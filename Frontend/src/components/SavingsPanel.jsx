import { useEffect, useMemo, useState } from "react";
import { formatAmountWithCurrency, formatNumberWithSpaces } from "../utils/numberFormat.js";
import { analyzeSavingsFromHistory } from "../utils/savingsAnalysis.js";
import { buildEmailTemplatesFromExtracted } from "../utils/emailTemplates.js";
import { apiFetch } from "../utils/apiClient.js";
import { toUserErrorMessage } from "../utils/errorText.js";

export default function SavingsPanel({ items = [] }) {
  const analysis = useMemo(() => analyzeSavingsFromHistory(items), [items]);
  const [usageAnswers, setUsageAnswers] = useState({});
  const [marketByKey, setMarketByKey] = useState({});
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketWarning, setMarketWarning] = useState("");
  const [marketError, setMarketError] = useState("");
  const [actionMail, setActionMail] = useState(null);

  const recurringEntries = analysis.recurring;
  const hasData = recurringEntries.length > 0;
  const summary = analysis.summary;
  const compareTargets = recurringEntries.slice(0, 30);

  useEffect(() => {
    const validKeys = new Set(recurringEntries.map((entry) => entry.key));
    setUsageAnswers((previous) => {
      const next = {};
      for (const [key, value] of Object.entries(previous)) {
        if (validKeys.has(key)) next[key] = value;
      }
      return next;
    });
  }, [recurringEntries]);

  useEffect(() => {
    if (!compareTargets.length) {
      setMarketByKey({});
      setMarketWarning("");
      setMarketError("");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    async function loadMarketComparison() {
      setMarketLoading(true);
      setMarketWarning("");
      setMarketError("");

      try {
        const response = await apiFetch("/api/market/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: compareTargets.map((entry) => ({
              key: entry.key,
              vendorName: entry.vendorName,
              category: entry.category,
              currentPrice: entry.latestAmount,
              currency: entry.currency || "SEK",
            })),
          }),
          signal: controller.signal,
        });
        const json = await response.json();

        if (!response.ok || !json.ok) {
          throw new Error(json.error || "Kunde inte hämta extern prisjämförelse.");
        }
        if (cancelled) return;

        const nextMarketByKey = {};
        for (const compared of json.items || []) {
          if (!compared?.key) continue;
          nextMarketByKey[compared.key] = compared;
        }

        setMarketByKey(nextMarketByKey);
        setMarketWarning(json.warning || "");
      } catch (caughtError) {
        if (cancelled || caughtError?.name === "AbortError") return;
        setMarketError(
          toUserErrorMessage(caughtError, "Kunde inte hämta extern prisjämförelse just nu.")
        );
      } finally {
        if (!cancelled) setMarketLoading(false);
      }
    }

    void loadMarketComparison();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [compareTargets]);

  const confirmedUnusedSaving = useMemo(() => {
    return recurringEntries.reduce((sum, entry) => {
      if (usageAnswers[entry.key] !== "no") return sum;
      return sum + (entry.latestAmount || 0);
    }, 0);
  }, [recurringEntries, usageAnswers]);

  const marketOverview = useMemo(() => {
    const currentRecurringMonthly = recurringEntries.reduce(
      (sum, entry) => sum + (entry.latestAmount || 0),
      0
    );

    let globalMarketMonthly = 0;
    let globalPotential = 0;
    let externalPotential = 0;
    let liveComparableCount = 0;

    for (const entry of recurringEntries) {
      const market = marketByKey[entry.key];
      if (!market) {
        globalMarketMonthly += entry.latestAmount || 0;
        continue;
      }

      const marketMedian = Number.isFinite(market.marketMedian)
        ? market.marketMedian
        : entry.latestAmount || 0;
      const possibleSaving = Number(market.possibleSaving) || 0;

      globalMarketMonthly += marketMedian;
      globalPotential += possibleSaving;

      if (market.provider === "serpapi") {
        externalPotential += possibleSaving;
        liveComparableCount += 1;
      }
    }

    return {
      currentRecurringMonthly,
      globalMarketMonthly,
      globalPotential,
      externalPotential,
      liveComparableCount,
    };
  }, [marketByKey, recurringEntries]);

  const vendorRows = useMemo(() => {
    return analysis.recurringByVendor.map((vendor) => {
      const externalPotential = vendor.serviceKeys.reduce((sum, serviceKey) => {
        const market = marketByKey[serviceKey];
        if (!market || market.provider !== "serpapi") return sum;
        return sum + (Number(market.possibleSaving) || 0);
      }, 0);

      const globalPotential = vendor.serviceKeys.reduce((sum, serviceKey) => {
        const market = marketByKey[serviceKey];
        if (!market) return sum;
        return sum + (Number(market.possibleSaving) || 0);
      }, 0);

      return {
        ...vendor,
        externalPotential,
        globalPotential,
      };
    });
  }, [analysis.recurringByVendor, marketByKey]);

  function openActionMail(entry) {
    const usageAnswer = usageAnswers[entry.key] || "";
    const market = marketByKey[entry.key] || null;
    const generated = createSuggestedActionMail({ entry, market, usageAnswer });
    setActionMail(generated);
  }

  async function copyActionMail() {
    if (!actionMail) return;
    const fullText = `Ämne: ${actionMail.subject}\n\n${actionMail.body}`;
    await navigator.clipboard.writeText(fullText);
  }

  function openActionMailClient(target) {
    if (!actionMail) return;

    const to = String(actionMail.recipient || "").trim();
    const subject = encodeURIComponent(actionMail.subject || "");
    const body = encodeURIComponent(actionMail.body || "");
    const toQuery = to ? encodeURIComponent(to) : "";

    const mailtoUrl = to
      ? `mailto:${toQuery}?subject=${subject}&body=${body}`
      : `mailto:?subject=${subject}&body=${body}`;

    const urls = {
      default: mailtoUrl,
      gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=${toQuery}&su=${subject}&body=${body}`,
      outlook: `https://outlook.office.com/mail/deeplink/compose?to=${toQuery}&subject=${subject}&body=${body}`,
    };

    if (target === "default") {
      window.location.href = urls.default;
      return;
    }
    window.open(urls[target], "_blank", "noopener,noreferrer");
  }

  return (
    <section className="panel savings-panel">
      <div className="panel-header">
        <span className="step-badge">Bonus</span>
        <h2>Sparanalys</h2>
      </div>

      {!hasData && (
        <p className="placeholder-text">
          Lägg in fakturor från minst två olika månader för att hitta återkommande kostnader.
        </p>
      )}

      {hasData && (
        <>
          <div className="savings-summary-grid">
            <SummaryCard
              label="Uppskattad intern besparing/mån"
              value={formatAmountWithCurrency(summary.estimatedMonthlySaving, "SEK", {
                fallback: "0 SEK",
              })}
            />
            <SummaryCard label="Återkommande tjänster" value={String(summary.recurringCount)} />
            <SummaryCard
              label="Återkommande leverantörer"
              value={String(summary.recurringVendorCount)}
            />
            <SummaryCard
              label="Din markerade besparing"
              value={formatAmountWithCurrency(confirmedUnusedSaving, "SEK", {
                fallback: "0 SEK",
              })}
            />
          </div>

          <section className="savings-market-overview">
            <h3>Månadsöversikt mot global marknad</h3>
            <p>
              Så här ser din nuvarande kostnadsnivå ut jämfört med marknadsnivå baserat på extern
              hämtning och referensdata.
            </p>

            <div className="savings-market-grid">
              <SummaryCard
                label="Du betalar nu (återkommande/mån)"
                value={formatAmountWithCurrency(marketOverview.currentRecurringMonthly, "SEK", {
                  fallback: "0 SEK",
                })}
              />
              <SummaryCard
                label="Global marknadsnivå (median/mån)"
                value={formatAmountWithCurrency(marketOverview.globalMarketMonthly, "SEK", {
                  fallback: "0 SEK",
                })}
              />
              <SummaryCard
                label="Möjlig besparing mot marknad"
                value={formatAmountWithCurrency(marketOverview.globalPotential, "SEK", {
                  fallback: "0 SEK",
                })}
              />
              <SummaryCard
                label="Extern verifierad besparing"
                value={
                  marketLoading
                    ? "Hämtar..."
                    : formatAmountWithCurrency(marketOverview.externalPotential, "SEK", {
                        fallback: "0 SEK",
                      })
                }
              />
            </div>

            <p className="savings-market-meta">
              Live-källor träffade på {marketOverview.liveComparableCount} tjänster.
            </p>
          </section>

          {analysis.monthlyTotals.length > 0 && (
            <section className="savings-month-payments">
              <h3>Så mycket betalar du per månad</h3>
              <p>Summerad månadskostnad från historiken.</p>
              <div className="savings-month-list">
                {analysis.monthlyTotals.map((month) => (
                  <div key={month.monthKey} className="savings-month-row">
                    <span>{month.monthKey}</span>
                    <strong>
                      {formatAmountWithCurrency(month.total, "SEK", {
                        fallback: "0 SEK",
                      })}
                    </strong>
                  </div>
                ))}
              </div>
            </section>
          )}

          {marketWarning ? <p className="warning-message">{marketWarning}</p> : null}
          {marketError ? <p className="error-message">{marketError}</p> : null}

          <section className="savings-vendor-section">
            <h3>Återkommande betalningar per leverantör</h3>
            <p>
              Här ser du återkommande kostnader från samma leverantör och möjlig besparing per
              leverantör.
            </p>

            <div className="savings-vendor-list">
              {vendorRows.map((vendor) => (
                <article key={vendor.key} className="savings-vendor-card">
                  <div className="savings-vendor-head">
                    <div>
                      <h4>{vendor.vendorName}</h4>
                      <p>
                        {vendor.serviceCount} återkommande faktura
                        {vendor.serviceCount > 1 ? "r" : ""} • {vendor.categories.join(", ")}
                      </p>
                    </div>
                    <div className="savings-vendor-badges">
                      <span className="queue-trust-badge queue-trust-badge-high">
                        Intern:{" "}
                        {formatAmountWithCurrency(vendor.internalPotential, "SEK", {
                          fallback: "0 SEK",
                        })}
                      </span>
                      <span className="queue-trust-badge queue-trust-badge-medium">
                        Marknad:{" "}
                        {formatAmountWithCurrency(vendor.globalPotential, "SEK", {
                          fallback: "0 SEK",
                        })}
                      </span>
                      <span className="queue-trust-badge queue-trust-badge-low">
                        Extern:{" "}
                        {formatAmountWithCurrency(vendor.externalPotential, "SEK", {
                          fallback: "0 SEK",
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="savings-vendor-metrics">
                    <span>
                      Nu:{" "}
                      <strong>
                        {formatAmountWithCurrency(vendor.latestAmount, vendor.currency || "SEK", {
                          fallback: "-",
                        })}
                      </strong>
                    </span>
                    <span>
                      Föregående:{" "}
                      <strong>
                        {formatAmountWithCurrency(vendor.previousAmount, vendor.currency || "SEK", {
                          fallback: "-",
                        })}
                      </strong>
                    </span>
                    <span>
                      Trend: <strong>{formatSignedPercent(vendor.trendPercent)}</strong>
                    </span>
                    <span>
                      Månader: <strong>{vendor.monthsObserved}</strong>
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <div className="savings-service-list">
            {recurringEntries.map((entry) => {
              const answer = usageAnswers[entry.key] || "";
              const market = marketByKey[entry.key] || null;

              return (
                <article
                  key={entry.key}
                  className={`savings-service-card savings-service-card--${entry.status}`}
                >
                  <div className="savings-service-head">
                    <div>
                      <h3>{entry.vendorName}</h3>
                      <p>
                        {entry.category} • {entry.latestMonth}
                      </p>
                    </div>
                    <div className="savings-service-metrics">
                      <span>
                        Nu:{" "}
                        <strong>
                          {formatAmountWithCurrency(entry.latestAmount, entry.currency, {
                            fallback: "-",
                          })}
                        </strong>
                      </span>
                      <span>
                        Förra:{" "}
                        <strong>
                          {formatAmountWithCurrency(entry.previousAmount, entry.currency, {
                            fallback: "-",
                          })}
                        </strong>
                      </span>
                      <span>
                        Snitt:{" "}
                        <strong>
                          {formatAmountWithCurrency(entry.averageAmount, entry.currency, {
                            fallback: "-",
                          })}
                        </strong>
                      </span>
                      <span>
                        Trend: <strong>{formatSignedPercent(entry.trendPercent)}</strong>
                      </span>
                      <span>
                        Intern besparing:{" "}
                        <strong>
                          {formatAmountWithCurrency(entry.potentialSaving, "SEK", {
                            fallback: "0 SEK",
                          })}
                        </strong>
                      </span>
                      <span>
                        Marknadsbesparing:{" "}
                        <strong>
                          {formatAmountWithCurrency(market?.possibleSaving, "SEK", {
                            fallback: "0 SEK",
                          })}
                        </strong>
                      </span>
                    </div>
                  </div>

                  <div className="savings-question-box">
                    <p>{entry.question}</p>
                    <div className="savings-question-actions">
                      <button
                        type="button"
                        className={`btn btn-secondary ${
                          answer === "yes" ? "savings-answer-active" : ""
                        }`}
                        onClick={() => setUsageAnswers((prev) => ({ ...prev, [entry.key]: "yes" }))}
                      >
                        Ja
                      </button>
                      <button
                        type="button"
                        className={`btn btn-secondary ${
                          answer === "no" ? "savings-answer-active savings-answer-negative" : ""
                        }`}
                        onClick={() => setUsageAnswers((prev) => ({ ...prev, [entry.key]: "no" }))}
                      >
                        Nej
                      </button>
                    </div>
                  </div>

                  <div className="savings-notes">
                    {entry.recommendations.map((recommendation) => (
                      <p key={`${entry.key}-${recommendation}`}>{recommendation}</p>
                    ))}
                  </div>

                  {market ? (
                    <div className="savings-market-box">
                      <p>
                        Extern jämförelse ({formatProviderLabel(market.provider)}): median{" "}
                        <strong>
                          {formatAmountWithCurrency(market.marketMedian, market.currency || "SEK", {
                            fallback: "-",
                          })}
                        </strong>{" "}
                        (spann{" "}
                        {formatAmountWithCurrency(market.marketLow, market.currency || "SEK", {
                          fallback: "-",
                        })}{" "}
                        till{" "}
                        {formatAmountWithCurrency(market.marketHigh, market.currency || "SEK", {
                          fallback: "-",
                        })}
                        , n={market.sampleSize || 0}).
                      </p>
                      <p>
                        Marknadspotential:{" "}
                        <strong>
                          {formatAmountWithCurrency(market.possibleSaving, market.currency || "SEK", {
                            fallback: "0 SEK",
                          })}
                        </strong>{" "}
                        ({formatSignedPercent(market.savingPercent)})
                      </p>
                      <p>{market.recommendation}</p>
                      {market.note ? <p>{market.note}</p> : null}
                    </div>
                  ) : null}

                  <div className="savings-actions-row">
                    <button className="btn btn-primary" type="button" onClick={() => openActionMail(entry)}>
                      Skapa åtgärdsmejl
                    </button>
                  </div>

                  <div className="savings-alternatives">
                    <span>Alternativ att undersöka:</span>
                    <strong>
                      {market?.alternativeHints?.length
                        ? market.alternativeHints.join(" • ")
                        : entry.alternatives.join(" • ")}
                    </strong>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      <ActionMailModal
        actionMail={actionMail}
        onClose={() => setActionMail(null)}
        onChange={setActionMail}
        onCopy={copyActionMail}
        onOpenClient={openActionMailClient}
      />
    </section>
  );
}

function SummaryCard({ label, value }) {
  return (
    <article className="savings-summary-card">
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

function ActionMailModal({ actionMail, onClose, onChange, onCopy, onOpenClient }) {
  if (!actionMail) return null;

  return (
    <div className="preview-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <article className="preview-modal-card savings-mail-modal-card" onClick={(event) => event.stopPropagation()}>
        <header className="preview-modal-header">
          <div>
            <strong>{actionMail.vendorName}</strong>
            <p>{actionMail.templateLabel}</p>
          </div>
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            Stäng
          </button>
        </header>

        <div className="preview-modal-body savings-mail-modal-body">
          <label className="history-edit-field">
            Mottagare (valfritt)
            <input
              className="metric-input"
              type="email"
              value={actionMail.recipient || ""}
              onChange={(event) => onChange({ ...actionMail, recipient: event.target.value })}
              placeholder="kontakt@leverantor.se"
            />
          </label>

          <label className="history-edit-field">
            Ämne
            <input
              className="metric-input"
              value={actionMail.subject}
              onChange={(event) => onChange({ ...actionMail, subject: event.target.value })}
            />
          </label>

          <label className="history-edit-field">
            Meddelande
            <textarea
              className="invoice-textarea savings-mail-textarea"
              value={actionMail.body}
              onChange={(event) => onChange({ ...actionMail, body: event.target.value })}
            />
          </label>

          <div className="button-row">
            <button className="btn btn-primary" type="button" onClick={onCopy}>
              Kopiera mejl
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => onOpenClient("default")}>
              Öppna i mejlapp
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => onOpenClient("gmail")}>
              Gmail
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => onOpenClient("outlook")}>
              Outlook
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}

function createSuggestedActionMail({ entry, market, usageAnswer }) {
  const extracted = {
    vendorName: entry.vendorName,
    category: entry.category,
    customerNumber: entry.customerNumber || "",
    invoiceNumber: entry.invoiceNumber || "",
    totalAmount: entry.latestAmount,
    currency: entry.currency || "SEK",
    dueDate: entry.dueDate || "",
    paymentMethod: entry.paymentMethod || "",
  };

  const templates = buildEmailTemplatesFromExtracted(extracted);
  const preferredTemplateIds = resolvePreferredTemplates({ entry, market, usageAnswer });
  const selectedTemplate =
    preferredTemplateIds
      .map((id) => templates.find((template) => template.templateId === id))
      .find(Boolean) || templates[0];

  let body = selectedTemplate?.body || "";
  const marketMedian = market?.marketMedian;
  const possibleSaving = Number(market?.possibleSaving) || 0;

  if (Number.isFinite(marketMedian) && possibleSaving > 0) {
    body +=
      `\n\nBakgrund från marknadsanalys:\n` +
      `Nuvarande kostnad: ${formatAmountWithCurrency(entry.latestAmount, entry.currency || "SEK", {
        fallback: "-",
      })}\n` +
      `Marknadsmedian: ${formatAmountWithCurrency(marketMedian, entry.currency || "SEK", {
        fallback: "-",
      })}\n` +
      `Möjlig besparing: ${formatAmountWithCurrency(possibleSaving, entry.currency || "SEK", {
        fallback: "0 SEK",
      })}`;
  }

  if (usageAnswer === "no") {
    body += `\n\nNotering: Tjänsten används inte längre och bör avslutas snarast möjligt.`;
  }

  return {
    vendorName: entry.vendorName,
    recipient: "",
    templateLabel: selectedTemplate?.templateLabel || "Åtgärdsmall",
    subject: selectedTemplate?.subject || `Fråga om faktura ${entry.invoiceNumber || ""}`.trim(),
    body,
  };
}

function resolvePreferredTemplates({ entry, market, usageAnswer }) {
  if (usageAnswer === "no") {
    return ["cancel-fast-track", "cancel-formal", "generic-termination-followup"];
  }

  if (entry.category === "Tjänst" || market?.provider === "not_applicable") {
    return ["service-cost-clarification", "service-price-check", "specification-request"];
  }

  if (
    (Number(market?.possibleSaving) || 0) >= 80 ||
    (Number(entry?.potentialSaving) || 0) >= 50 ||
    (Number(entry?.trendPercent) || 0) >= 10
  ) {
    return ["price-negotiation-match", "price-negotiation", "generic-price-review"];
  }

  return ["specification-request", "specification-dispute", "generic-charge-question"];
}

function formatSignedPercent(value) {
  if (!Number.isFinite(value)) return "-";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatNumberWithSpaces(value, { fallback: "0" })}%`;
}

function formatProviderLabel(provider) {
  if (provider === "serpapi") return "live-data";
  if (provider === "mixed") return "live + referens";
  if (provider === "not_applicable") return "ej tillämpbar";
  return "referens";
}
