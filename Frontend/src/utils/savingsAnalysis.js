import { toFiniteNumber } from "./numberFormat.js";

const CATEGORY_BENCHMARKS = {
  Mobil: {
    targetMonthly: 249,
    alternatives: ["Lägre surfmängd", "Lojalitetsrabatt", "Kampanj hos annan operatör"],
  },
  Internet: {
    targetMonthly: 399,
    alternatives: ["Sänk hastighet", "Bindningstidsrabatt", "Jämför fiberalternativ"],
  },
  El: {
    targetMonthly: 999,
    alternatives: ["Timpris", "Fastprisjämförelse", "Buntad elhandel + nät"],
  },
  Försäkring: {
    targetMonthly: 279,
    alternatives: ["Högre självrisk", "Samlingsrabatt", "Jämför villkor mot pris"],
  },
  Streaming: {
    targetMonthly: 129,
    alternatives: ["Dela familjeplan", "Reklamfinansierad plan", "Pausa abonnemang"],
  },
  Bank: {
    targetMonthly: 99,
    alternatives: ["Avgiftsfritt kort", "Flytta sparande", "Förhandla paketavgift"],
  },
  Tjänst: {
    targetMonthly: null,
    alternatives: [
      "Begär offert från flera leverantörer",
      "Jämför timpris och materialpåslag",
      "Be om fast pris innan nytt arbete",
    ],
  },
  Övrigt: {
    targetMonthly: 199,
    alternatives: ["Prisförhandling", "Byt paket", "Säg upp outnyttjade tjänster"],
  },
};

export function analyzeSavingsFromHistory(items = []) {
  const normalizedItems = normalizeHistoryItems(items);
  const recurring = buildRecurringServices(normalizedItems);
  const recurringByVendor = buildRecurringVendors(recurring);
  const monthSummary = buildMonthSummary(normalizedItems);
  const monthlyTotals = buildMonthlyTotals(normalizedItems);
  const categorySummary = buildCategorySummary(recurring);
  const opportunities = recurring
    .filter((entry) => entry.potentialSaving >= 20 || (entry.trendPercent ?? 0) >= 8)
    .slice(0, 12);

  return {
    summary: {
      recurringCount: recurring.length,
      recurringVendorCount: recurringByVendor.length,
      opportunityCount: opportunities.length,
      estimatedMonthlySaving: recurring.reduce((acc, entry) => acc + entry.potentialSaving, 0),
      ...monthSummary,
    },
    recurring,
    recurringByVendor,
    opportunities,
    monthlyTotals,
    categorySummary,
  };
}

function normalizeHistoryItems(items) {
  return items
    .map((item) => {
      const amount = resolveMonthlyAmount(item);
      const date = resolveDate(item);
      if (!Number.isFinite(amount) || amount <= 0 || !date) return null;

      const vendorName = cleanText(item?.vendorName) || "Okänd leverantör";
      const category = normalizeCategory(item?.category);
      const currency = cleanText(item?.currency) || "SEK";
      const monthKey = toMonthKey(date);

      return {
        id: item?.id || "",
        vendorName,
        category,
        currency,
        amount,
        date,
        monthKey,
        invoiceNumber: cleanText(item?.invoiceNumber),
        customerNumber: cleanText(item?.customerNumber),
        dueDate: cleanText(item?.dueDate),
        paymentMethod: cleanText(item?.paymentMethod),
        organizationNumber: cleanText(item?.organizationNumber),
        sourceType: cleanText(item?.sourceType),
        billingType: cleanText(item?.billingType),
      };
    })
    .filter(Boolean);
}

function resolveMonthlyAmount(item) {
  const monthly = toFiniteNumber(item?.monthlyCost);
  if (monthly != null && monthly > 0) return monthly;

  const total = toFiniteNumber(item?.totalAmount);
  if (total != null && total > 0) return total;

  return null;
}

function resolveDate(item) {
  const candidates = [item?.invoiceDate, item?.dueDate, item?.scannedAt, item?.createdAt];
  for (const candidate of candidates) {
    const parsed = parseDate(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function buildRecurringServices(items) {
  const groups = new Map();

  for (const item of items) {
    const key = `${item.vendorName.toLowerCase()}|${item.category.toLowerCase()}`;
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(item);
    } else {
      groups.set(key, {
        key,
        vendorName: item.vendorName,
        category: item.category,
        currency: item.currency,
        entries: [item],
      });
    }
  }

  const recurring = [];

  for (const group of groups.values()) {
    if (normalizeCategory(group.category) === "Tjänst") continue;

    const sorted = [...group.entries].sort((a, b) => a.date.getTime() - b.date.getTime());
    const monthlyEntries = collapseEntriesByMonth(sorted);
    const uniqueMonths = [...new Set(monthlyEntries.map((entry) => entry.monthKey))];

    if (uniqueMonths.length < 2) continue;
    if (!isLikelyRecurring(uniqueMonths)) continue;

    const latest = monthlyEntries[monthlyEntries.length - 1];
    const previous = findPreviousMonthEntry(monthlyEntries, latest.monthKey);
    const latestSource = findLatestSourceForMonth(sorted, latest.monthKey);
    const previousSource = previous ? findLatestSourceForMonth(sorted, previous.monthKey) : null;
    const previousAmount = Number.isFinite(previous?.amount) ? previous.amount : null;
    const averageAmount = mean(monthlyEntries.map((entry) => entry.amount));
    const trendPercent = computeTrendPercent(previous?.amount, latest.amount);
    const benchmark = getBenchmark(group.category);
    const targetMonthly = Number.isFinite(benchmark.targetMonthly) ? benchmark.targetMonthly : null;
    const baseAmount = Number.isFinite(latest.amount) ? latest.amount : averageAmount;
    const potentialSaving =
      previousAmount != null ? Math.max(0, round2(latest.amount - previousAmount)) : 0;
    const benchmarkGap =
      targetMonthly != null ? Math.max(0, round2(baseAmount - targetMonthly)) : 0;

    recurring.push({
      key: group.key,
      vendorName: group.vendorName,
      vendorKey: normalizeVendorKey(group.vendorName),
      category: group.category,
      currency: group.currency,
      monthsObserved: uniqueMonths.length,
      latestMonth: latest.monthKey,
      latestAmount: latest.amount,
      previousMonth: previous?.monthKey || "",
      previousAmount,
      averageAmount,
      trendPercent,
      targetMonthly,
      benchmarkGap,
      potentialSaving,
      status: classifyStatus({ potentialSaving, trendPercent }),
      question: `Använder du fortfarande ${group.vendorName}?`,
      recommendations: buildRecommendations({
        category: group.category,
        vendorName: group.vendorName,
        trendPercent,
        potentialSaving,
        previousAmount,
        benchmarkGap,
        targetMonthly,
      }),
      alternatives: benchmark.alternatives,
      historyId: latestSource?.id || "",
      invoiceNumber: latestSource?.invoiceNumber || "",
      customerNumber: latestSource?.customerNumber || "",
      dueDate: latestSource?.dueDate || "",
      paymentMethod: latestSource?.paymentMethod || "",
      organizationNumber: latestSource?.organizationNumber || "",
      sourceType: latestSource?.sourceType || "",
      billingType: latestSource?.billingType || "",
      previousInvoiceNumber: previousSource?.invoiceNumber || "",
    });
  }

  return recurring.sort((a, b) => {
    if (b.potentialSaving !== a.potentialSaving) return b.potentialSaving - a.potentialSaving;
    return (b.trendPercent || 0) - (a.trendPercent || 0);
  });
}

function buildRecurringVendors(recurringServices) {
  const grouped = new Map();

  for (const service of recurringServices) {
    const key = service.vendorKey || normalizeVendorKey(service.vendorName);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        key,
        vendorName: service.vendorName,
        currency: service.currency || "SEK",
        monthsObserved: service.monthsObserved || 0,
        latestAmount: Number(service.latestAmount) || 0,
        previousAmount: Number.isFinite(service.previousAmount) ? service.previousAmount : null,
        internalPotential: Number(service.potentialSaving) || 0,
        categories: new Set([service.category]),
        serviceKeys: [service.key],
        serviceCount: 1,
      });
      continue;
    }

    existing.monthsObserved = Math.max(existing.monthsObserved, service.monthsObserved || 0);
    existing.latestAmount += Number(service.latestAmount) || 0;
    if (Number.isFinite(service.previousAmount)) {
      existing.previousAmount =
        (Number.isFinite(existing.previousAmount) ? existing.previousAmount : 0) +
        service.previousAmount;
    }
    existing.internalPotential += Number(service.potentialSaving) || 0;
    existing.categories.add(service.category);
    existing.serviceKeys.push(service.key);
    existing.serviceCount += 1;
  }

  return [...grouped.values()]
    .map((entry) => {
      const trendPercent = computeTrendPercent(entry.previousAmount, entry.latestAmount);
      return {
        key: entry.key,
        vendorName: entry.vendorName,
        currency: entry.currency,
        monthsObserved: entry.monthsObserved,
        latestAmount: round2(entry.latestAmount),
        previousAmount: Number.isFinite(entry.previousAmount) ? round2(entry.previousAmount) : null,
        trendPercent,
        internalPotential: round2(entry.internalPotential),
        categories: [...entry.categories].sort((a, b) => a.localeCompare(b, "sv-SE")),
        serviceKeys: entry.serviceKeys,
        serviceCount: entry.serviceCount,
      };
    })
    .sort((a, b) => {
      if (b.internalPotential !== a.internalPotential) return b.internalPotential - a.internalPotential;
      return (b.latestAmount || 0) - (a.latestAmount || 0);
    });
}

function findPreviousMonthEntry(sortedEntries, latestMonth) {
  for (let index = sortedEntries.length - 2; index >= 0; index -= 1) {
    const candidate = sortedEntries[index];
    if (candidate.monthKey !== latestMonth) return candidate;
  }
  return null;
}

function findLatestSourceForMonth(sortedEntries, monthKey) {
  for (let index = sortedEntries.length - 1; index >= 0; index -= 1) {
    const candidate = sortedEntries[index];
    if (candidate.monthKey === monthKey) return candidate;
  }
  return null;
}

function collapseEntriesByMonth(sortedEntries) {
  const monthMap = new Map();

  for (const entry of sortedEntries) {
    const existing = monthMap.get(entry.monthKey);
    if (!existing) {
      monthMap.set(entry.monthKey, { monthKey: entry.monthKey, date: entry.date, amount: entry.amount });
      continue;
    }

    existing.amount = round2(existing.amount + entry.amount);
    if (entry.date.getTime() > existing.date.getTime()) {
      existing.date = entry.date;
    }
  }

  return [...monthMap.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

function isLikelyRecurring(monthKeys) {
  if (!Array.isArray(monthKeys) || monthKeys.length < 2) return false;

  const sortedMonthKeys = [...monthKeys].sort();
  const gaps = [];
  for (let index = 1; index < sortedMonthKeys.length; index += 1) {
    gaps.push(monthGap(sortedMonthKeys[index - 1], sortedMonthKeys[index]));
  }

  if (!gaps.length) return false;
  if (sortedMonthKeys.length === 2) return gaps[0] <= 2;

  const adjacentSteps = gaps.filter((gap) => gap === 1).length;
  const hasLargeGap = gaps.some((gap) => gap > 3);
  if (adjacentSteps === 0) return false;
  if (hasLargeGap && sortedMonthKeys.length < 4) return false;
  return true;
}

function monthGap(fromMonthKey, toMonthKey) {
  const [fromYear, fromMonth] = String(fromMonthKey || "")
    .split("-")
    .map((value) => Number(value));
  const [toYear, toMonth] = String(toMonthKey || "")
    .split("-")
    .map((value) => Number(value));

  if (
    !Number.isFinite(fromYear) ||
    !Number.isFinite(fromMonth) ||
    !Number.isFinite(toYear) ||
    !Number.isFinite(toMonth)
  ) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, (toYear - fromYear) * 12 + (toMonth - fromMonth));
}

function buildRecommendations({
  category,
  vendorName,
  trendPercent,
  potentialSaving,
  previousAmount,
  benchmarkGap,
  targetMonthly,
}) {
  const recommendations = [];
  if (normalizeCategory(category) === "Tjänst") {
    recommendations.push(
      "Detta ser ut som en engångstjänst och räknas inte som återkommande månadskostnad."
    );
    recommendations.push("Kontrollera att arbete, material och moms är tydligt specificerade.");
    recommendations.push(`Be ${vendorName} om prisöversyn eller fastpris vid liknande jobb.`);
    return recommendations.slice(0, 3);
  }

  if (Number.isFinite(targetMonthly) && benchmarkGap >= 20) {
    recommendations.push(
      `Du ligger över riktpris för ${category.toLowerCase()} (ca ${targetMonthly} kr/mån).`
    );
  }

  if (previousAmount != null && potentialSaving >= 20) {
    recommendations.push(
      `Kostnaden ligger ${Math.round(potentialSaving)} kr över föregående månad.`
    );
  }

  if ((trendPercent ?? 0) >= 8) {
    recommendations.push(
      `Kostnaden har ökat ${Math.round(trendPercent)}% mot föregående månad.`
    );
  }

  recommendations.push(`Be ${vendorName} om prisöversyn eller lojalitetsrabatt.`);
  return recommendations.slice(0, 3);
}

function buildMonthSummary(items) {
  const totalsByMonth = new Map();

  for (const item of items) {
    const total = totalsByMonth.get(item.monthKey) || 0;
    totalsByMonth.set(item.monthKey, total + item.amount);
  }

  const monthKeys = [...totalsByMonth.keys()].sort();
  const latestMonth = monthKeys[monthKeys.length - 1] || "";
  const previousMonth = monthKeys[monthKeys.length - 2] || "";
  const latestTotal = latestMonth ? totalsByMonth.get(latestMonth) || 0 : 0;
  const previousTotal = previousMonth ? totalsByMonth.get(previousMonth) || 0 : 0;
  const delta = round2(latestTotal - previousTotal);
  const deltaPercent = previousTotal > 0 ? round2((delta / previousTotal) * 100) : null;

  return {
    latestMonth,
    previousMonth,
    latestMonthTotal: round2(latestTotal),
    previousMonthTotal: round2(previousTotal),
    monthDelta: delta,
    monthDeltaPercent: deltaPercent,
  };
}

function buildMonthlyTotals(items) {
  const totalsByMonth = new Map();

  for (const item of items) {
    const total = totalsByMonth.get(item.monthKey) || 0;
    totalsByMonth.set(item.monthKey, total + item.amount);
  }

  return [...totalsByMonth.entries()]
    .map(([monthKey, total]) => ({ monthKey, total: round2(total) }))
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}

function buildCategorySummary(recurring) {
  const grouped = new Map();

  for (const entry of recurring) {
    const previous = grouped.get(entry.category) || {
      category: entry.category,
      serviceCount: 0,
      totalLatestAmount: 0,
      totalPotentialSaving: 0,
    };

    previous.serviceCount += 1;
    previous.totalLatestAmount += Number(entry.latestAmount) || 0;
    previous.totalPotentialSaving += Number(entry.potentialSaving) || 0;
    grouped.set(entry.category, previous);
  }

  return [...grouped.values()]
    .map((entry) => ({
      ...entry,
      totalLatestAmount: round2(entry.totalLatestAmount),
      totalPotentialSaving: round2(entry.totalPotentialSaving),
    }))
    .sort((a, b) => b.totalPotentialSaving - a.totalPotentialSaving);
}

function classifyStatus({ potentialSaving, trendPercent }) {
  if (potentialSaving >= 120 || (trendPercent ?? 0) >= 15) return "high";
  if (potentialSaving >= 50 || (trendPercent ?? 0) >= 8) return "medium";
  return "low";
}

function getBenchmark(category) {
  return CATEGORY_BENCHMARKS[normalizeCategory(category)] || CATEGORY_BENCHMARKS.Övrigt;
}

function normalizeCategory(value) {
  const key = cleanText(value).toLowerCase();
  const map = {
    mobil: "Mobil",
    internet: "Internet",
    el: "El",
    försäkring: "Försäkring",
    forsakring: "Försäkring",
    streaming: "Streaming",
    bank: "Bank",
    tjänst: "Tjänst",
    tjanst: "Tjänst",
    service: "Tjänst",
    hantverk: "Tjänst",
    installation: "Tjänst",
    renovering: "Tjänst",
    övrigt: "Övrigt",
    ovrigt: "Övrigt",
  };
  return map[key] || "Övrigt";
}

function normalizeVendorKey(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date;

  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const localDate = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00`);
  return Number.isNaN(localDate.getTime()) ? null : localDate;
}

function toMonthKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function computeTrendPercent(previousAmount, latestAmount) {
  if (!Number.isFinite(previousAmount) || previousAmount <= 0 || !Number.isFinite(latestAmount)) {
    return null;
  }
  return round2(((latestAmount - previousAmount) / previousAmount) * 100);
}

function mean(values) {
  if (!Array.isArray(values) || !values.length) return 0;
  const sum = values.reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0);
  return round2(sum / values.length);
}

function cleanText(value) {
  return String(value || "").trim();
}

function round2(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}
