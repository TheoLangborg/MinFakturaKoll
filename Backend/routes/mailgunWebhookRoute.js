import express from "express";
import {
  parseMailgunInboundPayload,
  reserveInboxDailyQuota,
  resolveActiveInboxByToken,
  resolveInboundRecipient,
  validateInboundAttachments,
  verifyMailgunSignature,
} from "../services/mailgunInboundService.js";
import { processInboundAttachments } from "../services/mailgunInboundInvoiceService.js";

const router = express.Router();

router.post("/inbound", async (req, res) => {
  try {
    const parsed = await parseMailgunInboundPayload(req);

    const signature = verifyMailgunSignature(parsed.fields);
    if (!signature.ok) {
      return res.status(signature.statusCode || 401).json({
        ok: false,
        error: signature.reason || "Ogiltig webhook-signatur.",
      });
    }

    const recipient = resolveInboundRecipient(parsed.fields);
    if (!recipient.ok) {
      return res.status(recipient.statusCode || 202).json({
        ok: true,
        accepted: true,
        message: recipient.reason || "Webhook mottagen utan giltig recipient.",
      });
    }

    const inbox = await resolveActiveInboxByToken(recipient.token);
    if (!inbox.ok) {
      return res.status(inbox.statusCode || 202).json({
        ok: true,
        accepted: true,
        message: inbox.reason || "Inbox-token kunde inte mappas till aktiv användare.",
      });
    }

    const attachmentValidation = validateInboundAttachments(parsed.attachments, parsed.limits);
    if (!attachmentValidation.ok) {
      console.warn(
        `[mailgun inbound] blocked token=${recipient.token} uid=${inbox.uid} reason="${
          attachmentValidation.reason || "invalid_attachments"
        }"`
      );
      return res.status(attachmentValidation.statusCode || 202).json({
        ok: true,
        accepted: true,
        blocked: true,
        message: attachmentValidation.reason || "Inbound avvisades av säkerhetsregler.",
      });
    }

    const quota = await reserveInboxDailyQuota(recipient.token, attachmentValidation.attachmentCount);
    if (!quota.ok) {
      console.warn(
        `[mailgun inbound] blocked token=${recipient.token} uid=${inbox.uid} reason="${
          quota.reason || "quota_exceeded"
        }"`
      );
      return res.status(quota.statusCode || 202).json({
        ok: true,
        accepted: true,
        blocked: true,
        message: quota.reason || "Inbound avvisades av daglig gräns.",
      });
    }

    const processed = await processInboundAttachments({
      uid: inbox.uid,
      token: recipient.token,
      recipient: recipient.recipient,
      fields: parsed.fields,
      attachments: attachmentValidation.attachments,
    });
    if (!processed.ok) {
      console.warn(
        `[mailgun inbound] processing-failed token=${recipient.token} uid=${inbox.uid} reason="${
          processed.reason || "processing_error"
        }"`
      );
      return res.status(processed.statusCode || 503).json({
        ok: false,
        accepted: false,
        error: processed.reason || "Inbound kunde inte processas just nu.",
      });
    }

    const attachmentCount = attachmentValidation.attachmentCount;
    const from = readField(parsed.fields, ["from"]);
    const subject = readField(parsed.fields, ["subject"]);

    console.log(
      `[mailgun inbound] token=${recipient.token} uid=${inbox.uid} attachments=${attachmentCount} accepted=${processed.acceptedCount} duplicates=${processed.duplicateCount} errors=${processed.errorCount} from="${from}" subject="${subject}" quota=${quota.dailyCount}/${quota.dailyLimit}`
    );

    return res.status(202).json({
      ok: true,
      accepted: true,
      attachmentCount,
      acceptedCount: processed.acceptedCount,
      duplicateCount: processed.duplicateCount,
      errorCount: processed.errorCount,
      recipient: recipient.recipient,
      message: "Inbound verifierad och köad för analys.",
    });
  } catch (error) {
    console.error("mailgunWebhookRoute inbound misslyckades:", error);
    return res.status(400).json({
      ok: false,
      error: "Inbound-webhook kunde inte tolkas.",
    });
  }
});

function readField(fields = {}, keys = []) {
  for (const key of keys) {
    if (!(key in fields)) continue;
    const value = fields[key];
    if (Array.isArray(value)) {
      const first = value.find((entry) => String(entry || "").trim());
      if (first) return String(first).trim();
      continue;
    }
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

export default router;
