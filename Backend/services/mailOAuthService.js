import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseInitError, getFirestoreDb } from "./firebaseAdminService.js";

const DEFAULT_CONNECTION_COLLECTION = "mail_oauth_connections";
const DEFAULT_STATE_COLLECTION = "mail_oauth_states";
const STATE_TTL_MS = 10 * 60 * 1000;
const DELETE_BATCH_SIZE = 300;
const STATE_CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
const STATE_CLEANUP_BATCH_SIZE = 200;
const TOKEN_REFRESH_SKEW_MS = 2 * 60 * 1000;

const DEFAULT_IMPORT_TYPES = Object.freeze({
  invoices: true,
  receipts: false,
  confirmations: false,
});

const DEFAULT_SYNC_STATS = Object.freeze({
  scanned: 0,
  importedMessages: 0,
  importedAttachments: 0,
  queuedForReview: 0,
  blocked: 0,
  errors: 0,
});

let lastStateCleanupAt = 0;
let stateCleanupInProgress = false;

const PROVIDER_CONFIG = {
  gmail: {
    id: "gmail",
    label: "Gmail",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    scopesEnvName: "GOOGLE_OAUTH_SCOPES",
    clientIdEnvName: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnvName: "GOOGLE_OAUTH_CLIENT_SECRET",
    redirectUriEnvName: "GOOGLE_OAUTH_REDIRECT_URI",
    defaultScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  },
  outlook: {
    id: "outlook",
    label: "Outlook",
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    revokeUrl: "",
    scopesEnvName: "MICROSOFT_OAUTH_SCOPES",
    clientIdEnvName: "MICROSOFT_OAUTH_CLIENT_ID",
    clientSecretEnvName: "MICROSOFT_OAUTH_CLIENT_SECRET",
    redirectUriEnvName: "MICROSOFT_OAUTH_REDIRECT_URI",
    defaultScopes: ["offline_access", "openid", "profile", "email", "User.Read", "Mail.Read"],
  },
};

const REQUIRED_CONSENT_FLAGS = [
  "privacyAccepted",
  "termsAccepted",
  "cookiesAccepted",
  "securityAccepted",
  "oauthDataUseAccepted",
];

export function listSupportedMailProviders() {
  return Object.values(PROVIDER_CONFIG).map((provider) => ({
    id: provider.id,
    label: provider.label,
  }));
}

export async function getMailConnectionStatusForUser(userId) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      ok: false,
      enabled: false,
      providers: [],
      reason:
        getFirebaseInitError() ||
        "Mailkopplingar ar inte tillgangliga eftersom Firestore saknar konfiguration.",
    };
  }

  const safeUserId = String(userId || "").trim();
  if (!safeUserId) {
    return {
      ok: false,
      enabled: true,
      providers: [],
      reason: "Kunde inte identifiera användaren.",
      statusCode: 400,
    };
  }

  const encryptionState = resolveTokenEncryptionState();
  const collectionRef = getConnectionCollectionRef(db);
  const providers = [];

  for (const providerId of Object.keys(PROVIDER_CONFIG)) {
    const providerRuntime = resolveProviderRuntimeConfig(providerId, encryptionState);
    const docRef = collectionRef.doc(buildConnectionDocId(safeUserId, providerId));
    const doc = await docRef.get();
    const data = doc.data() || {};
    const isConnected = Boolean(doc.exists && String(data.status || "") === "connected");

    providers.push({
      provider: providerId,
      label: providerRuntime.label,
      configured: providerRuntime.configured,
      missingConfig: providerRuntime.missingConfig,
      connected: isConnected,
      status: isConnected ? "connected" : "not_connected",
      accountEmail: String(data.accountEmail || "").trim(),
      connectedAt: toIsoTimestamp(data.connectedAt),
      updatedAt: toIsoTimestamp(data.updatedAt),
      disconnectedAt: toIsoTimestamp(data.disconnectedAt),
      consentApprovedAt: toIsoTimestamp(data?.consent?.approvedAt),
      scopes: normalizeScopesArray(data.scopes),
      autoImportEnabled: Boolean(data?.sync?.autoImportEnabled),
      importTypes: normalizeImportTypes(data?.sync?.importTypes),
      lastSyncAt: toIsoTimestamp(data?.sync?.lastSyncAt),
      lastSyncStatus: String(data?.sync?.lastSyncStatus || "").trim(),
      lastSyncMessage: String(data?.sync?.lastSyncMessage || "").trim(),
      lastSyncStats: normalizeSyncStats(data?.sync?.lastSyncStats),
      pendingReviewCount: clampPositiveInt(data?.sync?.pendingReviewCount, 0),
      warning: String(data?.metadata?.warning || "").trim(),
    });
  }

  return {
    ok: true,
    enabled: true,
    providers,
    encryptionReady: encryptionState.ok,
    encryptionWarning: encryptionState.ok ? "" : encryptionState.reason,
  };
}

export async function startMailConnection({
  userId,
  userEmail,
  provider,
  consent,
  policyVersions,
  requestOrigin,
  returnPath,
}) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      ok: false,
      statusCode: 503,
      reason:
        getFirebaseInitError() ||
        "Mailkopplingar ar inte tillgangliga eftersom Firestore saknar konfiguration.",
    };
  }

  void maybeCleanupOauthStates();

  const safeUserId = String(userId || "").trim();
  if (!safeUserId) {
    return {
      ok: false,
      statusCode: 400,
      reason: "Kunde inte identifiera användaren.",
    };
  }

  const providerId = normalizeProvider(provider);
  if (!providerId) {
    return {
      ok: false,
      statusCode: 400,
      reason: "Vald mailprovider stodjs inte.",
    };
  }

  const encryptionState = resolveTokenEncryptionState();
  if (!encryptionState.ok) {
    return {
      ok: false,
      statusCode: 503,
      reason: encryptionState.reason,
    };
  }

  const providerRuntime = resolveProviderRuntimeConfig(providerId, encryptionState);
  if (!providerRuntime.configured) {
    return {
      ok: false,
      statusCode: 503,
      reason: `OAuth for ${providerRuntime.label} ar inte fullstandigt konfigurerad i backend.`,
      missingConfig: providerRuntime.missingConfig,
    };
  }

  const consentValidation = validateConsentPayload(consent);
  if (!consentValidation.ok) {
    return {
      ok: false,
      statusCode: 400,
      reason: "Alla samtycken maste vara accepterade innan du kan koppla konto.",
      missingConsent: consentValidation.missingFlags,
    };
  }

  const frontendOrigin = resolveFrontendOrigin(requestOrigin);
  if (!frontendOrigin) {
    return {
      ok: false,
      statusCode: 400,
      reason: "Frontend-origin kunde inte verifieras for OAuth-redirect.",
    };
  }

  const safeReturnPath = normalizeReturnPath(returnPath);
  const state = crypto.randomBytes(24).toString("base64url");
  const codeVerifier = crypto.randomBytes(64).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const nowMs = Date.now();
  const expiresAtMs = nowMs + STATE_TTL_MS;

  await getStateCollectionRef(db).doc(state).set({
    uid: safeUserId,
    provider: providerId,
    frontendOrigin,
    returnPath: safeReturnPath,
    codeVerifier,
    expiresAtMs,
    used: false,
    createdAt: FieldValue.serverTimestamp(),
    consent: normalizeConsentRecord(consent),
    policyVersions: normalizePolicyVersions(policyVersions),
    userEmail: String(userEmail || "").trim(),
  });

  const authorizationUrl = buildAuthorizationUrl({
    providerRuntime,
    state,
    codeChallenge,
    loginHint: String(userEmail || "").trim(),
  });

  return {
    ok: true,
    provider: providerId,
    label: providerRuntime.label,
    authorizationUrl,
    expiresInSeconds: Math.floor(STATE_TTL_MS / 1000),
    scopes: providerRuntime.scopes,
  };
}

export async function completeMailConnectionCallback({
  provider,
  state,
  code,
  oauthError,
  oauthErrorDescription,
}) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      ok: false,
      statusCode: 503,
      reason:
        getFirebaseInitError() ||
        "Mailkopplingar ar inte tillgangliga eftersom Firestore saknar konfiguration.",
    };
  }

  void maybeCleanupOauthStates();

  const providerId = normalizeProvider(provider);
  if (!providerId) {
    return {
      ok: false,
      statusCode: 400,
      reason: "Okänd leverantör i OAuth-callback.",
    };
  }

  const safeState = String(state || "").trim();
  if (!safeState) {
    return {
      ok: false,
      statusCode: 400,
      reason: "OAuth state saknas i callback.",
    };
  }

  const encryptionState = resolveTokenEncryptionState();
  if (!encryptionState.ok) {
    return {
      ok: false,
      statusCode: 503,
      reason: encryptionState.reason,
    };
  }

  const providerRuntime = resolveProviderRuntimeConfig(providerId, encryptionState);
  if (!providerRuntime.configured) {
    return {
      ok: false,
      statusCode: 503,
      reason: `OAuth for ${providerRuntime.label} ar inte fullstandigt konfigurerad i backend.`,
      missingConfig: providerRuntime.missingConfig,
    };
  }

  let oauthState = null;
  const stateRef = getStateCollectionRef(db).doc(safeState);

  try {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(stateRef);
      if (!snapshot.exists) {
        throw new ServiceError("OAuth state hittades inte eller har redan anvants.", 400);
      }

      const data = snapshot.data() || {};
      if (Boolean(data.used)) {
        throw new ServiceError("OAuth state har redan anvants.", 400);
      }
      if (String(data.provider || "") !== providerId) {
        throw new ServiceError("OAuth state matchar inte vald provider.", 400);
      }

      const expiresAtMs = Number(data.expiresAtMs || 0);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
        throw new ServiceError("OAuth state har gatt ut. Forsok koppla kontot igen.", 400);
      }

      oauthState = data;
      transaction.update(stateRef, {
        used: true,
        usedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      return {
        ok: false,
        statusCode: error.statusCode,
        reason: error.message,
      };
    }
    throw error;
  }

  const frontendOrigin = String(oauthState?.frontendOrigin || "").trim();
  const returnPath = String(oauthState?.returnPath || "/").trim() || "/";

  if (oauthError) {
    const message = formatProviderError(oauthError, oauthErrorDescription);
    return {
      ok: false,
      statusCode: 400,
      reason: message,
      redirectUrl: buildFrontendRedirectUrl({
        frontendOrigin,
        returnPath,
        provider: providerId,
        status: "error",
        message,
      }),
    };
  }

  const authCode = String(code || "").trim();
  if (!authCode) {
    const message = "OAuth callback saknar authorization code.";
    return {
      ok: false,
      statusCode: 400,
      reason: message,
      redirectUrl: buildFrontendRedirectUrl({
        frontendOrigin,
        returnPath,
        provider: providerId,
        status: "error",
        message,
      }),
    };
  }

  let tokenPayload = null;
  try {
    tokenPayload = await exchangeCodeForTokens({
      providerRuntime,
      code: authCode,
      codeVerifier: String(oauthState?.codeVerifier || ""),
    });
  } catch (error) {
    const message = toErrorMessage(error, "Kunde inte slutfors OAuth-kopplingen.");
    return {
      ok: false,
      statusCode: 400,
      reason: message,
      redirectUrl: buildFrontendRedirectUrl({
        frontendOrigin,
        returnPath,
        provider: providerId,
        status: "error",
        message,
      }),
    };
  }

  const accessToken = String(tokenPayload?.access_token || "").trim();
  if (!accessToken) {
    const message = "OAuth-svar saknade access_token.";
    return {
      ok: false,
      statusCode: 400,
      reason: message,
      redirectUrl: buildFrontendRedirectUrl({
        frontendOrigin,
        returnPath,
        provider: providerId,
        status: "error",
        message,
      }),
    };
  }

  const encryptedAccessToken = encryptSecret(accessToken, encryptionState.key);
  const refreshTokenFromProvider = String(tokenPayload?.refresh_token || "").trim();
  const expiresInSeconds = clampPositiveInt(tokenPayload?.expires_in, 3600);
  const tokenExpiresAtMs = Date.now() + expiresInSeconds * 1000;
  const scopes = normalizeScopesArray(tokenPayload?.scope, providerRuntime.scopes);
  const accountEmail = await resolveProviderAccountEmail(providerId, accessToken);

  const connectionRef = getConnectionCollectionRef(db).doc(
    buildConnectionDocId(String(oauthState?.uid || ""), providerId)
  );
  const existingSnapshot = await connectionRef.get();
  const existingData = existingSnapshot.data() || {};

  let encryptedRefreshToken = "";
  if (refreshTokenFromProvider) {
    encryptedRefreshToken = encryptSecret(refreshTokenFromProvider, encryptionState.key);
  } else {
    encryptedRefreshToken = String(existingData.encryptedRefreshToken || "").trim();
  }

  const updatePayload = {
    uid: String(oauthState?.uid || "").trim(),
    provider: providerId,
    providerLabel: providerRuntime.label,
    status: "connected",
    accountEmail,
    scopes,
    encryptedAccessToken,
    encryptedRefreshToken,
    tokenType: String(tokenPayload?.token_type || "Bearer").trim() || "Bearer",
    tokenExpiresAtMs,
    lastConnectedAt: FieldValue.serverTimestamp(),
    disconnectedAt: null,
    updatedAt: FieldValue.serverTimestamp(),
    consent: {
      ...normalizeConsentRecord(oauthState?.consent || {}),
      approvedAt: FieldValue.serverTimestamp(),
      policyVersions: normalizePolicyVersions(oauthState?.policyVersions || {}),
    },
    sync: {
      autoImportEnabled: false,
      mode: "manual_review",
      importTypes: normalizeImportTypes(existingData?.sync?.importTypes),
      lastSyncAt: existingData?.sync?.lastSyncAt || null,
      lastSyncStatus: String(existingData?.sync?.lastSyncStatus || "").trim(),
      lastSyncMessage: String(existingData?.sync?.lastSyncMessage || "").trim(),
      lastSyncStats: normalizeSyncStats(existingData?.sync?.lastSyncStats),
      pendingReviewCount: clampPositiveInt(existingData?.sync?.pendingReviewCount, 0),
      importedMessageIds: normalizeImportedMessageIds(existingData?.sync?.importedMessageIds),
      lastCursorInternalDateMs: clampPositiveInt(existingData?.sync?.lastCursorInternalDateMs, 0),
      updatedAt: FieldValue.serverTimestamp(),
    },
    metadata: {
      warning:
        !refreshTokenFromProvider && !existingData.encryptedRefreshToken
          ? "Ingen refresh-token returnerades. Framtida automatisk synk kan krava ny koppling."
          : "",
      lastTokenAt: FieldValue.serverTimestamp(),
    },
  };

  if (!existingSnapshot.exists) {
    updatePayload.createdAt = FieldValue.serverTimestamp();
    updatePayload.connectedAt = FieldValue.serverTimestamp();
  } else if (!existingData.connectedAt) {
    updatePayload.connectedAt = FieldValue.serverTimestamp();
  }

  await connectionRef.set(updatePayload, { merge: true });

  const successMessage = `${providerRuntime.label} ar nu kopplat till ditt konto.`;
  return {
    ok: true,
    provider: providerId,
    connected: true,
    redirectUrl: buildFrontendRedirectUrl({
      frontendOrigin,
      returnPath,
      provider: providerId,
      status: "success",
      message: successMessage,
    }),
    message: successMessage,
  };
}

export async function disconnectMailConnection({ userId, provider }) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      ok: false,
      statusCode: 503,
      reason:
        getFirebaseInitError() ||
        "Mailkopplingar ar inte tillgangliga eftersom Firestore saknar konfiguration.",
    };
  }

  const safeUserId = String(userId || "").trim();
  if (!safeUserId) {
    return {
      ok: false,
      statusCode: 400,
      reason: "Kunde inte identifiera användaren.",
    };
  }

  const providerId = normalizeProvider(provider);
  if (!providerId) {
    return {
      ok: false,
      statusCode: 400,
      reason: "Vald mailprovider stodjs inte.",
    };
  }

  const connectionRef = getConnectionCollectionRef(db).doc(buildConnectionDocId(safeUserId, providerId));
  const snapshot = await connectionRef.get();
  if (!snapshot.exists) {
    return {
      ok: true,
      disconnected: true,
      provider: providerId,
      revokedUpstream: false,
      warning: "",
    };
  }

  const data = snapshot.data() || {};
  if (String(data.uid || "") !== safeUserId) {
    return {
      ok: false,
      statusCode: 403,
      reason: "Du saknar behörighet till den här kopplingen.",
    };
  }

  const encryptionState = resolveTokenEncryptionState();
  const providerRuntime = resolveProviderRuntimeConfig(providerId, encryptionState);
  let revokedUpstream = false;
  let revokeWarning = "";

  if (encryptionState.ok) {
    const refreshToken = decryptSecret(String(data.encryptedRefreshToken || ""), encryptionState.key);
    const accessToken = decryptSecret(String(data.encryptedAccessToken || ""), encryptionState.key);
    const tokenToRevoke = refreshToken || accessToken;

    if (tokenToRevoke && providerRuntime.id === "gmail" && providerRuntime.revokeUrl) {
      try {
        const revokeResponse = await fetch(providerRuntime.revokeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: tokenToRevoke }),
        });
        revokedUpstream = revokeResponse.ok;
        if (!revokeResponse.ok) {
          revokeWarning = "Token kunde inte aterkallas uppstroms men lokal koppling togs bort.";
        }
      } catch {
        revokeWarning = "Token kunde inte aterkallas uppstroms men lokal koppling togs bort.";
      }
    }
  } else {
    revokeWarning = "Tokenkryptering saknas. Lokal koppling togs bort utan upstream revoke.";
  }

  await connectionRef.set(
    {
      status: "disconnected",
      encryptedAccessToken: "",
      encryptedRefreshToken: "",
      tokenExpiresAtMs: 0,
      disconnectedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      sync: {
        autoImportEnabled: false,
        mode: "disabled",
        importTypes: normalizeImportTypes(data?.sync?.importTypes),
        lastSyncAt: null,
        lastSyncStatus: "",
        lastSyncMessage: "",
        lastSyncStats: normalizeSyncStats(data?.sync?.lastSyncStats),
        pendingReviewCount: 0,
        importedMessageIds: normalizeImportedMessageIds(data?.sync?.importedMessageIds),
        lastCursorInternalDateMs: clampPositiveInt(data?.sync?.lastCursorInternalDateMs, 0),
        updatedAt: FieldValue.serverTimestamp(),
      },
      metadata: {
        warning: revokeWarning,
      },
    },
    { merge: true }
  );

  return {
    ok: true,
    disconnected: true,
    provider: providerId,
    revokedUpstream,
    warning: revokeWarning,
  };
}

export async function updateMailImportSettings({ userId, provider, importTypes }) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      ok: false,
      statusCode: 503,
      reason:
        getFirebaseInitError() ||
        "Mailkopplingar ar inte tillgangliga eftersom Firestore saknar konfiguration.",
    };
  }

  const safeUserId = String(userId || "").trim();
  if (!safeUserId) {
    return {
      ok: false,
      statusCode: 400,
      reason: "Kunde inte identifiera användaren.",
    };
  }

  const providerId = normalizeProvider(provider);
  if (!providerId) {
    return {
      ok: false,
      statusCode: 400,
      reason: "Vald mailprovider stodjs inte.",
    };
  }

  const connectionRef = getConnectionCollectionRef(db).doc(buildConnectionDocId(safeUserId, providerId));
  const snapshot = await connectionRef.get();
  if (!snapshot.exists) {
    return {
      ok: false,
      statusCode: 404,
      reason: "Mailkopplingen finns inte.",
    };
  }

  const data = snapshot.data() || {};
  if (String(data.uid || "").trim() !== safeUserId) {
    return {
      ok: false,
      statusCode: 403,
      reason: "Du saknar behörighet till den här kopplingen.",
    };
  }

  if (String(data.status || "").trim().toLowerCase() !== "connected") {
    return {
      ok: false,
      statusCode: 400,
      reason: "Mailkopplingen ar inte aktiv.",
    };
  }

  const normalizedImportTypes = normalizeImportTypes(importTypes);
  if (!hasAnyEnabledImportType(normalizedImportTypes)) {
    return {
      ok: false,
      statusCode: 400,
      reason: "Minst en importtyp maste vara vald.",
    };
  }

  const previousImportTypes = normalizeImportTypes(data?.sync?.importTypes);
  const broadenedSelection = didBroadenImportSelection(previousImportTypes, normalizedImportTypes);
  const currentCursorMs = clampPositiveInt(data?.sync?.lastCursorInternalDateMs, 0);
  const backfillCursorMs = Date.now() - resolveMailImportLookbackDays() * 24 * 60 * 60 * 1000;
  const nextCursorMs = broadenedSelection
    ? currentCursorMs > 0
      ? Math.min(currentCursorMs, backfillCursorMs)
      : backfillCursorMs
    : currentCursorMs;

  await connectionRef.set(
    {
      sync: {
        ...(data?.sync || {}),
        autoImportEnabled: false,
        mode: "manual_review",
        importTypes: normalizedImportTypes,
        lastCursorInternalDateMs: nextCursorMs,
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    ok: true,
    provider: providerId,
    importTypes: normalizedImportTypes,
  };
}

export async function getMailConnectionAccessContext({ userId, provider }) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      ok: false,
      statusCode: 503,
      reason:
        getFirebaseInitError() ||
        "Mailkopplingar ar inte tillgangliga eftersom Firestore saknar konfiguration.",
    };
  }

  const safeUserId = String(userId || "").trim();
  if (!safeUserId) {
    return {
      ok: false,
      statusCode: 400,
      reason: "Kunde inte identifiera användaren.",
    };
  }

  const providerId = normalizeProvider(provider);
  if (!providerId) {
    return {
      ok: false,
      statusCode: 400,
      reason: "Vald mailprovider stodjs inte.",
    };
  }

  const encryptionState = resolveTokenEncryptionState();
  if (!encryptionState.ok) {
    return {
      ok: false,
      statusCode: 503,
      reason: encryptionState.reason,
    };
  }

  const providerRuntime = resolveProviderRuntimeConfig(providerId, encryptionState);
  if (!providerRuntime.configured) {
    return {
      ok: false,
      statusCode: 503,
      reason: `OAuth for ${providerRuntime.label} ar inte fullstandigt konfigurerad i backend.`,
      missingConfig: providerRuntime.missingConfig,
    };
  }

  const connectionRef = getConnectionCollectionRef(db).doc(buildConnectionDocId(safeUserId, providerId));
  const snapshot = await connectionRef.get();
  if (!snapshot.exists) {
    return {
      ok: false,
      statusCode: 404,
      reason: "Mailkopplingen finns inte.",
    };
  }

  let data = snapshot.data() || {};
  if (String(data.uid || "").trim() !== safeUserId) {
    return {
      ok: false,
      statusCode: 403,
      reason: "Du saknar behörighet till den här kopplingen.",
    };
  }

  if (String(data.status || "").trim().toLowerCase() !== "connected") {
    return {
      ok: false,
      statusCode: 400,
      reason: "Mailkopplingen ar inte aktiv.",
    };
  }

  let accessToken = decryptSecret(String(data.encryptedAccessToken || ""), encryptionState.key);
  let refreshToken = decryptSecret(String(data.encryptedRefreshToken || ""), encryptionState.key);
  const expiresAtMs = clampPositiveInt(data.tokenExpiresAtMs, 0);
  const needsRefresh = !accessToken || expiresAtMs <= Date.now() + TOKEN_REFRESH_SKEW_MS;

  if (needsRefresh) {
    if (!refreshToken) {
      return {
        ok: false,
        statusCode: 401,
        reason: "Mailkopplingen saknar giltig refresh-token. Koppla kontot pa nytt.",
      };
    }

    let refreshed = null;
    try {
      refreshed = await refreshProviderAccessToken({
        providerRuntime,
        refreshToken,
      });
    } catch (error) {
      return {
        ok: false,
        statusCode: 401,
        reason: toErrorMessage(error, "Kunde inte fornya access-token for mailkopplingen."),
      };
    }

    accessToken = String(refreshed?.accessToken || "").trim();
    refreshToken = String(refreshed?.refreshToken || "").trim() || refreshToken;
    if (!accessToken) {
      return {
        ok: false,
        statusCode: 401,
        reason: "OAuth-provider returnerade ingen access-token vid fornyelse.",
      };
    }

    const refreshedPayload = {
      encryptedAccessToken: encryptSecret(accessToken, encryptionState.key),
      encryptedRefreshToken: encryptSecret(refreshToken, encryptionState.key),
      tokenExpiresAtMs: clampPositiveInt(refreshed?.tokenExpiresAtMs, Date.now() + 3600 * 1000),
      updatedAt: FieldValue.serverTimestamp(),
      metadata: {
        ...(data?.metadata || {}),
        lastTokenAt: FieldValue.serverTimestamp(),
      },
    };

    await connectionRef.set(refreshedPayload, { merge: true });
    data = {
      ...data,
      encryptedAccessToken: refreshedPayload.encryptedAccessToken,
      encryptedRefreshToken: refreshedPayload.encryptedRefreshToken,
      tokenExpiresAtMs: refreshedPayload.tokenExpiresAtMs,
      metadata: {
        ...(data?.metadata || {}),
      },
    };
  }

  return {
    ok: true,
    provider: providerId,
    accessToken,
    connectionRef,
    connectionData: data,
    accountEmail: String(data.accountEmail || "").trim(),
    importTypes: normalizeImportTypes(data?.sync?.importTypes),
    providerRuntime,
  };
}

export async function cleanupExpiredOauthStates({ maxIterations = 20 } = {}) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      ok: false,
      deletedCount: 0,
      reason:
        getFirebaseInitError() ||
        "Firestore configuration missing. Cannot clean OAuth states.",
    };
  }

  const stateRef = getStateCollectionRef(db);
  const now = Date.now();
  let deletedCount = 0;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const expiredSnapshot = await stateRef.where("expiresAtMs", "<=", now).limit(STATE_CLEANUP_BATCH_SIZE).get();
    const docs = new Map();
    expiredSnapshot.docs.forEach((doc) => docs.set(doc.id, doc));

    if (docs.size === 0) {
      break;
    }

    const batch = db.batch();
    docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deletedCount += docs.size;
  }

  return {
    ok: true,
    deletedCount,
  };
}

export async function purgeMailConnectionsForUser(userId) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      ok: false,
      reason:
        getFirebaseInitError() ||
        "Mailkopplingar kunde inte raderas eftersom Firestore saknar konfiguration.",
    };
  }

  const safeUserId = String(userId || "").trim();
  if (!safeUserId) {
    return {
      ok: false,
      reason: "Kunde inte identifiera användaren för borttagning av mejlkoppling.",
    };
  }

  const deletedConnections = await deleteDocsByUser(getConnectionCollectionRef(db), safeUserId);
  const deletedStates = await deleteDocsByUser(getStateCollectionRef(db), safeUserId);

  return {
    ok: true,
    deletedConnections,
    deletedPendingStates: deletedStates,
  };
}

function resolveProviderRuntimeConfig(providerId, encryptionState = resolveTokenEncryptionState()) {
  const definition = PROVIDER_CONFIG[providerId];
  const clientId = String(process.env[definition.clientIdEnvName] || "").trim();
  const clientSecret = String(process.env[definition.clientSecretEnvName] || "").trim();
  const redirectUri = String(process.env[definition.redirectUriEnvName] || "").trim();
  const scopes = normalizeScopesArray(process.env[definition.scopesEnvName], definition.defaultScopes);

  const missingConfig = [];
  if (!clientId) missingConfig.push(definition.clientIdEnvName);
  if (!clientSecret) missingConfig.push(definition.clientSecretEnvName);
  if (!redirectUri) missingConfig.push(definition.redirectUriEnvName);
  if (!encryptionState.ok) missingConfig.push("OAUTH_TOKEN_ENCRYPTION_KEY");

  return {
    id: definition.id,
    label: definition.label,
    authUrl: definition.authUrl,
    tokenUrl: definition.tokenUrl,
    revokeUrl: definition.revokeUrl,
    clientId,
    clientSecret,
    redirectUri,
    scopes,
    configured: missingConfig.length === 0,
    missingConfig,
  };
}

async function maybeCleanupOauthStates() {
  const now = Date.now();
  if (stateCleanupInProgress) return;
  if (now - lastStateCleanupAt < STATE_CLEANUP_INTERVAL_MS) return;

  stateCleanupInProgress = true;
  lastStateCleanupAt = now;

  try {
    await cleanupExpiredOauthStates({ maxIterations: 10 });
  } catch (error) {
    const message = toErrorMessage(error, "unknown error");
    console.warn(`[mail oauth] state-cleanup failed: ${message}`);
  } finally {
    stateCleanupInProgress = false;
  }
}

function buildAuthorizationUrl({ providerRuntime, state, codeChallenge, loginHint }) {
  const params = new URLSearchParams({
    client_id: providerRuntime.clientId,
    redirect_uri: providerRuntime.redirectUri,
    response_type: "code",
    scope: providerRuntime.scopes.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  if (providerRuntime.id === "gmail") {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
    params.set("include_granted_scopes", "true");
    if (loginHint) params.set("login_hint", loginHint);
  }

  if (providerRuntime.id === "outlook") {
    params.set("response_mode", "query");
    params.set("prompt", "select_account");
    if (loginHint) params.set("login_hint", loginHint);
  }

  return `${providerRuntime.authUrl}?${params.toString()}`;
}

async function exchangeCodeForTokens({ providerRuntime, code, codeVerifier }) {
  const payload = new URLSearchParams({
    client_id: providerRuntime.clientId,
    client_secret: providerRuntime.clientSecret,
    redirect_uri: providerRuntime.redirectUri,
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
  });

  let response;
  try {
    response = await fetch(providerRuntime.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload,
    });
  } catch {
    throw new Error("Kunde inte ansluta till OAuth-provider.");
  }

  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (!response.ok) {
    const detail =
      String(json?.error_description || "").trim() || String(json?.error || "").trim() || "okant fel";
    throw new Error(`OAuth token exchange misslyckades: ${detail}`);
  }

  return json || {};
}

async function refreshProviderAccessToken({ providerRuntime, refreshToken }) {
  const safeRefreshToken = String(refreshToken || "").trim();
  if (!safeRefreshToken) {
    throw new Error("Refresh-token saknas for mailkopplingen.");
  }

  const payload = new URLSearchParams({
    client_id: providerRuntime.clientId,
    client_secret: providerRuntime.clientSecret,
    grant_type: "refresh_token",
    refresh_token: safeRefreshToken,
  });

  let response;
  try {
    response = await fetch(providerRuntime.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload,
    });
  } catch {
    throw new Error("Kunde inte ansluta till OAuth-provider for tokenfornyelse.");
  }

  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (!response.ok) {
    const detail =
      String(json?.error_description || "").trim() || String(json?.error || "").trim() || "okant fel";
    throw new Error(`OAuth token refresh misslyckades: ${detail}`);
  }

  return {
    accessToken: String(json?.access_token || "").trim(),
    refreshToken: String(json?.refresh_token || "").trim(),
    tokenExpiresAtMs: Date.now() + clampPositiveInt(json?.expires_in, 3600) * 1000,
  };
}

async function resolveProviderAccountEmail(provider, accessToken) {
  const safeProvider = normalizeProvider(provider);
  const safeToken = String(accessToken || "").trim();
  if (!safeProvider || !safeToken) return "";

  if (safeProvider === "gmail") {
    try {
      const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: {
          Authorization: `Bearer ${safeToken}`,
        },
      });
      if (!response.ok) return "";
      const json = await response.json();
      return String(json?.emailAddress || "").trim();
    } catch {
      return "";
    }
  }

  if (safeProvider === "outlook") {
    try {
      const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
        headers: {
          Authorization: `Bearer ${safeToken}`,
        },
      });
      if (!response.ok) return "";
      const json = await response.json();
      return String(json?.mail || json?.userPrincipalName || "").trim();
    } catch {
      return "";
    }
  }

  return "";
}

function resolveTokenEncryptionState() {
  const raw = String(process.env.OAUTH_TOKEN_ENCRYPTION_KEY || "").trim();
  if (!raw) {
    return {
      ok: false,
      reason:
        "OAUTH_TOKEN_ENCRYPTION_KEY saknas. Ange en 32-byte nyckel (hex, base64/base64url eller exakt 32 tecken).",
      key: null,
    };
  }

  let key = null;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    const asBase64 = normalizeBase64(raw);
    try {
      key = Buffer.from(asBase64, "base64");
    } catch {
      key = null;
    }

    if (!key || key.length === 0) {
      key = null;
    }
  }

  if (!key || key.length !== 32) {
    const utf8Candidate = Buffer.from(raw, "utf8");
    if (utf8Candidate.length === 32) {
      key = utf8Candidate;
    }
  }

  if (!Buffer.isBuffer(key) || key.length !== 32) {
    return {
      ok: false,
      reason: "OAUTH_TOKEN_ENCRYPTION_KEY maste vara exakt 32 byte efter avkodning.",
      key: null,
    };
  }

  return { ok: true, reason: "", key };
}

function encryptSecret(secret, key) {
  const value = String(secret || "").trim();
  if (!value || !Buffer.isBuffer(key) || key.length !== 32) return "";

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptSecret(ciphertext, key) {
  const raw = String(ciphertext || "").trim();
  if (!raw || !Buffer.isBuffer(key) || key.length !== 32) return "";
  if (!raw.startsWith("v1.")) return "";

  const parts = raw.split(".");
  if (parts.length !== 4) return "";

  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const encrypted = Buffer.from(parts[3], "base64url");

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    return String(plain || "").trim();
  } catch {
    return "";
  }
}

function validateConsentPayload(consent) {
  const source = consent && typeof consent === "object" ? consent : {};
  const missingFlags = REQUIRED_CONSENT_FLAGS.filter((flag) => !Boolean(source[flag]));
  return {
    ok: missingFlags.length === 0,
    missingFlags,
  };
}

function normalizeConsentRecord(consent) {
  const source = consent && typeof consent === "object" ? consent : {};
  const normalized = {};
  for (const flag of REQUIRED_CONSENT_FLAGS) {
    normalized[flag] = Boolean(source[flag]);
  }
  return normalized;
}

function normalizePolicyVersions(policyVersions) {
  const source = policyVersions && typeof policyVersions === "object" ? policyVersions : {};
  return {
    privacy: String(source.privacy || "").trim(),
    terms: String(source.terms || "").trim(),
    cookies: String(source.cookies || "").trim(),
    security: String(source.security || "").trim(),
    oauth: String(source.oauth || "").trim(),
  };
}

function normalizeImportTypes(importTypes) {
  const source = importTypes && typeof importTypes === "object" ? importTypes : {};
  return {
    invoices: source.invoices !== false,
    receipts: Boolean(source.receipts),
    confirmations: Boolean(source.confirmations),
  };
}

function normalizeSyncStats(stats) {
  const source = stats && typeof stats === "object" ? stats : {};
  return {
    scanned: clampPositiveInt(source.scanned, DEFAULT_SYNC_STATS.scanned),
    importedMessages: clampPositiveInt(
      source.importedMessages,
      DEFAULT_SYNC_STATS.importedMessages
    ),
    importedAttachments: clampPositiveInt(
      source.importedAttachments,
      DEFAULT_SYNC_STATS.importedAttachments
    ),
    queuedForReview: clampPositiveInt(
      source.queuedForReview,
      DEFAULT_SYNC_STATS.queuedForReview
    ),
    blocked: clampPositiveInt(source.blocked, DEFAULT_SYNC_STATS.blocked),
    errors: clampPositiveInt(source.errors, DEFAULT_SYNC_STATS.errors),
  };
}

function normalizeImportedMessageIds(value) {
  const safeValues = Array.isArray(value) ? value : [];
  return [...new Set(safeValues.map((entry) => String(entry || "").trim()).filter(Boolean))].slice(-200);
}

function hasAnyEnabledImportType(importTypes) {
  const normalized = normalizeImportTypes(importTypes);
  return Object.values(normalized).some(Boolean);
}

function didBroadenImportSelection(previousImportTypes, nextImportTypes) {
  const previous = normalizeImportTypes(previousImportTypes);
  const next = normalizeImportTypes(nextImportTypes);
  return Object.keys(next).some((key) => Boolean(next[key]) && !Boolean(previous[key]));
}

function resolveMailImportLookbackDays() {
  return clampPositiveInt(process.env.MAIL_IMPORT_SYNC_LOOKBACK_DAYS, 21);
}

function normalizeProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  return Object.hasOwn(PROVIDER_CONFIG, provider) ? provider : "";
}

function normalizeScopesArray(value, fallback = []) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean))];
  }

  const safeValue = String(value || "").trim();
  if (!safeValue) return [...new Set((fallback || []).map((entry) => String(entry || "").trim()).filter(Boolean))];

  const splitByComma = safeValue.includes(",")
    ? safeValue.split(",")
    : safeValue.split(/\s+/g);

  return [...new Set(splitByComma.map((entry) => String(entry || "").trim()).filter(Boolean))];
}

function resolveFrontendOrigin(requestOrigin) {
  const normalizedRequestOrigin = normalizeOrigin(requestOrigin);
  const allowedOrigins = resolveAllowedFrontendOrigins();

  if (normalizedRequestOrigin && allowedOrigins.has(normalizedRequestOrigin)) {
    return normalizedRequestOrigin;
  }

  return "";
}

function resolveAllowedFrontendOrigins() {
  const fromList = String(process.env.MAIL_OAUTH_ALLOWED_REDIRECT_ORIGINS || "")
    .split(",")
    .map((entry) => normalizeOrigin(entry))
    .filter(Boolean);

  const frontendOrigins = String(process.env.FRONTEND_ORIGINS || "")
    .split(",")
    .map((entry) => normalizeOrigin(entry))
    .filter(Boolean);

  const singleOrigin = normalizeOrigin(process.env.FRONTEND_ORIGIN || "");
  const combined = [...fromList, ...frontendOrigins, singleOrigin].filter(Boolean);

  return new Set(combined.length ? combined : ["http://localhost:5173"]);
}

function normalizeOrigin(value) {
  let raw = String(value || "")
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "");
  if (!raw) return "";

  if (!/^https?:\/\//i.test(raw)) {
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(raw)) {
      raw = `http://${raw}`;
    } else {
      raw = `https://${raw}`;
    }
  }

  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeReturnPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  if (/^\/\//.test(raw)) return "/";
  if (raw.includes("\n") || raw.includes("\r")) return "/";
  return raw;
}

function buildFrontendRedirectUrl({ frontendOrigin, returnPath, provider, status, message }) {
  const safeOrigin = normalizeOrigin(frontendOrigin);
  if (!safeOrigin) return "";

  const target = new URL(normalizeReturnPath(returnPath), `${safeOrigin}/`);
  target.searchParams.set("mail_oauth_status", String(status || "").trim() || "unknown");
  target.searchParams.set("mail_oauth_provider", String(provider || "").trim() || "");
  if (message) {
    target.searchParams.set("mail_oauth_message", String(message || "").trim());
  }
  return target.toString();
}

function formatProviderError(errorCode, errorDescription) {
  const code = String(errorCode || "").trim();
  const detail = String(errorDescription || "").trim();
  if (!code && !detail) return "OAuth-flodet avbrots av provider.";
  return [code, detail].filter(Boolean).join(": ");
}

function clampPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function toIsoTimestamp(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return new Date(asNumber).toISOString();
  }
  const asString = String(value || "").trim();
  if (!asString) return null;
  const parsed = Date.parse(asString);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function toErrorMessage(error, fallback) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function getConnectionCollectionRef(db) {
  const name = String(process.env.FIREBASE_MAIL_CONNECTION_COLLECTION || DEFAULT_CONNECTION_COLLECTION).trim();
  return db.collection(name || DEFAULT_CONNECTION_COLLECTION);
}

function getStateCollectionRef(db) {
  const name = String(process.env.FIREBASE_MAIL_OAUTH_STATE_COLLECTION || DEFAULT_STATE_COLLECTION).trim();
  return db.collection(name || DEFAULT_STATE_COLLECTION);
}

function buildConnectionDocId(userId, providerId) {
  return crypto.createHash("sha256").update(`${String(userId || "").trim()}:${providerId}`).digest("hex");
}

async function deleteDocsByUser(collectionRef, userId) {
  let deletedCount = 0;

  while (true) {
    const snapshot = await collectionRef.where("uid", "==", userId).limit(DELETE_BATCH_SIZE).get();
    if (snapshot.empty) break;

    const batch = collectionRef.firestore.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    deletedCount += snapshot.docs.length;
  }

  return deletedCount;
}

function normalizeBase64(value) {
  const raw = String(value || "").trim().replace(/-/g, "+").replace(/_/g, "/");
  const missingPadding = raw.length % 4;
  if (!missingPadding) return raw;
  return `${raw}${"=".repeat(4 - missingPadding)}`;
}

class ServiceError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "ServiceError";
    this.statusCode = statusCode;
  }
}
