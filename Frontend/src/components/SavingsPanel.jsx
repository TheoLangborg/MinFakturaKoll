import { useEffect, useMemo, useState } from "react";
import { formatAmountWithCurrency, formatNumberWithSpaces } from "../utils/numberFormat.js";
import { analyzeSavingsFromHistory } from "../utils/savingsAnalysis.js";
import { apiFetch } from "../utils/apiClient.js";
import { toUserErrorMessage } from "../utils/errorText.js";

export default function SavingsPanel({ items = [] }) {
  const analysis = useMemo(() => analyzeSavingsFromHistory(items), [items]);
  const [usageAnswers, setUsageAnswers] = useState({});
  const [marketByKey, setMarketByKey] = useState({});
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketWarning, setMarketWarning] = useState("");
  const [marketError, setMarketError] = useState("");

  const hasData = analysis.recurring.length > 0;
  const summary = analysis.summary;
  const visibleEntries = useMemo(() => {
    if (analysis.opportunities.length > 0) return analysis.opportunities;
    return analysis.recurring.slice(0, 8);
  }, [analysis.opportunities, analysis.recurring]);

  useEffect(() => {
    const validKeys = new Set(analysis.recurring.map((entry) => entry.key));
    setUsageAnswers((previous) => {
      const next = {};
      for (const [key, value] of Object.entries(previous)) {
        if (validKeys.has(key)) next[key] = value;
      }
      return next;
    });
  }, [analysis.recurring]);

  useEffect(() => {
    if (!visibleEntries.length) {
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
            items: visibleEntries.map((entry) => ({
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

        const map = {};
        for (const compared of json.items || []) {
          if (!compared?.key) continue;
          map[compared.key] = compared;
        }

        setMarketByKey(map);
        setMarketWarning(json.warning || "");
      } catch (error) {
        if (cancelled || error?.name === "AbortError") return;
        setMarketError(
          toUserErrorMessage(error, "Kunde inte hämta extern prisjämförelse just nu.")
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
  }, [visibleEntries]);

  const confirmedUnusedSaving = useMemo(() => {
    return analysis.recurring.reduce((sum, entry) => {
      if (usageAnswers[entry.key] !== "no") return sum;
      return sum + (entry.latestAmount || 0);
    }, 0);
  }, [analysis.recurring, usageAnswers]);

  const externalPotential = useMemo(() => {
    return visibleEntries.reduce((sum, entry) => {
      const market = marketByKey[entry.key];
      if (!market) return sum;
      if (market.provider !== "serpapi") return sum;
      return sum + (Number(market.possibleSaving) || 0);
    }, 0);
  }, [marketByKey, visibleEntries]);

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
              label="Uppskattad sparpotential/mån"
              value={formatAmountWithCurrency(summary.estimatedMonthlySaving, "SEK", {
                fallback: "0 SEK",
              })}
            />
            <SummaryCard label="Återkommande tjänster" value={String(summary.recurringCount)} />
            <SummaryCard
              label="Kandidater att agera på"
              value={String(summary.opportunityCount)}
            />
            <SummaryCard
              label="Din markerade besparing"
              value={formatAmountWithCurrency(confirmedUnusedSaving, "SEK", {
                fallback: "0 SEK",
              })}
            />
            <SummaryCard
              label="Extern verifierad potential"
              value={
                marketLoading
                  ? "Hämtar..."
                  : formatAmountWithCurrency(externalPotential, "SEK", {
                      fallback: "0 SEK",
                    })
              }
            />
          </div>

          {marketWarning ? <p className="warning-message">{marketWarning}</p> : null}
          {marketError ? <p className="error-message">{marketError}</p> : null}

          {summary.latestMonth && (
            <p className="savings-month-trend">
              Senaste månad ({summary.latestMonth}):{" "}
              <strong>
                {formatAmountWithCurrency(summary.latestMonthTotal, "SEK", {
                  fallback: "0 SEK",
                })}
              </strong>
              {summary.previousMonth ? (
                <>
                  {" "}
                  mot {summary.previousMonth}:{" "}
                  <strong>
                    {formatAmountWithCurrency(summary.previousMonthTotal, "SEK", {
                      fallback: "0 SEK",
                    })}
                  </strong>{" "}
                  ({formatSignedAmount(summary.monthDelta)} /{" "}
                  {formatSignedPercent(summary.monthDeltaPercent)})
                </>
              ) : null}
            </p>
          )}

          <div className="savings-service-list">
            {visibleEntries.map((entry) => {
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
                      <p>{entry.category}</p>
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
                      {market.provider === "serpapi" ? (
                        <>
                          <p>
                            Extern besparing:{" "}
                            <strong>
                              {formatAmountWithCurrency(market.possibleSaving, market.currency || "SEK", {
                                fallback: "0 SEK",
                              })}
                            </strong>{" "}
                            ({formatSignedPercent(market.savingPercent)})
                          </p>
                          <p>{market.recommendation}</p>
                        </>
                      ) : market.provider === "not_applicable" ? (
                        <>
                          <p>{market.recommendation}</p>
                          {market.note ? <p>{market.note}</p> : null}
                        </>
                      ) : (
                        <p>Live-data saknas just nu. Referensspann visas endast som riktvärde.</p>
                      )}
                      {market.provider !== "not_applicable" && market.note ? <p>{market.note}</p> : null}
                    </div>
                  ) : null}

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

function formatSignedPercent(value) {
  if (!Number.isFinite(value)) return "-";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatNumberWithSpaces(value, { fallback: "0" })}%`;
}

function formatSignedAmount(value) {
  if (!Number.isFinite(value)) return "0 SEK";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatAmountWithCurrency(value, "SEK", { fallback: "0 SEK" })}`;
}

function formatProviderLabel(provider) {
  if (provider === "serpapi") return "live-data";
  if (provider === "mixed") return "live + referens";
  if (provider === "not_applicable") return "ej tillämpbar";
  return "referens";
}
