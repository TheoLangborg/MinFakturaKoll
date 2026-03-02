import express from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { createOrGetInboxForUser } from "../services/inboxService.js";

const router = express.Router();
router.use(requireAuth);

router.post("/create", async (req, res) => {
  try {
    const created = await createOrGetInboxForUser(req.user?.uid || "");
    if (!created.ok) {
      return res.status(created.statusCode || 400).json({
        ok: false,
        error: created.reason || "Inbox-adressen kunde inte skapas.",
      });
    }

    return res.json({
      ok: true,
      created: Boolean(created.created),
      inboxAddress: created.inboxAddress,
      token: created.token,
    });
  } catch (error) {
    console.error("inboxRoute create misslyckades:", error);
    return res.status(500).json({
      ok: false,
      error: "Inbox-adressen kunde inte skapas just nu. Försök igen om en stund.",
    });
  }
});

export default router;
