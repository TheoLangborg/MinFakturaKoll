import { useEffect, useState } from "react";
import { apiFetch } from "../utils/apiClient.js";

const DISMISS_KEY = "mfk_mail_auto_hint_dismissed";

export default function MailAutoImportHint({ onOpenSetup }) {
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (readDismissedState()) {
      setLoading(false);
      setVisible(false);
      return () => {
        cancelled = true;
      };
    }

    async function loadStatus() {
      setLoading(true);
      try {
        const response = await apiFetch("/api/mail-connections/status");
        const json = await response.json();
        if (!response.ok || !json.ok) {
          throw new Error(json.error || json.reason || "Mejlstatus kunde inte hämtas.");
        }

        const providers = Array.isArray(json.providers) ? json.providers : [];
        const hasConnectedProvider = providers.some((provider) => Boolean(provider?.connected));
        if (!cancelled) {
          setVisible(!hasConnectedProvider);
        }
      } catch {
        if (!cancelled) {
          setVisible(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  function dismissHint() {
    writeDismissedState();
    setVisible(false);
  }

  if (loading || !visible) {
    return null;
  }

  return (
    <section className="mail-auto-hint" role="note" aria-label="Tips om e-postintegration">
      <div className="mail-auto-hint-copy">
        <span className="mail-auto-hint-kicker">Tips</span>
        <strong>Hämta fakturor direkt från mejlen</strong>
        <p>
          Koppla Gmail eller Outlook i Profil så kan appen hämta tydliga fakturor automatiskt och
          lägga osäkra mejl i manuell granskning.
        </p>
      </div>

      <div className="mail-auto-hint-actions">
        <button type="button" className="btn btn-secondary mail-auto-hint-open" onClick={onOpenSetup}>
          Öppna e-postintegration
        </button>
        <button type="button" className="mail-auto-hint-dismiss" onClick={dismissHint}>
          Senare
        </button>
      </div>
    </section>
  );
}

function readDismissedState() {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(DISMISS_KEY) === "1";
}

function writeDismissedState() {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(DISMISS_KEY, "1");
}
