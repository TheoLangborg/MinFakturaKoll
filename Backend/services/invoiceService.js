import {
  buildEmailActions,
  buildMissingFields,
  extractWithRules,
  getResponseOutputText,
  isImageMimeType,
  isPdfMimeType,
  normalizeExtracted,
  normalizeFilePayload,
  parseJsonObject,
} from "../utils/invoiceUtils.js";

export async function scanInvoice({ text, file }) {
  const safeText = typeof text === "string" ? text : "";
  const safeFile = normalizeFilePayload(file);

  if (!safeText.trim() && !safeFile) {
    throw new Error("MISSING_INPUT");
  }

  const analysis = await analyzeInvoice({ text: safeText, file: safeFile });
  const normalized = normalizeExtracted(analysis.extracted, safeText);
  const extracted = normalized.extracted;
  const fieldMeta = normalized.fieldMeta;

  return {
    extracted,
    fieldMeta,
    actions: buildEmailActions(extracted),
    missingFields: buildMissingFields(extracted),
    analysisMode: analysis.analysisMode,
    warning: analysis.warning || "",
  };
}

async function analyzeInvoice({ text, file }) {
  const openAiApiKey = process.env.OPENAI_API_KEY || "";
  const openAiModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  if (!openAiApiKey) {
    return {
      extracted: extractWithRules(text),
      analysisMode: "rules",
      warning:
        "AI-analys är inte aktiverad eftersom OPENAI_API_KEY saknas i backend/.env. Regelbaserad analys används tills nyckeln är konfigurerad.",
    };
  }

  try {
    const extracted = await extractWithOpenAI({
      text,
      file,
      openAiApiKey,
      openAiModel,
    });
    return {
      extracted,
      analysisMode: "ai",
      warning: "",
    };
  } catch (error) {
    console.error("AI-extraktion misslyckades:", error);
    return {
      extracted: extractWithRules(text),
      analysisMode: "rules",
      warning:
        "AI-analysen kunde inte genomföras just nu. Regelbaserad analys användes som reserv.",
    };
  }
}

async function extractWithOpenAI({ text, file, openAiApiKey, openAiModel }) {
  const userContent = [];

  if (text.trim()) {
    userContent.push({
      type: "input_text",
      text: `OCR_TEXT:\n${text.trim()}`,
    });
  }

  if (file?.dataUrl) {
    if (isImageMimeType(file.type)) {
      userContent.push({
        type: "input_image",
        image_url: file.dataUrl,
        detail: "high",
      });
    } else if (isPdfMimeType(file.type, file.name)) {
      userContent.push({
        type: "input_file",
        filename: file.name || "invoice.pdf",
        file_data: file.dataUrl,
      });
    }
  }

  if (!userContent.length) {
    userContent.push({
      type: "input_text",
      text: "No usable invoice content found.",
    });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openAiModel,
      temperature: 0,
      max_output_tokens: 900,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "You extract structured data from invoices.",
                "Return only valid JSON. Do not add markdown.",
                "Use this JSON shape:",
                "{",
                '  "extracted": {',
                '    "vendorName": string|null,',
                '    "category": string|null,',
                '    "monthlyCost": number|null,',
                '    "totalAmount": number|null,',
                '    "currency": string|null,',
                '    "dueDate": "YYYY-MM-DD"|null,',
                '    "invoiceDate": "YYYY-MM-DD"|null,',
                '    "customerNumber": string|null,',
                '    "invoiceNumber": string|null,',
                '    "organizationNumber": string|null,',
                '    "ocrNumber": string|null,',
                '    "vatAmount": number|null,',
                '    "paymentMethod": string|null,',
                '    "confidence": number',
                "  },",
                '  "fieldMeta": {',
                '    "vendorName": { "confidence": number, "sourceText": string },',
                '    "category": { "confidence": number, "sourceText": string },',
                '    "monthlyCost": { "confidence": number, "sourceText": string },',
                '    "totalAmount": { "confidence": number, "sourceText": string },',
                '    "currency": { "confidence": number, "sourceText": string },',
                '    "dueDate": { "confidence": number, "sourceText": string },',
                '    "invoiceDate": { "confidence": number, "sourceText": string },',
                '    "customerNumber": { "confidence": number, "sourceText": string },',
                '    "invoiceNumber": { "confidence": number, "sourceText": string },',
                '    "organizationNumber": { "confidence": number, "sourceText": string },',
                '    "ocrNumber": { "confidence": number, "sourceText": string },',
                '    "vatAmount": { "confidence": number, "sourceText": string },',
                '    "paymentMethod": { "confidence": number, "sourceText": string }',
                "  }",
                "}",
                "Rules:",
                "- Use confidence values from 0 to 1.",
                "- sourceText should be a short quote from OCR text when possible.",
                "- monthlyCost, totalAmount and vatAmount are numbers without currency symbols.",
                "- monthlyCost must be null unless a monthly amount is explicitly stated (for example '/mån', 'månadskostnad', 'månadsavgift').",
                "- currency should be ISO code like SEK, EUR or USD.",
                "- dueDate and invoiceDate must be YYYY-MM-DD or null.",
                "- category should be one of: Mobil, Internet, El, Försäkring, Streaming, Bank, Tjänst, Övrigt.",
                "- paymentMethod should be one of: Autogiro, E-faktura, Bankgiro, Plusgiro, Kort, Swish, Okänt.",
              ].join(" "),
            },
          ],
        },
        {
          role: "user",
          content: userContent,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API-fel ${response.status}: ${errorText.slice(0, 500)}`);
  }

  const data = await response.json();
  const outputText = getResponseOutputText(data);
  const parsed = parseJsonObject(outputText);

  if (!parsed) {
    throw new Error("Kunde inte tolka JSON från AI-svar.");
  }

  return parsed;
}
