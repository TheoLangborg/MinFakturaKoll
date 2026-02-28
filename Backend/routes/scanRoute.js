import express from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { saveHistoryEntry } from "../services/historyService.js";
import { scanInvoice } from "../services/invoiceService.js";

const router = express.Router();

router.post("/scan", requireAuth, async (req, res) => {
  try {
    const result = await scanInvoice({
      text: req.body?.text,
      file: req.body?.file,
    });

    let historyId = "";
    let historyWarning = "";

    try {
      const historySave = await saveHistoryEntry({
        userId: req.user?.uid || "",
        extracted: result.extracted,
        analysisMode: result.analysisMode,
        sourceType: req.body?.file ? "file" : "text",
        fileName: req.body?.file?.name || "",
        filePayload: req.body?.file || null,
        sourceText: req.body?.text || "",
      });

      if (historySave.ok) {
        historyId = historySave.id || "";
      } else {
        historyWarning =
          historySave.reason ||
          "Analysen blev klar men kunde inte sparas i historiken just nu.";
      }
    } catch (historyError) {
      console.error("Kunde inte spara historik:", historyError);
      historyWarning = "Analysen blev klar men kunde inte sparas i historiken just nu.";
    }

    const combinedWarning = [result.warning, historyWarning].filter(Boolean).join(" ");

    return res.json({
      ok: true,
      ...result,
      historyId,
      warning: combinedWarning,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "MISSING_INPUT") {
      return res.status(400).json({
        ok: false,
        error: "Ingen fakturadata skickades in. Ladda upp fil eller skicka text.",
      });
    }

    console.error("scanRoute misslyckades:", error);
    return res.status(500).json({
      ok: false,
      error:
        "Vi kunde inte analysera fakturan just nu. Kontrollera filen och försök igen om en stund.",
    });
  }
});

export default router;
