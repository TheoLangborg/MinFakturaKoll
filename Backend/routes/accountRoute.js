import express from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { deleteAllHistoryEntries } from "../services/historyService.js";
import { deactivateInboxesForUser } from "../services/inboxService.js";
import { purgeMailConnectionsForUser } from "../services/mailOAuthService.js";

const router = express.Router();
router.use(requireAuth);

router.post("/purge", async (req, res) => {
  try {
    const userId = req.user?.uid || "";
    const [historyResult, inboxResult, mailResult] = await Promise.all([
      deleteAllHistoryEntries(userId),
      deactivateInboxesForUser(userId),
      purgeMailConnectionsForUser(userId),
    ]);

    const errors = [historyResult, inboxResult, mailResult]
      .filter((entry) => !entry?.ok)
      .map((entry) => String(entry?.reason || "").trim())
      .filter(Boolean);

    if (errors.length) {
      return res.status(400).json({
        ok: false,
        error: errors.join(" "),
      });
    }

    return res.json({
      ok: true,
      deletedHistoryCount: historyResult.deletedCount || 0,
      deactivatedInboxCount: inboxResult.deactivatedCount || 0,
      deletedMailConnectionCount: mailResult.deletedConnections || 0,
      deletedMailOauthStateCount: mailResult.deletedPendingStates || 0,
    });
  } catch (error) {
    console.error("accountRoute purge misslyckades:", error);
    return res.status(500).json({
      ok: false,
      error: "Kunde inte radera kontodata just nu. Försök igen om en stund.",
    });
  }
});

export default router;
