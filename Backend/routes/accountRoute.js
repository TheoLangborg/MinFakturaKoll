import express from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { deleteAllHistoryEntries } from "../services/historyService.js";

const router = express.Router();
router.use(requireAuth);

router.post("/purge", async (req, res) => {
  try {
    const result = await deleteAllHistoryEntries(req.user?.uid || "");
    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        error: result.reason || "Kunde inte radera kontodata just nu.",
      });
    }

    return res.json({
      ok: true,
      deletedHistoryCount: result.deletedCount || 0,
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
