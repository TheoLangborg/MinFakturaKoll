import crypto from "node:crypto";
import Busboy from "@fastify/busboy";
import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseInitError, getFirestoreDb } from "./firebaseAdminService.js";

const DEFAULT_INBOX_COLLECTION = "inboxes";
const DEFAULT_MAX_ATTACHMENTS = 10;
const DEFAULT_MAX_MB = 15;
const DEFAULT_DAILY_LIMIT = 30;
const DEFAULT_SIGNATURE_MAX_AGE_SEC = 15 * 60;
const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export async function parseMailgunInboundPayload(req) {
  const contentType = String(req.headers?.["content-type"] || "").toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    return parseMultipartPayload(req);
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const raw = await readRawBody(req);
    const fields = parseUrlEncodedBody(raw.toString("utf8"));
    return {
      fields,
      attachments: [],
      limits: { filesLimitHit: false, truncatedFiles: [] },
    };
  }

  if (req.body && typeof req.body === "object") {
    return {
      fields: req.body,
      attachments: [],
      limits: { filesLimitHit: false, truncatedFiles: [] },
    };
  }

  throw new Error(
    `Unsupported inbound content-type: ${
      contentType || "unknown"
    }. Expected multipart/form-data or x-www-form-urlencoded.`
  );
}

export function verifyMailgunSignature(fields = {}) {
  const signingKey = String(process.env.MAILGUN_SIGNING_KEY || "").trim();
  if (!signingKey) {
    return {
      ok: false,
      statusCode: 503,
      reason: "MAILGUN_SIGNING_KEY is missing in backend environment.",
    };
  }

  const timestamp = getFieldValue(fields, ["timestamp", "signature.timestamp", "signature[timestamp]"]);
  const token = getFieldValue(fields, ["token", "signature.token", "signature[token]"]);
  const signature = getFieldValue(fields, [
    "signature",
    "signature.signature",
    "signature[signature]",
  ]);

  if (!timestamp || !token || !signature) {
    return {
      ok: false,
      statusCode: 401,
      reason: "Mailgun signature is missing in webhook payload.",
    };
  }

  const timestampSec = Number(timestamp);
  if (!Number.isFinite(timestampSec)) {
    return {
      ok: false,
      statusCode: 401,
      reason: "Mailgun signature contains invalid timestamp.",
    };
  }

  const maxAgeSec = clampPositiveInt(
    process.env.MAILGUN_SIGNATURE_MAX_AGE_SEC,
    DEFAULT_SIGNATURE_MAX_AGE_SEC
  );
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestampSec) > maxAgeSec) {
    return {
      ok: false,
      statusCode: 401,
      reason: "Mailgun signature timestamp is outside allowed window.",
    };
  }

  const expected = crypto.createHmac("sha256", signingKey).update(`${timestamp}${token}`).digest("hex");
  if (!safeCompare(expected, String(signature || "").toLowerCase())) {
    return {
      ok: false,
      statusCode: 401,
      reason: "Invalid Mailgun signature.",
    };
  }

  return { ok: true };
}

export function resolveInboundRecipient(fields = {}) {
  const inboundDomain = normalizeInboundDomain(process.env.INBOUND_DOMAIN || "");
  if (!inboundDomain) {
    return {
      ok: false,
      statusCode: 503,
      reason: "INBOUND_DOMAIN is missing in backend environment.",
    };
  }

  const candidates = [];
  const recipientField = getFieldValue(fields, ["recipient"]);
  const toField = getFieldValue(fields, ["to"]);
  if (recipientField) candidates.push(recipientField);
  if (toField) candidates.push(toField);

  const envelope = getFieldValue(fields, ["envelope"]);
  if (envelope) {
    try {
      const parsed = JSON.parse(envelope);
      const toValues = Array.isArray(parsed?.to) ? parsed.to : [];
      toValues.forEach((entry) => {
        if (entry) candidates.push(String(entry));
      });
    } catch {
      // Ignore malformed envelope and use other fields.
    }
  }

  const recipientEmail = extractAddressByDomain(candidates, inboundDomain);
  if (!recipientEmail) {
    return {
      ok: false,
      statusCode: 202,
      reason: "No recipient in expected inbound domain was found.",
    };
  }

  const token = extractTokenFromAddress(recipientEmail);
  if (!token) {
    return {
      ok: false,
      statusCode: 202,
      reason: "Recipient address does not contain a valid inbox token.",
    };
  }

  return {
    ok: true,
    token,
    recipient: recipientEmail,
  };
}

export async function resolveActiveInboxByToken(token) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      ok: false,
      statusCode: 503,
      reason:
        getFirebaseInitError() ||
        "Firestore configuration missing. Cannot map inbound token to user.",
    };
  }

  const safeToken = String(token || "").trim();
  if (!safeToken) {
    return {
      ok: false,
      statusCode: 202,
      reason: "Inbox token is missing in recipient address.",
    };
  }

  const collectionName = String(process.env.FIREBASE_INBOX_COLLECTION || DEFAULT_INBOX_COLLECTION).trim();
  const doc = await db.collection(collectionName || DEFAULT_INBOX_COLLECTION).doc(safeToken).get();

  if (!doc.exists) {
    return {
      ok: false,
      statusCode: 202,
      reason: "Inbox token not found.",
    };
  }

  const data = doc.data() || {};
  if (!Boolean(data.isActive)) {
    return {
      ok: false,
      statusCode: 202,
      reason: "Inbox token is inactive.",
    };
  }

  const uid = String(data.uid || "").trim();
  if (!uid) {
    return {
      ok: false,
      statusCode: 202,
      reason: "Inbox token has no mapped uid.",
    };
  }

  return {
    ok: true,
    token: safeToken,
    uid,
    inbox: data,
  };
}

export function validateInboundAttachments(attachments = [], limits = {}) {
  const maxAttachments = clampPositiveInt(process.env.INBOUND_MAX_ATTACHMENTS, DEFAULT_MAX_ATTACHMENTS);
  const maxBytes = clampPositiveInt(process.env.INBOUND_MAX_MB, DEFAULT_MAX_MB) * 1024 * 1024;

  const safeAttachments = Array.isArray(attachments) ? attachments : [];
  const filesLimitHit = Boolean(limits?.filesLimitHit);
  const truncatedFiles = Array.isArray(limits?.truncatedFiles) ? limits.truncatedFiles : [];

  if (filesLimitHit || truncatedFiles.length > 0) {
    return {
      ok: false,
      statusCode: 202,
      reason: "One or more attachments exceeded size or file-count limits.",
    };
  }

  if (!safeAttachments.length) {
    return {
      ok: false,
      statusCode: 202,
      reason: "Email has no attachments to import.",
    };
  }

  if (safeAttachments.length > maxAttachments) {
    return {
      ok: false,
      statusCode: 202,
      reason: `Email contains too many attachments. Max allowed is ${maxAttachments}.`,
    };
  }

  const validated = [];

  for (const attachment of safeAttachments) {
    const contentType = normalizeInboundContentType(attachment?.contentType);
    const fileName = sanitizeInboundFilename(attachment?.fileName || "");
    const size = Number(attachment?.size || 0);
    const sha256 = String(attachment?.sha256 || "").trim().toLowerCase();
    const buffer = Buffer.isBuffer(attachment?.buffer) ? attachment.buffer : null;

    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      return {
        ok: false,
        statusCode: 202,
        reason: `Attachment content type ${contentType || "(unknown)"} is not allowed.`,
      };
    }

    if (!Number.isFinite(size) || size <= 0 || size > maxBytes) {
      return {
        ok: false,
        statusCode: 202,
        reason: `Attachment is too large or invalid. Max size is ${
          Math.floor(maxBytes / (1024 * 1024))
        } MB.`,
      };
    }

    if (!buffer || buffer.length !== size) {
      return {
        ok: false,
        statusCode: 202,
        reason: `Attachment ${fileName || "(unknown file)"} could not be safely read.`,
      };
    }

    const inferredType = detectMagicContentType(buffer);
    if (!inferredType) {
      return {
        ok: false,
        statusCode: 202,
        reason: `Attachment ${fileName} has unknown or unsafe magic bytes.`,
      };
    }

    if (inferredType !== contentType) {
      return {
        ok: false,
        statusCode: 202,
        reason: `Attachment ${fileName} has mismatched type and was blocked.`,
      };
    }

    if (!sha256 || !/^[a-f0-9]{64}$/.test(sha256)) {
      return {
        ok: false,
        statusCode: 202,
        reason: `Attachment ${fileName} is missing a valid SHA-256 hash.`,
      };
    }

    validated.push({
      fieldName: String(attachment?.fieldName || "").trim(),
      fileName,
      encoding: String(attachment?.encoding || "").trim(),
      contentType,
      size,
      truncated: Boolean(attachment?.truncated),
      sha256,
      buffer,
    });
  }

  return {
    ok: true,
    attachmentCount: validated.length,
    attachments: validated,
  };
}

export async function reserveInboxDailyQuota(token, incrementBy) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      ok: false,
      statusCode: 503,
      reason:
        getFirebaseInitError() ||
        "Firestore configuration missing. Quota check cannot run.",
    };
  }

  const safeToken = String(token || "").trim();
  if (!safeToken) {
    return {
      ok: false,
      statusCode: 202,
      reason: "Inbox token is missing for quota check.",
    };
  }

  const requested = clampPositiveInt(incrementBy, 0);
  if (requested <= 0) {
    return {
      ok: true,
      dailyLimit: clampPositiveInt(process.env.INBOUND_DAILY_LIMIT, DEFAULT_DAILY_LIMIT),
      dailyCount: 0,
      remaining: clampPositiveInt(process.env.INBOUND_DAILY_LIMIT, DEFAULT_DAILY_LIMIT),
    };
  }

  const dailyLimit = clampPositiveInt(process.env.INBOUND_DAILY_LIMIT, DEFAULT_DAILY_LIMIT);
  const collectionName = String(process.env.FIREBASE_INBOX_COLLECTION || DEFAULT_INBOX_COLLECTION).trim();
  const inboxRef = db.collection(collectionName || DEFAULT_INBOX_COLLECTION).doc(safeToken);

  let result = null;
  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(inboxRef);
    if (!doc.exists) {
      result = {
        ok: false,
        statusCode: 202,
        reason: "Inbox token not found for quota check.",
      };
      return;
    }

    const data = doc.data() || {};
    if (!Boolean(data.isActive)) {
      result = {
        ok: false,
        statusCode: 202,
        reason: "Inbox token is inactive for quota check.",
      };
      return;
    }

    const today = getDateKeyUTC(new Date());
    const previousDate = String(data.dailyCountDate || "");
    const currentCount = previousDate === today ? clampPositiveInt(data.dailyCount, 0) : 0;
    const nextCount = currentCount + requested;

    if (nextCount > dailyLimit) {
      result = {
        ok: false,
        statusCode: 202,
        reason: `Daily inbox limit reached (${dailyLimit} attachments/day).`,
        dailyLimit,
        dailyCount: currentCount,
        remaining: Math.max(0, dailyLimit - currentCount),
      };
      return;
    }

    transaction.set(
      inboxRef,
      {
        dailyCount: nextCount,
        dailyCountDate: today,
        lastUsedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    result = {
      ok: true,
      dailyLimit,
      dailyCount: nextCount,
      remaining: Math.max(0, dailyLimit - nextCount),
    };
  });

  return (
    result || {
      ok: false,
      statusCode: 500,
      reason: "Quota check failed.",
    }
  );
}

function parseMultipartPayload(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const attachments = [];
    const truncatedFiles = [];
    let filesLimitHit = false;

    const maxAttachments = clampPositiveInt(
      process.env.INBOUND_MAX_ATTACHMENTS,
      DEFAULT_MAX_ATTACHMENTS
    );
    const maxBytes = clampPositiveInt(process.env.INBOUND_MAX_MB, DEFAULT_MAX_MB) * 1024 * 1024;

    const busboy = new Busboy({
      headers: req.headers,
      limits: {
        files: maxAttachments,
        fileSize: maxBytes,
      },
    });

    busboy.on("field", (fieldName, value) => {
      appendField(fields, fieldName, value);
    });

    busboy.on("file", (fieldName, stream, fileName, encoding, mimeType) => {
      let size = 0;
      let truncated = false;
      const chunks = [];
      const hasher = crypto.createHash("sha256");

      stream.on("data", (chunk) => {
        size += chunk.length;
        hasher.update(chunk);
        chunks.push(chunk);
      });

      stream.on("limit", () => {
        truncated = true;
      });

      stream.on("end", () => {
        const cleanName = sanitizeInboundFilename(fileName || "");
        const buffer = Buffer.concat(chunks);
        const sha256 = hasher.digest("hex");
        const attachmentMeta = {
          fieldName: String(fieldName || "").trim(),
          fileName: cleanName,
          encoding: String(encoding || "").trim(),
          contentType: normalizeInboundContentType(mimeType),
          size,
          truncated,
          sha256,
          buffer,
        };
        attachments.push(attachmentMeta);
        if (truncated) {
          truncatedFiles.push(cleanName || "(unknown file)");
        }
      });

      stream.on("error", reject);
    });

    busboy.on("filesLimit", () => {
      filesLimitHit = true;
    });
    busboy.on("error", (error) => {
      reject(error);
    });
    busboy.on("finish", () => {
      resolve({
        fields,
        attachments,
        limits: {
          filesLimitHit,
          truncatedFiles,
          maxAttachments,
          maxBytes,
        },
      });
    });

    req.pipe(busboy);
  });
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseUrlEncodedBody(raw) {
  const parsed = {};
  const params = new URLSearchParams(String(raw || ""));
  for (const [key, value] of params.entries()) {
    appendField(parsed, key, value);
  }
  return parsed;
}

function appendField(target, key, value) {
  const safeKey = String(key || "").trim();
  if (!safeKey) return;

  if (!(safeKey in target)) {
    target[safeKey] = value;
    return;
  }

  const current = target[safeKey];
  if (Array.isArray(current)) {
    current.push(value);
    return;
  }

  target[safeKey] = [current, value];
}

function getFieldValue(fields, keys) {
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

function normalizeInboundDomain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

function extractAddressByDomain(values, inboundDomain) {
  const allCandidates = [];
  values.forEach((value) => {
    const text = String(value || "");
    const found = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    // Keep original local-part casing. Firestore inbox tokens are case-sensitive.
    found.forEach((entry) => allCandidates.push(String(entry).trim()));
  });

  const match = allCandidates.find((email) =>
    String(email || "").toLowerCase().endsWith(`@${inboundDomain}`)
  );
  return match || "";
}

function extractTokenFromAddress(address) {
  // Do not lowercase token: document IDs in Firestore are case-sensitive.
  const email = String(address || "").trim();
  if (!email.includes("@")) return "";
  const localPart = email.split("@")[0] || "";
  const token = localPart.split("+")[0] || "";
  if (!/^[a-z0-9_-]{10,80}$/i.test(token)) return "";
  return token;
}

function safeCompare(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function clampPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function getDateKeyUTC(date) {
  return date.toISOString().slice(0, 10);
}

function detectMagicContentType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return "";

  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return "";
}

function normalizeInboundContentType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "image/jpg") return "image/jpeg";
  return raw;
}

export function sanitizeInboundFilename(value) {
  const raw = String(value || "").trim().replace(/[/\\?%*:|"<>]/g, "_");
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return "attachment.bin";
  return cleaned.slice(0, 140);
}
