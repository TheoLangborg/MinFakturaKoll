import express from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  completeMailConnectionCallback,
  disconnectMailConnection,
  getMailConnectionStatusForUser,
  startMailConnection,
} from "../services/mailOAuthService.js";

const router = express.Router();

router.get("/oauth/:provider/callback", async (req, res) => {
  try {
    const completed = await completeMailConnectionCallback({
      provider: req.params?.provider,
      state: req.query?.state,
      code: req.query?.code,
      oauthError: req.query?.error,
      oauthErrorDescription: req.query?.error_description,
    });

    if (completed.redirectUrl) {
      return res.redirect(302, completed.redirectUrl);
    }

    return res.status(completed.statusCode || (completed.ok ? 200 : 400)).json({
      ok: Boolean(completed.ok),
      error: completed.ok ? "" : completed.reason || "OAuth callback misslyckades.",
      provider: completed.provider || String(req.params?.provider || "").trim().toLowerCase(),
      message: completed.message || "",
    });
  } catch (error) {
    console.error("mailConnectionRoute callback misslyckades:", error);
    return res.status(500).json({
      ok: false,
      error: "OAuth callback kunde inte behandlas just nu.",
    });
  }
});

router.use(requireAuth);

router.get("/status", async (req, res) => {
  try {
    const status = await getMailConnectionStatusForUser(req.user?.uid || "");
    return res.status(status.statusCode || (status.ok ? 200 : 400)).json({
      ok: Boolean(status.ok),
      enabled: Boolean(status.enabled),
      providers: Array.isArray(status.providers) ? status.providers : [],
      reason: status.reason || "",
      encryptionReady: Boolean(status.encryptionReady),
      encryptionWarning: status.encryptionWarning || "",
    });
  } catch (error) {
    console.error("mailConnectionRoute status misslyckades:", error);
    return res.status(500).json({
      ok: false,
      error: "Mailkopplingarnas status kunde inte hamtas just nu.",
    });
  }
});

router.post("/connect/:provider/start", async (req, res) => {
  try {
    const started = await startMailConnection({
      userId: req.user?.uid || "",
      userEmail: req.user?.email || "",
      provider: req.params?.provider,
      consent: req.body?.consent || {},
      policyVersions: req.body?.policyVersions || {},
      requestOrigin: req.headers?.origin || "",
      returnPath: req.body?.returnPath || "",
    });

    return res.status(started.statusCode || (started.ok ? 200 : 400)).json({
      ok: Boolean(started.ok),
      provider: started.provider || String(req.params?.provider || "").trim().toLowerCase(),
      label: started.label || "",
      authorizationUrl: started.authorizationUrl || "",
      scopes: started.scopes || [],
      expiresInSeconds: started.expiresInSeconds || 0,
      missingConfig: started.missingConfig || [],
      missingConsent: started.missingConsent || [],
      error: started.ok ? "" : started.reason || "Kunde inte starta OAuth-flodet.",
    });
  } catch (error) {
    console.error("mailConnectionRoute start misslyckades:", error);
    return res.status(500).json({
      ok: false,
      error: "Kunde inte starta OAuth-flodet just nu.",
    });
  }
});

router.post("/disconnect/:provider", async (req, res) => {
  try {
    const disconnected = await disconnectMailConnection({
      userId: req.user?.uid || "",
      provider: req.params?.provider,
    });

    return res.status(disconnected.statusCode || (disconnected.ok ? 200 : 400)).json({
      ok: Boolean(disconnected.ok),
      provider: disconnected.provider || String(req.params?.provider || "").trim().toLowerCase(),
      disconnected: Boolean(disconnected.disconnected),
      revokedUpstream: Boolean(disconnected.revokedUpstream),
      warning: disconnected.warning || "",
      error: disconnected.ok ? "" : disconnected.reason || "Kunde inte koppla fran konto just nu.",
    });
  } catch (error) {
    console.error("mailConnectionRoute disconnect misslyckades:", error);
    return res.status(500).json({
      ok: false,
      error: "Kunde inte koppla fran konto just nu.",
    });
  }
});

export default router;
