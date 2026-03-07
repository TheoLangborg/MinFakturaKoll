import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreDb, getFirebaseInitError } from "../services/firebaseAdminService.js";

const DEFAULT_INVOICE_COLLECTION = "invoices";
const DEFAULT_INBOUND_EMAIL_COLLECTION = "inboundEmails";
const BATCH_SIZE = 200;

async function main() {
  const db = getFirestoreDb();
  if (!db) {
    throw new Error(
      getFirebaseInitError() ||
        "Firestore is not configured. Check Backend/.env before running scrub script."
    );
  }

  const invoiceCollection = String(
    process.env.FIREBASE_INVOICE_COLLECTION || DEFAULT_INVOICE_COLLECTION
  ).trim();
  const inboundCollection = String(
    process.env.FIREBASE_INBOUND_EMAIL_COLLECTION || DEFAULT_INBOUND_EMAIL_COLLECTION
  ).trim();

  const invoiceStats = await scrubCollection({
    db,
    collectionName: invoiceCollection || DEFAULT_INVOICE_COLLECTION,
    onDoc: buildInvoiceUpdate,
  });
  const inboundStats = await scrubCollection({
    db,
    collectionName: inboundCollection || DEFAULT_INBOUND_EMAIL_COLLECTION,
    onDoc: buildInboundEmailUpdate,
  });

  console.log(
    `[scrub] done invoices checked=${invoiceStats.checked} updated=${invoiceStats.updated} | inbound checked=${inboundStats.checked} updated=${inboundStats.updated}`
  );
}

async function scrubCollection({ db, collectionName, onDoc }) {
  let checked = 0;
  let updated = 0;
  let cursor = null;

  while (true) {
    let query = db.collection(collectionName).orderBy("__name__").limit(BATCH_SIZE);
    if (cursor) {
      query = query.startAfter(cursor);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    const batch = db.batch();
    let batchWrites = 0;
    for (const doc of snapshot.docs) {
      checked += 1;
      const updatePayload = onDoc(doc.data() || {});
      if (!updatePayload || !Object.keys(updatePayload).length) continue;
      batch.set(
        doc.ref,
        {
          ...updatePayload,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      batchWrites += 1;
      updated += 1;
    }

    if (batchWrites > 0) {
      await batch.commit();
    }

    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < BATCH_SIZE) break;
  }

  return { checked, updated };
}

function buildInvoiceUpdate(data) {
  const rawToken = String(data.inboxToken || "").trim();
  if (!rawToken) return null;

  return {
    inboxTokenRef: fingerprint(rawToken),
    inboxToken: FieldValue.delete(),
  };
}

function buildInboundEmailUpdate(data) {
  const rawToken = String(data.token || "").trim();
  if (!rawToken) return null;

  return {
    tokenRef: fingerprint(rawToken),
    token: FieldValue.delete(),
  };
}

function fingerprint(value) {
  const safe = String(value || "").trim();
  if (!safe) return "";
  return crypto.createHash("sha256").update(safe).digest("hex").slice(0, 16);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  console.error(`[scrub] failed: ${message}`);
  process.exitCode = 1;
});
