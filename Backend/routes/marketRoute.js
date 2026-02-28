import express from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { compareMarketPrices } from "../services/marketPriceService.js";

const router = express.Router();
router.use(requireAuth);

router.post("/compare", async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const result = await compareMarketPrices(items);

    return res.json({
      ok: true,
      provider: result.provider,
      warning: result.warning || "",
      items: result.items || [],
    });
  } catch (error) {
    console.error("marketRoute misslyckades:", error);
    return res.status(500).json({
      ok: false,
      error: "Extern prisjämförelse är tillfälligt otillgänglig. Försök igen om en stund.",
    });
  }
});

export default router;
