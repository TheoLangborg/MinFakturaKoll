import { useEffect, useMemo, useState } from "react";
import { MAX_FILE_BYTES, SAMPLE_TEXT } from "../constants/appConstants.js";
import {
  isImageType,
  isPdfType,
  isTextType,
  normalizeFileType,
  readAsDataUrl,
} from "../utils/fileUtils.js";
import { buildEmailTemplatesFromExtracted } from "../utils/emailTemplates.js";
import { apiFetch } from "../utils/apiClient.js";
import { toUserErrorMessage } from "../utils/errorText.js";

export function useInvoiceScanner({ onHistoryChanged } = {}) {
  const [invoiceFile, setInvoiceFile] = useState(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [text, setText] = useState(SAMPLE_TEXT);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [editedExtracted, setEditedExtracted] = useState(null);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [hasUnsyncedHistoryEdit, setHasUnsyncedHistoryEdit] = useState(false);

  const emailTemplates = useMemo(() => {
    if (editedExtracted) return buildEmailTemplatesFromExtracted(editedExtracted);

    if (!Array.isArray(result?.actions)) return [];
    return result.actions
      .filter((entry) => entry?.type === "cancel_email")
      .map((entry, index) => ({
        ...entry,
        templateId: entry.templateId || `template-${index + 1}`,
        templateLabel: entry.templateLabel || `Mall ${index + 1}`,
      }));
  }, [editedExtracted, result]);

  const email = useMemo(() => {
    if (!emailTemplates.length) return null;
    return (
      emailTemplates.find((template) => template.templateId === selectedTemplateId) ||
      emailTemplates[0]
    );
  }, [emailTemplates, selectedTemplateId]);

  useEffect(() => {
    const nextExtracted = result?.extracted || null;
    setEditedExtracted(nextExtracted);
    setHasUnsyncedHistoryEdit(false);

    const ids = buildEmailTemplatesFromExtracted(nextExtracted).map((template) => template.templateId);
    setSelectedTemplateId(ids[0] || "");
  }, [result]);

  useEffect(() => {
    if (!emailTemplates.length) {
      setSelectedTemplateId("");
      return;
    }

    const selectedStillExists = emailTemplates.some(
      (template) => template.templateId === selectedTemplateId
    );
    if (!selectedStillExists) {
      setSelectedTemplateId(emailTemplates[0].templateId);
    }
  }, [emailTemplates, selectedTemplateId]);

  useEffect(() => {
    if (!hasUnsyncedHistoryEdit || !result?.historyId || !editedExtracted) return;

    const syncTimer = setTimeout(() => {
      void syncEditedHistory({
        historyId: result.historyId,
        extracted: editedExtracted,
        onHistoryChanged,
        onSuccess: () => setHasUnsyncedHistoryEdit(false),
        onError: (message) => {
          setHasUnsyncedHistoryEdit(false);
          setWarning((previous) => (previous ? `${previous} ${message}` : message));
        },
      });
    }, 450);

    return () => clearTimeout(syncTimer);
  }, [editedExtracted, hasUnsyncedHistoryEdit, onHistoryChanged, result?.historyId]);

  async function handleFile(file) {
    if (!file) return;

    if (file.size > MAX_FILE_BYTES) {
      setError("Filen är för stor. Maxstorlek är 10 MB.");
      return;
    }

    setError("");
    setWarning("");
    setResult(null);

    const fileType = normalizeFileType(file);
    const base = {
      name: file.name,
      size: file.size,
      type: fileType,
      previewKind: "unknown",
      previewSrc: "",
      textPreview: "",
    };

    try {
      if (isTextType(fileType, file.name)) {
        const content = await file.text();
        const trimmed = content.trim();

        setInvoiceFile({
          ...base,
          previewKind: "text",
          textPreview: trimmed || "(Tom textfil)",
        });

        if (trimmed) setText(trimmed);
        return;
      }

      if (isImageType(fileType)) {
        const dataUrl = await readAsDataUrl(file);
        setInvoiceFile({
          ...base,
          previewKind: "image",
          previewSrc: dataUrl,
        });
        if (!text.trim() || text === SAMPLE_TEXT) {
          setText(` `);
        }
        return;
      }

      if (isPdfType(fileType, file.name)) {
        const dataUrl = await readAsDataUrl(file);
        setInvoiceFile({
          ...base,
          previewKind: "pdf",
          previewSrc: dataUrl,
        });
        if (!text.trim() || text === SAMPLE_TEXT) {
          setText(`Fakturafil: ${file.name}\nPDF laddad. Komplettera OCR-text vid behov.`);
        }
        return;
      }

      setInvoiceFile(base);
      setError("Filtypen kunde inte förhandsvisas. Prova PDF, bild eller textfil.");
    } catch (caughtError) {
      const reason = toUserErrorMessage(caughtError, "okänt fel vid filuppladdning");
      setError(`Vi kunde inte läsa filen: ${reason}`);
    }
  }

  function onFileChange(event) {
    const file = event.target.files?.[0];
    void handleFile(file);
  }

  function onDragOver(event) {
    event.preventDefault();
    setIsDragging(true);
  }

  function onDragLeave(event) {
    event.preventDefault();
    setIsDragging(false);
  }

  function onDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer?.files?.[0];
    void handleFile(file);
  }

  async function analyze() {
    const hasVisualFile =
      invoiceFile && (invoiceFile.previewKind === "image" || invoiceFile.previewKind === "pdf");

    if (!text.trim() && !hasVisualFile) {
      setError("Lägg till fakturatext eller ladda upp en fakturafil innan analys.");
      return;
    }

    setLoading(true);
    setError("");
    setWarning("");
    setResult(null);

    try {
      const payload = { text: text.trim() };

      if (hasVisualFile) {
        payload.file = {
          name: invoiceFile.name,
          type: invoiceFile.type,
          dataUrl: invoiceFile.previewSrc,
        };
      }

      const response = await apiFetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Analysen misslyckades.");
      }

      setResult(json);
      setWarning(json.warning || "");
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, "Analysen kunde inte genomföras just nu."));
    } finally {
      setLoading(false);
    }
  }

  async function copyEmail() {
    if (!email) return;
    const fullText = `Ämne: ${email.subject}\n\n${email.body}`;
    await navigator.clipboard.writeText(fullText);
  }

  function selectTemplate(templateId) {
    setSelectedTemplateId(templateId);
  }

  function updateExtractedField(fieldKey, nextValue) {
    setEditedExtracted((previous) => {
      const current = previous || {};
      return {
        ...current,
        [fieldKey]: normalizeEditedValue(fieldKey, nextValue),
      };
    });
    setHasUnsyncedHistoryEdit(true);
  }

  function clearAll() {
    setInvoiceFile(null);
    setPreviewModalOpen(false);
    setResult(null);
    setEditedExtracted(null);
    setHasUnsyncedHistoryEdit(false);
    setError("");
    setWarning("");
    setText("");
    setSelectedTemplateId("");
  }

  function openPreview() {
    setPreviewModalOpen(true);
  }

  function closePreview() {
    setPreviewModalOpen(false);
  }

  return {
    invoiceFile,
    previewModalOpen,
    isDragging,
    text,
    loading,
    result,
    editedExtracted,
    fieldMeta: result?.fieldMeta || {},
    error,
    warning,
    email,
    emailTemplates,
    selectedTemplateId,
    setText,
    onFileChange,
    onDragOver,
    onDragLeave,
    onDrop,
    analyze,
    copyEmail,
    selectTemplate,
    updateExtractedField,
    clearAll,
    openPreview,
    closePreview,
  };
}

async function syncEditedHistory({ historyId, extracted, onHistoryChanged, onSuccess, onError }) {
  try {
    const response = await apiFetch(`/api/history/${encodeURIComponent(historyId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extracted }),
    });
    const json = await response.json();

    if (!response.ok || !json.ok) {
      throw new Error(json.error || "Kunde inte uppdatera historiken.");
    }

    onSuccess?.();
    if (typeof onHistoryChanged === "function") {
      await onHistoryChanged();
    }
  } catch (error) {
    onError?.(
      toUserErrorMessage(
        error,
        "Ändringen sparades lokalt men kunde inte synkas till historiken just nu."
      )
    );
  }
}

const NUMERIC_FIELDS = new Set(["monthlyCost", "totalAmount", "vatAmount", "confidence"]);
const DATE_FIELDS = new Set(["dueDate", "invoiceDate"]);

function normalizeEditedValue(fieldKey, nextValue) {
  if (DATE_FIELDS.has(fieldKey)) {
    return nextValue || null;
  }

  if (NUMERIC_FIELDS.has(fieldKey)) {
    if (nextValue === "") return null;
    const parsed = Number(
      String(nextValue)
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, "")
        .replace(/kr|sek|eur|usd/gi, "")
        .replace(",", ".")
    );
    return Number.isFinite(parsed) ? parsed : nextValue;
  }

  return nextValue;
}
