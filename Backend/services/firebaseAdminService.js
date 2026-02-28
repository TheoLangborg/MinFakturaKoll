import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(MODULE_DIR, "..");

let firestoreDb = null;
let authClient = null;
let firebaseInitError = "";
let initialized = false;

export function getFirestoreDb() {
  ensureInitialized();
  return firestoreDb;
}

export function getFirebaseAuth() {
  ensureInitialized();
  return authClient;
}

export function getFirebaseInitError() {
  ensureInitialized();
  return firebaseInitError;
}

function ensureInitialized() {
  if (initialized) return;
  initialized = true;

  try {
    const serviceAccount = loadServiceAccountFromPath() || loadServiceAccountFromEnv();

    if (!serviceAccount) {
      firebaseInitError =
        "Firebase Admin är inte konfigurerat. Lägg till FIREBASE_SERVICE_ACCOUNT_PATH (rekommenderat) eller FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL och FIREBASE_PRIVATE_KEY i backend/.env.";
      firestoreDb = null;
      authClient = null;
      return;
    }

    if (!getApps().length) {
      initializeApp({
        credential: cert(serviceAccount),
      });
    }

    firestoreDb = getFirestore();
    authClient = getAuth();
  } catch (error) {
    const detail = toErrorSummary(error);
    firebaseInitError = detail
      ? `Firebase Admin kunde inte startas. Kontrollera backend/.env och service account-filen. Detalj: ${detail}`
      : "Firebase Admin kunde inte startas. Kontrollera backend/.env och service account-filen.";
    firestoreDb = null;
    authClient = null;
  }
}

function loadServiceAccountFromPath() {
  const pathFromEnv =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS || "";

  if (!pathFromEnv) return null;

  const candidatePaths = path.isAbsolute(pathFromEnv)
    ? [pathFromEnv]
    : [path.resolve(process.cwd(), pathFromEnv), path.resolve(BACKEND_ROOT, pathFromEnv)];

  const resolvedPath = candidatePaths.find((candidate) => fs.existsSync(candidate));
  if (!resolvedPath) {
    throw new Error(
      `Service account-filen hittades inte. Kontrollerade sökvägar: ${candidatePaths.join(", ")}`
    );
  }

  const raw = fs.readFileSync(resolvedPath, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error("Service account-filen saknar project_id, client_email eller private_key.");
  }

  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
  };
}

function loadServiceAccountFromEnv() {
  const projectId = (process.env.FIREBASE_PROJECT_ID || "").trim();
  const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY || "";

  if (!projectId || !clientEmail || !privateKeyRaw) return null;

  const privateKey = normalizePrivateKey(privateKeyRaw);
  if (!privateKey.includes("BEGIN PRIVATE KEY") || !privateKey.includes("END PRIVATE KEY")) {
    throw new Error(
      "FIREBASE_PRIVATE_KEY har ogiltigt format. Använd gärna FIREBASE_SERVICE_ACCOUNT_PATH istället."
    );
  }

  return {
    projectId,
    clientEmail,
    privateKey,
  };
}

function normalizePrivateKey(rawValue) {
  return String(rawValue)
    .trim()
    .replace(/^"(.*)"$/s, "$1")
    .replace(/\\n/g, "\n");
}

function toErrorSummary(error) {
  if (error instanceof Error) return error.message.trim();
  return String(error || "").trim();
}
