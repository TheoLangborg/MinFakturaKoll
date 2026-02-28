import { useMemo, useState } from "react";

export default function ActionPanel({
  email,
  emailTemplates = [],
  selectedTemplateId = "",
  onCopyEmail,
  onSelectTemplate,
}) {
  const [recipient, setRecipient] = useState("");
  const [showMailApps, setShowMailApps] = useState(false);

  const hasTemplates = emailTemplates.length > 0;
  const hasActiveTemplate = Boolean(email);

  const emailCountText = useMemo(
    () => (hasTemplates ? `${emailTemplates.length} mallar tillgängliga` : ""),
    [emailTemplates.length, hasTemplates]
  );

  function openMailClient(target) {
    if (!email) return;

    const to = recipient.trim();
    const subject = encodeURIComponent(email.subject || "");
    const body = encodeURIComponent(email.body || "");
    const toQuery = to ? encodeURIComponent(to) : "";

    const mailtoUrl = to
      ? `mailto:${toQuery}?subject=${subject}&body=${body}`
      : `mailto:?subject=${subject}&body=${body}`;

    const urls = {
      default: mailtoUrl,
      gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=${toQuery}&su=${subject}&body=${body}`,
      outlook: `https://outlook.office.com/mail/deeplink/compose?to=${toQuery}&subject=${subject}&body=${body}`,
      yahoo: `https://compose.mail.yahoo.com/?to=${toQuery}&subj=${subject}&body=${body}`,
    };

    if (target === "default") {
      window.location.href = urls.default;
      return;
    }

    window.open(urls[target], "_blank", "noopener,noreferrer");
  }

  return (
    <section className="panel panel-action">
      <div className="panel-header">
        <span className="step-badge">Steg 3</span>
        <h2>Åtgärd</h2>
      </div>

      {!hasTemplates && <p className="placeholder-text">Ingen åtgärd skapad ännu.</p>}

      {hasTemplates && (
        <>
          <div className="template-manager">
            <h3>Mallbibliotek</h3>
            <p className="template-manager-sub">{emailCountText}</p>

            <div className="template-tab-list">
              {emailTemplates.map((template) => (
                <button
                  key={template.templateId}
                  className={`template-tab ${
                    selectedTemplateId === template.templateId ? "template-tab-active" : ""
                  }`}
                  onClick={() => onSelectTemplate(template.templateId)}
                >
                  {template.templateLabel}
                </button>
              ))}
            </div>
          </div>

          {hasActiveTemplate && (
            <>
              <div className="email-header">
                <div>
                  <h3>{email.subject}</h3>
                  <p>Välj mejlapp direkt eller kopiera texten manuellt.</p>
                </div>

                <div className="email-actions">
                  <button className="btn btn-secondary" onClick={() => setShowMailApps((v) => !v)}>
                    {showMailApps ? "Dölj mejlappar" : "Öppna i mejlapp"}
                  </button>
                  <button className="btn btn-primary" onClick={onCopyEmail}>
                    Kopiera mejl
                  </button>
                </div>
              </div>

              {showMailApps && (
                <div className="mail-app-picker">
                  <label className="mail-recipient">
                    Mottagare (valfritt)
                    <input
                      className="metric-input"
                      type="email"
                      value={recipient}
                      onChange={(event) => setRecipient(event.target.value)}
                      placeholder="exempel@leverantor.se"
                    />
                  </label>

                  <div className="mail-app-buttons">
                    <button className="btn btn-secondary" onClick={() => openMailClient("default")}>
                      Standardapp
                    </button>
                    <button className="btn btn-secondary" onClick={() => openMailClient("gmail")}>
                      Gmail
                    </button>
                    <button className="btn btn-secondary" onClick={() => openMailClient("outlook")}>
                      Outlook
                    </button>
                    <button className="btn btn-secondary" onClick={() => openMailClient("yahoo")}>
                      Yahoo Mail
                    </button>
                  </div>
                </div>
              )}

              <pre className="email-preview">{email.body}</pre>
            </>
          )}
        </>
      )}
    </section>
  );
}
