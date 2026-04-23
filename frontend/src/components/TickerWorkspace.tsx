import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "../lib/api";
import {
  formatTimestamp,
  fmtCompactCurrency,
  fmtCompactNumber,
  fmtCurrencySmall,
  fmtDateShort,
  fmtNumber,
  fmtParenSignedPct,
  fmtSignedPct,
  fmtWholeNumber,
} from "../lib/formatters";
import type { TickerOverviewResponse } from "../lib/types";
import { Panel } from "./Panel";
import { ToolWorkspaceFrame } from "./shell/ToolWorkspaceFrame";
import { TickerFinancialsPanel } from "./TickerFinancialsPanel";
import { ErrorState } from "./ui/ErrorState";

type TickerWorkspaceProps = {
  selectedSymbol: string;
  onSymbolChange: (symbol: string) => void;
  controlsDisabled: boolean;
};

export function TickerWorkspace({
  selectedSymbol,
  onSymbolChange,
  controlsDisabled,
}: TickerWorkspaceProps) {
  const symbol = selectedSymbol.trim().toUpperCase() || "NVDA";
  const [symbolInput, setSymbolInput] = useState(symbol);
  const tickerOverviewQuery = useQuery({
    queryKey: ["ticker-overview", symbol],
    queryFn: () => api.tickerOverview(symbol),
    enabled: Boolean(symbol.trim()),
    refetchInterval: false,
    staleTime: 120_000,
  });
  const tickerOverview = tickerOverviewQuery.data;
  const tickerOverviewError = tickerOverviewQuery.error instanceof Error ? tickerOverviewQuery.error.message : null;
  const tickerFinancialsQuery = useQuery({
    queryKey: ["ticker-financials", symbol],
    queryFn: () => api.tickerFinancials(symbol),
    enabled: Boolean(symbol.trim()),
    refetchInterval: false,
    staleTime: 120_000,
  });
  const tickerFinancialsError = tickerFinancialsQuery.error instanceof Error ? tickerFinancialsQuery.error.message : null;

  useEffect(() => {
    setSymbolInput(symbol);
  }, [symbol]);

  return (
    <ToolWorkspaceFrame compact titleRowSlot={renderTickerQueryBar()} title="Ticker">
      <div className="grid gap-6">
        {renderTickerOverview()}
        <TickerFinancialsPanel
          error={tickerFinancialsError}
          financials={tickerFinancialsQuery.data}
          isLoading={tickerFinancialsQuery.isLoading || tickerFinancialsQuery.isFetching}
        />
      </div>
    </ToolWorkspaceFrame>
  );

  function renderTickerQueryBar() {
    return (
      <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Ticker symbol</span>
            <input
              className="h-9 w-full rounded-xl border border-line/80 bg-panelSoft px-3 text-sm text-text outline-none transition focus:border-accent/60"
              data-testid="ticker-symbol-input"
              onChange={(event) => setSymbolInput(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submitTickerInput();
                }
              }}
              placeholder="Enter ticker"
              spellCheck={false}
              type="text"
              value={symbolInput}
            />
          </label>
          <button
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 px-3 text-sm font-medium text-accent transition hover:border-accent/50 hover:bg-accent/16 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="ticker-load-button"
            disabled={!symbolInput.trim() || controlsDisabled}
            onClick={submitTickerInput}
            type="button"
          >
            {tickerOverviewQuery.isFetching && symbolInput.trim().toUpperCase() === symbol ? `Loading ${symbol}...` : "Load ticker"}
          </button>
        </div>
        <div className="shrink-0 text-[11px] text-muted lg:text-right">
          {tickerOverviewQuery.isFetching
            ? "Loading quote"
            : tickerOverview
              ? `Spot ${fmtCurrencySmall(tickerOverview.quote.price)}`
              : "No quote loaded"}
        </div>
      </div>
    );
  }

  function renderTickerOverview() {
    if (tickerOverviewQuery.isLoading) {
      return <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">Loading ticker overview...</div>;
    }
    if (tickerOverviewError && !tickerOverview) {
      return <ErrorState message={tickerOverviewError} />;
    }
    if (!tickerOverview) {
      return <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">Search for a ticker to load its overview.</div>;
    }
    const rows = tickerOverviewRows(tickerOverview);
    return (
      <Panel
        action={<div className="text-xs text-muted">{formatTimestamp(tickerOverview.generatedAt)}</div>}
        eyebrow={tickerOverview.quote.marketDataStatus}
        title={`${tickerOverview.symbol} Overview`}
        topDivider={false}
      >
        <div className="overflow-hidden rounded-2xl border border-line/80 bg-panel" data-testid="ticker-overview-panel">
          <div className="grid divide-y divide-line/70 md:grid-cols-2 md:divide-x md:divide-y-0">
            {[rows.slice(0, Math.ceil(rows.length / 2)), rows.slice(Math.ceil(rows.length / 2))].map((columnRows, columnIndex) => (
              <div key={columnIndex} className="divide-y divide-line/70">
                {columnRows.map((row) => (
                  <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_minmax(9rem,auto)] items-center gap-4 px-4 py-3 text-sm">
                    <div className="text-muted">{row.label}</div>
                    {row.value}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        {tickerOverview.sourceNotice ? <div className="mt-3 text-xs text-muted">{tickerOverview.sourceNotice}</div> : null}
        {tickerOverviewError ? <div className="mt-3 text-xs text-danger">{tickerOverviewError}</div> : null}
      </Panel>
    );
  }

  function submitTickerInput() {
    const normalizedSymbol = symbolInput.trim().toUpperCase();
    if (!normalizedSymbol) {
      return;
    }
    onSymbolChange(normalizedSymbol);
  }
}

function tickerOverviewRows(overview: TickerOverviewResponse) {
  return [
    { label: "Market Cap", value: renderTickerOverviewValue(fmtCompactCurrency(overview.marketCap), fmtSignedPct(overview.marketCapChangePct)) },
    { label: "Revenue (ttm)", value: renderTickerOverviewValue(fmtCompactCurrency(overview.revenueTtm), fmtSignedPct(overview.revenueTtmChangePct)) },
    { label: "Net Income", value: renderTickerOverviewValue(fmtCompactCurrency(overview.netIncomeTtm), fmtSignedPct(overview.netIncomeTtmChangePct)) },
    { label: "EPS", value: renderTickerOverviewValue(fmtNumber(overview.epsTtm), fmtSignedPct(overview.epsTtmChangePct)) },
    { label: "Shares Out", value: renderTickerOverviewValue(fmtCompactNumber(overview.sharesOutstanding)) },
    { label: "PE Ratio", value: renderTickerOverviewValue(fmtNumber(overview.peRatio)) },
    { label: "Forward PE", value: renderTickerOverviewValue(fmtNumber(overview.forwardPeRatio)) },
    {
      label: "Dividend",
      value: renderTickerOverviewValue(
        overview.dividendAmount == null
          ? "-"
          : `${fmtCurrencySmall(overview.dividendAmount)}${overview.dividendYieldPct == null ? "" : ` (${fmtNumber(overview.dividendYieldPct)}%)`}`,
      ),
    },
    { label: "Ex-Dividend Date", value: renderTickerOverviewValue(fmtDateShort(overview.exDividendDate)) },
    { label: "Volume", value: renderTickerOverviewValue(fmtWholeNumber(overview.volume)) },
    { label: "Open", value: renderTickerOverviewValue(fmtCurrencySmall(overview.open)) },
    { label: "Previous Close", value: renderTickerOverviewValue(fmtCurrencySmall(overview.previousClose)) },
    {
      label: "Day's Range",
      value: renderTickerOverviewValue(
        overview.dayRangeLow == null || overview.dayRangeHigh == null
          ? "-"
          : `${fmtCurrencySmall(overview.dayRangeLow)} - ${fmtCurrencySmall(overview.dayRangeHigh)}`,
      ),
    },
    {
      label: "52-Week Range",
      value: renderTickerOverviewValue(
        overview.week52Low == null || overview.week52High == null
          ? "-"
          : `${fmtCurrencySmall(overview.week52Low)} - ${fmtCurrencySmall(overview.week52High)}`,
      ),
    },
    { label: "Beta", value: renderTickerOverviewValue(fmtNumber(overview.beta)) },
    { label: "Analysts", value: renderTickerOverviewValue(overview.analystRating ?? "-") },
    {
      label: "Price Target",
      value: renderTickerOverviewValue(fmtCurrencySmall(overview.priceTarget), fmtParenSignedPct(overview.priceTargetUpsidePct)),
    },
    { label: "Earnings Date", value: renderTickerOverviewValue(fmtDateShort(overview.earningsDate)) },
  ];
}

function renderTickerOverviewValue(value: string, change?: string | null) {
  return (
    <div className="flex items-baseline justify-end gap-2 text-right">
      <span className="font-medium text-text">{value}</span>
      {change ? <span className={change.startsWith("-") ? "text-danger" : "text-safe"}>{change}</span> : null}
    </div>
  );
}
