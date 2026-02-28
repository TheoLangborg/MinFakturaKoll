import { ACCEPTED_FILE_TYPES } from "../constants/appConstants.js";
import { formatFileSize } from "../utils/fileUtils.js";
import PreviewContent from "./PreviewContent.jsx";

export default function InvoiceInputPanel({
  invoiceFile,
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
  onClear,
  onOpenPreview,
}) {
  const hasFilePreview = Boolean(invoiceFile?.previewKind);
  const fileInputId = "invoice-upload-input";

  return (
    <article className="panel">
      <div className="panel-header">
        <span className="step-badge">Steg 1</span>
        <h2>Fakturainput</h2>
      </div>

      <div className="text-block-header">
        <h3>Fil i input-rutan</h3>
        <p>
          Ladda upp i rutan nedan. Du kan dra in filen eller klicka i rutan för att välja fil.
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
          accept={ACCEPTED_FILE_TYPES}
          onChange={onFileChange}
        />

        {!hasFilePreview && (
          <label htmlFor={fileInputId} className="input-upload-label">
            <strong>Släpp filen här eller klicka för att välja</strong>
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
          <span>{invoiceFile.name}</span>
          <div className="preview-meta-actions">
            <span>{formatFileSize(invoiceFile.size)}</span>
            <label htmlFor={fileInputId} className="replace-file-button">
              Byt fil
            </label>
          </div>
        </div>
      )}

      <div className="text-block-header">
        <h3>OCR-text / komplettering</h3>
        <p>Om text saknas i filen kan du komplettera här innan du analyserar.</p>
      </div>

      <textarea
        className="invoice-textarea"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder="Klistra in OCR-text från fakturan här..."
        rows={7}
      />

      <div className="button-row">
        <button className="btn btn-primary" onClick={onAnalyze} disabled={loading}>
          {loading ? "Analyserar..." : "Analysera faktura"}
        </button>
        <button className="btn btn-secondary" onClick={onClear} disabled={loading}>
          Rensa
        </button>
      </div>

      {error && <p className="error-message">{error}</p>}
      {warning && <p className="warning-message">{warning}</p>}
    </article>
  );
}
