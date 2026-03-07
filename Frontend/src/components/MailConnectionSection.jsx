import { useEffect, useMemo, useState } from "react";
import { LEGAL_POLICY_VERSIONS } from "../constants/legalContent.js";
import { apiFetch } from "../utils/apiClient.js";
import { toUserErrorMessage } from "../utils/errorText.js";

const CONSENT_ITEMS = [
  {
    id: "privacyAccepted",
    label: "Jag har last integritetspolicyn och forstar personuppgiftsbehandlingen.",
  },
  {
    id: "termsAccepted",
    label: "Jag accepterar anvandarvillkoren for e-postimport och automatisk analys.",
  },
  {
    id: "cookiesAccepted",
    label: "Jag godkanner nodvandig lagring for sessions- och OAuth-sakerhet.",
  },
  {
    id: "securityAccepted",
    label: "Jag forstar att jag kan koppla fran kontot nar som helst i Profil.",
  },
  {
    id: "oauthDataUseAccepted",
    label: "Jag godkanner att endast fakturarelaterad metadata och bilagor behandlas for import.",
  },
];

const INITIAL_CONSENT = CONSENT_ITEMS.reduce((acc, item) => {
  acc[item.id] = false;
  return acc;
}, {});

const PROVIDER_LABELS = {
  gmail: "Gmail",
  outlook: "Outlook",
};

export default function MailConnectionSection({ isOpen, disabled = false }) {
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState([]);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [consent, setConsent] = useState(INITIAL_CONSENT);
  const [activeProvider, setActiveProvider] = useState("");

  const allConsentsAccepted = useMemo(
    () => CONSENT_ITEMS.every((item) => Boolean(consent[item.id])),
    [consent]
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

    void loadStatus();
  }, [isOpen]);

  async function loadStatus() {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch("/api/mail-connections/status");
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || json.reason || "Kunde inte hamta mailkopplingar.");
      }
      setProviders(Array.isArray(json.providers) ? json.providers : []);
      if (json.encryptionWarning) {
        setError(String(json.encryptionWarning));
      }
    } catch (caughtError) {
      setProviders([]);
      setError(toUserErrorMessage(caughtError, "Kunde inte hamta mailkopplingar."));
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect(providerId) {
    if (!allConsentsAccepted) {
      setError("Du maste godkanna samtliga samtycken innan du kan koppla konto.");
      return;
    }

    setActiveProvider(providerId);
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

      setInfo(`Omdirigerar till ${resolveProviderLabel(providerId)} for godkannande...`);
      window.location.assign(authorizationUrl);
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, "Kunde inte starta OAuth-kopplingen."));
    } finally {
      setActiveProvider("");
    }
  }

  async function handleDisconnect(providerId) {
    setActiveProvider(providerId);
    setError("");
    setInfo("");
    try {
      const response = await apiFetch(`/api/mail-connections/disconnect/${providerId}`, {
        method: "POST",
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Kunde inte koppla fran kontot.");
      }

      setInfo(`${resolveProviderLabel(providerId)} ar fran kopplat.`);
      await loadStatus();
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, "Kunde inte koppla fran kontot."));
    } finally {
      setActiveProvider("");
    }
  }

  return (
    <section className="profile-section profile-mail-section">
      <h4>E-postintegration (OAuth)</h4>
      <p>
        Koppla Gmail eller Outlook for att i framtiden kunna importera fakturor automatiskt med ditt
        uttryckliga godkannande.
      </p>
      <p className="profile-mail-note">
        Vi begar enbart lasbehorighet till mail och lagrar krypterade token. Du kan nar som helst
        koppla fran kontot.
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
              disabled={disabled || loading || Boolean(activeProvider)}
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
            const busy = activeProvider === providerId;
            const connected = Boolean(provider.connected);
            const configured = Boolean(provider.configured);
            return (
              <article key={providerId} className="profile-mail-provider-card">
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
                      OAuth ar inte aktiverat i backend for {resolveProviderLabel(providerId)}.
                    </p>
                  ) : null}
                </div>

                <div className="profile-mail-provider-actions">
                  {connected ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => handleDisconnect(providerId)}
                      disabled={disabled || loading || busy}
                    >
                      {busy ? "Kopplar fran..." : "Koppla fran"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleConnect(providerId)}
                      disabled={disabled || loading || busy || !configured || !allConsentsAccepted}
                    >
                      {busy ? "Startar..." : `Koppla ${resolveProviderLabel(providerId)}`}
                    </button>
                  )}
                </div>
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
      ? `${providerLabel} ar nu kopplat.`
      : `Kopplingen mot ${providerLabel} kunde inte genomforas.`);

  url.searchParams.delete("mail_oauth_status");
  url.searchParams.delete("mail_oauth_provider");
  url.searchParams.delete("mail_oauth_message");
  const nextSearch = url.searchParams.toString();
  const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash || ""}`;
  window.history.replaceState({}, "", nextUrl);

  return { status, message };
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
