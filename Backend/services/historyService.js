import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseInitError, getFirestoreDb } from "./firebaseAdminService.js";

const DEFAULT_COLLECTION = "invoice_history";
const DELETE_BATCH_SIZE = 400;
const MAX_PREVIEW_DATA_URL_LENGTH = 720000;
const MAX_TEXT_PREVIEW_LENGTH = 12000;

export async function saveHistoryEntry({
  userId,
  extracted,
  analysisMode = "unknown",
  sourceType = "text",
  fileName = "",
  filePayload = null,
  sourceText = "",
}) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      ok: false,
      reason:
        getFirebaseInitError() ||
        "Historiktjänsten är inte tillgänglig eftersom Firestore saknar konfiguration i backend.",
    };
  }

  if (!userId) {
    return { ok: false, reason: "Kunde inte identifiera användaren för historikposten." };
  }

  const payload = buildHistoryPayload({
    userId,
    extracted,
    analysisMode,
    sourceType,
    fileName,
    filePayload,
    sourceText,
  });

  const docRef = await getCollectionRef(db).add({
    ...payload,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, id: docRef.id };
}

export async function listHistoryEntries(userId, limit = 40) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      enabled: false,
      items: [],
      warning:
        getFirebaseInitError() ||
        "Historiktjänsten är inte tillgänglig eftersom Firestore saknar konfiguration i backend.",
    };
  }

  if (!userId) {
    return { enabled: true, items: [], warning: "Ingen användarsession hittades för historiken." };
  }

  const safeLimit = clampNumber(limit, 1, 200, 40);
  const { docs, warning } = await loadUserHistoryDocs(db, userId, safeLimit);

  const items = docs
    .map((doc) => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        vendorName: data.vendorName || "",
        category: data.category || "",
        billingType: normalizeBillingType(data.billingType, {
          category: data.category,
          monthlyCost: data.monthlyCost,
          totalAmount: data.totalAmount,
        }),
        monthlyCost: data.monthlyCost ?? null,
        totalAmount: data.totalAmount ?? null,
        currency: data.currency || "SEK",
        dueDate: data.dueDate || null,
        invoiceDate: data.invoiceDate || null,
        customerNumber: data.customerNumber || "",
        invoiceNumber: data.invoiceNumber || "",
        organizationNumber: data.organizationNumber || "",
        ocrNumber: data.ocrNumber || "",
        vatAmount: data.vatAmount ?? null,
        paymentMethod: data.paymentMethod || "",
        status: data.status || inferStatus(data.dueDate),
        confidence: data.confidence ?? null,
        sourceType: data.sourceType || "text",
        fileName: data.fileName || "",
        filePreview: normalizeStoredFilePreview(data.filePreview, data.fileName, data.sourceType),
        scannedAt: data.scannedAt || null,
        createdAt:
          typeof data.createdAt?.toDate === "function"
            ? data.createdAt.toDate().toISOString()
            : null,
        analysisMode: data.analysisMode || "unknown",
      };
    })
    .sort((a, b) => {
      const aTime = Date.parse(a.createdAt || "") || 0;
      const bTime = Date.parse(b.createdAt || "") || 0;
      return bTime - aTime;
    })
    .slice(0, safeLimit);

  return { enabled: true, items, warning };
}

export async function updateHistoryEntry(userId, id, extracted = {}) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      ok: false,
      reason:
        getFirebaseInitError() ||
        "Historiktjänsten är inte tillgänglig eftersom Firestore saknar konfiguration i backend.",
    };
  }

  if (!userId) {
    return { ok: false, reason: "Ingen användarsession hittades för uppdateringen." };
  }

  const safeId = String(id || "").trim();
  if (!safeId) {
    return { ok: false, reason: "Historikpostens id saknas i förfrågan." };
  }

  const docRef = getCollectionRef(db).doc(safeId);
  const existing = await docRef.get();
  if (!existing.exists) {
    return { ok: false, reason: "Historikposten finns inte." };
  }

  const existingData = existing.data() || {};
  const ownerId = existingData.userId || "";
  if (ownerId !== userId) {
    return { ok: false, reason: "Du saknar åtkomst till historikposten." };
  }

  const dueDate = extracted?.dueDate || null;
  const billingType = normalizeBillingType(extracted?.billingType ?? existingData.billingType, {
    category: extracted?.category ?? existingData.category,
    monthlyCost: extracted?.monthlyCost ?? existingData.monthlyCost,
    totalAmount: extracted?.totalAmount ?? existingData.totalAmount,
  });
  await docRef.set(
    {
      vendorName: extracted?.vendorName || "",
      category: extracted?.category || "",
      billingType,
      monthlyCost: extracted?.monthlyCost ?? null,
      totalAmount: extracted?.totalAmount ?? null,
      currency: extracted?.currency || "SEK",
      dueDate,
      invoiceDate: extracted?.invoiceDate || null,
      customerNumber: extracted?.customerNumber || "",
      invoiceNumber: extracted?.invoiceNumber || "",
      organizationNumber: extracted?.organizationNumber || "",
      ocrNumber: extracted?.ocrNumber || "",
      vatAmount: extracted?.vatAmount ?? null,
      paymentMethod: extracted?.paymentMethod || "",
      confidence: extracted?.confidence ?? null,
      status: inferStatus(dueDate),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true };
}

export async function deleteHistoryEntry(userId, id) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      ok: false,
      reason:
        getFirebaseInitError() ||
        "Historiktjänsten är inte tillgänglig eftersom Firestore saknar konfiguration i backend.",
    };
  }

  if (!userId) {
    return { ok: false, reason: "Ingen användarsession hittades för radering." };
  }

  const safeId = String(id || "").trim();
  if (!safeId) {
    return { ok: false, reason: "Historikpostens id saknas i förfrågan." };
  }

  const docRef = getCollectionRef(db).doc(safeId);
  const existing = await docRef.get();
  if (!existing.exists) {
    return { ok: false, reason: "Historikposten finns inte." };
  }

  const ownerId = existing.data()?.userId || "";
  if (ownerId !== userId) {
    return { ok: false, reason: "Du saknar åtkomst till historikposten." };
  }

  await docRef.delete();
  return { ok: true, deletedCount: 1 };
}

export async function deleteHistoryEntries(userId, ids = []) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      ok: false,
      reason:
        getFirebaseInitError() ||
        "Historiktjänsten är inte tillgänglig eftersom Firestore saknar konfiguration i backend.",
    };
  }

  if (!userId) {
    return { ok: false, reason: "Ingen användarsession hittades för radering." };
  }

  const safeIds = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!safeIds.length) {
    return { ok: false, reason: "Inga giltiga historik-id skickades in för radering." };
  }

  let deletedCount = 0;

  for (let start = 0; start < safeIds.length; start += DELETE_BATCH_SIZE) {
    const chunk = safeIds.slice(start, start + DELETE_BATCH_SIZE);
    const checks = await Promise.all(
      chunk.map(async (entryId) => {
        const docRef = getCollectionRef(db).doc(entryId);
        const doc = await docRef.get();
        if (!doc.exists) return null;
        if ((doc.data()?.userId || "") !== userId) return null;
        return docRef;
      })
    );

    const refs = checks.filter(Boolean);
    if (!refs.length) continue;

    const batch = db.batch();
    refs.forEach((ref) => batch.delete(ref));
    await batch.commit();
    deletedCount += refs.length;
  }

  return { ok: true, deletedCount };
}

export async function deleteAllHistoryEntries(userId) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      ok: false,
      reason:
        getFirebaseInitError() ||
        "Historiktjänsten är inte tillgänglig eftersom Firestore saknar konfiguration i backend.",
    };
  }

  if (!userId) {
    return { ok: false, reason: "Ingen användarsession hittades för radering." };
  }

  let deletedCount = 0;

  while (true) {
    const snapshot = await getCollectionRef(db)
      .where("userId", "==", userId)
      .limit(DELETE_BATCH_SIZE)
      .get();
    if (snapshot.empty) break;

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    deletedCount += snapshot.docs.length;
  }

  return { ok: true, deletedCount };
}

function buildHistoryPayload({
  userId,
  extracted = {},
  analysisMode,
  sourceType,
  fileName,
  filePayload,
  sourceText,
}) {
  const dueDate = extracted?.dueDate || null;
  return {
    userId,
    vendorName: extracted?.vendorName || "",
    category: extracted?.category || "",
    billingType: normalizeBillingType(extracted?.billingType, {
      category: extracted?.category,
      monthlyCost: extracted?.monthlyCost,
      totalAmount: extracted?.totalAmount,
    }),
    monthlyCost: extracted?.monthlyCost ?? null,
    totalAmount: extracted?.totalAmount ?? null,
    currency: extracted?.currency || "SEK",
    dueDate,
    invoiceDate: extracted?.invoiceDate || null,
    customerNumber: extracted?.customerNumber || "",
    invoiceNumber: extracted?.invoiceNumber || "",
    organizationNumber: extracted?.organizationNumber || "",
    ocrNumber: extracted?.ocrNumber || "",
    vatAmount: extracted?.vatAmount ?? null,
    paymentMethod: extracted?.paymentMethod || "",
    confidence: extracted?.confidence ?? null,
    status: inferStatus(dueDate),
    sourceType,
    fileName,
    filePreview: buildHistoryFilePreview({ sourceType, fileName, filePayload, sourceText }),
    analysisMode,
    scannedAt: new Date().toISOString(),
  };
}

function inferStatus(dueDate) {
  if (!dueDate) return "Okänt";
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return "Okänt";

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return "Förfallen";
  if (diffDays <= 7) return "Förfaller snart";
  return "Aktiv";
}

function normalizeBillingType(value, context = {}) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (normalized === "abonnemang" || normalized === "subscription" || normalized === "recurring") {
    return "Abonnemang";
  }
  if (normalized === "engang" || normalized === "one-time" || normalized === "onetime") {
    return "Engång";
  }
  if (normalized === "oklart" || normalized === "okant") {
    return "Oklart";
  }

  return inferBillingTypeFromContext(context);
}

function inferBillingTypeFromContext(context = {}) {
  const category = String(context?.category || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const monthlyCost = toFiniteNumber(context?.monthlyCost);
  const totalAmount = toFiniteNumber(context?.totalAmount);

  if (/(tjanst|service|hantverk|installation|renovering|bygg|rot)/.test(category)) {
    return "Engång";
  }
  if (monthlyCost != null && monthlyCost > 0) {
    return "Abonnemang";
  }
  if (totalAmount != null && totalAmount > 0) {
    return "Engång";
  }
  return "Oklart";
}

function getCollectionRef(db) {
  const collectionName = process.env.FIREBASE_HISTORY_COLLECTION || DEFAULT_COLLECTION;
  return db.collection(collectionName);
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
}

function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const cleaned = value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, "")
    .replace(/kr|sek|eur|usd/gi, "")
    .replace(",", ".");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildHistoryFilePreview({ sourceType, fileName, filePayload, sourceText }) {
  const safeFileName = String(fileName || filePayload?.name || "").trim();
  const safeSourceType = String(sourceType || "").trim().toLowerCase();
  const dataUrl = typeof filePayload?.dataUrl === "string" ? filePayload.dataUrl.trim() : "";
  const fileType = String(filePayload?.type || "").trim().toLowerCase();

  if (safeSourceType === "file") {
    const previewKind = inferPreviewKind(fileType, safeFileName);
    if ((previewKind === "image" || previewKind === "pdf") && dataUrl.startsWith("data:")) {
      if (dataUrl.length <= MAX_PREVIEW_DATA_URL_LENGTH) {
        return {
          previewKind,
          previewSrc: dataUrl,
          textPreview: "",
          fileName: safeFileName,
          fileType: fileType || "",
          unavailableReason: "",
        };
      }

      return {
        previewKind: "unavailable",
        previewSrc: "",
        textPreview: "",
        fileName: safeFileName,
        fileType: fileType || "",
        unavailableReason: "Filen var för stor för att sparas i historikförhandsvisning.",
      };
    }

    return {
      previewKind: "unavailable",
      previewSrc: "",
      textPreview: "",
      fileName: safeFileName,
      fileType: fileType || "",
      unavailableReason: "Ingen visuell förhandsvisning kunde sparas för filtypen.",
    };
  }

  const textPreview = String(sourceText || "").trim().slice(0, MAX_TEXT_PREVIEW_LENGTH);
  if (textPreview) {
    return {
      previewKind: "text",
      previewSrc: "",
      textPreview,
      fileName: safeFileName,
      fileType: fileType || "text/plain",
      unavailableReason: "",
    };
  }

  return null;
}

function normalizeStoredFilePreview(rawPreview, fileName, sourceType) {
  if (!rawPreview || typeof rawPreview !== "object") return null;

  const previewKind = String(rawPreview.previewKind || "").trim().toLowerCase();
  const normalizedKind =
    previewKind === "image" || previewKind === "pdf" || previewKind === "text"
      ? previewKind
      : "unavailable";

  const previewSrc =
    typeof rawPreview.previewSrc === "string" &&
    rawPreview.previewSrc.startsWith("data:") &&
    rawPreview.previewSrc.length <= MAX_PREVIEW_DATA_URL_LENGTH
      ? rawPreview.previewSrc
      : "";
  const textPreview =
    typeof rawPreview.textPreview === "string"
      ? rawPreview.textPreview.slice(0, MAX_TEXT_PREVIEW_LENGTH)
      : "";

  return {
    previewKind: normalizedKind,
    previewSrc,
    textPreview,
    fileName: String(rawPreview.fileName || fileName || "").trim(),
    fileType: String(rawPreview.fileType || "").trim(),
    unavailableReason: String(rawPreview.unavailableReason || "").trim(),
    sourceType: String(sourceType || "").trim().toLowerCase(),
  };
}

function inferPreviewKind(fileType, fileName) {
  if (fileType.startsWith("image/")) return "image";
  if (fileType === "application/pdf") return "pdf";

  const lowerName = String(fileName || "").toLowerCase();
  if (lowerName.endsWith(".pdf")) return "pdf";
  if (
    lowerName.endsWith(".png") ||
    lowerName.endsWith(".jpg") ||
    lowerName.endsWith(".jpeg") ||
    lowerName.endsWith(".webp")
  ) {
    return "image";
  }

  return "unavailable";
}

async function loadUserHistoryDocs(db, userId, safeLimit) {
  try {
    const snapshot = await getCollectionRef(db)
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .limit(safeLimit)
      .get();
    return { docs: snapshot.docs, warning: "" };
  } catch (error) {
    const message = String(error || "").toLowerCase();
    const isIndexError =
      message.includes("requires an index") || message.includes("failed-precondition");

    if (!isIndexError) throw error;

    const fallbackSnapshot = await getCollectionRef(db)
      .where("userId", "==", userId)
      .limit(Math.max(safeLimit * 3, 120))
      .get();

    return {
      docs: fallbackSnapshot.docs,
      warning:
        "Historik hämtades i kompatibilitetsläge eftersom Firestore-index saknas. Skapa indexet för snabbare laddning.",
    };
  }
}
