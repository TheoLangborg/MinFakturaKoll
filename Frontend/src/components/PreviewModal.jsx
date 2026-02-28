import { formatFileSize } from "../utils/fileUtils.js";
import PreviewContent from "./PreviewContent.jsx";

export default function PreviewModal({ isOpen, invoiceFile, onClose }) {
  if (!isOpen || !invoiceFile) return null;
  const hasSize = Number.isFinite(invoiceFile.size) && invoiceFile.size > 0;

  return (
    <div className="preview-modal" onClick={onClose}>
      <div className="preview-modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="preview-modal-header">
          <div>
            <strong>{invoiceFile.name}</strong>
            <p>{hasSize ? formatFileSize(invoiceFile.size) : "Förhandsvisning"}</p>
          </div>

          <button className="btn btn-secondary" type="button" onClick={onClose}>
            Stäng
          </button>
        </div>

        <div className="preview-modal-body">
          <PreviewContent file={invoiceFile} large />
        </div>
      </div>
    </div>
  );
}
