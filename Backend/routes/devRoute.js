import crypto from "node:crypto";
import express from "express";
import {
  processInboundAttachments,
} from "../services/mailgunInboundInvoiceService.js";
import {
  sanitizeInboundFilename,
  validateInboundAttachments,
} from "../services/mailgunInboundService.js";

const router = express.Router();

router.post("/simulate-inbound", async (req, res) => {
  if (!isDevRouteAllowed()) {
    return res.status(404).json({
      ok: false,
      error: "Not found.",
    });
  }

  if (!isDevSecretValid(req)) {
    return res.status(401).json({
      ok: false,
      error: "Ogiltig dev-nyckel.",
    });
  }

  const uid = String(req.body?.uid || "").trim();
  const token = String(req.body?.token || "dev-simulated").trim() || "dev-simulated";
  const recipient = String(req.body?.recipient || "dev@local.inbound").trim() || "dev@local.inbound";
  const from = String(req.body?.from || "dev-sender@example.test").trim();
  const subject = String(req.body?.subject || "Simulated inbound invoice").trim();
  const files = Array.isArray(req.body?.files) ? req.body.files : [];

  if (!uid) {
    return res.status(400).json({
      ok: false,
      error: "uid krävs i body.",
    });
  }

  if (!files.length) {
    return res.status(400).json({
      ok: false,
      error: "files[] krävs i body.",
    });
  }

  try {
    const attachments = files
      .map((file) => toInboundAttachment(file))
      .filter(Boolean);

    const validated = validateInboundAttachments(attachments, {
      filesLimitHit: false,
      truncatedFiles: [],
    });
    if (!validated.ok) {
      return res.status(validated.statusCode || 400).json({
        ok: false,
        error: validated.reason || "Filerna klarade inte validering.",
      });
    }

    const fields = {
      from,
      subject,
      recipient,
      date: new Date().toISOString(),
    };

    const processed = await processInboundAttachments({
      uid,
      token,
      recipient,
      fields,
      attachments: validated.attachments,
    });

    if (!processed.ok) {
      return res.status(processed.statusCode || 500).json({
        ok: false,
        error: processed.reason || "Dev simulate inbound misslyckades.",
      });
    }

    console.log(
      `[dev simulate inbound] uid=${uid} attachments=${validated.attachmentCount} accepted=${processed.acceptedCount} duplicates=${processed.duplicateCount} errors=${processed.errorCount}`
    );

    return res.status(202).json({
      ok: true,
      accepted: true,
      uid,
      attachmentCount: validated.attachmentCount,
      acceptedCount: processed.acceptedCount,
      duplicateCount: processed.duplicateCount,
      errorCount: processed.errorCount,
      createdInvoiceIds: processed.createdInvoiceIds || [],
      inboundLogIds: processed.inboundLogIds || [],
      message: "Simulerad inbound mottagen och köad för analys.",
    });
  } catch (error) {
    console.error("[dev simulate inbound] failed:", error);
    return res.status(400).json({
      ok: false,
      error: "Kunde inte tolka dev simulate inbound payload.",
    });
  }
});

function toInboundAttachment(file = {}) {
  const fileName = sanitizeInboundFilename(file.fileName || file.name || "attachment.bin");
  const contentType = normalizeContentType(file.contentType || file.type || "");
  const buffer = toBuffer(file);
  if (!buffer || !contentType) return null;

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  return {
    fieldName: "attachment",
    fileName,
    encoding: "base64",
    contentType,
    size: buffer.length,
    truncated: false,
    sha256,
    buffer,
  };
}

function toBuffer(file = {}) {
  if (typeof file.base64 === "string" && file.base64.trim()) {
    return fromBase64(file.base64);
  }
  if (typeof file.dataBase64 === "string" && file.dataBase64.trim()) {
    return fromBase64(file.dataBase64);
  }
  if (typeof file.dataUrl === "string" && file.dataUrl.trim()) {
    const base64 = extractDataUrlBase64(file.dataUrl);
    return fromBase64(base64);
  }
  return null;
}

function fromBase64(value) {
  const base64 = String(value || "").trim();
  if (!base64) return null;
  try {
    const buffer = Buffer.from(base64, "base64");
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

function extractDataUrlBase64(dataUrl) {
  const text = String(dataUrl || "");
  const marker = ";base64,";
  const index = text.indexOf(marker);
  if (index < 0) return "";
  return text.slice(index + marker.length);
}

function normalizeContentType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (type === "image/jpg") return "image/jpeg";
  return type;
}

function isDevRouteAllowed() {
  if (String(process.env.ALLOW_DEV_SIMULATE_INBOUND || "").trim().toLowerCase() === "true") {
    return true;
  }
  return String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production";
}

function isDevSecretValid(req) {
  const configured = String(process.env.DEV_SIMULATE_INBOUND_SECRET || "").trim();
  if (!configured) return true;
  const provided = String(req.headers["x-dev-secret"] || "").trim();
  return provided === configured;
}

export default router;
