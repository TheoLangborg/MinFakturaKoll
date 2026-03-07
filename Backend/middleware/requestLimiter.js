const STORE = new Map();

export function createRateLimiter({
  name = "default",
  windowMs = 60 * 1000,
  max = 120,
  keyGenerator = (req) => req.ip || "unknown",
  skip = () => false,
  message = "For manga forfragningar. Forsok igen om en stund.",
} = {}) {
  const safeName = String(name || "default");
  const safeWindowMs = clampInt(windowMs, 1000, 24 * 60 * 60 * 1000, 60 * 1000);
  const safeMax = clampInt(max, 1, 50000, 120);
  let lastCleanupAt = 0;

  return function rateLimiter(req, res, next) {
    if (skip(req)) {
      return next();
    }

    const now = Date.now();
    const entryStore = getStoreForName(safeName);

    if (now - lastCleanupAt > safeWindowMs) {
      cleanupExpiredEntries(entryStore, now);
      lastCleanupAt = now;
    }

    const key = String(keyGenerator(req) || "unknown");
    const bucket = entryStore.get(key);

    if (!bucket || now >= bucket.resetAt) {
      entryStore.set(key, {
        count: 1,
        resetAt: now + safeWindowMs,
      });

      setRateHeaders(res, {
        limit: safeMax,
        remaining: safeMax - 1,
        resetAt: now + safeWindowMs,
      });
      return next();
    }

    if (bucket.count >= safeMax) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      setRateHeaders(res, {
        limit: safeMax,
        remaining: 0,
        resetAt: bucket.resetAt,
      });
      return res.status(429).json({
        ok: false,
        error: message,
        retryAfterSec,
      });
    }

    bucket.count += 1;
    entryStore.set(key, bucket);
    setRateHeaders(res, {
      limit: safeMax,
      remaining: Math.max(0, safeMax - bucket.count),
      resetAt: bucket.resetAt,
    });
    return next();
  };
}

function getStoreForName(name) {
  if (!STORE.has(name)) {
    STORE.set(name, new Map());
  }
  return STORE.get(name);
}

function cleanupExpiredEntries(entryStore, now) {
  for (const [key, value] of entryStore.entries()) {
    if (!value || now >= Number(value.resetAt || 0)) {
      entryStore.delete(key);
    }
  }
}

function setRateHeaders(res, { limit, remaining, resetAt }) {
  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.floor(Number(resetAt || 0) / 1000)));
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function readPositiveIntEnv(key, fallback, min = 1, max = 50000) {
  const raw = Number(process.env[key]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

function readWindowMsEnv(key, fallback) {
  const seconds = Number(process.env[key]);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  return Math.floor(seconds * 1000);
}

export const globalApiRateLimiter = createRateLimiter({
  name: "global-api",
  windowMs: readWindowMsEnv("RATE_LIMIT_GLOBAL_WINDOW_SEC", 60 * 1000),
  max: readPositiveIntEnv("RATE_LIMIT_GLOBAL_MAX", 240),
  message: "For manga API-anrop fran samma klient. Forsok igen om en stund.",
});

export const scanRateLimiter = createRateLimiter({
  name: "scan",
  windowMs: readWindowMsEnv("RATE_LIMIT_SCAN_WINDOW_SEC", 10 * 60 * 1000),
  max: readPositiveIntEnv("RATE_LIMIT_SCAN_MAX", 45),
  message: "Du har gjort for manga fakturaskanningar pa kort tid.",
});

export const accountRateLimiter = createRateLimiter({
  name: "account",
  windowMs: readWindowMsEnv("RATE_LIMIT_ACCOUNT_WINDOW_SEC", 15 * 60 * 1000),
  max: readPositiveIntEnv("RATE_LIMIT_ACCOUNT_MAX", 30),
  message: "For manga kontoanrop pa kort tid.",
});

export const inboxRateLimiter = createRateLimiter({
  name: "inbox",
  windowMs: readWindowMsEnv("RATE_LIMIT_INBOX_WINDOW_SEC", 10 * 60 * 1000),
  max: readPositiveIntEnv("RATE_LIMIT_INBOX_MAX", 50),
  message: "For manga inbox-anrop pa kort tid.",
});

export const mailConnectionRateLimiter = createRateLimiter({
  name: "mail-connections",
  windowMs: readWindowMsEnv("RATE_LIMIT_MAIL_CONNECTION_WINDOW_SEC", 15 * 60 * 1000),
  max: readPositiveIntEnv("RATE_LIMIT_MAIL_CONNECTION_MAX", 30),
  message: "For manga OAuth/anropsforsok pa kort tid.",
});

export const webhookRateLimiter = createRateLimiter({
  name: "mailgun-webhook",
  windowMs: readWindowMsEnv("RATE_LIMIT_WEBHOOK_WINDOW_SEC", 60 * 1000),
  max: readPositiveIntEnv("RATE_LIMIT_WEBHOOK_MAX", 240),
  keyGenerator: (req) => {
    const forwardedFor = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    return forwardedFor || req.ip || "unknown";
  },
  message: "Webhook-frekvensen ar for hog just nu.",
});

export const devRouteRateLimiter = createRateLimiter({
  name: "dev",
  windowMs: readWindowMsEnv("RATE_LIMIT_DEV_WINDOW_SEC", 60 * 1000),
  max: readPositiveIntEnv("RATE_LIMIT_DEV_MAX", 30),
  message: "For manga dev-anrop pa kort tid.",
});
