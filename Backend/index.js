import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import scanRoute from "./routes/scanRoute.js";
import testRoute from "./routes/testRoute.js";
import historyRoute from "./routes/historyRoute.js";
import marketRoute from "./routes/marketRoute.js";
import accountRoute from "./routes/accountRoute.js";
import inboxRoute from "./routes/inboxRoute.js";
import mailgunWebhookRoute from "./routes/mailgunWebhookRoute.js";
import mailConnectionRoute from "./routes/mailConnectionRoute.js";
import devRoute from "./routes/devRoute.js";
import { applySecurityHeaders } from "./middleware/securityHeaders.js";
import {
  accountRateLimiter,
  devRouteRateLimiter,
  globalApiRateLimiter,
  inboxRateLimiter,
  mailConnectionRateLimiter,
  scanRateLimiter,
  webhookRateLimiter,
} from "./middleware/requestLimiter.js";
import { startInboundInvoiceWorker } from "./services/mailgunInboundInvoiceService.js";
import { cleanupExpiredOauthStates } from "./services/mailOAuthService.js";

dotenv.config();

const app = express();
const allowedOrigins = resolveAllowedOrigins();
const port = Number(process.env.PORT || 3001);

app.disable("x-powered-by");
app.set("trust proxy", shouldTrustProxy() ? 1 : false);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser or same-origin server requests with no Origin header.
      if (!origin) {
        callback(null, true);
        return;
      }

      const normalizedOrigin = normalizeOrigin(origin);
      if (normalizedOrigin && allowedOrigins.has(normalizedOrigin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.use(applySecurityHeaders);
app.use(express.json({ limit: "35mb" }));
app.use("/api", globalApiRateLimiter);

app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));
app.use("/api", scanRateLimiter, scanRoute);
app.use("/api/history", historyRoute);
app.use("/api/market", marketRoute);
app.use("/api/account", accountRateLimiter, accountRoute);
app.use("/api/inbox", inboxRateLimiter, inboxRoute);
app.use("/api/mail-connections", mailConnectionRateLimiter, mailConnectionRoute);
app.use("/api/test", testRoute);
app.use("/webhooks/mailgun", webhookRateLimiter, mailgunWebhookRoute);
app.use("/dev", devRouteRateLimiter, devRoute);

startInboundInvoiceWorker();
startOauthStateCleanupWorker();

const server = app.listen(port, () => {
  console.log(`[cors] Allowed frontend origins: ${[...allowedOrigins].join(", ")}`);
  console.log(`MinFakturaKoll backend startad: http://localhost:${port}`);
});

const requestTimeoutMs = clampNumber(process.env.SERVER_REQUEST_TIMEOUT_MS, 180000, 30000, 900000);
const headersTimeoutMs = clampNumber(process.env.SERVER_HEADERS_TIMEOUT_MS, 185000, 35000, 920000);
server.requestTimeout = requestTimeoutMs;
server.headersTimeout = Math.max(headersTimeoutMs, requestTimeoutMs + 5000);

function resolveAllowedOrigins() {
  const originsFromList = String(process.env.FRONTEND_ORIGINS || "")
    .split(",")
    .map((entry) => normalizeOrigin(entry))
    .filter(Boolean);

  const fallbackOrigin = normalizeOrigin(process.env.FRONTEND_ORIGIN || "");
  const defaults =
    originsFromList.length > 0
      ? originsFromList
      : [fallbackOrigin || "http://localhost:5173"];

  return new Set(defaults);
}

function normalizeOrigin(value) {
  let raw = String(value || "")
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "");
  if (!raw) return "";

  if (!/^https?:\/\//i.test(raw)) {
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(raw)) {
      raw = `http://${raw}`;
    } else {
      raw = `https://${raw}`;
    }
  }

  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return "";
  }
}

function shouldTrustProxy() {
  const value = String(process.env.TRUST_PROXY || "true").trim().toLowerCase();
  return value !== "false";
}

function startOauthStateCleanupWorker() {
  const enabled = String(process.env.OAUTH_STATE_CLEANUP_ENABLED || "true").trim().toLowerCase();
  if (enabled === "false") return;

  const intervalMs = clampNumber(process.env.OAUTH_STATE_CLEANUP_INTERVAL_SEC, 3600, 60, 86400) * 1000;

  const timer = setInterval(() => {
    void cleanupExpiredOauthStates()
      .then((result) => {
        if (result?.ok && Number(result.deletedCount || 0) > 0) {
          console.log(`[mail oauth] cleanup deleted=${result.deletedCount}`);
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error || "unknown error");
        console.warn(`[mail oauth] cleanup failed: ${message}`);
      });
  }, intervalMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}
