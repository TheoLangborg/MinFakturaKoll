const FIELD_KEYS = [
  "vendorName",
  "category",
  "monthlyCost",
  "totalAmount",
  "currency",
  "dueDate",
  "invoiceDate",
  "customerNumber",
  "invoiceNumber",
  "organizationNumber",
  "ocrNumber",
  "vatAmount",
  "paymentMethod",
];

const DEFAULT_SOURCE_TEXT = "Ingen tydlig källa hittades i texten.";

export function normalizeExtracted(raw, fallbackText = "") {
  const fallback = extractWithRules(fallbackText);
  const rawExtracted = getRawExtracted(raw);
  const rawFieldMeta = getRawFieldMeta(raw);

  const totalAmount = toNumber(rawExtracted?.totalAmount, fallback.totalAmount);
  const monthlyCost = resolveMonthlyCost({
    rawMonthlyCost: toNumber(rawExtracted?.monthlyCost, null),
    fallbackMonthlyCost: fallback.monthlyCost,
    totalAmount,
    rawMonthlySourceText: rawFieldMeta?.monthlyCost?.sourceText,
    fullSourceText: fallbackText,
  });
  const vatAmount = toNumber(rawExtracted?.vatAmount, fallback.vatAmount);
  const confidence = clamp(toNumber(rawExtracted?.confidence, fallback.confidence), 0, 1);
  const aiCategory = normalizeCategory(rawExtracted?.category);
  const fallbackCategory = normalizeCategory(fallback.category);
  const category = resolveCategoryPreference({
    aiCategory,
    fallbackCategory,
    sourceText: fallbackText,
  });

  const extracted = {
    vendorName: cleanString(rawExtracted?.vendorName, fallback.vendorName),
    category,
    monthlyCost,
    totalAmount,
    currency: cleanString(rawExtracted?.currency, "SEK"),
    dueDate: normalizeDate(rawExtracted?.dueDate || fallback.dueDate),
    invoiceDate: normalizeDate(rawExtracted?.invoiceDate || fallback.invoiceDate),
    customerNumber: cleanString(rawExtracted?.customerNumber, fallback.customerNumber),
    invoiceNumber: cleanString(rawExtracted?.invoiceNumber, fallback.invoiceNumber),
    organizationNumber: cleanString(
      rawExtracted?.organizationNumber,
      fallback.organizationNumber
    ),
    ocrNumber: cleanString(rawExtracted?.ocrNumber, fallback.ocrNumber),
    vatAmount,
    paymentMethod: normalizePaymentMethod(rawExtracted?.paymentMethod || fallback.paymentMethod),
    confidence,
  };

  const fieldMeta = buildFieldMeta(extracted, rawFieldMeta, fallbackText);

  return { extracted, fieldMeta };
}

export function extractWithRules(text) {
  const source = String(text || "");
  const firstLine = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  const vendorName = firstLine || "Okänd leverantör";
  const customerNumber =
    findMatch(source, [
      /kundnummer[:\s]*([a-z0-9\-]+)/i,
      /customer\s*number[:\s]*([a-z0-9\-]+)/i,
      /account[:\s]*([a-z0-9\-]+)/i,
    ]) || "";

  const invoiceNumber =
    findMatch(source, [
      /fakturanummer[:\s]*([a-z0-9\-]+)/i,
      /invoice\s*number[:\s]*([a-z0-9\-]+)/i,
      /faktura\s*nr[:\s]*([a-z0-9\-]+)/i,
    ]) || "";

  const organizationNumber =
    findMatch(source, [
      /organisationsnummer[:\s]*([0-9\-]+)/i,
      /org\.?\s*nr[:\s]*([0-9\-]+)/i,
      /orgnr[:\s]*([0-9\-]+)/i,
    ]) || "";

  const ocrNumber =
    findMatch(source, [
      /ocr(?:-nummer|nummer|nr)?[:\s]*([0-9\- ]{5,})/i,
      /betalreferens[:\s]*([0-9\- ]{5,})/i,
      /reference[:\s]*([0-9\- ]{5,})/i,
    ]) || "";

  const dueDate =
    normalizeDate(
      findMatch(source, [
        /förfallodatum[:\s]*([0-9./\-]+)/i,
        /forfallodatum[:\s]*([0-9./\-]+)/i,
        /förfaller[:\s]*([0-9./\-]+)/i,
        /forfaller[:\s]*([0-9./\-]+)/i,
        /due\s*date[:\s]*([0-9./\-]+)/i,
      ])
    ) || null;

  const invoiceDate =
    normalizeDate(
      findMatch(source, [
        /fakturadatum[:\s]*([0-9./\-]+)/i,
        /invoice\s*date[:\s]*([0-9./\-]+)/i,
        /datum[:\s]*([0-9./\-]+)/i,
      ])
    ) || null;

  const totalAmount = toNumber(
    findMatch(source, [
      /att\s*betala[^0-9]*([0-9][0-9\s.,]*)/i,
      /belopp[^0-9]*([0-9][0-9\s.,]*)\s*kr/i,
      /total[^0-9]*([0-9][0-9\s.,]*)/i,
    ]),
    null
  );

  const vatAmount = toNumber(
    findMatch(source, [
      /moms[^0-9]*([0-9][0-9\s.,]*)/i,
      /varav\s+moms[^0-9]*([0-9][0-9\s.,]*)/i,
      /vat[^0-9]*([0-9][0-9\s.,]*)/i,
    ]),
    null
  );
  const monthlyCost = extractMonthlyCost(source);

  const category = guessCategory(`${source}\n${vendorName}`);
  const paymentMethod = guessPaymentMethod(source);

  let confidence = 0.25;
  if (vendorName && vendorName !== "Okänd leverantör") confidence += 0.15;
  if (totalAmount != null) confidence += 0.15;
  if (dueDate) confidence += 0.1;
  if (invoiceNumber) confidence += 0.1;
  if (customerNumber) confidence += 0.1;
  if (ocrNumber) confidence += 0.1;
  if (category !== "Övrigt") confidence += 0.1;
  if (paymentMethod !== "Okänt") confidence += 0.1;

  return {
    vendorName,
    category,
    monthlyCost,
    totalAmount,
    currency: "SEK",
    dueDate,
    invoiceDate,
    customerNumber,
    invoiceNumber,
    organizationNumber,
    ocrNumber,
    vatAmount,
    paymentMethod,
    confidence: clamp(confidence, 0, 1),
  };
}

export function buildEmailActions(extracted) {
  const vendor = extracted.vendorName || "leverantören";
  const customer = extracted.customerNumber || "okänt";
  const invoiceNumber = extracted.invoiceNumber || "okänt";
  const amountText =
    extracted.totalAmount != null
      ? `${extracted.totalAmount} ${extracted.currency || "SEK"}`
      : "okänt belopp";
  const dueDateText = extracted.dueDate || "okänt förfallodatum";
  const paymentMethod = extracted.paymentMethod || "okänt betalsätt";

  const templates = [
    {
      type: "cancel_email",
      templateId: "cancel-formal",
      templateLabel: "Uppsägningsmall",
      subject: `Uppsägning av abonnemang - kundnummer ${customer}`,
      body:
        `Hej,\n\n` +
        `Jag vill säga upp mitt abonnemang hos ${vendor}.\n` +
        `Kundnummer: ${customer}\n` +
        `Fakturanummer: ${invoiceNumber}\n` +
        `Vänligen bekräfta uppsägningen samt vilket datum avtalet upphör.\n\n` +
        `Tack på förhand.\n` +
        `Med vänlig hälsning`,
    },
    {
      type: "cancel_email",
      templateId: "price-negotiation",
      templateLabel: "Förhandlingsmall",
      subject: `Förfrågan om bättre pris - kundnummer ${customer}`,
      body:
        `Hej,\n\n` +
        `Jag har granskat min senaste faktura från ${vendor} och vill se över min kostnad.\n` +
        `Nuvarande belopp: ${amountText}\n` +
        `Fakturanummer: ${invoiceNumber}\n` +
        `Kan ni erbjuda ett bättre pris eller ett mer fördelaktigt paket?\n\n` +
        `Om det inte finns en konkurrenskraftig lösning vill jag gå vidare med uppsägning.\n\n` +
        `Med vänlig hälsning`,
    },
    {
      type: "cancel_email",
      templateId: "specification-request",
      templateLabel: "Specifikationsmall",
      subject: `Begäran om fakturaspecifikation ${invoiceNumber}`,
      body:
        `Hej,\n\n` +
        `Jag behöver hjälp att förtydliga min senaste faktura från ${vendor}.\n` +
        `Belopp: ${amountText}\n` +
        `Förfallodatum: ${dueDateText}\n` +
        `Betalsätt: ${paymentMethod}\n` +
        `Kundnummer: ${customer}\n\n` +
        `Kan ni förklara kostnadsposterna och bekräfta att allt är korrekt debiterat?\n\n` +
        `Tack!\n` +
        `Med vänlig hälsning`,
    },
  ];

  return shuffleArray(templates);
}

export function buildMissingFields(extracted) {
  const missing = [];

  if (!extracted.vendorName || extracted.vendorName === "Okänd leverantör") {
    missing.push("Leverantör");
  }

  if (extracted.totalAmount == null) {
    missing.push("Totalbelopp");
  }

  if (!extracted.dueDate) {
    missing.push("Förfallodatum");
  }

  if (!extracted.invoiceNumber) {
    missing.push("Fakturanummer");
  }

  if (!extracted.customerNumber && !extracted.ocrNumber) {
    missing.push("Kundnummer eller OCR-nummer");
  }

  return missing;
}

export function normalizeFilePayload(file) {
  if (!file || typeof file !== "object") return null;

  const name = cleanString(file.name, "invoice-file").slice(0, 180);
  const type = cleanString(file.type, "application/octet-stream");
  const dataUrl = typeof file.dataUrl === "string" ? file.dataUrl : "";

  if (!dataUrl.startsWith("data:")) return null;

  return { name, type, dataUrl };
}

export function getResponseOutputText(responseJson) {
  if (typeof responseJson?.output_text === "string" && responseJson.output_text.trim()) {
    return responseJson.output_text.trim();
  }

  const parts = [];
  for (const item of responseJson?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim();
}

export function parseJsonObject(rawText) {
  if (!rawText) return null;

  try {
    return JSON.parse(rawText);
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export function isImageMimeType(type) {
  return String(type || "").startsWith("image/");
}

export function isPdfMimeType(type, name = "") {
  return type === "application/pdf" || String(name).toLowerCase().endsWith(".pdf");
}

function getRawExtracted(raw) {
  if (raw && typeof raw === "object" && raw.extracted && typeof raw.extracted === "object") {
    return raw.extracted;
  }
  return raw && typeof raw === "object" ? raw : {};
}

function getRawFieldMeta(raw) {
  if (raw && typeof raw === "object" && raw.fieldMeta && typeof raw.fieldMeta === "object") {
    return raw.fieldMeta;
  }
  return {};
}

function buildFieldMeta(extracted, rawFieldMeta, sourceText) {
  const meta = {};

  for (const key of FIELD_KEYS) {
    const rawMeta = rawFieldMeta?.[key] || {};
    const value = extracted[key];
    const inferredSource =
      cleanString(rawMeta?.sourceText, "") || inferSourceText(sourceText, key, value);
    const normalizedSource = inferredSource || DEFAULT_SOURCE_TEXT;

    const rawConfidence = toNumber(rawMeta?.confidence, null);
    const fallbackConfidence = inferFieldConfidence(
      key,
      value,
      extracted.confidence,
      normalizedSource
    );

    meta[key] = {
      confidence:
        rawConfidence == null ? fallbackConfidence : clamp(rawConfidence, 0, 1),
      sourceText: normalizedSource,
    };
  }

  return meta;
}

function inferFieldConfidence(key, value, globalConfidence, sourceText) {
  if (isEmptyValue(value)) return 0.25;

  let base = clamp(toNumber(globalConfidence, 0.6), 0.35, 0.95);
  base -= 0.08;

  if (sourceText && sourceText !== DEFAULT_SOURCE_TEXT) {
    base += 0.12;
  } else {
    base -= 0.08;
  }

  if (key === "category" || key === "paymentMethod") {
    base -= 0.05;
  }

  return clamp(base, 0, 1);
}

function inferSourceText(text, key, value) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return "";

  const byValue = lines.find((line) => lineMatchesValue(line, value));
  if (byValue) return byValue;

  const patternMap = {
    vendorName: [/^.{2,}$/],
    category: [/abonnemang|bredband|internet|elfaktura|försäkring|bank|stream|installation|hantverk|rot|renovering|service|arbete/i],
    monthlyCost: [/månadskostnad|månadsavgift|per\s*månad|\/\s*mån|kr\s*\/\s*mån|abonnemang/i],
    totalAmount: [/att\s*betala|belopp|total|summa/i],
    currency: [/sek|eur|usd|kr/i],
    dueDate: [/förfallo|förfaller|due\s*date/i],
    invoiceDate: [/fakturadatum|invoice\s*date|datum/i],
    customerNumber: [/kundnummer|customer\s*number|account/i],
    invoiceNumber: [/fakturanummer|invoice\s*number|faktura\s*nr/i],
    organizationNumber: [/organisationsnummer|org\.?\s*nr|orgnr/i],
    ocrNumber: [/ocr|betalreferens|reference/i],
    vatAmount: [/moms|vat|varav\s+moms/i],
    paymentMethod: [/autogiro|e-faktura|efaktura|bankgiro|plusgiro|kort|swish/i],
  };

  const patterns = patternMap[key] || [];
  for (const pattern of patterns) {
    const matchLine = lines.find((line) => pattern.test(line));
    if (matchLine) return matchLine;
  }

  if (key === "vendorName") {
    return lines[0];
  }

  return "";
}

function lineMatchesValue(line, value) {
  if (isEmptyValue(value)) return false;
  const lowerLine = line.toLowerCase();

  if (typeof value === "number") {
    const rounded = String(Math.round(value * 100) / 100);
    const integer = String(Math.round(value));
    return lowerLine.includes(rounded) || lowerLine.includes(integer);
  }

  const textValue = String(value).trim().toLowerCase();
  if (!textValue) return false;

  if (/^\d{4}-\d{2}-\d{2}$/.test(textValue)) {
    const [year, month, day] = textValue.split("-");
    const candidates = [
      `${year}-${month}-${day}`,
      `${year}/${month}/${day}`,
      `${day}-${month}-${year}`,
      `${day}/${month}/${year}`,
    ];
    return candidates.some((candidate) => lowerLine.includes(candidate));
  }

  return textValue.length >= 3 && lowerLine.includes(textValue);
}

function isEmptyValue(value) {
  return (
    value == null ||
    (typeof value === "string" && value.trim() === "") ||
    (typeof value === "number" && !Number.isFinite(value))
  );
}

function findMatch(source, patterns) {
  for (const pattern of patterns) {
    const match = String(source || "").match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function extractMonthlyCost(source) {
  const match = findMatch(source, [
    /månadskostnad[:\s]*([0-9][0-9\s.,]*)/i,
    /månadsavgift[:\s]*([0-9][0-9\s.,]*)/i,
    /([0-9][0-9\s.,]*)\s*(?:kr)?\s*\/\s*mån(?:ad)?/i,
    /([0-9][0-9\s.,]*)\s*(?:kr)?\s*per\s*månad/i,
    /([0-9][0-9\s.,]*)\s*(?:kr)?\s*månadsvis/i,
  ]);

  return toNumber(match, null);
}

function resolveMonthlyCost({
  rawMonthlyCost,
  fallbackMonthlyCost,
  totalAmount,
  rawMonthlySourceText,
  fullSourceText,
}) {
  const candidate = rawMonthlyCost ?? fallbackMonthlyCost ?? null;
  if (candidate == null) return null;
  if (totalAmount == null) return candidate;

  const sameAsTotal = Math.abs(candidate - totalAmount) < 0.005;
  if (!sameAsTotal) return candidate;

  const hasMonthlySignal =
    hasMonthlySignals(rawMonthlySourceText) || hasMonthlySignals(fullSourceText);
  return hasMonthlySignal ? candidate : null;
}

function hasMonthlySignals(text) {
  const lower = String(text || "").toLowerCase();
  return /(månadskostnad|månadsavgift|\/\s*mån|kr\s*\/\s*mån|per\s*månad|månadsvis|abonnemang)/.test(
    lower
  );
}

function toNumber(value, fallback = null) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return fallback;

  const cleaned = value
    .replace(/\s+/g, "")
    .replace(/kr|sek|eur|usd/gi, "")
    .replace(",", ".");

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) {
    return `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`;
  }

  const euro = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (euro) {
    const year = euro[3].length === 2 ? `20${euro[3]}` : euro[3];
    return `${year}-${pad2(euro[2])}-${pad2(euro[1])}`;
  }

  return null;
}

function normalizeCategory(value) {
  const key = cleanString(value, "Övrigt").toLowerCase();
  const map = {
    mobil: "Mobil",
    mobile: "Mobil",
    telefoni: "Mobil",
    internet: "Internet",
    broadband: "Internet",
    bredband: "Internet",
    el: "El",
    electricity: "El",
    försäkring: "Försäkring",
    forsakring: "Försäkring",
    insurance: "Försäkring",
    streaming: "Streaming",
    bank: "Bank",
    tjänst: "Tjänst",
    tjanst: "Tjänst",
    service: "Tjänst",
    tjänster: "Tjänst",
    tjanster: "Tjänst",
    hantverk: "Tjänst",
    installation: "Tjänst",
    renovering: "Tjänst",
    bygg: "Tjänst",
    övrigt: "Övrigt",
    ovrigt: "Övrigt",
    other: "Övrigt",
  };

  return map[key] || cleanString(value, "Övrigt");
}

function resolveCategoryPreference({ aiCategory, fallbackCategory, sourceText }) {
  const normalizedAi = normalizeCategory(aiCategory);
  const normalizedFallback = normalizeCategory(fallbackCategory);

  if (
    normalizedFallback === "Tjänst" &&
    normalizedAi !== "Tjänst" &&
    hasServiceSignals(sourceText)
  ) {
    return "Tjänst";
  }

  if (normalizedAi && normalizedAi !== "Övrigt") return normalizedAi;
  if (normalizedFallback && normalizedFallback !== "Övrigt") return normalizedFallback;
  return normalizedAi || normalizedFallback || "Övrigt";
}

function hasServiceSignals(text) {
  const lower = String(text || "").toLowerCase();
  return /(golvvärme|golvvarme|rot|hantverk|renovering|installation|servicearbete|arbete \(timmar\)|styckpris|material|rör|ror|snick|målning|malning)/.test(
    lower
  );
}

function guessCategory(text) {
  const lower = String(text || "").toLowerCase();
  if (/(golvvärme|golvvarme|renovering|hantverk|rot avdrag|rot skatteavdrag|installation|rör|ror|snick|målning|malning|bygg|servicearbete|arbete \(timmar\)|styckpris|summa|material)/.test(lower)) {
    return "Tjänst";
  }
  if (/(tele2|telia|telenor|halebop|vimla|mobil|abonnemang|comviq)/.test(lower)) return "Mobil";
  if (/(bredband|internet|fiber)/.test(lower)) return "Internet";
  if (/(elfaktura|elhandel|elnät|elnat|vattenfall|eon|fortum)/.test(lower)) return "El";
  if (/(försäkring|forsakring|if|folksam|länsförsäkringar|lansforsakringar)/.test(lower))
    return "Försäkring";
  if (/(spotify|netflix|hbo|max|viaplay|stream)/.test(lower)) return "Streaming";
  if (/(bank|klarna|kortavgift|ränta|ranta)/.test(lower)) return "Bank";
  return "Övrigt";
}

function normalizePaymentMethod(value) {
  const key = cleanString(value, "Okänt").toLowerCase();
  const map = {
    autogiro: "Autogiro",
    "e-faktura": "E-faktura",
    efaktura: "E-faktura",
    bankgiro: "Bankgiro",
    plusgiro: "Plusgiro",
    kort: "Kort",
    swish: "Swish",
    okänt: "Okänt",
    okant: "Okänt",
    unknown: "Okänt",
  };
  return map[key] || cleanString(value, "Okänt");
}

function guessPaymentMethod(text) {
  const lower = String(text || "").toLowerCase();
  if (lower.includes("autogiro")) return "Autogiro";
  if (lower.includes("e-faktura") || lower.includes("efaktura")) return "E-faktura";
  if (lower.includes("bankgiro")) return "Bankgiro";
  if (lower.includes("plusgiro")) return "Plusgiro";
  if (lower.includes("kort")) return "Kort";
  if (lower.includes("swish")) return "Swish";
  return "Okänt";
}

function shuffleArray(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function cleanString(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function pad2(value) {
  return String(value).padStart(2, "0");
}
