const GENERIC_ERROR = "Något gick fel. Försök igen om en stund.";

export function toUserErrorMessage(error, fallback = GENERIC_ERROR) {
  if (!error) return fallback;

  if (typeof error === "string") {
    const cleaned = stripErrorPrefix(error).trim();
    return cleaned || fallback;
  }

  if (error instanceof Error) {
    const cleaned = stripErrorPrefix(error.message || "").trim();
    return cleaned || fallback;
  }

  return fallback;
}

function stripErrorPrefix(text) {
  return String(text || "").replace(/^Error:\s*/i, "");
}
