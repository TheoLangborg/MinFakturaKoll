import { API_URL } from "../constants/appConstants.js";
import { clearStoredAuthSession, getValidIdToken } from "../services/authService.js";

export async function apiFetch(path, options = {}) {
  const token = await getValidIdToken();
  if (!token) {
    throw new Error("Du är inte inloggad eller sessionen har gått ut. Logga in igen.");
  }

  const url = String(path || "").startsWith("http") ? String(path) : `${API_URL}${String(path || "")}`;
  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
    });
  } catch {
    throw new Error(
      "Kunde inte kontakta servern. Kontrollera internetanslutningen och att backend är igång."
    );
  }

  if (response.status === 401 && (await shouldClearStoredSession(response))) {
    clearStoredAuthSession();
  }

  return response;
}

async function shouldClearStoredSession(response) {
  if (!response || response.status !== 401) {
    return false;
  }

  try {
    const payload = await response.clone().json();
    const message = String(payload?.error || payload?.reason || "").trim().toLowerCase();

    if (!message) {
      return true;
    }

    return (
      message.includes("din session") ||
      message.includes("sessionen har") ||
      message.includes("logga in igen") ||
      message.includes("ogiltig")
    );
  } catch {
    return true;
  }
}
