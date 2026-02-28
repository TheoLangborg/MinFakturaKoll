import { useEffect, useMemo, useState } from "react";
import { MAX_FILE_BYTES, MAX_QUEUE_FILES, SAMPLE_TEXT } from "../constants/appConstants.js";
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

const QUEUE_STATUS = {
  pending: "pending",
  processing: "processing",
  done: "done",
  error: "error",
};

export function useInvoiceScanner({ onHistoryChanged } = {}) {
  const [queueItems, setQueueItems] = useState([]);
  const [selectedQueueItemId, setSelectedQueueItemId] = useState("");
  const [activeQueueItemId, setActiveQueueItemId] = useState("");
  const [standaloneText, setStandaloneText] = useState(SAMPLE_TEXT);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [editedExtracted, setEditedExtracted] = useState(null);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [hasUnsyncedHistoryEdit, setHasUnsyncedHistoryEdit] = useState(false);

  const selectedQueueItem = useMemo(() => {
    if (!queueItems.length) return null;
    return queueItems.find((item) => item.id === selectedQueueItemId) || queueItems[0];
  }, [queueItems, selectedQueueItemId]);

  const invoiceFile = selectedQueueItem?.file || null;
  const text = selectedQueueItem ? selectedQueueItem.text : standaloneText;

  const queueProgress = useMemo(() => {
    const total = queueItems.length;
    const done = queueItems.filter((item) => item.status === QUEUE_STATUS.done).length;
    const failed = queueItems.filter((item) => item.status === QUEUE_STATUS.error).length;
    const processing = queueItems.filter((item) => item.status === QUEUE_STATUS.processing).length;
    const pending = queueItems.filter((item) => item.status === QUEUE_STATUS.pending).length;
    return { total, done, failed, processing, pending };
  }, [queueItems]);

  const analyzableQueueCount = useMemo(
    () =>
      queueItems.filter(
        (item) => item.status === QUEUE_STATUS.pending || item.status === QUEUE_STATUS.error
      ).length,
    [queueItems]
  );

  const isQueueBatchComplete = useMemo(
    () =>
      queueProgress.total > 0 &&
      queueProgress.pending === 0 &&
      queueProgress.processing === 0,
    [queueProgress]
  );

  const analyzedFileSummaries = useMemo(() => {
    return queueItems
      .filter((item) => item.status === QUEUE_STATUS.done && item.result)
      .map((item) => {
        const trustPercent = calculateAverageTrustPercent(item.result);
        return {
          id: item.id,
          fileName: item.file?.name || "Okänd fil",
          trustPercent,
          trustLevel: getTrustLevel(trustPercent),
          comment: buildTrustComment(trustPercent, item.result?.extracted),
        };
      });
  }, [queueItems]);

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
    if (!queueItems.length) {
      setSelectedQueueItemId("");
      return;
    }

    const selectedStillExists = queueItems.some((item) => item.id === selectedQueueItemId);
    if (!selectedStillExists) {
      setSelectedQueueItemId(queueItems[0].id);
    }
  }, [queueItems, selectedQueueItemId]);

  useEffect(() => {
    if (!selectedQueueItem) {
      if (!queueItems.length) {
        setResult(null);
        setEditedExtracted(null);
        setWarning("");
      }
      return;
    }

    if (selectedQueueItem.result) {
      setResult(selectedQueueItem.result);
      setWarning(selectedQueueItem.warning || "");
      setError("");
      return;
    }

    setResult(null);
    setEditedExtracted(null);
    if (selectedQueueItem.status === QUEUE_STATUS.error && selectedQueueItem.error) {
      setWarning(selectedQueueItem.error);
    } else {
      setWarning("");
    }
  }, [queueItems.length, selectedQueueItem]);

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

  async function addFiles(files) {
    const incoming = Array.from(files || []);
    if (!incoming.length) return;

    setError("");
    setWarning("");

    const slotsLeft = Math.max(0, MAX_QUEUE_FILES - queueItems.length);
    if (slotsLeft <= 0) {
      setError(`Kön är full. Max ${MAX_QUEUE_FILES} filer kan analyseras samtidigt.`);
      return;
    }

    const acceptedFiles = incoming.slice(0, slotsLeft);
    const skippedByLimit = incoming.length - acceptedFiles.length;

    const prepared = [];
    const itemErrors = [];

    for (const file of acceptedFiles) {
      try {
        const preparedItem = await buildQueueItem(file);
        prepared.push(preparedItem);
      } catch (caughtError) {
        const reason = toUserErrorMessage(caughtError, "okänt fel vid filuppladdning");
        itemErrors.push(`${file.name}: ${reason}`);
      }
    }

    if (prepared.length) {
      setQueueItems((previous) => [...previous, ...prepared]);
      setSelectedQueueItemId((previous) => previous || prepared[0].id);
    }

    if (skippedByLimit > 0 || itemErrors.length > 0) {
      const messages = [];
      if (skippedByLimit > 0) {
        messages.push(
          `${skippedByLimit} fil${skippedByLimit > 1 ? "er" : ""} hoppades över eftersom maxgränsen är ${MAX_QUEUE_FILES}.`
        );
      }
      if (itemErrors.length > 0) {
        messages.push(itemErrors.join(" "));
      }
      setWarning(messages.join(" "));
    }
  }

  function onFileChange(event) {
    const files = event.target.files;
    void addFiles(files);
    event.target.value = "";
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
    const files = event.dataTransfer?.files;
    void addFiles(files);
  }

  function setText(nextText) {
    if (!selectedQueueItemId) {
      setStandaloneText(nextText);
      return;
    }

    setQueueItems((previous) =>
      previous.map((item) => {
        if (item.id !== selectedQueueItemId) return item;
        if (item.status === QUEUE_STATUS.processing) return item;
        return {
          ...item,
          text: nextText,
          status: QUEUE_STATUS.pending,
          error: "",
          warning: "",
          result: null,
        };
      })
    );
  }

  function selectQueueItem(itemId) {
    setSelectedQueueItemId(itemId);
  }

  function showQueueItemResult(itemId) {
    const target = queueItems.find((item) => item.id === itemId);
    if (!target || !target.result) return false;
    setSelectedQueueItemId(itemId);
    setResult(target.result);
    setWarning(target.warning || "");
    setError("");
    return true;
  }

  function removeQueueItem(itemId) {
    if (loading && itemId === activeQueueItemId) return;
    setQueueItems((previous) => previous.filter((item) => item.id !== itemId));
  }

  async function analyze() {
    if (loading) return;

    if (!queueItems.length) {
      await analyzeStandaloneText();
      return;
    }

    const targets = queueItems.filter(
      (item) => item.status === QUEUE_STATUS.pending || item.status === QUEUE_STATUS.error
    );

    if (!targets.length) {
      setWarning("Alla filer i kön är redan analyserade.");
      return;
    }

    await analyzeQueueItems(targets, { mode: "all" });
  }

  async function analyzeSelected() {
    if (loading) return;

    if (!selectedQueueItem) {
      setWarning("Välj en fil i kön först.");
      return;
    }

    if (selectedQueueItem.status === QUEUE_STATUS.processing) {
      setWarning("Den valda filen analyseras redan.");
      return;
    }

    await analyzeQueueItems([selectedQueueItem], { mode: "single" });
  }

  async function analyzeQueueItems(targets, { mode }) {
    if (!Array.isArray(targets) || !targets.length) return;

    setLoading(true);
    setError("");
    setWarning("");

    let successCount = 0;
    let failedCount = 0;

    for (const queueItem of targets) {
      setActiveQueueItemId(queueItem.id);
      setSelectedQueueItemId(queueItem.id);
      setQueueItems((previous) =>
        previous.map((item) =>
          item.id === queueItem.id
            ? { ...item, status: QUEUE_STATUS.processing, error: "", warning: "" }
            : item
        )
      );

      try {
        const payload = buildPayloadFromQueueItem(queueItem);
        if (!payload) {
          throw new Error("Filen saknar fakturatext och kunde inte analyseras.");
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

        successCount += 1;
        setResult(json);
        setWarning(json.warning || "");
        setQueueItems((previous) =>
          previous.map((item) =>
            item.id === queueItem.id
              ? {
                  ...item,
                  status: QUEUE_STATUS.done,
                  error: "",
                  warning: json.warning || "",
                  result: json,
                }
              : item
          )
        );
      } catch (caughtError) {
        failedCount += 1;
        const message = toUserErrorMessage(caughtError, "Analysen kunde inte genomföras.");
        setQueueItems((previous) =>
          previous.map((item) =>
            item.id === queueItem.id
              ? {
                  ...item,
                  status: QUEUE_STATUS.error,
                  error: message,
                  warning: "",
                }
              : item
          )
        );
      }
    }

    setActiveQueueItemId("");
    setLoading(false);

    if (failedCount > 0) {
      if (successCount > 0) {
        if (mode === "single") {
          setWarning("Filen analyserades med varningar. Kontrollera resultatet.");
          return;
        }
        setWarning(`Klart. ${successCount} fil(er) analyserades, ${failedCount} misslyckades.`);
      } else if (mode === "single") {
        setError("Den valda filen kunde inte analyseras.");
      } else {
        setError("Ingen fil kunde analyseras. Kontrollera köstatus och försök igen.");
      }
      return;
    }

    if (mode === "single") {
      setWarning("Klar. Vald fil analyserades.");
      return;
    }
    setWarning(`Klart. ${successCount} fil(er) analyserades.`);
  }

  async function analyzeStandaloneText() {
    if (!standaloneText.trim()) {
      setError("Lägg till fakturatext eller ladda upp en fakturafil innan analys.");
      return;
    }

    setLoading(true);
    setError("");
    setWarning("");
    setResult(null);

    try {
      const response = await apiFetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: standaloneText.trim() }),
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
      const nextExtracted = {
        ...current,
        [fieldKey]: normalizeEditedValue(fieldKey, nextValue),
      };

      if (selectedQueueItemId) {
        setQueueItems((previousQueue) =>
          previousQueue.map((item) =>
            item.id === selectedQueueItemId && item.result
              ? {
                  ...item,
                  result: {
                    ...item.result,
                    extracted: nextExtracted,
                  },
                }
              : item
          )
        );
      }

      return nextExtracted;
    });
    setHasUnsyncedHistoryEdit(true);
  }

  function clearAll() {
    setQueueItems([]);
    setSelectedQueueItemId("");
    setActiveQueueItemId("");
    setStandaloneText("");
    setPreviewModalOpen(false);
    setResult(null);
    setEditedExtracted(null);
    setHasUnsyncedHistoryEdit(false);
    setError("");
    setWarning("");
    setSelectedTemplateId("");
  }

  function openPreview() {
    if (!invoiceFile) return;
    setPreviewModalOpen(true);
  }

  function closePreview() {
    setPreviewModalOpen(false);
  }

  return {
    invoiceFile,
    queueItems,
    queueProgress,
    analyzableQueueCount,
    analyzedFileSummaries,
    isQueueBatchComplete,
    selectedQueueItemId,
    activeQueueItemId,
    maxQueueFiles: MAX_QUEUE_FILES,
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
    onSelectQueueItem: selectQueueItem,
    onShowQueueItemResult: showQueueItemResult,
    onRemoveQueueItem: removeQueueItem,
    analyze,
    analyzeSelected,
    copyEmail,
    selectTemplate,
    updateExtractedField,
    clearAll,
    openPreview,
    closePreview,
  };
}

async function buildQueueItem(file) {
  if (!file) {
    throw new Error("Ingen fil valdes.");
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Filen är för stor. Maxstorlek är 10 MB.");
  }

  const fileType = normalizeFileType(file);
  const fileInfo = {
    name: file.name,
    size: file.size,
    type: fileType,
    previewKind: "unknown",
    previewSrc: "",
    textPreview: "",
  };

  let text = "";

  if (isTextType(fileType, file.name)) {
    const content = await file.text();
    const trimmed = content.trim();
    fileInfo.previewKind = "text";
    fileInfo.textPreview = trimmed || "(Tom textfil)";
    text = trimmed;
    return createQueueItem(fileInfo, text);
  }

  if (isImageType(fileType)) {
    fileInfo.previewKind = "image";
    fileInfo.previewSrc = await readAsDataUrl(file);
    return createQueueItem(fileInfo, text);
  }

  if (isPdfType(fileType, file.name)) {
    fileInfo.previewKind = "pdf";
    fileInfo.previewSrc = await readAsDataUrl(file);
    text = `Fakturafil: ${file.name}\nPDF laddad. Komplettera OCR-text vid behov.`;
    return createQueueItem(fileInfo, text);
  }

  throw new Error("Filtypen kunde inte förhandsvisas. Prova PDF, bild eller textfil.");
}

function createQueueItem(fileInfo, text) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    file: fileInfo,
    text,
    status: QUEUE_STATUS.pending,
    error: "",
    warning: "",
    result: null,
  };
}

function buildPayloadFromQueueItem(queueItem) {
  const hasVisualFile =
    queueItem.file.previewKind === "image" || queueItem.file.previewKind === "pdf";
  const trimmedText = String(queueItem.text || "").trim();

  if (!trimmedText && !hasVisualFile) {
    return null;
  }

  const payload = { text: trimmedText };
  if (hasVisualFile) {
    payload.file = {
      name: queueItem.file.name,
      type: queueItem.file.type,
      dataUrl: queueItem.file.previewSrc,
    };
  }
  return payload;
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
  } catch (caughtError) {
    onError?.(
      toUserErrorMessage(
        caughtError,
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

function calculateAverageTrustPercent(result) {
  const fieldMeta = result?.fieldMeta;
  if (!fieldMeta || typeof fieldMeta !== "object") return null;

  const values = Object.values(fieldMeta)
    .map((meta) => Number(meta?.confidence))
    .filter((value) => Number.isFinite(value));

  if (!values.length) return null;
  return Math.round((values.reduce((acc, value) => acc + value, 0) / values.length) * 100);
}

function getTrustLevel(trustPercent) {
  if (!Number.isFinite(trustPercent)) return "unknown";
  if (trustPercent >= 85) return "high";
  if (trustPercent >= 65) return "medium";
  return "low";
}

function buildTrustComment(trustPercent, extracted) {
  const missingCount = countMissingCoreFields(extracted);
  if (!Number.isFinite(trustPercent)) {
    return "Tillförlitlighet saknas för den här filen. Kontrollera fälten manuellt.";
  }

  if (trustPercent >= 85) {
    if (missingCount > 0) {
      return `Hög träffsäkerhet, men ${missingCount} nyckelfält bör kontrolleras.`;
    }
    return "Hög träffsäkerhet. Resultatet är redo att användas direkt.";
  }

  if (trustPercent >= 65) {
    if (missingCount > 0) {
      return `Bra grundresultat. Dubbelkolla ${missingCount} nyckelfält innan du skickar åtgärd.`;
    }
    return "Bra resultat. Gör en snabb manuell kontroll av belopp och datum.";
  }

  return "Lägre tillförlitlighet. Granska fakturan noggrant och komplettera manuellt vid behov.";
}

function countMissingCoreFields(extracted) {
  if (!extracted || typeof extracted !== "object") return 0;

  let missing = 0;
  if (!String(extracted.vendorName || "").trim()) missing += 1;
  if (!String(extracted.invoiceNumber || "").trim()) missing += 1;
  if (!String(extracted.dueDate || "").trim()) missing += 1;
  if (extracted.totalAmount == null || extracted.totalAmount === "") missing += 1;

  const hasCustomer = String(extracted.customerNumber || "").trim();
  const hasOcr = String(extracted.ocrNumber || "").trim();
  if (!hasCustomer && !hasOcr) missing += 1;

  return missing;
}
