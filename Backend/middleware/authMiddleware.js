import { getFirebaseAuth, getFirebaseInitError } from "../services/firebaseAdminService.js";

export async function requireAuth(req, res, next) {
  try {
    const authHeader = String(req.headers?.authorization || "");
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        ok: false,
        error: "Din session saknas eller är ogiltig. Logga in igen.",
      });
    }

    const idToken = authHeader.slice("Bearer ".length).trim();
    if (!idToken) {
      return res.status(401).json({
        ok: false,
        error: "Din session saknas eller är ogiltig. Logga in igen.",
      });
    }

    const authClient = getFirebaseAuth();
    if (!authClient) {
      return res.status(503).json({
        ok: false,
        error:
          getFirebaseInitError() ||
          "Inloggningstjänsten är inte tillgänglig just nu. Kontrollera Firebase-konfigurationen i backend.",
      });
    }

    const decoded = await authClient.verifyIdToken(idToken, true);
    req.user = {
      uid: decoded.uid,
      email: decoded.email || "",
    };

    return next();
  } catch (error) {
    return res.status(401).json({
      ok: false,
      error: "Sessionen har gått ut eller är ogiltig. Logga in igen.",
    });
  }
}
