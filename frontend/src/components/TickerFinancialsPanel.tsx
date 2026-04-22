import { useMemo, useState } from "react";

import type { FinancialStatementTable, TickerFinancialsResponse } from "../lib/types";
import { Panel } from "./Panel";

type FinancialsTab = "income_statement" | "balance_sheet" | "cash_flow" | "ratios" | "estimates";

type TickerFinancialsPanelProps = {
  financials?: TickerFinancialsResponse;
  isLoading: boolean;
  error: string | null;
};

const FINANCIAL_TABS: Array<{ key: FinancialsTab; label: string }> = [
  { key: "income_statement", label: "Income Statement" },
  { key: "balance_sheet", label: "Balance Sheet" },
  { key: "cash_flow", label: "Cash Flow" },
  { key: "ratios", label: "Ratios" },
  { key: "estimates", label: "Estimates" },
];

const PERIOD_LABELS = {
  annual: "Annual",
  quarterly: "Quarterly",
  current: "Current",
  ttm: "TTM",
  unknown: "Other",
} as const;

export function TickerFinancialsPanel({ financials, isLoading, error }: TickerFinancialsPanelProps) {
  const [activeTab, setActiveTab] = useState<FinancialsTab>("income_statement");
  const [periodPreference, setPeriodPreference] = useState<"annual" | "quarterly">("annual");

  const availableTables = useMemo(() => tablesForTab(financials, activeTab), [activeTab, financials]);
  const activeTable = useMemo(
    () => selectTableForPeriod(availableTables, periodPreference),
    [availableTables, periodPreference],
  );
  const availablePeriods = new Set(availableTables.map((table) => table.periodType));
  const reportsAvailable = financials?.reports.filter((report) => report.available).map((report) => report.reportType) ?? [];
  const reportsMissing = financials?.reports.filter((report) => !report.available).map((report) => report.reportType) ?? [];

  if (isLoading && !financials) {
    return <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">Loading financials...</div>;
  }

  if (!financials && error) {
    return <div className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-4 text-sm text-danger">{error}</div>;
  }

  if (!financials) {
    return null;
  }

  return (
    <Panel
      action={<div className="text-xs text-muted">{formatTimestamp(financials.generatedAt)}</div>}
      eyebrow={financials.isStale ? "IBKR fundamentals stale" : "IBKR fundamentals"}
      title={`${financials.symbol} Financials`}
    >
      <div className="flex flex-col gap-3 border-b border-line/70 pb-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 gap-1 overflow-x-auto">
          {FINANCIAL_TABS.map((tab) => (
            <button
              key={tab.key}
              className={`h-9 shrink-0 rounded-xl border px-3 text-sm transition ${
                activeTab === tab.key
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-line/80 bg-panelSoft text-muted hover:border-accent/25 hover:text-text"
              }`}
              onClick={() => setActiveTab(tab.key)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
        {availablePeriods.has("annual") || availablePeriods.has("quarterly") ? (
          <div className="inline-flex w-fit rounded-xl border border-line/80 bg-panelSoft p-1">
            {(["annual", "quarterly"] as const).map((period) => (
              <button
                key={period}
                className={`h-7 rounded-lg px-3 text-xs transition ${
                  periodPreference === period ? "bg-panel text-text shadow-sm" : "text-muted hover:text-text"
                }`}
                disabled={!availablePeriods.has(period)}
                onClick={() => setPeriodPreference(period)}
                type="button"
              >
                {PERIOD_LABELS[period]}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {activeTable ? <FinancialsTable table={activeTable} /> : <EmptyFinancialsState activeTab={activeTab} />}

      <div className="mt-4 grid gap-2 text-xs text-muted">
        {financials.sourceNotices.map((notice) => (
          <div key={notice}>{notice}</div>
        ))}
        {error ? <div className="text-danger">{error}</div> : null}
        <div>
          Reports: {reportsAvailable.length ? reportsAvailable.join(", ") : "none returned"}
          {reportsMissing.length ? ` · Missing: ${reportsMissing.join(", ")}` : ""}
        </div>
      </div>
    </Panel>
  );
}

function FinancialsTable({ table }: { table: FinancialStatementTable }) {
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-line/80 bg-panel">
      <div className="flex flex-col gap-1 border-b border-line/70 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between">
        <div className="font-medium text-text">{table.title}</div>
        <div className="text-xs text-muted">
          {PERIOD_LABELS[table.periodType]}{table.unit ? ` · ${table.unit}` : ""}{table.currency ? ` · ${table.currency}` : ""}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line/70 text-left text-xs uppercase tracking-[0.14em] text-muted">
              <th className="sticky left-0 z-10 bg-panel px-4 py-3 font-medium">Metric</th>
              {table.columns.map((column, index) => (
                <th key={`${column.label}-${index}`} className="px-4 py-3 text-right font-medium">
                  <div>{column.label}</div>
                  {column.periodEnding ? <div className="mt-1 text-[10px] normal-case tracking-normal">{formatDate(column.periodEnding)}</div> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.label} className="border-b border-line/50 last:border-0">
                <th className="sticky left-0 z-10 max-w-[18rem] bg-panel px-4 py-3 text-left font-normal text-muted">
                  {row.label}
                </th>
                {table.columns.map((column, index) => (
                  <td key={`${row.label}-${column.label}-${index}`} className="px-4 py-3 text-right font-medium text-text">
                    {formatFinancialValue(row.values[index])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyFinancialsState({ activeTab }: { activeTab: FinancialsTab }) {
  const tabLabel = FINANCIAL_TABS.find((tab) => tab.key === activeTab)?.label ?? "Financials";
  return (
    <div className="mt-4 rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
      No {tabLabel.toLowerCase()} table was returned for this ticker.
    </div>
  );
}

function tablesForTab(financials: TickerFinancialsResponse | undefined, tab: FinancialsTab) {
  if (!financials) {
    return [];
  }
  if (tab === "ratios") {
    return financials.ratios;
  }
  if (tab === "estimates") {
    return financials.estimates;
  }
  return financials.statements.filter((table) => table.statementType === tab);
}

function selectTableForPeriod(tables: FinancialStatementTable[], preference: "annual" | "quarterly") {
  return (
    tables.find((table) => table.periodType === preference) ??
    tables.find((table) => table.periodType === "annual") ??
    tables.find((table) => table.periodType === "quarterly") ??
    tables[0] ??
    null
  );
}

function formatFinancialValue(value: number | string | null | undefined) {
  if (value == null || value === "") {
    return "-";
  }
  if (typeof value === "string") {
    return value;
  }
  const maximumFractionDigits = Math.abs(value) >= 100 ? 0 : 2;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
