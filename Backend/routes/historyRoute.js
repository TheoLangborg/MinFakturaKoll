import express from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  deleteAllHistoryEntries,
  deleteHistoryEntries,
  deleteHistoryEntry,
  listHistoryEntries,
  updateHistoryEntry,
} from "../services/historyService.js";

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const limit = req.query?.limit;
    const history = await listHistoryEntries(req.user?.uid || "", limit);
    return res.json({
      ok: true,
      ...history,
    });
  } catch (error) {
    console.error("historyRoute misslyckades:", error);
    return res.status(500).json({
      ok: false,
      error: "Historiken kunde inte hämtas just nu. Försök igen om en stund.",
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const historyId = req.params?.id;
    const updated = await updateHistoryEntry(req.user?.uid || "", historyId, req.body?.extracted || {});

    if (!updated.ok) {
      return res.status(400).json({
        ok: false,
        error: updated.reason || "Historikposten kunde inte uppdateras. Kontrollera indata och försök igen.",
      });
    }

    return res.json({
      ok: true,
    });
  } catch (error) {
    console.error("historyRoute uppdatering misslyckades:", error);
    return res.status(500).json({
      ok: false,
      error: "Historikposten kunde inte uppdateras just nu. Försök igen.",
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const historyId = req.params?.id;
    const deleted = await deleteHistoryEntry(req.user?.uid || "", historyId);

    if (!deleted.ok) {
      return res.status(400).json({
        ok: false,
        error: deleted.reason || "Historikposten kunde inte raderas. Kontrollera att posten finns kvar.",
      });
    }

    return res.json({
      ok: true,
      deletedCount: deleted.deletedCount || 0,
    });
  } catch (error) {
    console.error("historyRoute radering misslyckades:", error);
    return res.status(500).json({
      ok: false,
      error: "Historikposten kunde inte raderas just nu. Försök igen.",
    });
  }
});

router.post("/delete", async (req, res) => {
  try {
    const removeAll = Boolean(req.body?.all);

    if (removeAll) {
      const deleted = await deleteAllHistoryEntries(req.user?.uid || "");
      if (!deleted.ok) {
        return res.status(400).json({
          ok: false,
          error: deleted.reason || "All historik kunde inte raderas. Försök igen om en stund.",
        });
      }

      return res.json({
        ok: true,
        deletedCount: deleted.deletedCount || 0,
      });
    }

    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const deleted = await deleteHistoryEntries(req.user?.uid || "", ids);
    if (!deleted.ok) {
      return res.status(400).json({
        ok: false,
        error: deleted.reason || "Markerad historik kunde inte raderas. Försök igen om en stund.",
      });
    }

    return res.json({
      ok: true,
      deletedCount: deleted.deletedCount || 0,
    });
  } catch (error) {
    console.error("historyRoute massradering misslyckades:", error);
    return res.status(500).json({
      ok: false,
      error: "Historiken kunde inte raderas just nu. Försök igen om en stund.",
    });
  }
});

export default router;
