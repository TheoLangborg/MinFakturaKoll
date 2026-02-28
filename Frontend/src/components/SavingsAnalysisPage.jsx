import { useMemo } from "react";
import { formatAmountWithCurrency, formatNumberWithSpaces } from "../utils/numberFormat.js";
import { analyzeSavingsFromHistory } from "../utils/savingsAnalysis.js";
import SavingsPanel from "./SavingsPanel.jsx";

export default function SavingsAnalysisPage({ history }) {
  const analysis = useMemo(() => analyzeSavingsFromHistory(history.items), [history.items]);
  const hasItems = history.items.length > 0;
  const hasRecurring = analysis.recurring.length > 0;
  const recentMonths = analysis.monthlyTotals.slice(-6);
  const monthCount = analysis.monthlyTotals.length;
  const latestMonth = analysis.monthlyTotals[monthCount - 1] || null;
  const previousMonth = analysis.monthlyTotals[monthCount - 2] || null;
  const totalSpend = analysis.monthlyTotals.reduce((sum, month) => sum + (month.total || 0), 0);
  const averageSpend = monthCount > 0 ? totalSpend / monthCount : 0;
  const latestDelta = latestMonth && previousMonth ? latestMonth.total - previousMonth.total : null;

  return (
    <>
      <section className="panel panel-savings-page">
        <div className="history-header">
          <div>
            <h2>Potentiella Besparingar</h2>
            <p>
              Djupare analys av återkommande kostnader, månadstrender och var du kan sänka
              utgifterna snabbast.
            </p>
          </div>

          <div className="history-header-actions">
            <button
              className="btn btn-secondary"
              onClick={history.loadHistory}
              disabled={history.loading || history.mutating}
            >
              {history.loading ? "Uppdaterar..." : "Uppdatera data"}
            </button>
          </div>
        </div>

        {history.error ? <p className="error-message">{history.error}</p> : null}
        {history.warning ? <p className="warning-message">{history.warning}</p> : null}

        {!history.enabled && !history.error ? (
          <p className="placeholder-text">
            Historiktjänsten är inte tillgänglig just nu. Kontrollera Firebase-inställningarna i
            backend `.env`.
          </p>
        ) : null}

        {history.enabled && !hasItems && !history.loading ? (
          <p className="placeholder-text">
            Ingen historik ännu. Kör analyser för minst två månader så visas sparanalysen här.
          </p>
        ) : null}

        {hasItems ? (
          <div className="savings-summary-grid savings-summary-grid-compact">
            <SummaryCard
              label="Senaste månad"
              value={
                latestMonth
                  ? `${latestMonth.monthKey} - ${formatAmountWithCurrency(latestMonth.total, "SEK", {
                      fallback: "0 SEK",
                    })}`
                  : "Saknas"
              }
            />
            <SummaryCard
              label="Snitt per månad"
              value={formatAmountWithCurrency(averageSpend, "SEK", {
                fallback: "0 SEK",
              })}
            />
            <SummaryCard
              label="Total spend i historik"
              value={formatAmountWithCurrency(totalSpend, "SEK", {
                fallback: "0 SEK",
              })}
            />
            <SummaryCard label="Månader med data" value={String(monthCount)} />
            <SummaryCard
              label="Återkommande leverantörer"
              value={String(analysis.recurringByVendor.length)}
            />
            <SummaryCard
              label="Förändring senaste månad"
              value={latestDelta == null ? "-" : formatSignedAmount(latestDelta)}
            />
          </div>
        ) : null}
      </section>

      {hasItems ? <SavingsPanel items={history.items} /> : null}

      {hasRecurring ? (
        <section className="panel panel-savings-deepdive">
          <div className="panel-header">
            <span className="step-badge">Detaljer</span>
            <h2>Fördjupad Sparanalys</h2>
          </div>

          <div className="savings-deep-grid">
            <article className="savings-deep-card">
              <h3>Månad För Månad</h3>
              <p>Utveckling av total kostnad baserat på historiken.</p>
              <div className="savings-month-list">
                {recentMonths.map((month) => (
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
            </article>

            <article className="savings-deep-card">
              <h3>Kategoriöversikt</h3>
              <p>Vilka kategorier driver mest kostnad och sparpotential.</p>
              <div className="savings-category-list">
                {analysis.categorySummary.slice(0, 6).map((entry) => (
                  <div key={entry.category} className="savings-category-row">
                    <div>
                      <strong>{entry.category}</strong>
                      <span>{entry.serviceCount} återkommande tjänster</span>
                    </div>
                    <div className="savings-category-values">
                      <em>
                        Kostnad:{" "}
                        {formatAmountWithCurrency(entry.totalLatestAmount, "SEK", {
                          fallback: "0 SEK",
                        })}
                      </em>
                      <em>
                        Potential:{" "}
                        {formatAmountWithCurrency(entry.totalPotentialSaving, "SEK", {
                          fallback: "0 SEK",
                        })}
                      </em>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </div>

          <div className="savings-table-wrap">
            <table className="savings-detail-table">
              <thead>
                <tr>
                  <th>Leverantör</th>
                  <th>Kategori</th>
                  <th>Månader</th>
                  <th>Förra Kostnad</th>
                  <th>Senaste Kostnad</th>
                  <th>Trend</th>
                  <th>Sparpotential</th>
                  <th>Prioritet</th>
                </tr>
              </thead>
              <tbody>
                {analysis.recurring.map((entry) => (
                  <tr key={entry.key}>
                    <td>{entry.vendorName}</td>
                    <td>{entry.category}</td>
                    <td>{entry.monthsObserved}</td>
                    <td>
                      {formatAmountWithCurrency(entry.previousAmount, entry.currency || "SEK", {
                        fallback: "-",
                      })}
                    </td>
                    <td>
                      {formatAmountWithCurrency(entry.latestAmount, entry.currency || "SEK", {
                        fallback: "-",
                      })}
                    </td>
                    <td>{formatSignedPercent(entry.trendPercent)}</td>
                    <td>
                      {formatAmountWithCurrency(entry.potentialSaving, "SEK", {
                        fallback: "0 SEK",
                      })}
                    </td>
                    <td>
                      <span className={`savings-priority savings-priority--${entry.status || "low"}`}>
                        {priorityLabel(entry.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}

function formatSignedPercent(value) {
  if (!Number.isFinite(value)) return "-";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatNumberWithSpaces(value, { fallback: "0" })}%`;
}

function priorityLabel(status) {
  if (status === "high") return "Hög";
  if (status === "medium") return "Medel";
  return "Låg";
}

function SummaryCard({ label, value }) {
  return (
    <article className="savings-summary-card">
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

function formatSignedAmount(value) {
  if (!Number.isFinite(value)) return "-";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatAmountWithCurrency(value, "SEK", { fallback: "0 SEK" })}`;
}
