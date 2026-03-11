import express from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  approveMailImportReview,
  listMailImportReviews,
  rejectMailImportReview,
  runMailImportSync,
} from "../services/mailImportService.js";
import {
  completeMailConnectionCallback,
  disconnectMailConnection,
  getMailConnectionStatusForUser,
  startMailConnection,
  updateMailImportSettings,
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
      error: disconnected.ok ? "" : disconnected.reason || "Kunde inte koppla från konto just nu.",
    });
  } catch (error) {
    console.error("mailConnectionRoute disconnect misslyckades:", error);
    return res.status(500).json({
      ok: false,
      error: "Kunde inte koppla från konto just nu.",
    });
  }
});

router.post("/:provider/settings", async (req, res) => {
  try {
    const updated = await updateMailImportSettings({
      userId: req.user?.uid || "",
      provider: req.params?.provider,
      importTypes: req.body?.importTypes || {},
    });

    return res.status(updated.statusCode || (updated.ok ? 200 : 400)).json({
      ok: Boolean(updated.ok),
      provider: updated.provider || String(req.params?.provider || "").trim().toLowerCase(),
      importTypes: updated.importTypes || {},
      error: updated.ok ? "" : updated.reason || "Kunde inte spara importreglerna.",
    });
  } catch (error) {
    console.error("mailConnectionRoute settings misslyckades:", error);
    return res.status(500).json({
      ok: false,
      error: "Kunde inte spara importreglerna just nu.",
    });
  }
});

router.post("/:provider/sync-now", async (req, res) => {
  try {
    const synced = await runMailImportSync({
      userId: req.user?.uid || "",
      provider: req.params?.provider,
      maxMessages: req.body?.maxMessages,
    });

    return res.status(synced.statusCode || (synced.ok ? 200 : 400)).json({
      ok: Boolean(synced.ok),
      provider: synced.provider || String(req.params?.provider || "").trim().toLowerCase(),
      stats: synced.stats || {},
      pendingReviewCount: synced.pendingReviewCount || 0,
      importTypes: synced.importTypes || {},
      message: synced.message || "",
      error: synced.ok ? "" : synced.reason || "Kunde inte starta mailsynken.",
    });
  } catch (error) {
    console.error("mailConnectionRoute sync misslyckades:", error);
    return res.status(500).json({
      ok: false,
      error: "Kunde inte starta mailsynken just nu.",
    });
  }
});

router.get("/:provider/reviews", async (req, res) => {
  try {
    const reviews = await listMailImportReviews({
      userId: req.user?.uid || "",
      provider: req.params?.provider,
      limit: req.query?.limit,
    });

    return res.status(reviews.statusCode || (reviews.ok ? 200 : 400)).json({
      ok: Boolean(reviews.ok),
      provider: String(req.params?.provider || "").trim().toLowerCase(),
      items: Array.isArray(reviews.items) ? reviews.items : [],
      error: reviews.ok ? "" : reviews.reason || "Kunde inte hamta granskningskon.",
    });
  } catch (error) {
    console.error("mailConnectionRoute reviews misslyckades:", error);
    return res.status(500).json({
      ok: false,
      error: "Kunde inte hamta granskningskon just nu.",
    });
  }
});

router.post("/:provider/reviews/:reviewId/approve", async (req, res) => {
  try {
    const approved = await approveMailImportReview({
      userId: req.user?.uid || "",
      provider: req.params?.provider,
      reviewId: req.params?.reviewId,
    });

    return res.status(approved.statusCode || (approved.ok ? 200 : 400)).json({
      ok: Boolean(approved.ok),
      action: approved.action || "",
      acceptedCount: approved.acceptedCount || 0,
      duplicateCount: approved.duplicateCount || 0,
      errorCount: approved.errorCount || 0,
      pendingReviewCount: approved.pendingReviewCount || 0,
      error: approved.ok ? "" : approved.reason || "Kunde inte godkänna meddelandet.",
    });
  } catch (error) {
    console.error("mailConnectionRoute approve misslyckades:", error);
    return res.status(500).json({
      ok: false,
      error: "Kunde inte godkänna meddelandet just nu.",
    });
  }
});

router.post("/:provider/reviews/:reviewId/reject", async (req, res) => {
  try {
    const rejected = await rejectMailImportReview({
      userId: req.user?.uid || "",
      provider: req.params?.provider,
      reviewId: req.params?.reviewId,
    });

    return res.status(rejected.statusCode || (rejected.ok ? 200 : 400)).json({
      ok: Boolean(rejected.ok),
      action: rejected.action || "",
      error: rejected.ok ? "" : rejected.reason || "Kunde inte avvisa meddelandet.",
    });
  } catch (error) {
    console.error("mailConnectionRoute reject misslyckades:", error);
    return res.status(500).json({
      ok: false,
      error: "Kunde inte avvisa meddelandet just nu.",
    });
  }
});

export default router;
