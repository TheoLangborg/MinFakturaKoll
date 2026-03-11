import { useCallback, useEffect, useMemo, useState } from "react";
import { LEGAL_POLICY_VERSIONS } from "../constants/legalContent.js";
import { apiFetch } from "../utils/apiClient.js";
import { toUserErrorMessage } from "../utils/errorText.js";

const CONSENT_ITEMS = [
  {
    id: "privacyAccepted",
    label: "Jag har läst integritetspolicyn och förstår personuppgiftsbehandlingen.",
  },
  {
    id: "termsAccepted",
    label: "Jag accepterar användarvillkoren för e-postimport och automatisk analys.",
  },
  {
    id: "cookiesAccepted",
    label: "Jag godkänner nödvändig lagring för sessions- och OAuth-säkerhet.",
  },
  {
    id: "securityAccepted",
    label: "Jag förstår att jag kan koppla från kontot när som helst i Profil.",
  },
  {
    id: "oauthDataUseAccepted",
    label: "Jag godkänner att endast relevanta dokument och metadata behandlas för import.",
  },
];

const INITIAL_CONSENT = CONSENT_ITEMS.reduce((acc, item) => {
  acc[item.id] = false;
  return acc;
}, {});

const DEFAULT_IMPORT_TYPES = Object.freeze({
  invoices: true,
  receipts: false,
  confirmations: false,
});

const REVIEW_LIMIT = 12;

const PROVIDER_LABELS = {
  gmail: "Gmail",
  outlook: "Outlook",
};

const IMPORT_TYPE_LABELS = {
  invoices: {
    title: "Fakturor",
    description: "Prioriterar PDF och bildbilagor med starka fakturasignaler.",
  },
  receipts: {
    title: "Kvitton",
    description: "Tillåt kvitton med bilagor eller tydlig betalningsbekräftelse.",
  },
  confirmations: {
    title: "Bekräftelser",
    description: "Förberedd för framtida order- och bokningsbekräftelser.",
  },
};

export default function MailConnectionSection({
  isOpen,
  disabled = false,
  onConnectionsUpdated = null,
}) {
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState([]);
  const [providerSettings, setProviderSettings] = useState({});
  const [reviewsByProvider, setReviewsByProvider] = useState({});
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [consent, setConsent] = useState(INITIAL_CONSENT);
  const [activeAction, setActiveAction] = useState("");

  const allConsentsAccepted = useMemo(
    () => CONSENT_ITEMS.every((item) => Boolean(consent[item.id])),
    [consent]
  );

  const fetchReviewsForProvider = useCallback(async (providerId) => {
    if (String(providerId || "").trim().toLowerCase() !== "gmail") {
      return [];
    }

    const response = await apiFetch(
      `/api/mail-connections/${providerId}/reviews?limit=${encodeURIComponent(REVIEW_LIMIT)}`
    );
    const json = await response.json();
    if (!response.ok || !json.ok) {
      throw new Error(json.error || "Kunde inte hämta granskningskön.");
    }
    return Array.isArray(json.items) ? json.items : [];
  }, []);

  const loadStatus = useCallback(
    async ({ preserveMessages = false } = {}) => {
      setLoading(true);
      if (!preserveMessages) {
        setError("");
        setInfo("");
      }

      try {
        const response = await apiFetch("/api/mail-connections/status");
        const json = await response.json();
        if (!response.ok || !json.ok) {
          throw new Error(json.error || json.reason || "Kunde inte hämta mejlkopplingar.");
        }

        const nextProviders = Array.isArray(json.providers) ? json.providers : [];
        setProviders(nextProviders);
        setProviderSettings(buildProviderSettings(nextProviders));

        const nextReviews = {};
        if (nextProviders.some((provider) => provider?.provider === "gmail" && provider?.connected)) {
          nextReviews.gmail = await fetchReviewsForProvider("gmail");
        }
        setReviewsByProvider(nextReviews);
        onConnectionsUpdated?.();

        if (json.encryptionWarning && !preserveMessages) {
          setError(String(json.encryptionWarning));
        }
      } catch (caughtError) {
        setProviders([]);
        setReviewsByProvider({});
        setError(toUserErrorMessage(caughtError, "Kunde inte hämta mejlkopplingar."));
      } finally {
        setLoading(false);
      }
    },
    [fetchReviewsForProvider, onConnectionsUpdated]
  );

  useEffect(() => {
    if (!isOpen) return;

    const callbackMessage = consumeMailOauthParams();
    if (callbackMessage) {
      if (callbackMessage.status === "success") {
        setInfo(callbackMessage.message);
        setError("");
      } else if (callbackMessage.status === "error") {
        setError(callbackMessage.message);
        setInfo("");
      }
    }

    void loadStatus({
      preserveMessages: Boolean(callbackMessage),
    });
  }, [isOpen, loadStatus]);

  async function handleConnect(providerId) {
    if (!allConsentsAccepted) {
      setError("Du måste godkänna samtliga samtycken innan du kan koppla konto.");
      return;
    }

    setActiveAction(`${providerId}:connect`);
    setError("");
    setInfo("");

    try {
      const response = await apiFetch(`/api/mail-connections/connect/${providerId}/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          consent,
          policyVersions: LEGAL_POLICY_VERSIONS,
          returnPath: buildSafeReturnPath(),
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Kunde inte starta OAuth-kopplingen.");
      }

      const authorizationUrl = String(json.authorizationUrl || "").trim();
      if (!authorizationUrl) {
        throw new Error("OAuth-kopplingen kunde inte startas eftersom authorizationUrl saknas.");
      }

      setInfo(`Omdirigerar till ${resolveProviderLabel(providerId)} för godkännande...`);
      window.location.assign(authorizationUrl);
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, "Kunde inte starta OAuth-kopplingen."));
      setActiveAction("");
    }
  }

  async function handleDisconnect(providerId) {
    setActiveAction(`${providerId}:disconnect`);
    setError("");
    setInfo("");

    try {
      const response = await apiFetch(`/api/mail-connections/disconnect/${providerId}`, {
        method: "POST",
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Kunde inte koppla från kontot.");
      }

      setInfo(`${resolveProviderLabel(providerId)} är frånkopplat.`);
      await loadStatus({ preserveMessages: true });
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, "Kunde inte koppla från kontot."));
    } finally {
      setActiveAction("");
    }
  }

  function handleImportTypeChange(providerId, typeId, checked) {
    setProviderSettings((prev) => ({
      ...prev,
      [providerId]: {
        ...normalizeImportTypes(prev[providerId]),
        [typeId]: checked,
      },
    }));
  }

  async function handleSaveSettings(providerId) {
    setActiveAction(`${providerId}:save-settings`);
    setError("");
    setInfo("");

    try {
      const importTypes = normalizeImportTypes(providerSettings[providerId]);
      const response = await apiFetch(`/api/mail-connections/${providerId}/settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ importTypes }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Kunde inte spara importreglerna.");
      }

      setInfo(`${resolveProviderLabel(providerId)} uppdaterades. Osäkra mejl hamnar i granskning.`);
      await loadStatus({ preserveMessages: true });
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, "Kunde inte spara importreglerna."));
    } finally {
      setActiveAction("");
    }
  }

  async function handleSyncNow(providerId) {
    setActiveAction(`${providerId}:sync`);
    setError("");
    setInfo("");

    try {
      const response = await apiFetch(`/api/mail-connections/${providerId}/sync-now`, {
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

      setInfo(String(json.message || "Synken ar klar."));
      await loadStatus({ preserveMessages: true });
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, "Kunde inte starta mejlsynken."));
    } finally {
      setActiveAction("");
    }
  }

  async function handleReviewAction(providerId, reviewId, action) {
    setActiveAction(`${providerId}:${action}:${reviewId}`);
    setError("");
    setInfo("");

    try {
      const response = await apiFetch(
        `/api/mail-connections/${providerId}/reviews/${reviewId}/${action === "approve" ? "approve" : "reject"}`,
        {
          method: "POST",
        }
      );
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Kunde inte behandla granskningsposten.");
      }

      setInfo(
        action === "approve"
          ? "Meddelandet godkändes och dokumentbilagorna lades i importkön."
          : "Meddelandet avvisades och kommer inte laddas upp."
      );
      await loadStatus({ preserveMessages: true });
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, "Kunde inte behandla granskningsposten."));
    } finally {
      setActiveAction("");
    }
  }

  return (
    <section className="profile-section profile-mail-section">
      <h4>E-postintegration (OAuth)</h4>
      <p>
        Koppla Gmail eller Outlook för att kunna synka fakturadokument med minsta möjliga
        behörighet och manuell granskning för osäkra mejl.
      </p>
      <p className="profile-mail-note">
        Endast tydliga dokument kan autoimporteras. Tveksamma mejl väntar på godkännande i appen
        innan någon bilaga laddas upp.
      </p>

      <div className="profile-mail-consent-list">
        {CONSENT_ITEMS.map((item) => (
          <label key={item.id} className="profile-mail-consent-item">
            <input
              type="checkbox"
              checked={Boolean(consent[item.id])}
              onChange={(event) =>
                setConsent((prev) => ({
                  ...prev,
                  [item.id]: event.target.checked,
                }))
              }
              disabled={disabled || loading || Boolean(activeAction)}
            />
            <span>{item.label}</span>
          </label>
        ))}
      </div>

      <p className="profile-mail-version">
        Policyversioner: privacy {LEGAL_POLICY_VERSIONS.privacy}, terms {LEGAL_POLICY_VERSIONS.terms},
        cookies {LEGAL_POLICY_VERSIONS.cookies}, security {LEGAL_POLICY_VERSIONS.security}, oauth{" "}
        {LEGAL_POLICY_VERSIONS.oauth}
      </p>

      <div className="profile-mail-provider-list">
        {loading && providers.length === 0 ? (
          <p>Laddar kopplingar...</p>
        ) : (
          listProvidersWithFallback(providers).map((provider) => {
            const providerId = String(provider.provider || "").trim().toLowerCase();
            const connected = Boolean(provider.connected);
            const configured = Boolean(provider.configured);
            const settings = normalizeImportTypes(providerSettings[providerId] || provider.importTypes);
            const reviewItems = Array.isArray(reviewsByProvider[providerId]) ? reviewsByProvider[providerId] : [];

            return (
              <article key={providerId} className="profile-mail-provider-card">
                <div className="profile-mail-provider-body">
                  <div>
                    <h5>{resolveProviderLabel(providerId)}</h5>
                    <p className={connected ? "profile-mail-status connected" : "profile-mail-status"}>
                      {connected ? "Kopplat" : "Inte kopplat"}
                    </p>
                    {provider.accountEmail ? (
                      <p className="profile-mail-meta">Konto: {provider.accountEmail}</p>
                    ) : null}
                    {!configured ? (
                      <p className="profile-mail-meta">
                      OAuth är inte aktiverat i backend för {resolveProviderLabel(providerId)}.
                      </p>
                    ) : null}
                    {provider.warning ? <p className="profile-mail-warning">{provider.warning}</p> : null}
                  </div>

                  <div className="profile-mail-provider-actions">
                    {connected ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => handleDisconnect(providerId)}
                        disabled={disabled || loading || isProviderBusy(activeAction, providerId)}
                      >
                        {activeAction === `${providerId}:disconnect` ? "Kopplar från..." : "Koppla från"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => handleConnect(providerId)}
                        disabled={
                          disabled ||
                          loading ||
                          isProviderBusy(activeAction, providerId) ||
                          !configured ||
                          !allConsentsAccepted
                        }
                      >
                        {activeAction === `${providerId}:connect`
                          ? "Startar..."
                          : `Koppla ${resolveProviderLabel(providerId)}`}
                      </button>
                    )}
                  </div>
                </div>

                {connected && providerId === "gmail" ? (
                  <div className="profile-mail-controls">
                    <div className="profile-mail-settings-panel">
                      <div className="profile-mail-panel-head">
                        <div>
                          <h6>Importregler</h6>
                          <p>Välj vilka dokumenttyper som får skannas. Övrigt blockeras.</p>
                        </div>
                        <span className={`profile-mail-sync-chip profile-mail-sync-chip-${resolveSyncTone(provider)}`}>
                          {resolveSyncLabel(provider.lastSyncStatus || "")}
                        </span>
                      </div>

                      <div className="profile-mail-type-grid">
                        {Object.entries(IMPORT_TYPE_LABELS).map(([typeId, item]) => (
                          <label key={typeId} className="profile-mail-type-card">
                            <input
                              type="checkbox"
                              checked={Boolean(settings[typeId])}
                              onChange={(event) => handleImportTypeChange(providerId, typeId, event.target.checked)}
                              disabled={disabled || loading || isProviderBusy(activeAction, providerId)}
                            />
                            <div>
                              <strong>{item.title}</strong>
                              <span>{item.description}</span>
                            </div>
                          </label>
                        ))}
                      </div>

                      <div className="profile-mail-action-row">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => handleSaveSettings(providerId)}
                          disabled={disabled || loading || isProviderBusy(activeAction, providerId)}
                        >
                          {activeAction === `${providerId}:save-settings` ? "Sparar..." : "Spara regler"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => handleSyncNow(providerId)}
                          disabled={disabled || loading || isProviderBusy(activeAction, providerId)}
                        >
                          {activeAction === `${providerId}:sync` ? "Synkar..." : "Synka nu"}
                        </button>
                      </div>

                      <div className="profile-mail-sync-summary">
                        <p>
                          Senaste synk: <strong>{provider.lastSyncAt ? formatTimestamp(provider.lastSyncAt) : "Ingen synk än"}</strong>
                        </p>
                        <p>{provider.lastSyncMessage || "Ingen tidigare synk."}</p>
                        <div className="profile-mail-stat-list">
                          <span className="profile-mail-stat-chip">
                            Autoimport: {Number(provider?.lastSyncStats?.importedMessages || 0)}
                          </span>
                          <span className="profile-mail-stat-chip">
                            Granskning: {Number(provider?.pendingReviewCount || reviewItems.length || 0)}
                          </span>
                          <span className="profile-mail-stat-chip">
                            Blockerade: {Number(provider?.lastSyncStats?.blocked || 0)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="profile-mail-review-panel">
                      <div className="profile-mail-panel-head">
                        <div>
                          <h6>Manuell granskning</h6>
                          <p>Dessa mejl är inte tillräckligt tydliga för autoimport och väntar på ditt beslut.</p>
                        </div>
                        <span className="profile-mail-review-count">{reviewItems.length} väntar</span>
                      </div>

                      {reviewItems.length === 0 ? (
                        <p className="profile-mail-empty">Inga mejl väntar på granskning just nu.</p>
                      ) : (
                        <div className="profile-mail-review-list">
                          {reviewItems.map((item) => (
                            <article key={item.id} className="profile-mail-review-card">
                              <div className="profile-mail-review-head">
                                <div>
                                  <strong>{item.subject || "(saknar ämnesrad)"}</strong>
                                  <p>{item.from || "Okänd avsändare"}</p>
                                </div>
                                <span className="profile-mail-review-score">
                                  Score {Number(item?.classification?.score || 0)}
                                </span>
                              </div>

                              <div className="profile-mail-review-meta">
                                <span>Typ: {resolveImportTypeLabel(item.selectedType)}</span>
                                <span>Datum: {item.receivedAtIso ? formatTimestamp(item.receivedAtIso) : "Okänt"}</span>
                              </div>

                              {item.snippet ? <p className="profile-mail-review-snippet">{item.snippet}</p> : null}
                              {Array.isArray(item?.classification?.reasons) && item.classification.reasons.length ? (
                                <div className="profile-mail-reason-list">
                                  {item.classification.reasons.map((reason) => (
                                    <span key={reason} className="profile-mail-reason-chip">
                                      {reason}
                                    </span>
                                  ))}
                                </div>
                              ) : null}

                              {Array.isArray(item.attachmentCandidates) && item.attachmentCandidates.length ? (
                                <ul className="profile-mail-attachment-list">
                                  {item.attachmentCandidates.map((attachment) => (
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

                              <div className="profile-mail-review-actions">
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  onClick={() => handleReviewAction(providerId, item.id, "approve")}
                                  disabled={disabled || loading || Boolean(activeAction)}
                                >
                                  {activeAction === `${providerId}:approve:${item.id}` ? "Godkänner..." : "Godkänn och importera"}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-danger"
                                  onClick={() => handleReviewAction(providerId, item.id, "reject")}
                                  disabled={disabled || loading || Boolean(activeAction)}
                                >
                                  {activeAction === `${providerId}:reject:${item.id}` ? "Avvisar..." : "Avvisa"}
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {connected && providerId === "outlook" ? (
                  <p className="profile-mail-meta">
                    Strikt dokumentimport med granskningskö är förberedd för Gmail nu. Outlook kopplas på i nästa steg.
                  </p>
                ) : null}
              </article>
            );
          })
        )}
      </div>

      {error ? <p className="profile-inline-error">{error}</p> : null}
      {info ? <p className="placeholder-text">{info}</p> : null}
    </section>
  );
}

function buildSafeReturnPath() {
  if (typeof window === "undefined") return "/";

  const url = new URL(window.location.href);
  url.searchParams.delete("mail_oauth_status");
  url.searchParams.delete("mail_oauth_provider");
  url.searchParams.delete("mail_oauth_message");

  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ""}${url.hash || ""}`;
}

function consumeMailOauthParams() {
  if (typeof window === "undefined") return null;

  const url = new URL(window.location.href);
  const status = String(url.searchParams.get("mail_oauth_status") || "").trim();
  if (!status) return null;

  const providerId = String(url.searchParams.get("mail_oauth_provider") || "").trim().toLowerCase();
  const providerLabel = resolveProviderLabel(providerId);
  const rawMessage = String(url.searchParams.get("mail_oauth_message") || "").trim();
  const message =
    rawMessage ||
    (status === "success"
      ? `${providerLabel} är nu kopplat.`
      : `Kopplingen mot ${providerLabel} kunde inte genomföras.`);

  url.searchParams.delete("mail_oauth_status");
  url.searchParams.delete("mail_oauth_provider");
  url.searchParams.delete("mail_oauth_message");
  const nextSearch = url.searchParams.toString();
  const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash || ""}`;
  window.history.replaceState({}, "", nextUrl);

  return { status, message };
}

function buildProviderSettings(providers) {
  return listProvidersWithFallback(providers).reduce((acc, provider) => {
    const providerId = String(provider.provider || "").trim().toLowerCase();
    acc[providerId] = normalizeImportTypes(provider.importTypes);
    return acc;
  }, {});
}

function normalizeImportTypes(importTypes) {
  const source = importTypes && typeof importTypes === "object" ? importTypes : {};
  return {
    ...DEFAULT_IMPORT_TYPES,
    invoices: source.invoices !== false,
    receipts: Boolean(source.receipts),
    confirmations: Boolean(source.confirmations),
  };
}

function listProvidersWithFallback(providers) {
  if (Array.isArray(providers) && providers.length) {
    return providers;
  }
  return [
    { provider: "gmail", connected: false, configured: false, accountEmail: "" },
    { provider: "outlook", connected: false, configured: false, accountEmail: "" },
  ];
}

function resolveProviderLabel(providerId) {
  return PROVIDER_LABELS[String(providerId || "").trim().toLowerCase()] || "E-post";
}

function resolveImportTypeLabel(typeId) {
  return IMPORT_TYPE_LABELS[String(typeId || "").trim().toLowerCase()]?.title || "Okänd typ";
}

function resolveSyncLabel(status) {
  const safeStatus = String(status || "").trim().toLowerCase();
  if (safeStatus === "ok") return "Redo";
  if (safeStatus === "warning") return "Varning";
  if (safeStatus === "error") return "Fel";
  return "Ej synkad";
}

function resolveSyncTone(provider) {
  const safeStatus = String(provider?.lastSyncStatus || "").trim().toLowerCase();
  if (safeStatus === "ok") return "ok";
  if (safeStatus === "warning") return "warning";
  if (safeStatus === "error") return "error";
  return "idle";
}

function formatTimestamp(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Okänt datum";
  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function isProviderBusy(activeAction, providerId) {
  return String(activeAction || "").startsWith(`${providerId}:`);
}
