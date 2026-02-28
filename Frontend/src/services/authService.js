import { FIREBASE_WEB_API_KEY } from "../constants/appConstants.js";

const AUTH_STORAGE_KEY = "minkostnadskoll_auth_session_v1";
const AUTH_CHANGE_EVENT = "minkostnadskoll-auth-change";
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

export function getStoredAuthSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.idToken || !parsed?.refreshToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearStoredAuthSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  notifyAuthChange(null);
}

export async function signInWithEmailPassword(email, password) {
  return authenticateWithPassword("accounts:signInWithPassword", email, password);
}

export async function signUpWithEmailPassword(email, password) {
  return authenticateWithPassword("accounts:signUp", email, password);
}

export async function sendPasswordResetEmail(email) {
  ensureApiKeyConfigured();

  const safeEmail = String(email || "").trim();
  if (!safeEmail) {
    throw new Error("Fyll i en e-postadress.");
  }

  await postIdentityToolkit("accounts:sendOobCode", {
    requestType: "PASSWORD_RESET",
    email: safeEmail,
  });
  return true;
}

export async function updateAccountProfile({ displayName, email }) {
  const { token, current } = await getAuthenticatedContext();
  const safeDisplayName = String(displayName ?? "").trim();
  const safeEmail = String(email ?? "").trim();

  const nextDisplayName = safeDisplayName || "";
  const nextEmail = safeEmail || "";
  const hasDisplayNameChange = nextDisplayName !== String(current.displayName || "");
  const hasEmailChange = nextEmail !== String(current.email || "");

  if (!hasDisplayNameChange && !hasEmailChange) {
    return current;
  }

  const payload = {
    idToken: token,
    returnSecureToken: true,
    displayName: nextDisplayName,
    email: nextEmail || current.email || "",
  };

  const response = await postIdentityToolkit("accounts:update", payload);
  const session = mergeSessionFromAuthResponse(response, current, {
    displayName: nextDisplayName,
    email: nextEmail || current.email || "",
  });
  storeAuthSession(session);
  return session;
}

export async function updateAccountPassword(newPassword) {
  const { token, current } = await getAuthenticatedContext();
  const safePassword = String(newPassword || "");

  if (safePassword.length < 6) {
    throw new Error("Lösenordet måste vara minst 6 tecken.");
  }

  const response = await postIdentityToolkit("accounts:update", {
    idToken: token,
    returnSecureToken: true,
    password: safePassword,
  });

  const session = mergeSessionFromAuthResponse(response, current, {
    displayName: current.displayName || "",
    email: current.email || "",
  });
  storeAuthSession(session);
  return session;
}

export async function deleteCurrentAccount() {
  const { token } = await getAuthenticatedContext();

  await postIdentityToolkit("accounts:delete", {
    idToken: token,
  });

  clearStoredAuthSession();
  return true;
}

export async function getValidIdToken() {
  const current = getStoredAuthSession();
  if (!current?.idToken) return "";

  const expiresAt = Number(current.expiresAt || 0);
  const stillValid = Number.isFinite(expiresAt) && expiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS;
  if (stillValid) return current.idToken;

  try {
    const refreshed = await refreshIdToken(current.refreshToken);
    storeAuthSession({
      ...refreshed,
      email: current.email || refreshed.email || "",
      displayName: current.displayName || refreshed.displayName || "",
    });
    return refreshed.idToken;
  } catch {
    clearStoredAuthSession();
    return "";
  }
}

function storeAuthSession(session) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  notifyAuthChange(session);
}

async function authenticateWithPassword(endpoint, email, password) {
  ensureApiKeyConfigured();

  const safeEmail = String(email || "").trim();
  const safePassword = String(password || "");

  if (!safeEmail || !safePassword) {
    throw new Error("E-post och lösenord krävs.");
  }

  const payload = await postIdentityToolkit(endpoint, {
    email: safeEmail,
    password: safePassword,
    returnSecureToken: true,
  });

  const session = normalizeAuthPayload(payload);
  storeAuthSession(session);
  return session;
}

async function refreshIdToken(refreshToken) {
  ensureApiKeyConfigured();
  const safeRefreshToken = String(refreshToken || "").trim();
  if (!safeRefreshToken) {
    throw new Error("Din inloggningssession saknar refresh-token. Logga in igen.");
  }

  let response;
  try {
    response = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(safeRefreshToken)}`,
      }
    );
  } catch {
    throw new Error("Kunde inte ansluta till inloggningstjänsten. Kontrollera internet och försök igen.");
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(mapFirebaseAuthError(payload?.error?.message));
  }

  return normalizeAuthPayload({
    idToken: payload.id_token,
    refreshToken: payload.refresh_token,
    localId: payload.user_id,
    email: "",
    displayName: "",
    expiresIn: payload.expires_in,
  });
}

function normalizeAuthPayload(payload) {
  const expiresInSeconds = Number(payload?.expiresIn || 3600);
  const expiresAt = Date.now() + Math.max(300, expiresInSeconds) * 1000;

  return {
    idToken: String(payload?.idToken || ""),
    refreshToken: String(payload?.refreshToken || ""),
    uid: String(payload?.localId || ""),
    email: String(payload?.email || ""),
    displayName: String(payload?.displayName || ""),
    expiresAt,
  };
}

function mergeSessionFromAuthResponse(responsePayload, currentSession, overrides = {}) {
  const normalized = normalizeAuthPayload({
    idToken: responsePayload?.idToken,
    refreshToken: responsePayload?.refreshToken,
    localId: responsePayload?.localId || currentSession?.uid || "",
    email: responsePayload?.email || overrides.email || currentSession?.email || "",
    displayName:
      responsePayload?.displayName ?? overrides.displayName ?? currentSession?.displayName ?? "",
    expiresIn: responsePayload?.expiresIn,
  });

  return {
    ...normalized,
    uid: normalized.uid || String(currentSession?.uid || ""),
    email: normalized.email || String(currentSession?.email || ""),
    displayName:
      normalized.displayName || String(overrides.displayName || currentSession?.displayName || ""),
  };
}

async function getAuthenticatedContext() {
  const current = getStoredAuthSession();
  if (!current?.idToken) {
    throw new Error("Du är inte inloggad. Logga in igen.");
  }

  const token = await getValidIdToken();
  if (!token) {
    throw new Error("Sessionen har gått ut. Logga in igen.");
  }

  const refreshed = getStoredAuthSession();
  return {
    token,
    current: refreshed || current,
  };
}

async function postIdentityToolkit(endpoint, body) {
  ensureApiKeyConfigured();

  let response;
  try {
    response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${encodeURIComponent(
        FIREBASE_WEB_API_KEY
      )}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      }
    );
  } catch {
    throw new Error("Kunde inte ansluta till inloggningstjänsten. Kontrollera internet och försök igen.");
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(mapFirebaseAuthError(payload?.error?.message));
  }

  return payload;
}

function ensureApiKeyConfigured() {
  if (!FIREBASE_WEB_API_KEY) {
    throw new Error(
      "Inloggning är inte konfigurerad. Lägg till VITE_FIREBASE_API_KEY i Frontend/.env och starta om appen."
    );
  }
}

function mapFirebaseAuthError(errorCode) {
  const code = String(errorCode || "").trim().toUpperCase();

  const messages = {
    EMAIL_EXISTS: "E-postadressen används redan.",
    EMAIL_NOT_FOUND: "Hittar inget konto med den e-postadressen.",
    INVALID_PASSWORD: "Fel lösenord.",
    USER_DISABLED: "Kontot är inaktiverat.",
    TOO_MANY_ATTEMPTS_TRY_LATER: "För många försök. Vänta en stund och försök igen.",
    OPERATION_NOT_ALLOWED: "Inloggning med e-post/lösenord är inte aktiverad i Firebase Auth.",
    WEAK_PASSWORD: "Lösenordet är för svagt.",
    INVALID_LOGIN_CREDENTIALS: "Fel e-post eller lösenord.",
    INVALID_ID_TOKEN: "Sessionen är ogiltig. Logga in igen.",
    TOKEN_EXPIRED: "Sessionen har gått ut. Logga in igen.",
    INVALID_EMAIL: "E-postadressen är ogiltig.",
    NETWORK_REQUEST_FAILED:
      "Kunde inte nå inloggningstjänsten. Kontrollera internet och försök igen.",
    CREDENTIAL_TOO_OLD_LOGIN_AGAIN:
      "Den här åtgärden kräver ny inloggning. Logga ut och logga in igen.",
    REQUIRES_RECENT_LOGIN:
      "Den här åtgärden kräver ny inloggning. Logga ut och logga in igen.",
  };

  return messages[code] || `Autentisering misslyckades (${code || "okänt fel"}).`;
}

export function subscribeToAuthChanges(handler) {
  if (typeof window === "undefined") return () => {};

  const listener = (event) => {
    handler?.(event?.detail || null);
  };
  window.addEventListener(AUTH_CHANGE_EVENT, listener);
  return () => window.removeEventListener(AUTH_CHANGE_EVENT, listener);
}

function notifyAuthChange(session) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTH_CHANGE_EVENT, { detail: session || null }));
}
