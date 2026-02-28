import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../utils/apiClient.js";
import { toUserErrorMessage } from "../utils/errorText.js";

export function useInvoiceHistory({ enabled: authEnabled = true } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [historyEnabled, setHistoryEnabled] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (!authEnabled) {
        setItems([]);
        setWarning("");
        setHistoryEnabled(false);
        return;
      }

      const response = await apiFetch("/api/history?limit=60");
      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Kunde inte hämta historik.");
      }

      setItems(Array.isArray(json.items) ? json.items : []);
      setWarning(json.warning || "");
      setHistoryEnabled(Boolean(json.enabled));
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, "Historiken kunde inte hämtas just nu."));
      setItems([]);
      setHistoryEnabled(false);
    } finally {
      setLoading(false);
    }
  }, [authEnabled]);

  async function updateOne(id, extracted = {}) {
    if (!id) return false;

    setMutating(true);
    setError("");
    try {
      const response = await apiFetch(`/api/history/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extracted }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Kunde inte uppdatera posten.");
      }

      setItems((previous) =>
        previous.map((item) => {
          if (item.id !== id) return item;
          const dueDate = extracted?.dueDate || null;
          return {
            ...item,
            ...extracted,
            dueDate,
            status: inferStatus(dueDate),
          };
        })
      );

      return true;
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, "Kunde inte uppdatera historikposten."));
      return false;
    } finally {
      setMutating(false);
    }
  }

  async function deleteOne(id) {
    if (!id) return false;

    setMutating(true);
    setError("");
    try {
      const response = await apiFetch(`/api/history/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Kunde inte radera posten.");
      }

      setItems((previous) => previous.filter((item) => item.id !== id));
      return true;
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, "Kunde inte radera historikposten."));
      return false;
    } finally {
      setMutating(false);
    }
  }

  async function deleteMany(ids = []) {
    const safeIds = [...new Set(ids.filter(Boolean))];
    if (!safeIds.length) return false;

    setMutating(true);
    setError("");
    try {
      const response = await apiFetch("/api/history/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: safeIds }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Kunde inte radera markerade poster.");
      }

      const idSet = new Set(safeIds);
      setItems((previous) => previous.filter((item) => !idSet.has(item.id)));
      return true;
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, "Kunde inte radera markerade historikposter."));
      return false;
    } finally {
      setMutating(false);
    }
  }

  async function deleteAll() {
    setMutating(true);
    setError("");
    try {
      const response = await apiFetch("/api/history/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Kunde inte radera all historik.");
      }

      setItems([]);
      return true;
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, "Kunde inte radera all historik."));
      return false;
    } finally {
      setMutating(false);
    }
  }

  useEffect(() => {
    if (!authEnabled) {
      setItems([]);
      setWarning("");
      setError("");
      setHistoryEnabled(false);
      return;
    }
    void loadHistory();
  }, [authEnabled, loadHistory]);

  return {
    items,
    loading,
    mutating,
    error,
    warning,
    enabled: historyEnabled,
    loadHistory,
    updateOne,
    deleteOne,
    deleteMany,
    deleteAll,
  };
}

function inferStatus(dueDate) {
  if (!dueDate) return "Okänt";
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return "Okänt";

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return "Förfallen";
  if (diffDays <= 7) return "Förfaller snart";
  return "Aktiv";
}
