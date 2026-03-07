import crypto from "node:crypto";
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
    const ipGate = verifyWebhookIpAllowlist(req);
    if (!ipGate.ok) {
      return res.status(403).json({
        ok: false,
        error: ipGate.reason || "Webhook source IP ar inte tillaten.",
      });
    }

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
      const tokenRef = fingerprint(recipient.token);
      const userRef = fingerprint(inbox.uid);
      console.warn(
        `[mailgun inbound] blocked tokenRef=${tokenRef} userRef=${userRef} reason="${
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
      const tokenRef = fingerprint(recipient.token);
      const userRef = fingerprint(inbox.uid);
      console.warn(
        `[mailgun inbound] blocked tokenRef=${tokenRef} userRef=${userRef} reason="${
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
      const tokenRef = fingerprint(recipient.token);
      const userRef = fingerprint(inbox.uid);
      console.warn(
        `[mailgun inbound] processing-failed tokenRef=${tokenRef} userRef=${userRef} reason="${
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
    const tokenRef = fingerprint(recipient.token);
    const userRef = fingerprint(inbox.uid);
    const fromDomain = extractEmailDomain(from);
    const subjectLength = String(subject || "").length;

    console.log(
      `[mailgun inbound] tokenRef=${tokenRef} userRef=${userRef} attachments=${attachmentCount} accepted=${processed.acceptedCount} duplicates=${processed.duplicateCount} errors=${processed.errorCount} fromDomain=${fromDomain || "-"} subjectLength=${subjectLength} quota=${quota.dailyCount}/${quota.dailyLimit}`
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

function fingerprint(value) {
  const safe = String(value || "").trim();
  if (!safe) return "-";
  return crypto.createHash("sha256").update(safe).digest("hex").slice(0, 12);
}

function extractEmailDomain(value) {
  const safe = String(value || "").trim().toLowerCase();
  const match = safe.match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
  return match?.[1] || "";
}

function verifyWebhookIpAllowlist(req) {
  const allowlistRaw = String(process.env.MAILGUN_WEBHOOK_ALLOWED_IPS || "").trim();
  if (!allowlistRaw) {
    return { ok: true };
  }

  const allowlist = new Set(
    allowlistRaw
      .split(",")
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
  if (!allowlist.size) {
    return { ok: true };
  }

  const clientIp = resolveClientIp(req);
  if (!clientIp) {
    return {
      ok: false,
      reason: "Webhook source IP kunde inte verifieras.",
    };
  }

  if (!allowlist.has(clientIp)) {
    return {
      ok: false,
      reason: "Webhook source IP ar inte tillaten.",
    };
  }

  return { ok: true };
}

function resolveClientIp(req) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  const safeForwarded = normalizeIp(forwardedFor);
  if (safeForwarded) return safeForwarded;

  const reqIp = normalizeIp(req.ip);
  if (reqIp) return reqIp;

  return "";
}

function normalizeIp(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/^::ffff:/i, "");
}

export default router;
