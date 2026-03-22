import { useEffect, useState } from "react";
import { apiFetch } from "../utils/apiClient.js";
import { toUserErrorMessage } from "../utils/errorText.js";

const PROVIDER_LABELS = {
  gmail: "Gmail",
  outlook: "Outlook",
};

const IMPORT_TYPE_LABELS = {
  invoices: "Fakturor",
  receipts: "Kvitton",
  confirmations: "Bekräftelser",
};

export default function MailSyncResultsModal({
  open,
  onClose,
  syncResult,
  onQueueBlockedItem = null,
}) {
  const [activeItemId, setActiveItemId] = useState("");
  const [feedback, setFeedback] = useState({ tone: "", message: "" });

  useEffect(() => {
    if (!open) {
      setActiveItemId("");
      setFeedback({ tone: "", message: "" });
    }
  }, [open]);

  if (!open) return null;

  const result = syncResult && typeof syncResult === "object" ? syncResult : {};
  const items = Array.isArray(result.items) ? result.items : [];
  const stats = result.stats && typeof result.stats === "object" ? result.stats : {};

  async function handleQueueForReview(item) {
    const messageId = String(item?.id || "").trim();
    const providerId = String(item?.provider || result.provider || "").trim().toLowerCase();
    if (!messageId || !providerId) return;

    setActiveItemId(messageId);
    setFeedback({ tone: "", message: "" });

    try {
      const response = await apiFetch(
        `/api/mail-connections/${providerId}/messages/${encodeURIComponent(messageId)}/queue-review`,
        {
          method: "POST",
        }
      );
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Kunde inte skicka mejlet till granskning.");
      }

      onQueueBlockedItem?.(messageId, json);
      setFeedback({
        tone: "success",
        message: String(json.message || "Meddelandet skickades till manuell granskning."),
      });
    } catch (caughtError) {
      setFeedback({
        tone: "error",
        message: toUserErrorMessage(caughtError, "Kunde inte skicka mejlet till granskning."),
      });
    } finally {
      setActiveItemId("");
    }
  }

  return (
    <div className="profile-modal sync-details-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <article
        className="profile-modal-card sync-details-modal-card"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="profile-modal-header sync-details-modal-header">
          <div>
            <h3>{resolveProviderLabel(result.provider)}-synk</h3>
            <p>{String(result.message || "Här ser du resultatet från den senaste mejlsynken.")}</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Stäng
          </button>
        </header>

        <div className="profile-modal-body sync-details-modal-body">
          <section className="profile-section sync-details-summary">
            <div className="sync-details-stat-list">
              <span className="profile-mail-stat-chip">Skannade: {Number(stats.scanned || 0)}</span>
              <span className="profile-mail-stat-chip">Autoimport: {Number(stats.importedMessages || 0)}</span>
              <span className="profile-mail-stat-chip">Granskning: {Number(stats.queuedForReview || 0)}</span>
              <span className="profile-mail-stat-chip">Blockerade: {Number(stats.blocked || 0)}</span>
              <span className="profile-mail-stat-chip">Fel: {Number(stats.errors || 0)}</span>
            </div>
            {feedback.message ? (
              <p className={feedback.tone === "error" ? "sync-detail-feedback-error" : "sync-detail-feedback"}>
                {feedback.message}
              </p>
            ) : null}
          </section>

          <section className="profile-section">
            <h4>Skannade mejl</h4>
            <p>
              Varje rad visar vad som hände med mejlet, varför det klassades så och om det går att
              skicka vidare manuellt.
            </p>

            {items.length === 0 ? (
              <p className="sync-detail-empty">Inga mejldetaljer finns för den här synken ännu.</p>
            ) : (
              <div className="sync-detail-list">
                {items.map((item) => {
                  const attachmentCandidates = Array.isArray(item?.attachmentCandidates)
                    ? item.attachmentCandidates
                    : [];
                  const reasonChips = Array.isArray(item?.classification?.reasons)
                    ? item.classification.reasons
                    : [];
                  const canQueueForReview = Boolean(item?.canQueueForReview);
                  const isQueueing = activeItemId === String(item?.id || "");

                  return (
                    <article key={`${item.id || "mail"}:${item.outcome || "blocked"}`} className="sync-detail-card">
                      <div className="sync-detail-head">
                        <div>
                          <strong>{item.subject || "(saknar ämnesrad)"}</strong>
                          <p>{item.from || "Okänd avsändare"}</p>
                        </div>
                        <span
                          className={`sync-detail-outcome sync-detail-outcome-${resolveOutcomeTone(item.outcome)}`}
                        >
                          {resolveOutcomeLabel(item.outcome)}
                        </span>
                      </div>

                      <div className="sync-detail-meta">
                        <span>Datum: {item.receivedAtIso ? formatTimestamp(item.receivedAtIso) : "Okänt"}</span>
                        {item.selectedType ? <span>Typ: {resolveImportTypeLabel(item.selectedType)}</span> : null}
                        {Number(item?.classification?.score || 0) > 0 ? (
                          <span>Poäng {Number(item.classification.score || 0)}</span>
                        ) : null}
                      </div>

                      {item.outcomeReason ? (
                        <p className="sync-detail-reason">{String(item.outcomeReason)}</p>
                      ) : null}

                      {item.snippet ? (
                        <p className="sync-detail-snippet">{String(item.snippet)}</p>
                      ) : item.textPreview ? (
                        <p className="sync-detail-snippet">{String(item.textPreview).slice(0, 240)}</p>
                      ) : null}

                      {reasonChips.length ? (
                        <div className="sync-detail-chip-list">
                          {reasonChips.map((reason) => (
                            <span key={`${item.id}:${reason}`} className="profile-mail-reason-chip">
                              {reason}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {attachmentCandidates.length ? (
                        <ul className="sync-detail-attachment-list">
                          {attachmentCandidates.map((attachment) => (
                            <li key={`${item.id}:${attachment.attachmentId || attachment.fileName}`}>
                              <span>{attachment.fileName || "Bilaga utan filnamn"}</span>
                              <small>
                                {attachment.mimeType || "okänd typ"}
                                {attachment.likelyDocument ? " · dokument" : " · flaggad"}
                              </small>
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      {canQueueForReview ? (
                        <div className="sync-detail-actions">
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => handleQueueForReview(item)}
                            disabled={Boolean(activeItemId)}
                          >
                            {isQueueing ? "Skickar..." : "Skicka till granskning ändå"}
                          </button>
                          <p className="sync-detail-action-note">
                            Visas bara när AI:n hittade ett dokument men var osäker på om det
                            verkligen är en faktura.
                          </p>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </article>
    </div>
  );
}

function resolveProviderLabel(provider) {
  return PROVIDER_LABELS[String(provider || "").trim().toLowerCase()] || "E-post";
}

function resolveImportTypeLabel(typeId) {
  return IMPORT_TYPE_LABELS[String(typeId || "").trim().toLowerCase()] || "Okänd typ";
}

function resolveOutcomeLabel(outcome) {
  const safeOutcome = String(outcome || "").trim().toLowerCase();
  if (safeOutcome === "imported") return "Autoimporterat";
  if (safeOutcome === "review") return "Granskning";
  if (safeOutcome === "error") return "Fel";
  return "Blockerat";
}

function resolveOutcomeTone(outcome) {
  const safeOutcome = String(outcome || "").trim().toLowerCase();
  if (safeOutcome === "imported") return "ok";
  if (safeOutcome === "review") return "review";
  if (safeOutcome === "error") return "error";
  return "blocked";
}

function formatTimestamp(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Okänt datum";
  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}
