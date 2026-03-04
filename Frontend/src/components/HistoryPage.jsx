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
const DEFAULT_HISTORY_FILTERS = {
  vendor: "",
  month: "all",
  billingType: "all",
  paidStatus: "all",
  category: "all",
};
const PAID_STATUS_OPTIONS = [
  { value: "all", label: "Alla" },
  { value: "paid", label: "Betalda" },
  { value: "unpaid", label: "Ej betalda" },
];

function HistoryCard({
  item,
  selectionMode,
  isSelected,
  busy,
  deleteBusy,
  onToggleSelect,
  onDeleteOne,
  onOpenInvoice,
  onTogglePaid,
  onToggleBillingType,
}) {
  const costText = formatAmountWithCurrency(item.totalAmount, item.currency || "SEK", {
    fallback: "Okänt belopp",
  });
  const dateText = item.dueDate || item.invoiceDate || "Okänt datum";
  const status = getStatusMeta(item);
  const billingType = getBillingTypeMeta(item);
  const nextBillingType = getToggledBillingType(item?.billingType, item);
  const vendorName = getVendorDisplayName(item.vendorName);
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
          <button
            type="button"
            className={`history-billing-toggle history-billing-badge ${billingType.className}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleBillingType(item);
            }}
            disabled={busy}
            title={`Byt fakturatyp till ${nextBillingType}`}
            aria-label={`Byt fakturatyp till ${nextBillingType}`}
          >
            {billingType.label}
          </button>
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
            type="button"
            className={`history-paid-toggle ${item.paid ? "history-paid-toggle-active" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onTogglePaid(item);
            }}
            disabled={busy}
            title={item.paid ? "Ångra betalmarkering" : "Markera fakturan som betald"}
            aria-label={item.paid ? "Ångra betalmarkering" : "Markera fakturan som betald"}
          >
            {item.paid ? "Ångra betald" : "Markera betald"}
          </button>

          <button
            className="icon-danger-button"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDeleteOne(item.id);
            }}
            disabled={deleteBusy}
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
          <strong>{getSourceTypeLabel(item)}</strong>
        </div>
        <div>
          <span>Analys</span>
          <strong>{item.analysisMode === "ai" ? "AI" : "Regelbaserad"}</strong>
        </div>
      </div>
    </article>
  );
}

function HistoryFieldLabel({ label, status }) {
  return (
    <span className="history-edit-field-head">
      <span>{label}</span>
      <span className={`history-field-confidence history-field-confidence-${status.tone}`}>
        {status.label}
      </span>
    </span>
  );
}

function HistoryInvoiceModal({ item, draft, saving, onFieldChange, onSave, onClose, onOpenPreview }) {
  if (!item || !draft) return null;
  const previewFile = toHistoryPreviewFile(item);
  const previewNotice = getHistoryPreviewNotice(item);
  const fieldStatus = {
    vendorName: resolveHistoryFieldStatus(item, "vendorName", draft.vendorName),
    category: resolveHistoryFieldStatus(item, "category", draft.category),
    billingType: resolveHistoryFieldStatus(item, "billingType", draft.billingType),
    invoiceDate: resolveHistoryFieldStatus(item, "invoiceDate", draft.invoiceDate),
    dueDate: resolveHistoryFieldStatus(item, "dueDate", draft.dueDate),
    invoiceNumber: resolveHistoryFieldStatus(item, "invoiceNumber", draft.invoiceNumber),
    customerNumber: resolveHistoryFieldStatus(item, "customerNumber", draft.customerNumber),
    ocrNumber: resolveHistoryFieldStatus(item, "ocrNumber", draft.ocrNumber),
    organizationNumber: resolveHistoryFieldStatus(
      item,
      "organizationNumber",
      draft.organizationNumber
    ),
    monthlyCost: resolveHistoryFieldStatus(item, "monthlyCost", draft.monthlyCost),
    totalAmount: resolveHistoryFieldStatus(item, "totalAmount", draft.totalAmount),
    vatAmount: resolveHistoryFieldStatus(item, "vatAmount", draft.vatAmount),
    currency: resolveHistoryFieldStatus(item, "currency", draft.currency),
    paymentMethod: resolveHistoryFieldStatus(item, "paymentMethod", draft.paymentMethod),
  };

  return (
    <div className="preview-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <article className="preview-modal-card history-edit-modal-card" onClick={(event) => event.stopPropagation()}>
        <header className="preview-modal-header">
          <div>
            <strong>Faktura från {getVendorDisplayName(item.vendorName)}</strong>
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
            <label className={`history-edit-field history-edit-field-${fieldStatus.vendorName.tone}`}>
              <HistoryFieldLabel label="Leverantör" status={fieldStatus.vendorName} />
              <input
                className="metric-input"
                value={draft.vendorName}
                onChange={(event) => onFieldChange("vendorName", event.target.value)}
                placeholder="Ingen leverantör hittades"
              />
            </label>

            <label className={`history-edit-field history-edit-field-${fieldStatus.category.tone}`}>
              <HistoryFieldLabel label="Kategori" status={fieldStatus.category} />
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

            <label className={`history-edit-field history-edit-field-${fieldStatus.billingType.tone}`}>
              <HistoryFieldLabel label="Fakturatyp" status={fieldStatus.billingType} />
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

            <label className={`history-edit-field history-edit-field-${fieldStatus.invoiceDate.tone}`}>
              <HistoryFieldLabel label="Fakturadatum" status={fieldStatus.invoiceDate} />
              <input
                className="metric-input"
                type="date"
                value={draft.invoiceDate}
                onChange={(event) => onFieldChange("invoiceDate", event.target.value)}
              />
            </label>

            <label className={`history-edit-field history-edit-field-${fieldStatus.dueDate.tone}`}>
              <HistoryFieldLabel label="Förfallodatum" status={fieldStatus.dueDate} />
              <input
                className="metric-input"
                type="date"
                value={draft.dueDate}
                onChange={(event) => onFieldChange("dueDate", event.target.value)}
              />
            </label>

            <label className={`history-edit-field history-edit-field-${fieldStatus.invoiceNumber.tone}`}>
              <HistoryFieldLabel label="Fakturanummer" status={fieldStatus.invoiceNumber} />
              <input
                className="metric-input"
                value={draft.invoiceNumber}
                onChange={(event) => onFieldChange("invoiceNumber", event.target.value)}
                placeholder="Inget fakturanummer hittades"
              />
            </label>

            <label className={`history-edit-field history-edit-field-${fieldStatus.customerNumber.tone}`}>
              <HistoryFieldLabel label="Kundnummer" status={fieldStatus.customerNumber} />
              <input
                className="metric-input"
                value={draft.customerNumber}
                onChange={(event) => onFieldChange("customerNumber", event.target.value)}
                placeholder="Inget kundnummer hittades"
              />
            </label>

            <label className={`history-edit-field history-edit-field-${fieldStatus.ocrNumber.tone}`}>
              <HistoryFieldLabel label="OCR-nummer" status={fieldStatus.ocrNumber} />
              <input
                className="metric-input"
                value={draft.ocrNumber}
                onChange={(event) => onFieldChange("ocrNumber", event.target.value)}
                placeholder="Inget OCR-nummer hittades"
              />
            </label>

            <label className={`history-edit-field history-edit-field-${fieldStatus.organizationNumber.tone}`}>
              <HistoryFieldLabel label="Organisationsnummer" status={fieldStatus.organizationNumber} />
              <input
                className="metric-input"
                value={draft.organizationNumber}
                onChange={(event) => onFieldChange("organizationNumber", event.target.value)}
                placeholder="Inget organisationsnummer hittades"
              />
            </label>

            <label className={`history-edit-field history-edit-field-${fieldStatus.monthlyCost.tone}`}>
              <HistoryFieldLabel label="Månadskostnad" status={fieldStatus.monthlyCost} />
              <input
                className="metric-input"
                inputMode="decimal"
                value={draft.monthlyCost}
                onChange={(event) => onFieldChange("monthlyCost", event.target.value)}
                placeholder="Ingen månadskostnad hittades"
              />
            </label>

            <label className={`history-edit-field history-edit-field-${fieldStatus.totalAmount.tone}`}>
              <HistoryFieldLabel label="Totalbelopp" status={fieldStatus.totalAmount} />
              <input
                className="metric-input"
                inputMode="decimal"
                value={draft.totalAmount}
                onChange={(event) => onFieldChange("totalAmount", event.target.value)}
                placeholder="Inget totalbelopp hittades"
              />
            </label>

            <label className={`history-edit-field history-edit-field-${fieldStatus.vatAmount.tone}`}>
              <HistoryFieldLabel label="Moms" status={fieldStatus.vatAmount} />
              <input
                className="metric-input"
                inputMode="decimal"
                value={draft.vatAmount}
                onChange={(event) => onFieldChange("vatAmount", event.target.value)}
                placeholder="Ingen moms hittades"
              />
            </label>

            <label className={`history-edit-field history-edit-field-${fieldStatus.currency.tone}`}>
              <HistoryFieldLabel label="Valuta" status={fieldStatus.currency} />
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

            <label className={`history-edit-field history-edit-field-${fieldStatus.paymentMethod.tone}`}>
              <HistoryFieldLabel label="Betalsätt" status={fieldStatus.paymentMethod} />
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
  const [optimisticUpdates, setOptimisticUpdates] = useState({});
  const [pendingPaidTargets, setPendingPaidTargets] = useState({});
  const [pendingBillingTypeTargets, setPendingBillingTypeTargets] = useState({});
  const [paidUpdatingIds, setPaidUpdatingIds] = useState([]);
  const [billingTypeUpdatingIds, setBillingTypeUpdatingIds] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_HISTORY_FILTERS);
  const [confirmState, setConfirmState] = useState({ open: false, type: "", targetId: "", count: 0, loading: false });
  const hasPendingToggleSave =
    paidUpdatingIds.length > 0 ||
    billingTypeUpdatingIds.length > 0 ||
    Object.keys(pendingPaidTargets).length > 0 ||
    Object.keys(pendingBillingTypeTargets).length > 0;
  const busy = history.loading || savingInvoice || confirmState.loading;
  const destructiveBusy = busy || history.mutating || hasPendingToggleSave;

  const sortedItems = useMemo(() => sortHistoryItems(history.items), [history.items]);
  const displayItems = useMemo(
    () => sortedItems.map((item) => applyOptimisticUpdate(item, optimisticUpdates)),
    [sortedItems, optimisticUpdates]
  );
  const hasItems = sortedItems.length > 0;
  const selectedCount = selectedIds.length;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const monthOptions = useMemo(() => getMonthFilterOptions(sortedItems), [sortedItems]);
  const categoryFilterOptions = useMemo(() => getCategoryFilterOptions(sortedItems), [sortedItems]);
  const filteredItems = useMemo(
    () => displayItems.filter((item) => matchesHistoryFilters(item, filters)),
    [displayItems, filters]
  );
  const filteredCount = filteredItems.length;
  const hasFilteredItems = filteredCount > 0;
  const hasActiveFilters = hasHistoryFilters(filters);
  const inactiveCount = useMemo(
    () => filteredItems.filter((item) => getStatusMeta(item).type === "overdue").length,
    [filteredItems]
  );

  useEffect(() => {
    if (!hasItems) {
      setSelectedIds([]);
      setSelectionMode(false);
      setActiveInvoice(null);
      setDraftInvoice(null);
      setHistoryPreviewOpen(false);
      setHistoryPreviewFile(null);
      setOptimisticUpdates({});
      setPendingPaidTargets({});
      setPendingBillingTypeTargets({});
      setPaidUpdatingIds([]);
      setBillingTypeUpdatingIds([]);
      setConfirmState({ open: false, type: "", targetId: "", count: 0, loading: false });
      return;
    }

    setSelectedIds((previous) => previous.filter((id) => filteredItems.some((item) => item.id === id)));
  }, [hasItems, filteredItems]);

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

  function togglePaid(item) {
    if (!item?.id || busy) return;

    const nextPaid = !item.paid;

    setOptimisticUpdates((previous) => mergeOptimisticField(previous, item.id, "paid", nextPaid));
    setPendingPaidTargets((previous) => ({
      ...previous,
      [item.id]: nextPaid,
    }));

    if (activeInvoice?.id === item.id) {
      setActiveInvoice((previous) =>
        previous?.id === item.id
          ? {
              ...previous,
              paid: nextPaid,
            }
          : previous
      );
      setDraftInvoice((previous) =>
        previous
          ? {
              ...previous,
              paid: nextPaid,
            }
          : previous
      );
    }
  }

  function toggleBillingType(item) {
    if (!item?.id || busy) return;

    const nextBillingType = getToggledBillingType(item?.billingType, item);

    setOptimisticUpdates((previous) =>
      mergeOptimisticField(previous, item.id, "billingType", nextBillingType)
    );
    setPendingBillingTypeTargets((previous) => ({
      ...previous,
      [item.id]: nextBillingType,
    }));

    if (activeInvoice?.id === item.id) {
      setActiveInvoice((previous) =>
        previous?.id === item.id
          ? {
              ...previous,
              billingType: nextBillingType,
            }
          : previous
      );
      setDraftInvoice((previous) =>
        previous
          ? {
              ...previous,
              billingType: nextBillingType,
            }
          : previous
      );
    }
  }

  /* eslint-disable react-hooks/exhaustive-deps */
  async function persistPaidTarget({ id, item, targetPaid }) {
    if (!id) return;

    setPaidUpdatingIds((previous) => addUpdatingId(previous, id));
    const payload = buildHistoryUpdatePayload(item, { paid: targetPaid });
    const saved = await history.updateOne(id, payload);
    setPaidUpdatingIds((previous) => removeUpdatingId(previous, id));

    if (!saved) {
      setPendingPaidTargets((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
      setOptimisticUpdates((previous) => clearOptimisticField(previous, id, "paid"));

      const baseItem = history.items.find((entry) => entry.id === id);
      if (activeInvoice?.id === id && baseItem) {
        setActiveInvoice((previous) =>
          previous?.id === id
            ? {
                ...previous,
                paid: Boolean(baseItem.paid),
              }
            : previous
        );
        setDraftInvoice((previous) =>
          previous
            ? {
                ...previous,
                paid: Boolean(baseItem.paid),
              }
            : previous
        );
      }
      return;
    }

    let shouldClear = false;
    setPendingPaidTargets((previous) => {
      if (previous[id] !== targetPaid) return previous;
      const next = { ...previous };
      delete next[id];
      shouldClear = true;
      return next;
    });

    if (shouldClear) {
      setOptimisticUpdates((previous) => clearOptimisticField(previous, id, "paid"));
    }
  }

  async function persistBillingTypeTarget({ id, item, targetBillingType }) {
    if (!id) return;

    setBillingTypeUpdatingIds((previous) => addUpdatingId(previous, id));
    const payload = buildHistoryUpdatePayload(item, { billingType: targetBillingType });
    const saved = await history.updateOne(id, payload);
    setBillingTypeUpdatingIds((previous) => removeUpdatingId(previous, id));

    if (!saved) {
      setPendingBillingTypeTargets((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
      setOptimisticUpdates((previous) => clearOptimisticField(previous, id, "billingType"));

      const baseItem = history.items.find((entry) => entry.id === id);
      if (activeInvoice?.id === id && baseItem) {
        const billingType = normalizeBillingType(baseItem.billingType, baseItem);
        setActiveInvoice((previous) =>
          previous?.id === id
            ? {
                ...previous,
                billingType,
              }
            : previous
        );
        setDraftInvoice((previous) =>
          previous
            ? {
                ...previous,
                billingType,
              }
            : previous
        );
      }
      return;
    }

    let shouldClear = false;
    setPendingBillingTypeTargets((previous) => {
      if (previous[id] !== targetBillingType) return previous;
      const next = { ...previous };
      delete next[id];
      shouldClear = true;
      return next;
    });

    if (shouldClear) {
      setOptimisticUpdates((previous) => clearOptimisticField(previous, id, "billingType"));
    }
  }

  useEffect(() => {
    Object.entries(pendingPaidTargets).forEach(([id, target]) => {
      if (paidUpdatingIds.includes(id)) return;

      const item = displayItems.find((entry) => entry.id === id);
      if (!item) return;

      void persistPaidTarget({
        id,
        item,
        targetPaid: Boolean(target),
      });
    });
  }, [pendingPaidTargets, paidUpdatingIds, displayItems, persistPaidTarget]);

  useEffect(() => {
    Object.entries(pendingBillingTypeTargets).forEach(([id, target]) => {
      if (billingTypeUpdatingIds.includes(id)) return;

      const item = displayItems.find((entry) => entry.id === id);
      if (!item) return;

      void persistBillingTypeTarget({
        id,
        item,
        targetBillingType: String(target || "Oklart"),
      });
    });
  }, [pendingBillingTypeTargets, billingTypeUpdatingIds, displayItems, persistBillingTypeTarget]);
  /* eslint-enable react-hooks/exhaustive-deps */

  function requestDeleteOne(id) {
    if (!id || destructiveBusy) return;
    setConfirmState({
      open: true,
      type: "one",
      targetId: id,
      count: 1,
      loading: false,
    });
  }

  function requestDeleteSelected() {
    if (!selectedIds.length || destructiveBusy) return;
    setConfirmState({
      open: true,
      type: "selected",
      targetId: "",
      count: selectedIds.length,
      loading: false,
    });
  }

  function requestDeleteAll() {
    if (destructiveBusy || !hasItems) return;
    setConfirmState({
      open: true,
      type: "all",
      targetId: "",
      count: sortedItems.length,
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

  function updateFilter(fieldKey, value) {
    setFilters((previous) => ({ ...previous, [fieldKey]: value }));
  }

  function resetFilters() {
    setFilters(DEFAULT_HISTORY_FILTERS);
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
          <div className="history-header-copy">
            <div className="history-heading-row">
              <h2>Historik</h2>
              <span className="history-total-badge">Totalt {sortedItems.length} fakturor</span>
              {hasActiveFilters ? (
                <span className="history-total-badge history-total-badge-muted">Visar {filteredCount}</span>
              ) : null}
            </div>
            <p>Här ser du tidigare analyserade fakturor med nyckelinfo.</p>
          </div>

          <div className="history-header-actions">
            <button className="btn btn-secondary" onClick={history.loadHistory} disabled={destructiveBusy}>
              {history.loading ? "Uppdaterar..." : "Uppdatera"}
            </button>
            {hasItems && (
              <button className="btn btn-secondary" onClick={toggleSelectionMode} disabled={destructiveBusy}>
                {selectionMode ? "Avsluta markering" : "Välj flera"}
              </button>
            )}
          </div>
        </div>

        {hasItems && (
          <div className="history-filter-toolbar">
            <div className="history-filter-grid">
              <label className="history-filter-field">
                Företag
                <input
                  className="metric-input"
                  value={filters.vendor}
                  onChange={(event) => updateFilter("vendor", event.target.value)}
                  placeholder="Sök leverantör"
                />
              </label>

              <label className="history-filter-field">
                Månad
                <select
                  className="metric-input"
                  value={filters.month}
                  onChange={(event) => updateFilter("month", event.target.value)}
                >
                  <option value="all">Alla månader</option>
                  {monthOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="history-filter-field">
                Fakturatyp
                <select
                  className="metric-input"
                  value={filters.billingType}
                  onChange={(event) => updateFilter("billingType", event.target.value)}
                >
                  <option value="all">Alla typer</option>
                  {BILLING_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="history-filter-field">
                Betalstatus
                <select
                  className="metric-input"
                  value={filters.paidStatus}
                  onChange={(event) => updateFilter("paidStatus", event.target.value)}
                >
                  {PAID_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="history-filter-field">
                Kategori
                <select
                  className="metric-input"
                  value={filters.category}
                  onChange={(event) => updateFilter("category", event.target.value)}
                >
                  <option value="all">Alla kategorier</option>
                  {categoryFilterOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="history-filter-meta">
              <p>
                Visar {filteredCount} av {sortedItems.length} fakturor.
              </p>
              {hasActiveFilters ? (
                <button className="btn btn-secondary" onClick={resetFilters} disabled={busy}>
                  Rensa filter
                </button>
              ) : null}
            </div>
          </div>
        )}

        {selectionMode && hasItems && (
          <div className="history-bulk-toolbar">
            <p>{selectedCount} markerade</p>
            <div className="history-bulk-actions">
              <button
                className="btn btn-secondary"
                onClick={requestDeleteSelected}
                disabled={!selectedCount || destructiveBusy}
              >
                Ta bort markerade
              </button>
              <button className="btn btn-danger" onClick={requestDeleteAll} disabled={destructiveBusy}>
                Ta bort alla
              </button>
            </div>
          </div>
        )}

        {inactiveCount > 0 && (
          <div className="history-warning-box" role="status">
            <strong>Varning:</strong> {inactiveCount} inaktiv
            {inactiveCount > 1 ? "a fakturor behöver" : " faktura behöver"} dubbelkoll.
          </div>
        )}

        {history.error && <p className="error-message">{history.error}</p>}
        {history.warning && <p className="warning-message">{history.warning}</p>}
        {!history.enabled && !history.error && (
          <p className="placeholder-text">
            Historiktjänsten är inte tillgänglig just nu. Kontrollera Firebase-inställningarna i backend `.env`.
          </p>
        )}

        {history.enabled && sortedItems.length === 0 && !history.loading && (
          <p className="placeholder-text">Ingen historik ännu. Kör en analys så sparas första posten.</p>
        )}

        {hasItems && !hasFilteredItems && (
          <p className="placeholder-text">Inga fakturor matchar dina filter just nu.</p>
        )}

        {hasFilteredItems && (
          <div className="history-list">
            {filteredItems.map((item) => (
              <HistoryCard
                key={item.id}
                item={item}
                selectionMode={selectionMode}
                isSelected={selectedSet.has(item.id)}
                busy={busy}
                deleteBusy={destructiveBusy}
                onToggleSelect={toggleSelectedId}
                onDeleteOne={requestDeleteOne}
                onOpenInvoice={openInvoice}
                onTogglePaid={togglePaid}
                onToggleBillingType={toggleBillingType}
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
  const statusText = normalizeText(item?.status);

  if (Boolean(item?.paid) || statusText.includes("betald")) {
    return {
      type: "paid",
      label: "Betald",
      className: "history-status-ok history-status-paid",
      sortGroup: 0,
      sortWeight: 2,
    };
  }

  const dueDate = parseDate(item?.dueDate);
  if (dueDate) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return {
        type: "overdue",
        label: "Förfallen",
        className: "history-status-danger",
        sortGroup: 2,
        sortWeight: 0,
      };
    }
    if (diffDays <= 7) {
      return {
        type: "soon",
        label: "Förfaller snart",
        className: "history-status-warn",
        sortGroup: 0,
        sortWeight: 1,
      };
    }
    return {
      type: "active",
      label: "Aktiv",
      className: "history-status-ok",
      sortGroup: 0,
      sortWeight: 0,
    };
  }

  if (statusText.includes("forfallen")) {
    return {
      type: "overdue",
      label: "Förfallen",
      className: "history-status-danger",
      sortGroup: 2,
      sortWeight: 0,
    };
  }
  if (statusText.includes("forfaller") || statusText.includes("snart")) {
    return {
      type: "soon",
      label: "Förfaller snart",
      className: "history-status-warn",
      sortGroup: 0,
      sortWeight: 1,
    };
  }
  if (statusText.includes("aktiv")) {
    return {
      type: "active",
      label: "Aktiv",
      className: "history-status-ok",
      sortGroup: 0,
      sortWeight: 0,
    };
  }
  return {
    type: "unknown",
    label: "Okänt",
    className: "",
    sortGroup: 1,
    sortWeight: 0,
  };
}

function parseDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const localDate = new Date(`${text}T00:00:00`);
    return Number.isNaN(localDate.getTime()) ? null : localDate;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sortHistoryItems(items = []) {
  return [...items].sort((a, b) => {
    const statusA = getStatusMeta(a);
    const statusB = getStatusMeta(b);

    if (statusA.sortGroup !== statusB.sortGroup) {
      return statusA.sortGroup - statusB.sortGroup;
    }

    if (statusA.sortWeight !== statusB.sortWeight) {
      return statusA.sortWeight - statusB.sortWeight;
    }

    const timeA = resolveSortTimestamp(a);
    const timeB = resolveSortTimestamp(b);

    if (statusA.type === "overdue") {
      return timeA - timeB;
    }
    return timeB - timeA;
  });
}

function resolveSortTimestamp(item) {
  const candidates = [item?.invoiceDate, item?.dueDate, item?.createdAt, item?.scannedAt];
  for (const value of candidates) {
    const date = parseDate(value);
    if (date) return date.getTime();
  }
  return 0;
}

function applyOptimisticUpdate(item, optimisticUpdates = {}) {
  if (!item?.id) return item;
  const patch = optimisticUpdates[item.id];
  if (!patch || typeof patch !== "object") return item;
  return { ...item, ...patch };
}

function addUpdatingId(previous = [], id = "") {
  if (!id || previous.includes(id)) return previous;
  return [...previous, id];
}

function removeUpdatingId(previous = [], id = "") {
  if (!id) return previous;
  return previous.filter((entry) => entry !== id);
}

function mergeOptimisticField(previous = {}, id = "", fieldKey = "", value) {
  if (!id || !fieldKey) return previous;
  const previousEntry = previous[id] || {};
  return {
    ...previous,
    [id]: {
      ...previousEntry,
      [fieldKey]: value,
    },
  };
}

function clearOptimisticField(previous = {}, id = "", fieldKey = "") {
  if (!id || !fieldKey) return previous;
  const previousEntry = previous[id];
  if (!previousEntry || !(fieldKey in previousEntry)) return previous;

  const nextEntry = { ...previousEntry };
  delete nextEntry[fieldKey];

  if (Object.keys(nextEntry).length === 0) {
    const next = { ...previous };
    delete next[id];
    return next;
  }

  return {
    ...previous,
    [id]: nextEntry,
  };
}

function resolveHistoryDate(item) {
  const candidates = [item?.invoiceDate, item?.dueDate, item?.createdAt, item?.scannedAt];
  for (const value of candidates) {
    const date = parseDate(value);
    if (date) return date;
  }
  return null;
}

function resolveMonthKey(item) {
  const date = resolveHistoryDate(item);
  if (!date) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}

function formatMonthLabel(monthKey) {
  const [yearText, monthText] = String(monthKey).split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return String(monthKey);
  }

  const date = new Date(year, month - 1, 1);
  if (Number.isNaN(date.getTime())) {
    return String(monthKey);
  }

  const label = date.toLocaleDateString("sv-SE", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getMonthFilterOptions(items = []) {
  const monthSet = new Set();
  items.forEach((item) => {
    const monthKey = resolveMonthKey(item);
    if (monthKey) monthSet.add(monthKey);
  });

  return [...monthSet]
    .sort((a, b) => b.localeCompare(a))
    .map((monthKey) => ({
      value: monthKey,
      label: formatMonthLabel(monthKey),
    }));
}

function getCategoryFilterOptions(items = []) {
  const categorySet = new Set();
  items.forEach((item) => {
    categorySet.add(normalizeCategory(cleanDisplayText(item?.category)));
  });

  return [...categorySet].sort((a, b) => a.localeCompare(b, "sv"));
}

function hasHistoryFilters(filters = DEFAULT_HISTORY_FILTERS) {
  return (
    cleanDisplayText(filters.vendor).length > 0 ||
    filters.month !== "all" ||
    filters.billingType !== "all" ||
    filters.paidStatus !== "all" ||
    filters.category !== "all"
  );
}

function matchesHistoryFilters(item, filters = DEFAULT_HISTORY_FILTERS) {
  const vendorFilter = normalizeText(cleanDisplayText(filters.vendor));
  if (vendorFilter) {
    const vendorName = normalizeText(cleanDisplayText(item?.vendorName));
    if (!vendorName.includes(vendorFilter)) {
      return false;
    }
  }

  if (filters.month !== "all" && resolveMonthKey(item) !== filters.month) {
    return false;
  }

  if (filters.billingType !== "all") {
    const billingType = normalizeBillingType(item?.billingType, item);
    if (billingType !== filters.billingType) {
      return false;
    }
  }

  if (filters.paidStatus === "paid" && !item?.paid) {
    return false;
  }
  if (filters.paidStatus === "unpaid" && item?.paid) {
    return false;
  }

  if (filters.category !== "all") {
    const category = normalizeCategory(cleanDisplayText(item?.category));
    if (category !== filters.category) {
      return false;
    }
  }

  return true;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function toDraft(item) {
  return {
    vendorName: sanitizeDraftField("vendorName", item.vendorName),
    category: normalizeCategory(cleanDisplayText(item.category)),
    billingType: normalizeBillingType(cleanDisplayText(item.billingType), item),
    invoiceDate: item.invoiceDate || "",
    dueDate: item.dueDate || "",
    invoiceNumber: sanitizeDraftField("invoiceNumber", item.invoiceNumber),
    customerNumber: sanitizeDraftField("customerNumber", item.customerNumber),
    ocrNumber: sanitizeDraftField("ocrNumber", item.ocrNumber),
    organizationNumber: sanitizeDraftField("organizationNumber", item.organizationNumber),
    monthlyCost: formatNumberWithSpaces(item.monthlyCost, { fallback: "" }),
    totalAmount: formatNumberWithSpaces(item.totalAmount, { fallback: "" }),
    vatAmount: formatNumberWithSpaces(item.vatAmount, { fallback: "" }),
    currency: cleanDisplayText(item.currency) || "SEK",
    paymentMethod: normalizePaymentMethod(cleanDisplayText(item.paymentMethod)),
    paid: Boolean(item.paid),
  };
}

function buildHistoryUpdatePayload(item, overrides = {}) {
  const category = normalizeCategory(overrides.category ?? cleanDisplayText(item?.category));
  const monthlyCost = toNumberOrNull(overrides.monthlyCost ?? item?.monthlyCost);
  const totalAmount = toNumberOrNull(overrides.totalAmount ?? item?.totalAmount);

  return {
    vendorName: cleanDisplayText(overrides.vendorName ?? item?.vendorName),
    category,
    billingType: normalizeBillingType(overrides.billingType ?? item?.billingType, {
      category,
      monthlyCost,
      totalAmount,
    }),
    invoiceDate: overrides.invoiceDate ?? item?.invoiceDate ?? null,
    dueDate: overrides.dueDate ?? item?.dueDate ?? null,
    invoiceNumber: cleanDisplayText(overrides.invoiceNumber ?? item?.invoiceNumber),
    customerNumber: cleanDisplayText(overrides.customerNumber ?? item?.customerNumber),
    ocrNumber: cleanDisplayText(overrides.ocrNumber ?? item?.ocrNumber),
    organizationNumber: cleanDisplayText(overrides.organizationNumber ?? item?.organizationNumber),
    monthlyCost,
    totalAmount,
    vatAmount: toNumberOrNull(overrides.vatAmount ?? item?.vatAmount),
    currency: cleanDisplayText(overrides.currency ?? item?.currency) || "SEK",
    paymentMethod: normalizePaymentMethod(overrides.paymentMethod ?? item?.paymentMethod),
    paid: Boolean(overrides.paid ?? item?.paid),
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
    paid: Boolean(draft.paid),
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

function getSourceTypeLabel(item) {
  const source = normalizeText(cleanDisplayText(item?.source));
  if (source === "email") return "E-post";

  const sourceType = normalizeText(cleanDisplayText(item?.sourceType));
  if (sourceType === "email") return "E-post";
  if (sourceType === "file") return "Filuppladdning";
  return "Textinput";
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

function getToggledBillingType(value, context = {}) {
  const current = normalizeBillingType(value, context);
  return current === "Abonnemang" ? "Engång" : "Abonnemang";
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

function getVendorDisplayName(value) {
  const text = cleanDisplayText(value);
  if (!text) return "Ingen leverantör hittades";
  if (looksLikeMetadataNoise(text)) return "Ingen leverantör hittades";

  const normalized = normalizeText(text);
  if (normalized === "okand leverantor" || normalized === "ingen leverantor hittades") {
    return "Ingen leverantör hittades";
  }

  return text;
}

function resolveHistoryFieldStatus(item, fieldKey, value) {
  const missing = isMissingHistoryFieldValue(fieldKey, value);
  const metaConfidence = Number(item?.fieldMeta?.[fieldKey]?.confidence);
  const globalConfidence = Number(item?.confidence);

  let confidence = 0.22;
  if (!missing && Number.isFinite(metaConfidence)) {
    confidence = clamp01(metaConfidence);
  } else if (!missing && Number.isFinite(globalConfidence)) {
    confidence = clamp01(globalConfidence);
  } else if (!missing) {
    confidence = 0.62;
  }

  if (!missing && fieldKey === "paymentMethod") {
    const payment = normalizeText(cleanDisplayText(value));
    if (payment === "okant") confidence = Math.min(confidence, 0.48);
  }

  if (!missing && fieldKey === "category") {
    const category = normalizeText(cleanDisplayText(value));
    if (category === "ovrigt") confidence = Math.min(confidence, 0.54);
  }

  const tone = confidence >= 0.8 ? "high" : confidence >= 0.55 ? "medium" : "low";
  if (missing) {
    return {
      tone: "low",
      label: "Saknas",
    };
  }

  const percentage = Math.round(confidence * 100);
  const toneLabel = tone === "high" ? "Hög" : tone === "medium" ? "Medel" : "Låg";
  return {
    tone,
    label: `${toneLabel} ${percentage}%`,
  };
}

function isMissingHistoryFieldValue(fieldKey, value) {
  const text = cleanDisplayText(value);

  if (fieldKey === "invoiceDate" || fieldKey === "dueDate") {
    return !parseDate(value);
  }

  if (fieldKey === "monthlyCost" || fieldKey === "totalAmount" || fieldKey === "vatAmount") {
    return toNumberOrNull(value) == null;
  }

  if (fieldKey === "paymentMethod") {
    const normalized = normalizeText(text);
    return !text || normalized === "okant";
  }

  if (fieldKey === "billingType") {
    const normalized = normalizeText(text);
    return !text || normalized === "oklart";
  }

  if (fieldKey === "vendorName") {
    if (!text || looksLikeMetadataNoise(text)) return true;
    const normalized = normalizeText(text);
    return normalized === "okand leverantor" || normalized === "ingen leverantor hittades";
  }

  if (
    fieldKey === "invoiceNumber" ||
    fieldKey === "customerNumber" ||
    fieldKey === "ocrNumber" ||
    fieldKey === "organizationNumber"
  ) {
    return !text || looksLikeMetadataNoise(text);
  }

  return !text;
}

function sanitizeDraftField(fieldKey, value) {
  const text = cleanDisplayText(value);
  if (!text) return "";
  if (looksLikeMetadataNoise(text)) return "";

  if (fieldKey === "vendorName") {
    const normalized = normalizeText(text);
    if (normalized === "okand leverantor" || normalized === "ingen leverantor hittades") {
      return "";
    }
  }

  return text;
}

function looksLikeMetadataNoise(value) {
  const text = normalizeText(cleanDisplayText(value));
  if (!text) return false;

  if (text.includes("inbound email invoice metadata")) return true;
  if (/^(from|subject|recipient|received_at|file_name|ocr_text)\s*:/.test(text)) return true;
  if (/^(from|subject|recipient|received_at|file_name|ocr_text)$/.test(text)) return true;

  return false;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
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
