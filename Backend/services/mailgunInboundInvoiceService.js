import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseInitError, getFirestoreDb, getStorageBucket } from "./firebaseAdminService.js";
import { saveHistoryEntry } from "./historyService.js";
import { scanInvoice } from "./invoiceService.js";
import { sanitizeInboundFilename } from "./mailgunInboundService.js";

const DEFAULT_INVOICE_COLLECTION = "invoices";
const DEFAULT_INBOUND_EMAIL_COLLECTION = "inboundEmails";
const DEFAULT_ANALYZE_TIMEOUT_MS = 90 * 1000;
const DEFAULT_ANALYSIS_POLL_MS = 12 * 1000;
const DEFAULT_ANALYSIS_AI_MAX_MB = 8;

const pendingInvoiceQueue = [];
const queuedInvoiceIds = new Set();
let workerRunning = false;
let workerStarted = false;
let pollTimer = null;

export async function processInboundAttachments({
  uid,
  token,
  recipient,
  fields = {},
  attachments = [],
}) {
  const db = getFirestoreDb();
  const bucket = getStorageBucket();
  if (!db || !bucket) {
    return {
      ok: false,
      statusCode: 503,
      reason:
        getFirebaseInitError() ||
        "Firebase is not configured for Firestore/Storage. Inbound processing is unavailable.",
    };
  }

  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    return {
      ok: false,
      statusCode: 202,
      reason: "Missing uid for inbound processing.",
    };
  }

  const safeAttachments = Array.isArray(attachments) ? attachments : [];
  if (!safeAttachments.length) {
    return {
      ok: true,
      acceptedCount: 0,
      duplicateCount: 0,
      errorCount: 0,
      createdInvoiceIds: [],
      inboundLogIds: [],
    };
  }

  const from = readField(fields, ["from", "sender"]);
  const subject = readField(fields, ["subject"]);
  const receivedAt =
    readField(fields, ["Date", "date", "message-headers"]) || new Date().toISOString();
  const tokenFingerprint = fingerprintToken(token);

  const createdInvoiceIds = [];
  const inboundLogIds = [];
  let duplicateCount = 0;
  let errorCount = 0;

  for (const attachment of safeAttachments) {
    const fileName = sanitizeInboundFilename(attachment?.fileName || "");
    const sha256 = String(attachment?.sha256 || "").trim().toLowerCase();
    const contentType = String(attachment?.contentType || "").trim().toLowerCase();
    const size = Number(attachment?.size || 0);
    const buffer = Buffer.isBuffer(attachment?.buffer) ? attachment.buffer : null;

    if (!buffer || !sha256 || size <= 0) {
      errorCount += 1;
      const logId = await logInboundEmail({
        db,
        uid: safeUid,
        token,
        recipient,
        from,
        subject,
        receivedAt,
        fileName,
        contentType,
        size,
        sha256,
        status: "blocked",
        reason: "Attachment is missing required metadata or bytes.",
      });
      if (logId) inboundLogIds.push(logId);
      continue;
    }

    try {
      const duplicate = await findDuplicateInvoiceByHash(db, safeUid, sha256);
      if (duplicate) {
        duplicateCount += 1;
        const logId = await logInboundEmail({
          db,
          uid: safeUid,
          token: tokenFingerprint,
          recipient,
          from,
          subject,
          receivedAt,
          fileName,
          contentType,
          size,
          sha256,
          status: "duplicate",
          reason: "Invoice with same SHA-256 already exists.",
          duplicateInvoiceId: duplicate.id,
        });
        if (logId) inboundLogIds.push(logId);
        continue;
      }

      const invoiceId = crypto.randomUUID();
      const storageName = ensureFileExtension(fileName, contentType);
      const storagePath = `invoices/${safeUid}/${invoiceId}/${storageName}`;

      await bucket.file(storagePath).save(buffer, {
        resumable: false,
        contentType,
        metadata: {
          metadata: {
            uid: safeUid,
            sha256,
            source: "email",
            tokenRef: tokenFingerprint,
          },
        },
      });

      await getInvoiceCollectionRef(db).doc(invoiceId).set({
        uid: safeUid,
        source: "email",
        status: "queued",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        file: {
          storagePath,
          sha256,
          filename: storageName,
          contentType,
          size,
        },
        emailMeta: {
          from,
          subject,
          receivedAt,
          recipient,
        },
        inboxTokenRef: tokenFingerprint,
      });

      const logId = await logInboundEmail({
        db,
        uid: safeUid,
        token: tokenFingerprint,
        recipient,
        from,
        subject,
        receivedAt,
        fileName: storageName,
        contentType,
        size,
        sha256,
        status: "queued",
        invoiceId,
      });
      if (logId) inboundLogIds.push(logId);

      createdInvoiceIds.push(invoiceId);
      enqueueInvoiceForAnalysis(invoiceId);
    } catch (error) {
      errorCount += 1;
      const reason = toErrorReason(error, "Failed to process inbound attachment.");
      const logId = await logInboundEmail({
        db,
        uid: safeUid,
        token: tokenFingerprint,
        recipient,
        from,
        subject,
        receivedAt,
        fileName,
        contentType,
        size,
        sha256,
        status: "error",
        reason,
      });
      if (logId) inboundLogIds.push(logId);
    }
  }

  return {
    ok: true,
    acceptedCount: createdInvoiceIds.length,
    duplicateCount,
    errorCount,
    createdInvoiceIds,
    inboundLogIds,
  };
}

export function startInboundInvoiceWorker() {
  if (workerStarted) return;
  workerStarted = true;

  const pollMs = clampPositiveInt(process.env.INBOUND_ANALYSIS_POLL_MS, DEFAULT_ANALYSIS_POLL_MS);
  pollTimer = setInterval(() => {
    void refillQueueFromFirestore();
  }, pollMs);
  if (typeof pollTimer.unref === "function") {
    pollTimer.unref();
  }

  void refillQueueFromFirestore();
}

function enqueueInvoiceForAnalysis(invoiceId) {
  const safeInvoiceId = String(invoiceId || "").trim();
  if (!safeInvoiceId || queuedInvoiceIds.has(safeInvoiceId)) return;
  queuedInvoiceIds.add(safeInvoiceId);
  pendingInvoiceQueue.push(safeInvoiceId);
  scheduleWorker();
}

function scheduleWorker() {
  if (workerRunning) return;
  setImmediate(() => {
    void runWorkerLoop();
  });
}

async function runWorkerLoop() {
  if (workerRunning) return;
  workerRunning = true;

  while (pendingInvoiceQueue.length > 0) {
    const invoiceId = pendingInvoiceQueue.shift();
    if (!invoiceId) continue;
    queuedInvoiceIds.delete(invoiceId);

    try {
      await analyzeQueuedInvoice(invoiceId);
    } catch (error) {
      console.error(`[mailgun inbound] analyze failed invoiceId=${invoiceId}`, error);
    }
  }

  workerRunning = false;
}

async function refillQueueFromFirestore() {
  const db = getFirestoreDb();
  if (!db) return;

  const collection = getInvoiceCollectionRef(db);
  const docs = await loadQueuedInvoiceDocs(collection, 20);
  docs.forEach((doc) => enqueueInvoiceForAnalysis(doc.id));
}

async function analyzeQueuedInvoice(invoiceId) {
  const db = getFirestoreDb();
  const bucket = getStorageBucket();
  if (!db || !bucket) {
    throw new Error(
      getFirebaseInitError() ||
        "Firebase is not configured for Firestore/Storage. Invoice analysis cannot run."
    );
  }

  const invoiceRef = getInvoiceCollectionRef(db).doc(invoiceId);
  const invoiceDoc = await invoiceRef.get();
  if (!invoiceDoc.exists) return;

  const invoiceData = invoiceDoc.data() || {};
  const status = String(invoiceData.status || "").toLowerCase();
  if (status === "done" || status === "processing") return;

  const uid = String(invoiceData.uid || "").trim();
  const fileMeta = invoiceData.file || {};
  const storagePath = String(fileMeta.storagePath || "").trim();
  const contentType = String(fileMeta.contentType || "").trim().toLowerCase();
  const fileName = sanitizeInboundFilename(fileMeta.filename || "invoice");
  const sha256 = String(fileMeta.sha256 || "").trim().toLowerCase();

  if (!uid || !storagePath || !contentType || !sha256) {
    await invoiceRef.set(
      {
        status: "error",
        errorMessage: "Invoice metadata is incomplete and cannot be analyzed.",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return;
  }

  await invoiceRef.set(
    {
      status: "processing",
      processingStartedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  try {
    const [buffer] = await bucket.file(storagePath).download();
    const emailMeta = invoiceData.emailMeta || {};
    const sourceText = buildAnalysisSeedText({
      from: emailMeta.from,
      subject: emailMeta.subject,
      fileName,
      recipient: emailMeta.recipient,
      receivedAt: emailMeta.receivedAt,
    });

    const filePayload = buildAnalysisFilePayload({ fileName, contentType, buffer });
    const analysis = await withTimeout(
      scanInvoice({
        text: sourceText,
        file: filePayload,
      }),
      clampPositiveInt(process.env.INBOUND_ANALYZE_TIMEOUT_MS, DEFAULT_ANALYZE_TIMEOUT_MS)
    );

    const historySave = await saveHistoryEntry({
      userId: uid,
      extracted: analysis.extracted,
      analysisMode: analysis.analysisMode,
      sourceType: "email",
      source: "email",
      fileName,
      filePayload,
      sourceText,
      fileSha256: sha256,
      emailMeta: {
        from: String(emailMeta.from || ""),
        subject: String(emailMeta.subject || ""),
        recipient: String(emailMeta.recipient || ""),
        receivedAt: String(emailMeta.receivedAt || ""),
      },
    });

    const historyId = historySave.ok ? historySave.id || "" : "";
    const historyWarning = historySave.ok
      ? ""
      : historySave.reason || "Analysis completed but history save failed.";

    await invoiceRef.set(
      {
        status: "done",
        extracted: analysis.extracted || null,
        fieldMeta: analysis.fieldMeta || {},
        analysisMode: analysis.analysisMode || "unknown",
        analysisWarning: [analysis.warning || "", historyWarning].filter(Boolean).join(" "),
        historyId,
        doneAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.log(
      `[mailgun inbound] analyzed invoiceId=${invoiceId} userRef=${fingerprintToken(uid)} historyId=${historyId || "-"}`
    );
  } catch (error) {
    const reason = toErrorReason(error, "Inbound analysis failed.");
    await invoiceRef.set(
      {
        status: "error",
        errorMessage: reason,
        failedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.error(
      `[mailgun inbound] invoice error invoiceId=${invoiceId} userRef=${fingerprintToken(uid)}: ${reason}`
    );
  }
}

async function findDuplicateInvoiceByHash(db, uid, sha256) {
  const collection = getInvoiceCollectionRef(db);

  try {
    const snapshot = await collection
      .where("uid", "==", uid)
      .where("file.sha256", "==", sha256)
      .limit(1)
      .get();
    if (!snapshot.empty) {
      return snapshot.docs[0];
    }
    return null;
  } catch (error) {
    if (!isMissingIndexError(error)) throw error;

    const fallbackSnapshot = await collection.where("uid", "==", uid).limit(250).get();
    const duplicate = fallbackSnapshot.docs.find(
      (doc) => String(doc.data()?.file?.sha256 || "").trim().toLowerCase() === sha256
    );
    return duplicate || null;
  }
}

async function logInboundEmail({
  db,
  uid,
  token,
  recipient,
  from,
  subject,
  receivedAt,
  fileName,
  contentType,
  size,
  sha256,
  status,
  reason = "",
  invoiceId = "",
  duplicateInvoiceId = "",
}) {
  try {
    const logRef = await getInboundEmailCollectionRef(db).add({
      uid: String(uid || "").trim(),
      tokenRef: String(token || "").trim(),
      recipient: String(recipient || "").trim(),
      emailMeta: {
        from: String(from || "").trim(),
        subject: String(subject || "").trim(),
        receivedAt: String(receivedAt || "").trim(),
      },
      attachment: {
        fileName: String(fileName || "").trim(),
        contentType: String(contentType || "").trim(),
        size: Number(size || 0),
        sha256: String(sha256 || "").trim().toLowerCase(),
      },
      status: String(status || "").trim().toLowerCase() || "received",
      reason: String(reason || "").trim(),
      invoiceId: String(invoiceId || "").trim(),
      duplicateInvoiceId: String(duplicateInvoiceId || "").trim(),
      createdAt: FieldValue.serverTimestamp(),
    });
    return logRef.id;
  } catch (error) {
    console.error("[mailgun inbound] failed to log inbound email", error);
    return "";
  }
}

function getInvoiceCollectionRef(db) {
  const collectionName = String(
    process.env.FIREBASE_INVOICE_COLLECTION || DEFAULT_INVOICE_COLLECTION
  ).trim();
  return db.collection(collectionName || DEFAULT_INVOICE_COLLECTION);
}

function getInboundEmailCollectionRef(db) {
  const collectionName = String(
    process.env.FIREBASE_INBOUND_EMAIL_COLLECTION || DEFAULT_INBOUND_EMAIL_COLLECTION
  ).trim();
  return db.collection(collectionName || DEFAULT_INBOUND_EMAIL_COLLECTION);
}

function buildAnalysisSeedText({ from, subject, fileName, recipient, receivedAt }) {
  return [
    "Inbound email invoice metadata:",
    `from: ${String(from || "").trim() || "-"}`,
    `subject: ${String(subject || "").trim() || "-"}`,
    `recipient: ${String(recipient || "").trim() || "-"}`,
    `received_at: ${String(receivedAt || "").trim() || "-"}`,
    `file_name: ${String(fileName || "").trim() || "-"}`,
  ].join("\n");
}

function buildAnalysisFilePayload({ fileName, contentType, buffer }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  if (!String(contentType || "").trim()) return null;

  const maxAiBytes =
    clampPositiveInt(process.env.INBOUND_ANALYSIS_AI_MAX_MB, DEFAULT_ANALYSIS_AI_MAX_MB) *
    1024 *
    1024;
  if (buffer.length > maxAiBytes) {
    return null;
  }

  const base64 = buffer.toString("base64");
  return {
    name: String(fileName || "invoice"),
    type: String(contentType || "application/octet-stream"),
    dataUrl: `data:${contentType};base64,${base64}`,
  };
}

function ensureFileExtension(fileName, contentType) {
  const safeName = sanitizeInboundFilename(fileName || "attachment");
  if (safeName.includes(".")) return safeName;

  const extMap = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
  };
  return `${safeName}${extMap[contentType] || ""}`;
}

async function loadQueuedInvoiceDocs(collection, limitCount) {
  try {
    const snapshot = await collection
      .where("status", "==", "queued")
      .orderBy("createdAt", "asc")
      .limit(limitCount)
      .get();
    return snapshot.docs;
  } catch (error) {
    if (!isMissingIndexError(error)) {
      console.error("[mailgun inbound] queued lookup failed", error);
      return [];
    }

    const fallback = await collection.where("status", "==", "queued").limit(limitCount * 3).get();
    return fallback.docs;
  }
}

function readField(fields, keys) {
  for (const key of keys) {
    if (!(key in fields)) continue;
    const value = fields[key];
    if (Array.isArray(value)) {
      const first = value.find((entry) => String(entry || "").trim());
      if (first) return String(first).trim();
      continue;
    }
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => clearTimeout(timer));
  });
}

function clampPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function isMissingIndexError(error) {
  const text = String(error || "").toLowerCase();
  return text.includes("requires an index") || text.includes("failed-precondition");
}

function toErrorReason(error, fallbackMessage) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 300);
  }
  return String(fallbackMessage || "Unknown inbound processing error.");
}

function fingerprintToken(value) {
  const safe = String(value || "").trim();
  if (!safe) return "";
  return crypto.createHash("sha256").update(safe).digest("hex").slice(0, 16);
}
