import { formatNumberWithSpaces } from "../utils/numberFormat.js";

const CATEGORY_OPTIONS = [
  "Mobil",
  "Internet",
  "El",
  "Försäkring",
  "Streaming",
  "Bank",
  "Tjänst",
  "Övrigt",
];

const PAYMENT_OPTIONS = ["Autogiro", "E-faktura", "Bankgiro", "Plusgiro", "Kort", "Swish", "Okänt"];

const CURRENCY_OPTIONS = ["SEK", "EUR", "USD"];

const CATEGORY_BENCHMARKS = {
  Mobil: 249,
  Internet: 399,
  El: 999,
  Försäkring: 279,
  Streaming: 129,
  Bank: 99,
  Tjänst: null,
  Övrigt: 199,
};

function MetricGroup({ title, children }) {
  return (
    <section className="metric-group">
      <h3 className="metric-group-title">{title}</h3>
      <div className="metric-group-grid">{children}</div>
    </section>
  );
}

function EditableMetricCard({
  fieldKey,
  label,
  value,
  type = "text",
  options,
  suffix,
  meta,
  onFieldChange,
}) {
  const isNumericInput = type === "number";
  const rawValue = value ?? "";
  const inputValue = isNumericInput
    ? formatNumberWithSpaces(rawValue, { fallback: String(rawValue) })
    : rawValue;
  const confidence = Number.isFinite(meta?.confidence) ? meta.confidence : 0.4;
  const confidencePercent = Math.round(confidence * 100);
  const confidenceClass = getConfidenceClass(confidence);
  const sourceText = meta?.sourceText || "Ingen tydlig källa hittades i texten.";

  return (
    <div className={`metric-card ${confidenceClass}`}>
      <div className="metric-card-head">
        <p>{label}</p>
        <span className="confidence-badge">{confidencePercent}%</span>
      </div>

      {options ? (
        <select
          className="metric-input"
          value={value ?? ""}
          onChange={(event) => onFieldChange(fieldKey, event.target.value)}
        >
          <option value="">-</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <div className="metric-input-wrap">
          <input
            className="metric-input"
            type={isNumericInput ? "text" : type}
            inputMode={isNumericInput ? "decimal" : undefined}
            value={inputValue}
            onChange={(event) => onFieldChange(fieldKey, event.target.value)}
          />
          {suffix && <span className="metric-suffix">{suffix}</span>}
        </div>
      )}

      <p className="metric-source">
        <span>Källa:</span> {sourceText}
      </p>
    </div>
  );
}

export default function AnalysisPanel({ panelId, result, extracted, fieldMeta, onFieldChange }) {
  const missingFields = getMissingFields(extracted);
  const savingsInsight = getSavingsInsight(extracted);

  return (
    <article id={panelId} className="panel">
      <div className="panel-header">
        <span className="step-badge">Steg 2</span>
        <h2>Analysresultat</h2>
      </div>

      {!result && <p className="placeholder-text">Kör analys för att visa resultat.</p>}

      {result && extracted && (
        <>
          <div className="analysis-mode-chip">
            Analysmetod: {result.analysisMode === "ai" ? "AI" : "Regelbaserad fallback"}
          </div>

          <div className="metric-groups">
            <MetricGroup title="Leverantör och klassificering">
              <EditableMetricCard
                fieldKey="vendorName"
                label="Leverantör"
                value={extracted.vendorName}
                meta={fieldMeta.vendorName}
                onFieldChange={onFieldChange}
              />
              <EditableMetricCard
                fieldKey="category"
                label="Kategori"
                value={extracted.category}
                options={CATEGORY_OPTIONS}
                meta={fieldMeta.category}
                onFieldChange={onFieldChange}
              />
            </MetricGroup>

            <MetricGroup title="Datum och referenser">
              <EditableMetricCard
                fieldKey="invoiceDate"
                label="Fakturadatum"
                value={extracted.invoiceDate}
                type="date"
                meta={fieldMeta.invoiceDate}
                onFieldChange={onFieldChange}
              />
              <EditableMetricCard
                fieldKey="dueDate"
                label="Förfallodatum"
                value={extracted.dueDate}
                type="date"
                meta={fieldMeta.dueDate}
                onFieldChange={onFieldChange}
              />
              <EditableMetricCard
                fieldKey="invoiceNumber"
                label="Fakturanummer"
                value={extracted.invoiceNumber}
                meta={fieldMeta.invoiceNumber}
                onFieldChange={onFieldChange}
              />
              <EditableMetricCard
                fieldKey="customerNumber"
                label="Kundnummer"
                value={extracted.customerNumber}
                meta={fieldMeta.customerNumber}
                onFieldChange={onFieldChange}
              />
              <EditableMetricCard
                fieldKey="ocrNumber"
                label="OCR-nummer"
                value={extracted.ocrNumber}
                meta={fieldMeta.ocrNumber}
                onFieldChange={onFieldChange}
              />
              <EditableMetricCard
                fieldKey="organizationNumber"
                label="Organisationsnummer"
                value={extracted.organizationNumber}
                meta={fieldMeta.organizationNumber}
                onFieldChange={onFieldChange}
              />
            </MetricGroup>

            <MetricGroup title="Belopp och betalning">
              <EditableMetricCard
                fieldKey="monthlyCost"
                label="Månadskostnad"
                value={extracted.monthlyCost}
                type="number"
                suffix="kr/mån"
                meta={fieldMeta.monthlyCost}
                onFieldChange={onFieldChange}
              />
              <EditableMetricCard
                fieldKey="totalAmount"
                label="Totalbelopp"
                value={extracted.totalAmount}
                type="number"
                suffix={extracted.currency || "SEK"}
                meta={fieldMeta.totalAmount}
                onFieldChange={onFieldChange}
              />
              <EditableMetricCard
                fieldKey="vatAmount"
                label="Moms"
                value={extracted.vatAmount}
                type="number"
                suffix="kr"
                meta={fieldMeta.vatAmount}
                onFieldChange={onFieldChange}
              />
              <EditableMetricCard
                fieldKey="currency"
                label="Valuta"
                value={extracted.currency}
                options={CURRENCY_OPTIONS}
                meta={fieldMeta.currency}
                onFieldChange={onFieldChange}
              />
              <EditableMetricCard
                fieldKey="paymentMethod"
                label="Betalsätt"
                value={extracted.paymentMethod}
                options={PAYMENT_OPTIONS}
                meta={fieldMeta.paymentMethod}
                onFieldChange={onFieldChange}
              />
            </MetricGroup>
          </div>

          {missingFields.length > 0 && (
            <div className="missing-fields-box">
              <h3>Viktiga fält som saknas</h3>
              <p>{missingFields.join(", ")}</p>
            </div>
          )}

          <div className="insight-box">
            <h3>Sparförslag: {savingsInsight.canSave ? "Möjlig besparing" : "Ingen tydlig besparing"}</h3>
            <p>{savingsInsight.message}</p>
          </div>
        </>
      )}
    </article>
  );
}

function getConfidenceClass(confidence) {
  if (confidence > 0.8) return "metric-card--high";
  if (confidence >= 0.5) return "metric-card--medium";
  return "metric-card--low";
}

function getMissingFields(extracted) {
  if (!extracted) return [];
  const missing = [];

  if (!extracted.vendorName) missing.push("Leverantör");
  if (extracted.totalAmount == null) missing.push("Totalbelopp");
  if (!extracted.dueDate) missing.push("Förfallodatum");
  if (!extracted.invoiceNumber) missing.push("Fakturanummer");
  if (!extracted.customerNumber && !extracted.ocrNumber) {
    missing.push("Kundnummer eller OCR-nummer");
  }

  return missing;
}

function getSavingsInsight(extracted) {
  if (!extracted) {
    return {
      canSave: false,
      message: "Ingen fakturadata finns ännu för att bedöma sparpotential.",
    };
  }

  const category = normalizeCategory(extracted.category);
  const benchmark = CATEGORY_BENCHMARKS[category] ?? CATEGORY_BENCHMARKS.Övrigt;
  const amount = toFiniteNumber(extracted.monthlyCost ?? extracted.totalAmount);

  if (category === "Tjänst") {
    return {
      canSave: false,
      message:
        "Detta ser ut som en engångstjänst (t.ex. hantverk/installation). Sparförslag per månad räknas inte automatiskt för den typen av faktura.",
    };
  }

  if (!Number.isFinite(benchmark)) {
    return {
      canSave: false,
      message: "Saknar riktpris för vald kategori, så ingen automatisk sparberäkning görs.",
    };
  }

  if (amount == null) {
    return {
      canSave: false,
      message:
        "Det saknas belopp för att räkna sparpotential. Fyll i månadskostnad eller totalbelopp.",
    };
  }

  const gap = Math.round((amount - benchmark) * 100) / 100;
  if (gap > 0) {
    return {
      canSave: true,
      message: `Möjlig besparing cirka ${formatNumberWithSpaces(gap, {
        fallback: String(gap),
      })} kr/mån jämfört med riktpris för ${category.toLowerCase()} (${benchmark} kr/mån).`,
    };
  }

  return {
    canSave: false,
    message: `Kostnaden ligger redan i nivå med riktpris för ${category.toLowerCase()}. Ingen tydlig extra besparing syns just nu.`,
  };
}

function toFiniteNumber(value) {
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

function normalizeCategory(value) {
  const key = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const map = {
    mobil: "Mobil",
    internet: "Internet",
    el: "El",
    forsakring: "Försäkring",
    streaming: "Streaming",
    bank: "Bank",
    tjanst: "Tjänst",
    tjänst: "Tjänst",
    service: "Tjänst",
    hantverk: "Tjänst",
    installation: "Tjänst",
    renovering: "Tjänst",
    ovrigt: "Övrigt",
  };
  return map[key] || "Övrigt";
}
