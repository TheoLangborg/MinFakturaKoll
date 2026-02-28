import { ACCEPTED_FILE_TYPES } from "../constants/appConstants.js";
import { formatFileSize } from "../utils/fileUtils.js";
import PreviewContent from "./PreviewContent.jsx";

const STATUS_META = {
  pending: { label: "Väntar", icon: "" },
  processing: { label: "Analyseras", icon: "…" },
  done: { label: "Analyserad", icon: "✓" },
  error: { label: "Fel", icon: "!" },
};

export default function InvoiceInputPanel({
  invoiceFile,
  queueItems = [],
  queueProgress,
  analyzableQueueCount = 0,
  analyzedFileSummaries = [],
  isQueueBatchComplete = false,
  selectedQueueItemId,
  activeQueueItemId,
  maxQueueFiles = 10,
  isDragging,
  text,
  error,
  warning,
  loading,
  onTextChange,
  onFileChange,
  onDragOver,
  onDragLeave,
  onDrop,
  onAnalyze,
  onAnalyzeSelected,
  onClear,
  onOpenPreview,
  onSelectQueueItem,
  onShowQueueItemResult,
  onRemoveQueueItem,
}) {
  const hasFilePreview = Boolean(invoiceFile?.previewKind);
  const fileInputId = "invoice-upload-input";
  const activeQueueItem = queueItems.find((item) => item.id === activeQueueItemId) || null;
  const selectedQueueItem = queueItems.find((item) => item.id === selectedQueueItemId) || null;
  const selectedIndex = queueItems.findIndex((item) => item.id === selectedQueueItemId);
  const queueSummary = queueProgress || {
    total: queueItems.length,
    done: 0,
    failed: 0,
    processing: 0,
    pending: queueItems.length,
  };
  const canAnalyzeSelected = Boolean(selectedQueueItem) && selectedQueueItem.status !== "processing";

  return (
    <article className="panel">
      <div className="panel-header">
        <span className="step-badge">Steg 1</span>
        <h2>Fakturainput</h2>
      </div>

      <div className="text-block-header">
        <h3>Fil i input-rutan</h3>
        <p>
          Lägg till en eller flera filer samtidigt (max {maxQueueFiles}). Du kan analysera alla
          automatiskt i kö eller en vald fil i taget.
        </p>
      </div>

      <div
        className={`input-surface input-surface-drop ${isDragging ? "upload-zone-active" : ""}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <input
          id={fileInputId}
          className="hidden-file-input"
          type="file"
          multiple
          accept={ACCEPTED_FILE_TYPES}
          onChange={onFileChange}
        />

        {!hasFilePreview && (
          <label htmlFor={fileInputId} className="input-upload-label">
            <strong>Släpp filer här eller klicka för att välja</strong>
            <span>Stöd: PDF, PNG, JPG, WEBP, TXT, CSV</span>
          </label>
        )}

        {hasFilePreview && (
          <div
            className="preview-button"
            role="button"
            tabIndex={0}
            onClick={onOpenPreview}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpenPreview();
              }
            }}
          >
            <PreviewContent file={invoiceFile} />
            <span className="preview-hint">Klicka för större förhandsvisning</span>
          </div>
        )}
      </div>

      {invoiceFile && (
        <div className="preview-meta">
          <span>
            {invoiceFile.name}
            {selectedIndex >= 0 ? ` • fil ${selectedIndex + 1}/${queueItems.length}` : ""}
          </span>
          <div className="preview-meta-actions">
            <span>{formatFileSize(invoiceFile.size)}</span>
            <label htmlFor={fileInputId} className="replace-file-button">
              Lägg till fler filer
            </label>
          </div>
        </div>
      )}

      {queueItems.length > 0 && (
        <div className="upload-queue">
          <div className="upload-queue-header">
            <strong>
              Analyskö {queueSummary.total}/{maxQueueFiles}
            </strong>
            <span>
              {queueSummary.done} analyserade • {queueSummary.pending} väntar
              {queueSummary.failed > 0 ? ` • ${queueSummary.failed} fel` : ""}
            </span>
          </div>

          {activeQueueItem && (
            <p className="upload-queue-active">Analyserar nu: {activeQueueItem.file.name}</p>
          )}

          <div className="upload-queue-list">
            {queueItems.map((item) => {
              const status = STATUS_META[item.status] || { label: "Okänd", icon: "?" };
              const isDone = item.status === "done" && Boolean(item.result);

              return (
                <article
                  key={item.id}
                  className={`upload-queue-item ${
                    item.id === selectedQueueItemId ? "upload-queue-item-selected" : ""
                  } ${item.id === activeQueueItemId ? "upload-queue-item-active" : ""}`}
                  onClick={() => onSelectQueueItem(item.id)}
                >
                  <div className="upload-queue-main">
                    <p className="upload-queue-name">{item.file.name}</p>
                    <p className="upload-queue-meta">{formatFileSize(item.file.size)}</p>
                    {item.status === "error" && item.error && (
                      <p className="upload-queue-error">{item.error}</p>
                    )}
                  </div>

                  <div className="upload-queue-actions">
                    <span className={`queue-status queue-status-${item.status}`}>
                      {status.icon ? `${status.icon} ` : ""}
                      {status.label}
                    </span>

                    {isDone && (
                      <button
                        className="queue-result-button"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onShowQueueItemResult(item.id);
                        }}
                      >
                        Visa resultat
                      </button>
                    )}

                    <button
                      className="queue-remove-button"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveQueueItem(item.id);
                      }}
                      disabled={loading && item.id === activeQueueItemId}
                      aria-label={`Ta bort ${item.file.name}`}
                    >
                      Ta bort
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {isQueueBatchComplete && analyzedFileSummaries.length > 0 && (
        <section className="queue-summary">
          <h3>Analyserade filer</h3>
          <p>
            Batchen är klar. Här är genomsnittlig tillförlitlighet per fil med snabb åtkomst till
            analysen.
          </p>

          <div className="queue-summary-list">
            {analyzedFileSummaries.map((summary) => (
              <article key={summary.id} className="queue-summary-item">
                <div>
                  <strong>{summary.fileName}</strong>
                  <p>{summary.comment}</p>
                </div>

                <div className="queue-summary-actions">
                  <span className={`queue-trust-badge queue-trust-badge-${summary.trustLevel}`}>
                    {Number.isFinite(summary.trustPercent) ? `${summary.trustPercent}%` : "—"}
                  </span>
                  <button
                    className="btn btn-secondary queue-summary-open"
                    type="button"
                    onClick={() => onShowQueueItemResult(summary.id)}
                  >
                    Visa analys/resultat
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="text-block-header">
        <h3>OCR-text / komplettering</h3>
        <p>
          {queueItems.length > 0
            ? "Texten gäller vald fil i kön."
            : "Om text saknas i filen kan du komplettera här innan du analyserar."}
        </p>
      </div>

      <textarea
        className="invoice-textarea"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder="Klistra in OCR-text från fakturan här..."
        rows={7}
      />

      <div className="button-row">
        {queueItems.length > 0 ? (
          <>
            <button className="btn btn-primary" onClick={onAnalyze} disabled={loading || !analyzableQueueCount}>
              {loading
                ? "Analyserar kö..."
                : `Analysera alla (${analyzableQueueCount} filer)`}
            </button>
            <button
              className="btn btn-secondary"
              onClick={onAnalyzeSelected}
              disabled={loading || !canAnalyzeSelected}
            >
              Analysera vald fil
            </button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={onAnalyze} disabled={loading}>
            {loading ? "Analyserar..." : "Analysera faktura"}
          </button>
        )}

        <button className="btn btn-secondary" onClick={onClear} disabled={loading}>
          Rensa
        </button>
      </div>

      {error && <p className="error-message">{error}</p>}
      {warning && <p className="warning-message">{warning}</p>}
    </article>
  );
}
