import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseInitError, getFirestoreDb } from "./firebaseAdminService.js";

const DEFAULT_INBOX_COLLECTION = "inboxes";
const INBOX_TOKEN_BYTES = 18; // base64url -> 24 chars
const MAX_TOKEN_ATTEMPTS = 8;
const DELETE_BATCH_SIZE = 300;

export async function createOrGetInboxForUser(userId) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      ok: false,
      statusCode: 503,
      reason:
        getFirebaseInitError() ||
        "Inbox-tjänsten är inte tillgänglig eftersom Firestore saknar konfiguration i backend.",
    };
  }

  const safeUserId = String(userId || "").trim();
  if (!safeUserId) {
    return {
      ok: false,
      statusCode: 400,
      reason: "Kunde inte identifiera användaren för inbox-adressen.",
    };
  }

  const inboundDomain = normalizeInboundDomain(process.env.INBOUND_DOMAIN || "");
  if (!inboundDomain) {
    return {
      ok: false,
      statusCode: 503,
      reason:
        "INBOUND_DOMAIN saknas i backend-miljön. Lägg till t.ex. INBOUND_DOMAIN=in.minfakturakoll.se.",
    };
  }

  const collectionRef = getInboxCollectionRef(db);

  try {
    const existingToken = await findActiveInboxTokenByUser(collectionRef, safeUserId);
    if (existingToken) {
      return {
        ok: true,
        created: false,
        token: existingToken,
        inboxAddress: buildInboxAddress(existingToken, inboundDomain),
      };
    }

    const token = await generateUniqueInboxToken(collectionRef);
    await collectionRef.doc(token).set({
      uid: safeUserId,
      isActive: true,
      createdAt: FieldValue.serverTimestamp(),
      lastUsedAt: null,
      dailyCount: 0,
      dailyCountDate: getDateKeyUTC(new Date()),
    });

    return {
      ok: true,
      created: true,
      token,
      inboxAddress: buildInboxAddress(token, inboundDomain),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Okänt fel";
    return {
      ok: false,
      statusCode: 500,
      reason: `Inbox-adressen kunde inte skapas just nu. Detalj: ${message}`,
    };
  }
}

export async function deactivateInboxesForUser(userId) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      ok: false,
      reason:
        getFirebaseInitError() ||
        "Inbox-tjansten ar inte tillganglig eftersom Firestore saknar konfiguration i backend.",
    };
  }

  const safeUserId = String(userId || "").trim();
  if (!safeUserId) {
    return {
      ok: false,
      reason: "Kunde inte identifiera användaren för inboxradering.",
    };
  }

  const collectionRef = getInboxCollectionRef(db);
  let deactivatedCount = 0;

  while (true) {
    const snapshot = await collectionRef.where("uid", "==", safeUserId).limit(DELETE_BATCH_SIZE).get();
    if (snapshot.empty) break;

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.set(
        doc.ref,
        {
          isActive: false,
          deactivatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          deactivatedReason: "account_purge",
        },
        { merge: true }
      );
    });
    await batch.commit();
    deactivatedCount += snapshot.docs.length;
  }

  return {
    ok: true,
    deactivatedCount,
  };
}

function getInboxCollectionRef(db) {
  const collectionName = String(process.env.FIREBASE_INBOX_COLLECTION || DEFAULT_INBOX_COLLECTION).trim();
  return db.collection(collectionName || DEFAULT_INBOX_COLLECTION);
}

async function findActiveInboxTokenByUser(collectionRef, uid) {
  const snapshot = await collectionRef.where("uid", "==", uid).limit(20).get();
  const activeDoc = snapshot.docs.find((doc) => Boolean(doc.data()?.isActive));
  return activeDoc?.id || "";
}

async function generateUniqueInboxToken(collectionRef) {
  for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt += 1) {
    const token = createInboxToken();
    const exists = await collectionRef.doc(token).get();
    if (!exists.exists) {
      return token;
    }
  }

  throw new Error("Kunde inte skapa unik inbox-token efter flera försök.");
}

function createInboxToken() {
  return crypto.randomBytes(INBOX_TOKEN_BYTES).toString("base64url");
}

function buildInboxAddress(token, inboundDomain) {
  return `${token}@${inboundDomain}`;
}

function normalizeInboundDomain(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");

  return raw.includes("@") ? "" : raw;
}

function getDateKeyUTC(date) {
  return date.toISOString().slice(0, 10);
}
