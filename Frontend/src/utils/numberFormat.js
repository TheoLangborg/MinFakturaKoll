const NUMBER_FORMATTER = new Intl.NumberFormat("sv-SE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const cleaned = value
    .trim()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, "")
    .replace(/kr|sek|eur|usd/gi, "")
    .replace(",", ".");

  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatNumberWithSpaces(value, { fallback = "" } = {}) {
  const numeric = toFiniteNumber(value);
  if (numeric == null) return fallback;
  return NUMBER_FORMATTER.format(numeric).replace(/\u00a0/g, " ");
}

export function formatAmountWithCurrency(value, currency = "SEK", { fallback = "" } = {}) {
  const formattedNumber = formatNumberWithSpaces(value, { fallback: "" });
  if (!formattedNumber) return fallback;
  return `${formattedNumber} ${currency || "SEK"}`;
}
