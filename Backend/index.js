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
import devRoute from "./routes/devRoute.js";
import { startInboundInvoiceWorker } from "./services/mailgunInboundInvoiceService.js";

dotenv.config();

const app = express();
const allowedOrigins = resolveAllowedOrigins();
const port = Number(process.env.PORT || 3001);

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

app.use(express.json({ limit: "35mb" }));

app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));
app.use("/api", scanRoute);
app.use("/api/history", historyRoute);
app.use("/api/market", marketRoute);
app.use("/api/account", accountRoute);
app.use("/api/inbox", inboxRoute);
app.use("/api/test", testRoute);
app.use("/webhooks/mailgun", mailgunWebhookRoute);
app.use("/dev", devRoute);

startInboundInvoiceWorker();

app.listen(port, () => {
  console.log(`[cors] Allowed frontend origins: ${[...allowedOrigins].join(", ")}`);
  console.log(`MinKostnadskoll backend startad: http://localhost:${port}`);
});

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
  let raw = String(value || "").trim();
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
