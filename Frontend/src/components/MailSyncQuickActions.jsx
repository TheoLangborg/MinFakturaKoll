import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../utils/apiClient.js";
import { toUserErrorMessage } from "../utils/errorText.js";

const POLL_INTERVAL_MS = 90 * 1000;

export default function MailSyncQuickActions({
  onOpenSetup,
  onPendingReviewChange,
  onSyncFeedback,
  refreshKey = 0,
}) {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [gmailProvider, setGmailProvider] = useState(null);
  const [error, setError] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      const response = await apiFetch("/api/mail-connections/status");
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || json.reason || "Kunde inte hämta mejlstatus.");
      }

      const providers = Array.isArray(json.providers) ? json.providers : [];
      const connectedGmail =
        providers.find(
          (provider) =>
            String(provider?.provider || "").trim().toLowerCase() === "gmail" && Boolean(provider?.connected)
        ) || null;

      setGmailProvider(connectedGmail);
      setError("");
      onPendingReviewChange?.(Number(connectedGmail?.pendingReviewCount || 0));
    } catch (caughtError) {
      setGmailProvider(null);
      setError(toUserErrorMessage(caughtError, "Kunde inte hämta mejlstatus."));
      onPendingReviewChange?.(0);
    } finally {
      setLoading(false);
    }
  }, [onPendingReviewChange]);

  useEffect(() => {
    setLoading(true);
    void loadStatus();
  }, [loadStatus, refreshKey]);

  useEffect(() => {
    if (!gmailProvider) return undefined;

    const timerId = window.setInterval(() => {
      void loadStatus();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(timerId);
  }, [gmailProvider, loadStatus]);

  async function handleSync() {
    setSyncing(true);
    setError("");

    try {
      const response = await apiFetch("/api/mail-connections/gmail/sync-now", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          maxMessages: 20,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Kunde inte starta mejlsynken.");
      }

      onSyncFeedback?.(String(json.message || "Synkningen är klar."));
      await loadStatus();
    } catch (caughtError) {
      const message = toUserErrorMessage(caughtError, "Kunde inte starta mejlsynken.");
      setError(message);
      onSyncFeedback?.(message, "error");
    } finally {
      setSyncing(false);
    }
  }

  if (loading || !gmailProvider) {
    return null;
  }

  const pendingReviewCount = Number(gmailProvider?.pendingReviewCount || 0);
  const lastSyncText = gmailProvider?.lastSyncAt
    ? formatTimestamp(gmailProvider.lastSyncAt)
    : "Ingen synk ännu";
  const summaryText =
    pendingReviewCount > 0
      ? `${pendingReviewCount} väntar på granskning`
      : `Senaste synk: ${lastSyncText}`;

  return (
    <section className="mail-sync-quick" aria-label="Snabbval för e-postsynk">
      <div className="mail-sync-quick-copy">
        <span className="mail-sync-quick-kicker">Gmail kopplat</span>
        <strong>Mejlsynk</strong>
        <p>{summaryText}</p>
      </div>

      <div className="mail-sync-quick-actions">
        {pendingReviewCount > 0 ? (
          <button type="button" className="btn btn-secondary" onClick={onOpenSetup}>
            Öppna granskning
          </button>
        ) : null}
        <button type="button" className="btn btn-primary" onClick={handleSync} disabled={syncing}>
          {syncing ? "Synkar…" : "Synka mejl"}
        </button>
      </div>

      {error ? <p className="mail-sync-quick-error">{error}</p> : null}
    </section>
  );
}

function formatTimestamp(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Okänt datum";
  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}
