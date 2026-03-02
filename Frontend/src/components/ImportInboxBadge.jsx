import { useEffect, useState } from "react";
import { apiFetch } from "../utils/apiClient.js";
import { toUserErrorMessage } from "../utils/errorText.js";

export default function ImportInboxBadge() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [inboxAddress, setInboxAddress] = useState("");
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState("idle");

  useEffect(() => {
    let cancelled = false;

    async function loadInboxAddress() {
      setLoading(true);
      setError("");
      try {
        const response = await apiFetch("/api/inbox/create", {
          method: "POST",
        });
        const json = await response.json();
        if (!response.ok || !json.ok) {
          throw new Error(json.error || "Kunde inte hämta import-mail.");
        }

        if (!cancelled) {
          setInboxAddress(String(json.inboxAddress || "").trim());
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(toUserErrorMessage(caughtError, "Kunde inte hämta import-mail."));
          setInboxAddress("");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadInboxAddress();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshInboxAddress() {
    setRefreshing(true);
    setError("");
    try {
      const response = await apiFetch("/api/inbox/create", {
        method: "POST",
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Kunde inte uppdatera import-mail.");
      }
      setInboxAddress(String(json.inboxAddress || "").trim());
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, "Kunde inte uppdatera import-mail."));
    } finally {
      setRefreshing(false);
    }
  }

  async function copyInboxAddress() {
    if (!inboxAddress) return;
    try {
      await navigator.clipboard.writeText(inboxAddress);
      setCopyState("copied");
      window.setTimeout(() => {
        setCopyState((prev) => (prev === "copied" ? "idle" : prev));
      }, 1600);
    } catch {
      setCopyState("error");
      window.setTimeout(() => {
        setCopyState((prev) => (prev === "error" ? "idle" : prev));
      }, 1800);
    }
  }

  if (loading) {
    return (
      <div className="import-inbox-chip">
        <span className="import-inbox-label">Maila in fakturor</span>
        <strong className="import-inbox-value">Skapar adress...</strong>
      </div>
    );
  }

  if (error || !inboxAddress) {
    return (
      <div className="import-inbox-chip">
        <span className="import-inbox-label">Maila in fakturor</span>
        <strong className="import-inbox-value">Import-mail saknas</strong>
        <button
          type="button"
          className="import-inbox-copy-btn"
          onClick={refreshInboxAddress}
          disabled={refreshing}
          title="Försök hämta import-mail igen"
          aria-label="Försök hämta import-mail igen"
        >
          {refreshing ? "Laddar..." : "Försök igen"}
        </button>
      </div>
    );
  }

  return (
    <div
      className="import-inbox-chip"
      title="Vidarebefordra PDF eller bildfakturor hit. Analysen sparas automatiskt i historiken."
    >
      <span className="import-inbox-label">Maila in fakturor</span>
      <strong className="import-inbox-value">{inboxAddress}</strong>
      <button
        type="button"
        className="import-inbox-copy-btn"
        onClick={copyInboxAddress}
        aria-label="Kopiera import-mail"
      >
        {copyState === "copied" ? "Kopierad" : copyState === "error" ? "Misslyckades" : "Kopiera"}
      </button>
    </div>
  );
}
