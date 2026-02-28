import { useEffect, useMemo, useState } from "react";
import { formatAmountWithCurrency, formatNumberWithSpaces } from "../utils/numberFormat.js";
import PreviewContent from "./PreviewContent.jsx";
import PreviewModal from "./PreviewModal.jsx";

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
const BILLING_OPTIONS = ["Abonnemang", "Engång", "Oklart"];

function HistoryCard({
  item,
  selectionMode,
  isSelected,
  busy,
  onToggleSelect,
  onDeleteOne,
  onOpenInvoice,
}) {
  const costText = formatAmountWithCurrency(item.totalAmount, item.currency || "SEK", {
    fallback: "Okänt belopp",
  });
  const dateText = item.dueDate || item.invoiceDate || "Okänt datum";
  const status = getStatusMeta(item);
  const billingType = getBillingTypeMeta(item);
  const vendorName = cleanDisplayText(item.vendorName) || "Okänd leverantör";
  const category = normalizeCategory(cleanDisplayText(item.category));

  function handleOpenOrToggle() {
    if (selectionMode) {
      onToggleSelect(item.id);
      return;
    }
    onOpenInvoice(item);
  }

  return (
    <article
      className={`history-card ${selectionMode ? "history-card-selectable" : ""} ${
        isSelected ? "history-card-selected" : ""
      }`}
      role="button"
      tabIndex={0}
      aria-pressed={selectionMode ? isSelected : undefined}
      onClick={handleOpenOrToggle}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleOpenOrToggle();
        }
      }}
    >
      <div className="history-card-top">
        <div>
          <h3>{vendorName}</h3>
          <p>{category}</p>
          <span className={`history-billing-badge ${billingType.className}`}>{billingType.label}</span>
        </div>

        <div className="history-card-actions">
          {selectionMode && (
            <span
              className={`history-select-indicator ${
                isSelected ? "history-select-indicator-active" : ""
              }`}
            >
              {isSelected ? "Markerad" : "Välj"}
            </span>
          )}

          <span className={`history-status ${status.className}`}>{status.label}</span>

          <button
            className="icon-danger-button"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDeleteOne(item.id);
            }}
            disabled={busy}
            title="Ta bort post"
            aria-label="Ta bort post"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      <div className="history-grid">
        <div>
          <span>Kostnad</span>
          <strong>{costText}</strong>
        </div>
        <div>
          <span>Datum</span>
          <strong>{dateText}</strong>
        </div>
        <div>
          <span>Källa</span>
          <strong>{item.sourceType === "file" ? "Filuppladdning" : "Textinput"}</strong>
        </div>
        <div>
          <span>Analys</span>
          <strong>{item.analysisMode === "ai" ? "AI" : "Regelbaserad"}</strong>
        </div>
      </div>
    </article>
  );
}

function HistoryInvoiceModal({ item, draft, saving, onFieldChange, onSave, onClose, onOpenPreview }) {
  if (!item || !draft) return null;
  const previewFile = toHistoryPreviewFile(item);
  const previewNotice = getHistoryPreviewNotice(item);

  return (
    <div className="preview-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <article className="preview-modal-card history-edit-modal-card" onClick={(event) => event.stopPropagation()}>
        <header className="preview-modal-header">
          <div>
            <strong>Faktura från {cleanDisplayText(item.vendorName) || "Okänd leverantör"}</strong>
            <p>Redigera uppgifter och spara till historiken.</p>
          </div>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Stäng
          </button>
        </header>

        <div className="preview-modal-body">
          <section className="history-preview-section">
            <h3>Originalfaktura</h3>
            {previewFile ? (
              <div className="history-preview-wrap">
                <button
                  type="button"
                  className="history-preview-trigger"
                  onClick={() => onOpenPreview(previewFile)}
                >
                  <div className="history-preview-box">
                    <PreviewContent file={previewFile} />
                  </div>
                  <span className="history-preview-hint">Klicka för förhandsvisning</span>
                </button>
              </div>
            ) : (
              <p className="history-edit-note">{previewNotice}</p>
            )}
          </section>

          <div className="history-edit-grid">
            <label className="history-edit-field">
              Leverantör
              <input
                className="metric-input"
                value={draft.vendorName}
                onChange={(event) => onFieldChange("vendorName", event.target.value)}
              />
            </label>

            <label className="history-edit-field">
              Kategori
              <select
                className="metric-input"
                value={draft.category}
                onChange={(event) => onFieldChange("category", event.target.value)}
              >
                <option value="">-</option>
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="history-edit-field">
              Fakturatyp
              <select
                className="metric-input"
                value={draft.billingType}
                onChange={(event) => onFieldChange("billingType", event.target.value)}
              >
                {BILLING_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="history-edit-field">
              Fakturadatum
              <input
                className="metric-input"
                type="date"
                value={draft.invoiceDate}
                onChange={(event) => onFieldChange("invoiceDate", event.target.value)}
              />
            </label>

            <label className="history-edit-field">
              Förfallodatum
              <input
                className="metric-input"
                type="date"
                value={draft.dueDate}
                onChange={(event) => onFieldChange("dueDate", event.target.value)}
              />
            </label>

            <label className="history-edit-field">
              Fakturanummer
              <input
                className="metric-input"
                value={draft.invoiceNumber}
                onChange={(event) => onFieldChange("invoiceNumber", event.target.value)}
              />
            </label>

            <label className="history-edit-field">
              Kundnummer
              <input
                className="metric-input"
                value={draft.customerNumber}
                onChange={(event) => onFieldChange("customerNumber", event.target.value)}
              />
            </label>

            <label className="history-edit-field">
              OCR-nummer
              <input
                className="metric-input"
                value={draft.ocrNumber}
                onChange={(event) => onFieldChange("ocrNumber", event.target.value)}
              />
            </label>

            <label className="history-edit-field">
              Organisationsnummer
              <input
                className="metric-input"
                value={draft.organizationNumber}
                onChange={(event) => onFieldChange("organizationNumber", event.target.value)}
              />
            </label>

            <label className="history-edit-field">
              Månadskostnad
              <input
                className="metric-input"
                inputMode="decimal"
                value={draft.monthlyCost}
                onChange={(event) => onFieldChange("monthlyCost", event.target.value)}
              />
            </label>

            <label className="history-edit-field">
              Totalbelopp
              <input
                className="metric-input"
                inputMode="decimal"
                value={draft.totalAmount}
                onChange={(event) => onFieldChange("totalAmount", event.target.value)}
              />
            </label>

            <label className="history-edit-field">
              Moms
              <input
                className="metric-input"
                inputMode="decimal"
                value={draft.vatAmount}
                onChange={(event) => onFieldChange("vatAmount", event.target.value)}
              />
            </label>

            <label className="history-edit-field">
              Valuta
              <select
                className="metric-input"
                value={draft.currency}
                onChange={(event) => onFieldChange("currency", event.target.value)}
              >
                <option value="">-</option>
                {CURRENCY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="history-edit-field">
              Betalsätt
              <select
                className="metric-input"
                value={draft.paymentMethod}
                onChange={(event) => onFieldChange("paymentMethod", event.target.value)}
              >
                <option value="">-</option>
                {PAYMENT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="history-edit-note">
            Här redigerar du den analyserade fakturaposten. Ändringar sparas direkt till historiken.
          </p>

          <div className="button-row">
            <button className="btn btn-primary" onClick={onSave} disabled={saving}>
              {saving ? "Sparar..." : "Spara ändringar"}
            </button>
            <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Avbryt
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}

function ConfirmModal({ isOpen, title, message, confirmLabel, onCancel, onConfirm, loading }) {
  if (!isOpen) return null;

  return (
    <div className="confirm-modal" role="dialog" aria-modal="true" onClick={onCancel}>
      <article className="confirm-modal-card" onClick={(event) => event.stopPropagation()}>
        <header className="confirm-modal-header">
          <h3>{title}</h3>
          <p>{message}</p>
        </header>
        <div className="confirm-modal-actions">
          <button className="btn btn-secondary" onClick={onCancel} disabled={loading}>
            Avbryt
          </button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={loading}>
            {loading ? "Tar bort..." : confirmLabel}
          </button>
        </div>
      </article>
    </div>
  );
}

export default function HistoryPage({ history }) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [activeInvoice, setActiveInvoice] = useState(null);
  const [draftInvoice, setDraftInvoice] = useState(null);
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [historyPreviewOpen, setHistoryPreviewOpen] = useState(false);
  const [historyPreviewFile, setHistoryPreviewFile] = useState(null);
  const [confirmState, setConfirmState] = useState({ open: false, type: "", targetId: "", count: 0, loading: false });
  const busy = history.loading || history.mutating || savingInvoice || confirmState.loading;

  const hasItems = history.items.length > 0;
  const selectedCount = selectedIds.length;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    if (!hasItems) {
      setSelectedIds([]);
      setSelectionMode(false);
      setActiveInvoice(null);
      setDraftInvoice(null);
      setHistoryPreviewOpen(false);
      setHistoryPreviewFile(null);
      setConfirmState({ open: false, type: "", targetId: "", count: 0, loading: false });
      return;
    }

    setSelectedIds((previous) => previous.filter((id) => history.items.some((item) => item.id === id)));
  }, [hasItems, history.items]);

  function toggleSelectionMode() {
    setSelectionMode((previous) => {
      const nextValue = !previous;
      if (!nextValue) {
        setSelectedIds([]);
      }
      return nextValue;
    });
  }

  function toggleSelectedId(id) {
    setSelectedIds((previous) => {
      if (previous.includes(id)) {
        return previous.filter((entry) => entry !== id);
      }
      return [...previous, id];
    });
  }

  function requestDeleteOne(id) {
    if (!id || busy) return;
    setConfirmState({
      open: true,
      type: "one",
      targetId: id,
      count: 1,
      loading: false,
    });
  }

  function requestDeleteSelected() {
    if (!selectedIds.length || busy) return;
    setConfirmState({
      open: true,
      type: "selected",
      targetId: "",
      count: selectedIds.length,
      loading: false,
    });
  }

  function requestDeleteAll() {
    if (busy || !hasItems) return;
    setConfirmState({
      open: true,
      type: "all",
      targetId: "",
      count: history.items.length,
      loading: false,
    });
  }

  function cancelDeleteConfirm() {
    if (confirmState.loading) return;
    setConfirmState({ open: false, type: "", targetId: "", count: 0, loading: false });
  }

  async function confirmDelete() {
    if (!confirmState.open || confirmState.loading) return;

    const snapshot = { ...confirmState };
    setConfirmState((previous) => ({ ...previous, loading: true }));

    if (snapshot.type === "one") {
      const deleted = await history.deleteOne(snapshot.targetId);
      if (!deleted) {
        setConfirmState((previous) => ({ ...previous, loading: false }));
        return;
      }

      setSelectedIds((previous) => previous.filter((entry) => entry !== snapshot.targetId));
      if (activeInvoice?.id === snapshot.targetId) {
        setActiveInvoice(null);
        setDraftInvoice(null);
        setHistoryPreviewOpen(false);
        setHistoryPreviewFile(null);
      }
      setConfirmState({ open: false, type: "", targetId: "", count: 0, loading: false });
      return;
    }

    if (snapshot.type === "selected") {
      const idsToDelete = [...selectedIds];
      const deleted = await history.deleteMany(idsToDelete);
      if (!deleted) {
        setConfirmState((previous) => ({ ...previous, loading: false }));
        return;
      }

      const removed = new Set(idsToDelete);
      setSelectedIds([]);
      if (activeInvoice?.id && removed.has(activeInvoice.id)) {
        setActiveInvoice(null);
        setDraftInvoice(null);
        setHistoryPreviewOpen(false);
        setHistoryPreviewFile(null);
      }
      setConfirmState({ open: false, type: "", targetId: "", count: 0, loading: false });
      return;
    }

    if (snapshot.type === "all") {
      const deleted = await history.deleteAll();
      if (!deleted) {
        setConfirmState((previous) => ({ ...previous, loading: false }));
        return;
      }

      setSelectedIds([]);
      setSelectionMode(false);
      setActiveInvoice(null);
      setDraftInvoice(null);
      setHistoryPreviewOpen(false);
      setHistoryPreviewFile(null);
      setConfirmState({ open: false, type: "", targetId: "", count: 0, loading: false });
      return;
    }

    setConfirmState({ open: false, type: "", targetId: "", count: 0, loading: false });
  }

  function openHistoryPreview(file) {
    if (!file) return;
    setHistoryPreviewFile(file);
    setHistoryPreviewOpen(true);
  }

  function closeHistoryPreview() {
    setHistoryPreviewOpen(false);
  }

  function openInvoice(item) {
    if (!item || selectionMode) return;
    setActiveInvoice(item);
    setDraftInvoice(toDraft(item));
  }

  function closeInvoice() {
    if (savingInvoice) return;
    setActiveInvoice(null);
    setDraftInvoice(null);
    setHistoryPreviewOpen(false);
    setHistoryPreviewFile(null);
  }

  function updateDraftField(fieldKey, value) {
    setDraftInvoice((previous) => {
      if (!previous) return previous;
      return { ...previous, [fieldKey]: value };
    });
  }

  async function saveDraftInvoice() {
    if (!activeInvoice || !draftInvoice || savingInvoice) return;

    const extracted = normalizeDraft(draftInvoice);
    setSavingInvoice(true);
    const saved = await history.updateOne(activeInvoice.id, extracted);
    setSavingInvoice(false);

    if (saved) {
      closeInvoice();
    }
  }

  return (
    <>
      <section className="panel panel-history">
        <div className="history-header">
          <div>
            <h2>Historik</h2>
            <p>Här ser du tidigare analyserade fakturor med nyckelinfo.</p>
          </div>

          <div className="history-header-actions">
            <button className="btn btn-secondary" onClick={history.loadHistory} disabled={busy}>
              {history.loading ? "Uppdaterar..." : "Uppdatera"}
            </button>
            {hasItems && (
              <button className="btn btn-secondary" onClick={toggleSelectionMode} disabled={busy}>
                {selectionMode ? "Avsluta markering" : "Välj flera"}
              </button>
            )}
          </div>
        </div>

        {selectionMode && hasItems && (
          <div className="history-bulk-toolbar">
            <p>{selectedCount} markerade</p>
            <div className="history-bulk-actions">
              <button
                className="btn btn-secondary"
                onClick={requestDeleteSelected}
                disabled={!selectedCount || busy}
              >
                Ta bort markerade
              </button>
              <button className="btn btn-danger" onClick={requestDeleteAll} disabled={busy}>
                Ta bort alla
              </button>
            </div>
          </div>
        )}

        {history.error && <p className="error-message">{history.error}</p>}
        {history.warning && <p className="warning-message">{history.warning}</p>}
        {!history.enabled && !history.error && (
          <p className="placeholder-text">
            Historiktjänsten är inte tillgänglig just nu. Kontrollera Firebase-inställningarna i backend `.env`.
          </p>
        )}

        {history.enabled && history.items.length === 0 && !history.loading && (
          <p className="placeholder-text">Ingen historik ännu. Kör en analys så sparas första posten.</p>
        )}

        {history.items.length > 0 && (
          <div className="history-list">
            {history.items.map((item) => (
              <HistoryCard
                key={item.id}
                item={item}
                selectionMode={selectionMode}
                isSelected={selectedSet.has(item.id)}
                busy={busy}
                onToggleSelect={toggleSelectedId}
                onDeleteOne={requestDeleteOne}
                onOpenInvoice={openInvoice}
              />
            ))}
          </div>
        )}
      </section>

      <HistoryInvoiceModal
        item={activeInvoice}
        draft={draftInvoice}
        saving={savingInvoice}
        onFieldChange={updateDraftField}
        onSave={saveDraftInvoice}
        onClose={closeInvoice}
        onOpenPreview={openHistoryPreview}
      />

      <PreviewModal
        isOpen={historyPreviewOpen}
        invoiceFile={historyPreviewFile}
        onClose={closeHistoryPreview}
      />

      <ConfirmModal
        isOpen={confirmState.open}
        title={getConfirmTitle(confirmState)}
        message={getConfirmMessage(confirmState)}
        confirmLabel={getConfirmButtonLabel(confirmState)}
        onCancel={cancelDeleteConfirm}
        onConfirm={confirmDelete}
        loading={confirmState.loading}
      />
    </>
  );
}

function getStatusMeta(item) {
  const dueDate = parseDate(item?.dueDate);
  if (dueDate) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return { label: "Förfallen", className: "history-status-danger" };
    }
    if (diffDays <= 7) {
      return { label: "Förfaller snart", className: "history-status-warn" };
    }
    return { label: "Aktiv", className: "history-status-ok" };
  }

  const statusText = normalizeText(item?.status);
  if (statusText.includes("forfallen")) {
    return { label: "Förfallen", className: "history-status-danger" };
  }
  if (statusText.includes("forfaller") || statusText.includes("snart")) {
    return { label: "Förfaller snart", className: "history-status-warn" };
  }
  if (statusText.includes("aktiv")) {
    return { label: "Aktiv", className: "history-status-ok" };
  }
  return { label: "Okänt", className: "" };
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function toDraft(item) {
  return {
    vendorName: cleanDisplayText(item.vendorName),
    category: normalizeCategory(cleanDisplayText(item.category)),
    billingType: normalizeBillingType(cleanDisplayText(item.billingType), item),
    invoiceDate: item.invoiceDate || "",
    dueDate: item.dueDate || "",
    invoiceNumber: cleanDisplayText(item.invoiceNumber),
    customerNumber: cleanDisplayText(item.customerNumber),
    ocrNumber: cleanDisplayText(item.ocrNumber),
    organizationNumber: cleanDisplayText(item.organizationNumber),
    monthlyCost: formatNumberWithSpaces(item.monthlyCost, { fallback: "" }),
    totalAmount: formatNumberWithSpaces(item.totalAmount, { fallback: "" }),
    vatAmount: formatNumberWithSpaces(item.vatAmount, { fallback: "" }),
    currency: cleanDisplayText(item.currency) || "SEK",
    paymentMethod: normalizePaymentMethod(cleanDisplayText(item.paymentMethod)),
  };
}

function toHistoryPreviewFile(item) {
  const preview = item?.filePreview;
  if (!preview || typeof preview !== "object") return null;

  const kind = String(preview.previewKind || "").toLowerCase();
  const name = cleanDisplayText(preview.fileName || item?.fileName) || "Faktura";

  if ((kind === "image" || kind === "pdf") && preview.previewSrc) {
    return {
      name,
      size: Number.isFinite(preview.size) ? preview.size : 0,
      previewKind: kind,
      previewSrc: preview.previewSrc,
      textPreview: "",
    };
  }

  if (kind === "text" && preview.textPreview) {
    return {
      name,
      size: Number.isFinite(preview.size) ? preview.size : 0,
      previewKind: "text",
      previewSrc: "",
      textPreview: preview.textPreview,
    };
  }

  return null;
}

function getHistoryPreviewNotice(item) {
  const preview = item?.filePreview;
  if (!preview) {
    return "Ingen sparad fakturavisning finns för den här posten.";
  }

  if (preview.previewKind === "unavailable") {
    return (
      cleanDisplayText(preview.unavailableReason) ||
      "Fakturan kunde inte sparas för förhandsvisning i historiken."
    );
  }

  return "Ingen sparad fakturavisning finns för den här posten.";
}

function getConfirmTitle(state) {
  if (state.type === "all") return "Ta bort all historik?";
  if (state.type === "selected") return "Ta bort markerade poster?";
  return "Ta bort post?";
}

function getConfirmMessage(state) {
  if (state.type === "all") {
    return "Detta raderar hela historiken permanent.";
  }
  if (state.type === "selected") {
    return `Du håller på att ta bort ${state.count} markerade poster permanent.`;
  }
  return "Den här historikposten tas bort permanent.";
}

function getConfirmButtonLabel(state) {
  if (state.type === "all") return "Ta bort allt";
  if (state.type === "selected") return "Ta bort markerade";
  return "Ta bort";
}

function normalizeDraft(draft) {
  return {
    vendorName: cleanDisplayText(draft.vendorName),
    category: normalizeCategory(draft.category),
    billingType: normalizeBillingType(draft.billingType, draft),
    invoiceDate: draft.invoiceDate || null,
    dueDate: draft.dueDate || null,
    invoiceNumber: cleanDisplayText(draft.invoiceNumber),
    customerNumber: cleanDisplayText(draft.customerNumber),
    ocrNumber: cleanDisplayText(draft.ocrNumber),
    organizationNumber: cleanDisplayText(draft.organizationNumber),
    monthlyCost: toNumberOrNull(draft.monthlyCost),
    totalAmount: toNumberOrNull(draft.totalAmount),
    vatAmount: toNumberOrNull(draft.vatAmount),
    currency: cleanDisplayText(draft.currency) || "SEK",
    paymentMethod: normalizePaymentMethod(draft.paymentMethod),
  };
}

function toNumberOrNull(value) {
  const cleaned = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, "")
    .replace(/kr|sek|eur|usd/gi, "")
    .replace(",", ".");

  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCategory(value) {
  const text = normalizeText(cleanDisplayText(value));
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
  return map[text] || "Övrigt";
}

function normalizePaymentMethod(value) {
  const text = normalizeText(cleanDisplayText(value));
  const map = {
    autogiro: "Autogiro",
    efaktura: "E-faktura",
    bankgiro: "Bankgiro",
    plusgiro: "Plusgiro",
    kort: "Kort",
    swish: "Swish",
    okant: "Okänt",
  };
  return map[text] || "Okänt";
}

function getBillingTypeMeta(item) {
  const billingType = normalizeBillingType(item?.billingType, item);
  if (billingType === "Abonnemang") {
    return { label: "Abonnemang", className: "history-billing-badge-subscription" };
  }
  if (billingType === "Engång") {
    return { label: "Engång", className: "history-billing-badge-one-time" };
  }
  return { label: "Oklart", className: "history-billing-badge-unknown" };
}

function normalizeBillingType(value, context = {}) {
  const text = normalizeText(cleanDisplayText(value));
  if (text === "abonnemang" || text === "subscription" || text === "recurring") {
    return "Abonnemang";
  }
  if (text === "engang" || text === "one-time" || text === "onetime") {
    return "Engång";
  }
  if (text === "oklart" || text === "okant") {
    return "Oklart";
  }

  return inferBillingType(context);
}

function inferBillingType(context = {}) {
  const category = normalizeText(cleanDisplayText(context?.category));
  const monthlyCost = toNumberOrNull(context?.monthlyCost);
  const totalAmount = toNumberOrNull(context?.totalAmount);

  if (/(tjanst|service|hantverk|installation|renovering|bygg|rot)/.test(category)) {
    return "Engång";
  }
  if (monthlyCost != null && monthlyCost > 0) {
    return "Abonnemang";
  }
  if (totalAmount != null && totalAmount > 0) {
    return "Engång";
  }
  return "Oklart";
}

function cleanDisplayText(value) {
  return String(value || "")
    .replace(/Ã¤/g, "ä")
    .replace(/Ã¶/g, "ö")
    .replace(/Ã¥/g, "å")
    .replace(/Ã„/g, "Ä")
    .replace(/Ã–/g, "Ö")
    .replace(/Ã…/g, "Å")
    .trim();
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-1 10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z" />
    </svg>
  );
}
