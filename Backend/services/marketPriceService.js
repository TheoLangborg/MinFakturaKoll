const FALLBACK_CATEGORY_BENCHMARKS = {
  Mobil: { low: 149, median: 249, high: 399, sampleSize: 24 },
  Internet: { low: 299, median: 399, high: 549, sampleSize: 20 },
  El: { low: 799, median: 999, high: 1499, sampleSize: 18 },
  "Försäkring": { low: 189, median: 279, high: 439, sampleSize: 18 },
  Streaming: { low: 89, median: 129, high: 199, sampleSize: 22 },
  Bank: { low: 0, median: 99, high: 199, sampleSize: 15 },
  Övrigt: { low: 99, median: 199, high: 349, sampleSize: 15 },
};

const CATEGORY_QUERIES = {
  Mobil: "billigaste mobilabonnemang sverige månadskostnad",
  Internet: "billigaste bredband fiber abonnemang sverige",
  El: "billigaste elavtal sverige månadsavgift",
  "Försäkring": "billigaste hemförsäkring sverige pris per månad",
  Streaming: "streamingtjänst abonnemang pris per månad sverige",
  Bank: "bankkort kontopaket avgift per månad sverige",
  Övrigt: "billigaste abonnemangstjänst sverige pris per månad",
};

const CATEGORY_ALTERNATIVE_HINTS = {
  Mobil: ["Hallon", "Fello", "Vimla", "Comviq"],
  Internet: ["Bahnhof", "Ownit", "Bredband2", "Tele2"],
  El: ["Tibber", "Fortum", "Vattenfall", "Göta Energi"],
  "Försäkring": ["Hedvig", "IF", "Folksam", "Länsförsäkringar"],
  Streaming: ["Byt plan", "Familjeabonnemang", "Reklamplan"],
  Bank: ["Avgiftsfritt kort", "Kundrabatt", "Paketjämförelse"],
  Tjänst: ["Begär offert", "Jämför timpris", "Fast pris innan start"],
  Övrigt: ["Prisförhandling", "Byt leverantör", "Rabattkampanj"],
};

const NOT_COMPARABLE_CATEGORIES = new Set(["Tjänst"]);

const DEFAULT_TIMEOUT_MS = 9000;
const DEFAULT_CACHE_TTL_HOURS = 24;
const MIN_CACHE_TTL_HOURS = 1;
const MAX_CACHE_TTL_HOURS = 168;
const serpApiStatsCache = new Map();
const serpApiInFlight = new Map();

export async function compareMarketPrices(rawItems = []) {
  const items = sanitizeItems(rawItems);
  if (!items.length) {
    return {
      provider: "fallback",
      warning: "",
      items: [],
    };
  }

  const provider = resolveProvider();
  if (provider === "serpapi") {
    const result = await compareWithSerpApi(items);
    return {
      provider: result.provider,
      warning: result.warning,
      items: result.items,
    };
  }

  return {
    provider: "fallback",
    warning:
      "Live-prisjämförelse är inte aktiverad. Referensnivåer används tills SERPAPI_API_KEY är konfigurerad i backend/.env.",
    items: items.map((item) => buildFallbackComparison(item)),
  };
}

function sanitizeItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];

  return rawItems
    .slice(0, 30)
    .map((entry, index) => {
      const key = String(entry?.key || `entry-${index + 1}`).trim();
      const vendorName = String(entry?.vendorName || "").trim() || "Okänd leverantör";
      const category = normalizeCategory(entry?.category);
      const currentPrice = toFiniteNumber(entry?.currentPrice);
      const currency = String(entry?.currency || "SEK").trim().toUpperCase() || "SEK";

      if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;

      return {
        key,
        vendorName,
        category,
        currentPrice,
        currency,
      };
    })
    .filter(Boolean);
}

function resolveProvider() {
  const configured = String(process.env.MARKET_COMPARE_PROVIDER || "auto")
    .trim()
    .toLowerCase();

  if (configured === "fallback") return "fallback";
  if (configured === "serpapi") return process.env.SERPAPI_API_KEY ? "serpapi" : "fallback";

  return process.env.SERPAPI_API_KEY ? "serpapi" : "fallback";
}

async function compareWithSerpApi(items) {
  const apiKey = String(process.env.SERPAPI_API_KEY || "").trim();
  if (!apiKey) {
    return {
      provider: "fallback",
      warning:
        "SERPAPI_API_KEY saknas i backend/.env. Referensnivåer används tills nyckeln är konfigurerad.",
      items: items.map((item) => buildFallbackComparison(item)),
    };
  }

  evictExpiredCacheEntries();
  const cacheTtlMs = resolveCacheTtlMs();

  const compared = await Promise.all(
    items.map(async (item) => {
      if (isNonComparableCategory(item.category)) {
        return buildNonComparableComparison(item);
      }

      try {
        const marketStats = await getSerpApiStatsCached(item, apiKey, cacheTtlMs);
        return buildMarketComparison(item, marketStats);
      } catch (error) {
        return buildFallbackComparison(item, {
          note: "Live-data kunde inte hämtas just nu. Referensnivå användes för den här posten.",
        });
      }
    })
  );

  const usedFallback = compared.some((entry) => entry.provider !== "serpapi");
  return {
    provider: usedFallback ? "mixed" : "serpapi",
    warning: usedFallback
      ? "Vissa poster kunde inte hämtas live och beräknades därför med referensnivåer."
      : "",
    items: compared,
  };
}

async function fetchSerpApiStats(item, apiKey) {
  const query = CATEGORY_QUERIES[item.category] || CATEGORY_QUERIES.Övrigt;
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_shopping");
  url.searchParams.set("q", `${query} ${item.vendorName}`);
  url.searchParams.set("hl", "sv");
  url.searchParams.set("gl", "se");
  url.searchParams.set("num", "20");
  url.searchParams.set("api_key", apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`SerpAPI fel ${response.status}: ${message.slice(0, 300)}`);
  }

  const payload = await response.json();
  const prices = extractPricesFromSerpApi(payload);

  if (prices.length < 3) {
    throw new Error("För få prispunkter i SerpAPI-svar.");
  }

  prices.sort((a, b) => a - b);
  const low = percentile(prices, 0.2);
  const median = percentile(prices, 0.5);
  const high = percentile(prices, 0.8);

  return {
    low,
    median,
    high,
    sampleSize: prices.length,
    source: "SerpAPI/Google Shopping",
    provider: "serpapi",
  };
}

function extractPricesFromSerpApi(payload) {
  const rows = [];

  if (Array.isArray(payload?.shopping_results)) {
    rows.push(...payload.shopping_results);
  }
  if (Array.isArray(payload?.organic_results)) {
    rows.push(...payload.organic_results);
  }

  const prices = [];
  for (const row of rows) {
    const candidates = [
      row?.price,
      row?.extracted_price,
      row?.old_price,
      row?.snippet,
      row?.title,
    ];

    for (const candidate of candidates) {
      const parsed = parsePriceValue(candidate);
      if (Number.isFinite(parsed) && parsed > 0) {
        prices.push(parsed);
      }
    }
  }

  return dedupeNearValues(prices);
}

function parsePriceValue(rawValue) {
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) return rawValue;
  if (typeof rawValue !== "string") return null;

  const match = rawValue.match(/(\d[\d\s.,]*)/);
  if (!match?.[1]) return null;

  const normalized = match[1]
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, "")
    .replace(",", ".");

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function dedupeNearValues(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const unique = [];

  for (const value of sorted) {
    if (!unique.length) {
      unique.push(value);
      continue;
    }

    const prev = unique[unique.length - 1];
    if (Math.abs(prev - value) >= 1) {
      unique.push(value);
    }
  }

  return unique;
}

function buildFallbackComparison(item, options = {}) {
  if (isNonComparableCategory(item.category)) {
    return buildNonComparableComparison(item);
  }

  const benchmark = FALLBACK_CATEGORY_BENCHMARKS[item.category] || FALLBACK_CATEGORY_BENCHMARKS.Övrigt;
  return buildMarketComparison(item, {
    low: benchmark.low,
    median: benchmark.median,
    high: benchmark.high,
    sampleSize: benchmark.sampleSize,
    source: "Referensnivå",
    provider: "fallback",
    note: options.note || "",
  });
}

function buildNonComparableComparison(item) {
  const currentPrice = round2(item.currentPrice);

  return {
    key: item.key,
    vendorName: item.vendorName,
    category: item.category,
    currency: item.currency,
    currentPrice,
    marketLow: currentPrice,
    marketMedian: currentPrice,
    marketHigh: currentPrice,
    sampleSize: 0,
    source: "Ej tillämpligt",
    provider: "not_applicable",
    possibleSaving: 0,
    savingPercent: 0,
    recommendation:
      "Kategorin Tjänst behandlas som engångskostnad och jämförs inte som ett månadsabonnemang.",
    alternativeHints: CATEGORY_ALTERNATIVE_HINTS[item.category] || CATEGORY_ALTERNATIVE_HINTS.Övrigt,
    note: "Manuell prisjämförelse rekommenderas för engångsarbete.",
  };
}

function buildMarketComparison(item, marketStats) {
  const marketMedian = round2(marketStats.median);
  const possibleSaving = Math.max(0, round2(item.currentPrice - marketMedian));
  const savingPercent =
    item.currentPrice > 0 ? round2((possibleSaving / item.currentPrice) * 100) : 0;

  return {
    key: item.key,
    vendorName: item.vendorName,
    category: item.category,
    currency: item.currency,
    currentPrice: round2(item.currentPrice),
    marketLow: round2(marketStats.low),
    marketMedian,
    marketHigh: round2(marketStats.high),
    sampleSize: Number(marketStats.sampleSize || 0),
    source: marketStats.source || "Okänd källa",
    provider: marketStats.provider || "fallback",
    possibleSaving,
    savingPercent,
    recommendation: buildRecommendation({
      item,
      marketMedian,
      possibleSaving,
      savingPercent,
    }),
    alternativeHints: CATEGORY_ALTERNATIVE_HINTS[item.category] || CATEGORY_ALTERNATIVE_HINTS.Övrigt,
    note: marketStats.note || "",
  };
}

function buildRecommendation({ item, marketMedian, possibleSaving, savingPercent }) {
  if (possibleSaving <= 0) {
    return `Du ligger redan i nivå med marknadsmedian för ${item.category.toLowerCase()}.`;
  }

  if (savingPercent >= 30) {
    return `Stor avvikelse mot marknaden. Förhandla direkt eller byt leverantör.`;
  }

  if (savingPercent >= 15) {
    return `Du kan sannolikt sänka kostnaden genom omförhandling. Sikta mot ca ${marketMedian} kr/mån.`;
  }

  return `Mindre avvikelse mot marknaden. Be om lojalitetsrabatt.`;
}

function isNonComparableCategory(category) {
  return NOT_COMPARABLE_CATEGORIES.has(normalizeCategory(category));
}

function normalizeCategory(value) {
  const key = String(value || "")
    .trim()
    .toLowerCase();

  const map = {
    mobil: "Mobil",
    internet: "Internet",
    el: "El",
    försäkring: "Försäkring",
    forsakring: "Försäkring",
    streaming: "Streaming",
    bank: "Bank",
    tjänst: "Tjänst",
    tjanst: "Tjänst",
    service: "Tjänst",
    hantverk: "Tjänst",
    installation: "Tjänst",
    renovering: "Tjänst",
    övrigt: "Övrigt",
    ovrigt: "Övrigt",
  };

  return map[key] || "Övrigt";
}

function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const cleaned = value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, "")
    .replace(/kr|sek|eur|usd/gi, "")
    .replace(",", ".");

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentile(sortedValues, ratio) {
  if (!sortedValues.length) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (sortedValues.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];

  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function round2(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

async function getSerpApiStatsCached(item, apiKey, cacheTtlMs) {
  const cacheKey = buildCacheKey(item);
  const cached = readCachedMarketStats(cacheKey);
  if (cached) {
    return cached;
  }

  const inFlight = serpApiInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const pending = fetchSerpApiStats(item, apiKey)
    .then((stats) => {
      writeCachedMarketStats(cacheKey, stats, cacheTtlMs);
      return stats;
    })
    .finally(() => {
      serpApiInFlight.delete(cacheKey);
    });

  serpApiInFlight.set(cacheKey, pending);
  return pending;
}

function buildCacheKey(item) {
  const category = normalizeCacheToken(item?.category || "");
  const vendor = normalizeCacheToken(item?.vendorName || "");
  return `${category}|${vendor}`;
}

function normalizeCacheToken(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readCachedMarketStats(cacheKey) {
  const entry = serpApiStatsCache.get(cacheKey);
  if (!entry) return null;

  if (!Number.isFinite(entry.expiresAt) || entry.expiresAt <= Date.now()) {
    serpApiStatsCache.delete(cacheKey);
    return null;
  }

  return entry.value || null;
}

function writeCachedMarketStats(cacheKey, value, cacheTtlMs) {
  serpApiStatsCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + cacheTtlMs,
  });
}

function evictExpiredCacheEntries() {
  const now = Date.now();
  for (const [key, entry] of serpApiStatsCache.entries()) {
    if (!Number.isFinite(entry?.expiresAt) || entry.expiresAt <= now) {
      serpApiStatsCache.delete(key);
    }
  }
}

function resolveCacheTtlMs() {
  const configuredHours = Number(
    process.env.MARKET_COMPARE_CACHE_TTL_HOURS || DEFAULT_CACHE_TTL_HOURS
  );
  if (!Number.isFinite(configuredHours)) {
    return DEFAULT_CACHE_TTL_HOURS * 60 * 60 * 1000;
  }

  const safeHours = Math.min(
    MAX_CACHE_TTL_HOURS,
    Math.max(MIN_CACHE_TTL_HOURS, Math.floor(configuredHours))
  );
  return safeHours * 60 * 60 * 1000;
}
