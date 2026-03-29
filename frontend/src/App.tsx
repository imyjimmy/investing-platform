import { useEffect, useState, useDeferredValue, startTransition } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { api } from "./lib/api";
import type { OpenOrderExposure, OptionPosition } from "./lib/types";
import { MetricCard } from "./components/MetricCard";
import { Panel } from "./components/Panel";
import { RiskBadge } from "./components/RiskBadge";
import { StatusBadge } from "./components/StatusBadge";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const currencySmall = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const number = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

function fmtCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return currency.format(value);
}

function fmtCurrencySmall(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return currencySmall.format(value);
}

function fmtNumber(value: number | null | undefined, suffix = "") {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return `${number.format(value)}${suffix}`;
}

function pnlTone(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "text-muted";
  }
  if (value > 0) {
    return "text-safe";
  }
  if (value < 0) {
    return "text-danger";
  }
  return "text-text";
}

function orderRiskLabel(order: OpenOrderExposure) {
  if (order.strategyTag === "cash-secured-put") {
    return "Put obligation";
  }
  if (order.secType === "STK") {
    return "Stock cash use";
  }
  if (order.strategyTag === "covered-call") {
    return "Call management";
  }
  return "Order capital";
}

function isPaperTradingAccountId(accountId: string | null | undefined) {
  if (!accountId) {
    return false;
  }
  return accountId.trim().toUpperCase().startsWith("DU");
}

function App() {
  const [chainSymbol, setChainSymbol] = useState("NVDA");
  const [selectedExpiry, setSelectedExpiry] = useState<string | undefined>(undefined);
  const [tickerFilter, setTickerFilter] = useState("");
  const [rightFilter, setRightFilter] = useState<"ALL" | "C" | "P">("ALL");
  const [shortOnly, setShortOnly] = useState(true);
  const [coveredOnly, setCoveredOnly] = useState(false);
  const [cashSecuredOnly, setCashSecuredOnly] = useState(false);
  const [nearExpiryOnly, setNearExpiryOnly] = useState(false);
  const [moneynessFilter, setMoneynessFilter] = useState<"ALL" | "ITM" | "NTM" | "OTM">("ALL");
  const [sortKey, setSortKey] = useState<keyof OptionPosition>("assignmentRiskLevel");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [movePct, setMovePct] = useState(-10);
  const [daysForward, setDaysForward] = useState(7);
  const [ivShockPct, setIvShockPct] = useState(0);

  const deferredTickerFilter = useDeferredValue(tickerFilter);

  const connectionQuery = useQuery({
    queryKey: ["connection-status"],
    queryFn: api.connectionStatus,
    refetchInterval: 10_000,
  });

  const riskSummaryQuery = useQuery({
    queryKey: ["risk-summary"],
    queryFn: api.riskSummary,
    refetchInterval: 15_000,
  });

  const optionPositionsQuery = useQuery({
    queryKey: ["option-positions"],
    queryFn: api.optionPositions,
    refetchInterval: 15_000,
  });

  const openOrdersQuery = useQuery({
    queryKey: ["open-orders"],
    queryFn: api.openOrders,
    refetchInterval: 15_000,
  });

  const chainQuery = useQuery({
    queryKey: ["chain", chainSymbol, selectedExpiry],
    queryFn: () => api.chain(chainSymbol, selectedExpiry),
    refetchInterval: 20_000,
  });

  const scenarioQuery = useQuery({
    queryKey: ["scenario", movePct, daysForward, ivShockPct],
    queryFn: () => api.scenario(movePct, daysForward, ivShockPct),
  });

  const connectMutation = useMutation({ mutationFn: api.connect });
  const reconnectMutation = useMutation({ mutationFn: api.reconnect });

  useEffect(() => {
    const nextExpiry = chainQuery.data?.selectedExpiry;
    if (nextExpiry && nextExpiry !== selectedExpiry) {
      setSelectedExpiry(nextExpiry);
    }
  }, [chainQuery.data?.selectedExpiry, selectedExpiry]);

  const risk = riskSummaryQuery.data;
  const optionPositions = optionPositionsQuery.data?.positions ?? [];
  const openOrders = openOrdersQuery.data?.orders ?? [];
  const accountId = risk?.account.accountId ?? connectionQuery.data?.accountId ?? null;
  const isPaperTrading = isPaperTradingAccountId(accountId);
  const watchlist = Array.from(new Set(["NVDA", ...(risk?.watchlist ?? []), ...optionPositions.map((position) => position.symbol)])).sort();
  const chainHasBidAsk = (chainQuery.data?.rows ?? []).some(
    (row) => row.callBid != null || row.callAsk != null || row.putBid != null || row.putAsk != null,
  );
  const chainHasOptionMarks = (chainQuery.data?.rows ?? []).some((row) => row.callMid != null || row.putMid != null);

  const filteredPositions = optionPositions
    .filter((position) => position.symbol.toLowerCase().includes(deferredTickerFilter.trim().toLowerCase()))
    .filter((position) => rightFilter === "ALL" || position.right === rightFilter)
    .filter((position) => !shortOnly || position.shortOrLong === "short")
    .filter((position) => !coveredOnly || position.strategyTag === "covered-call")
    .filter((position) => !cashSecuredOnly || position.strategyTag === "cash-secured-put")
    .filter((position) => !nearExpiryOnly || position.dte <= 7)
    .filter((position) => {
      if (moneynessFilter === "ALL") {
        return true;
      }
      const value = position.moneynessPct ?? 0;
      if (moneynessFilter === "ITM") {
        return value > 0;
      }
      if (moneynessFilter === "NTM") {
        return Math.abs(value) <= 2.5;
      }
      return value < 0;
    })
    .slice()
    .sort((left, right) => comparePositions(left, right, sortKey, sortDirection));

  const connectError = connectMutation.error instanceof Error ? connectMutation.error.message : null;
  const reconnectError = reconnectMutation.error instanceof Error ? reconnectMutation.error.message : null;

  return (
    <div className="grid-shell min-h-screen px-4 py-6 text-text md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header className="panel rounded-[28px] px-6 py-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-2 text-[11px] uppercase tracking-[0.32em] text-accent">Van Aken Investments LLC</div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-tight text-text">IBKR Options Workstation</h1>
                {isPaperTrading ? (
                  <div className="inline-flex items-center rounded-full border-2 border-danger bg-panelSoft px-4 py-1 text-sm font-medium text-text">
                    Paper Trading Acct
                  </div>
                ) : null}
              </div>
              <p className="mt-2 max-w-3xl text-sm text-muted">
                Read free liquidity, option obligations, near-term expiry risk, and short-premium opportunity without bouncing between TWS windows.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <StatusBadge status={connectionQuery.data} />
              <div className="flex gap-2">
                <button
                  className="rounded-full border border-line bg-panelSoft px-4 py-2 text-sm font-medium text-text transition hover:border-accent/40 hover:text-accent"
                  onClick={() => connectMutation.mutate()}
                  type="button"
                >
                  Connect
                </button>
                <button
                  className="rounded-full border border-line bg-panelSoft px-4 py-2 text-sm font-medium text-text transition hover:border-caution/40 hover:text-caution"
                  onClick={() => reconnectMutation.mutate()}
                  type="button"
                >
                  Reconnect
                </button>
              </div>
            </div>
          </div>
          <div className="mt-4 grid gap-3 text-sm text-muted md:grid-cols-4">
            <div className="panel-soft rounded-2xl px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.2em]">Gateway</div>
              <div className="mt-1 text-text">{connectionQuery.data ? `${connectionQuery.data.host}:${connectionQuery.data.port}` : "Loading"}</div>
            </div>
            <div className="panel-soft rounded-2xl px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.2em]">Mode</div>
              <div className="mt-1 text-text">{connectionQuery.data?.mode.toUpperCase() ?? "—"}</div>
            </div>
            <div className="panel-soft rounded-2xl px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.2em]">Data freshness</div>
              <div className="mt-1 text-text">{risk?.isStale ? "Stale snapshot" : "Live snapshot"}</div>
            </div>
            <div className="panel-soft rounded-2xl px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.2em]">Last heartbeat</div>
              <div className="mt-1 text-text">{connectionQuery.data?.lastHeartbeatAt ? formatTimestamp(connectionQuery.data.lastHeartbeatAt) : "—"}</div>
            </div>
          </div>
          {connectionQuery.data?.lastError || connectError || reconnectError ? (
            <div className="mt-4 rounded-2xl border border-danger/20 bg-danger/8 px-4 py-3 text-sm text-danger">
              {connectError ?? reconnectError ?? connectionQuery.data?.lastError}
            </div>
          ) : null}
        </header>

        <Panel title="Portfolio Overview" eyebrow="Home Screen">
          {riskSummaryQuery.isLoading ? (
            <div className="text-sm text-muted">Loading overview...</div>
          ) : risk ? (
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Net liq" value={fmtCurrency(risk.account.netLiquidation)} />
                <MetricCard label="Available funds" value={fmtCurrency(risk.account.availableFunds)} />
                <MetricCard label="Excess liquidity" value={fmtCurrency(risk.account.excessLiquidity)} />
                <MetricCard
                  label="Margin usage"
                  value={fmtNumber(risk.account.marginUsagePct, "%")}
                  tone={risk.account.marginUsagePct > 60 ? "danger" : risk.account.marginUsagePct > 40 ? "caution" : "safe"}
                />
                <MetricCard label="Open option positions" value={fmtNumber(risk.account.optionPositionsCount)} />
                <MetricCard label="Open orders" value={fmtNumber(risk.account.openOrdersCount)} />
                <MetricCard
                  label="Premium this week"
                  value={fmtCurrency(risk.premium.estimatedPremiumExpiringThisWeek)}
                  tone={risk.premium.estimatedPremiumExpiringThisWeek > 0 ? "safe" : "neutral"}
                />
                <MetricCard
                  label="Free option capacity"
                  value={fmtCurrency(risk.collateral.estimatedFreeOptionSellingCapacity)}
                  tone={
                    risk.collateral.estimatedFreeOptionSellingCapacity <= 0
                      ? "danger"
                      : risk.collateral.estimatedFreeOptionSellingCapacity < 25_000
                        ? "caution"
                        : "safe"
                  }
                />
              </div>
              <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
                <div className="panel-soft rounded-2xl p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-text">Positions closest to the money</h3>
                    <span className="text-xs uppercase tracking-[0.18em] text-muted">Short risk stack</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="text-xs uppercase tracking-[0.16em] text-muted">
                        <tr>
                          <th className="pb-3 pr-4">Ticker</th>
                          <th className="pb-3 pr-4">Contract</th>
                          <th className="pb-3 pr-4">Spot</th>
                          <th className="pb-3 pr-4">Distance</th>
                          <th className="pb-3 pr-4">DTE</th>
                          <th className="pb-3">Risk</th>
                        </tr>
                      </thead>
                      <tbody>
                        {risk.positionsClosestToMoney.map((position) => (
                          <tr key={`${position.symbol}-${position.expiry}-${position.right}-${position.strike}`} className="border-t border-line/70">
                            <td className="py-3 pr-4 font-medium text-text">{position.symbol}</td>
                            <td className="py-3 pr-4 mono text-xs text-muted">
                              {position.right}
                              {position.strike} {position.expiry}
                            </td>
                            <td className="py-3 pr-4">{fmtCurrencySmall(position.underlyingSpot)}</td>
                            <td className="py-3 pr-4">{fmtNumber(position.distanceToStrikePct, "%")}</td>
                            <td className="py-3 pr-4">{position.dte}</td>
                            <td className="py-3">
                              <RiskBadge level={position.assignmentRiskLevel} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="panel-soft rounded-2xl p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-text">Alerts</h3>
                    <span className="text-xs uppercase tracking-[0.16em] text-muted">Near-term pressure</span>
                  </div>
                  <div className="space-y-3">
                    {risk.alerts.length === 0 ? (
                      <div className="rounded-2xl border border-line/80 px-4 py-3 text-sm text-muted">No urgent alerts in the current snapshot.</div>
                    ) : (
                      risk.alerts.map((alert) => (
                        <div
                          key={`${alert.title}-${alert.detail}`}
                          className={`rounded-2xl border px-4 py-3 text-sm ${
                            alert.level === "critical"
                              ? "border-danger/25 bg-danger/8"
                              : alert.level === "warning"
                                ? "border-caution/25 bg-caution/8"
                                : "border-line/80 bg-panel"
                          }`}
                        >
                          <div className="font-medium text-text">{alert.title}</div>
                          <div className="mt-1 text-muted">{alert.detail}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <ErrorState message={riskSummaryQuery.error instanceof Error ? riskSummaryQuery.error.message : "Overview unavailable."} />
          )}
        </Panel>

        <div className="grid gap-6 xl:grid-cols-[1.5fr,0.9fr]">
          <Panel title="Option Positions" eyebrow="Positions View">
            <div className="mb-4 grid gap-3 lg:grid-cols-3 xl:grid-cols-6">
              <input
                className="rounded-2xl border border-line bg-panelSoft px-3 py-2 text-sm outline-none transition focus:border-accent/50"
                placeholder="Filter ticker"
                value={tickerFilter}
                onChange={(event) => setTickerFilter(event.target.value)}
              />
              <select
                className="rounded-2xl border border-line bg-panelSoft px-3 py-2 text-sm outline-none transition focus:border-accent/50"
                value={rightFilter}
                onChange={(event) => setRightFilter(event.target.value as "ALL" | "C" | "P")}
              >
                <option value="ALL">Calls + puts</option>
                <option value="C">Calls only</option>
                <option value="P">Puts only</option>
              </select>
              <select
                className="rounded-2xl border border-line bg-panelSoft px-3 py-2 text-sm outline-none transition focus:border-accent/50"
                value={moneynessFilter}
                onChange={(event) => setMoneynessFilter(event.target.value as "ALL" | "ITM" | "NTM" | "OTM")}
              >
                <option value="ALL">All moneyness</option>
                <option value="ITM">In the money</option>
                <option value="NTM">Near the money</option>
                <option value="OTM">Out of the money</option>
              </select>
              <ToggleChip label="Short only" checked={shortOnly} onToggle={() => setShortOnly((value) => !value)} />
              <ToggleChip label="Covered calls" checked={coveredOnly} onToggle={() => setCoveredOnly((value) => !value)} />
              <ToggleChip label="Cash-secured puts" checked={cashSecuredOnly} onToggle={() => setCashSecuredOnly((value) => !value)} />
              <ToggleChip label="Near expiry" checked={nearExpiryOnly} onToggle={() => setNearExpiryOnly((value) => !value)} />
            </div>
            {optionPositionsQuery.isLoading ? (
              <div className="text-sm text-muted">Loading option positions...</div>
            ) : optionPositionsQuery.error instanceof Error ? (
              <ErrorState message={optionPositionsQuery.error.message} />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[1180px] text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-[0.16em] text-muted">
                    <tr>
                      {[
                        ["symbol", "Ticker"],
                        ["right", "Right"],
                        ["quantity", "Qty"],
                        ["expiry", "Expiration"],
                        ["strike", "Strike"],
                        ["underlyingSpot", "Spot"],
                        ["moneynessPct", "Moneyness"],
                        ["dte", "DTE"],
                        ["avgCost", "Avg"],
                        ["currentMid", "Mark"],
                        ["unrealizedPnL", "Unreal. P/L"],
                        ["delta", "Delta"],
                        ["theta", "Theta"],
                        ["impliedVol", "IV"],
                        ["collateralEstimate", "Collateral"],
                        ["assignmentRiskLevel", "Risk"],
                      ].map(([key, label]) => (
                        <th key={key} className="pb-3 pr-4">
                          <button
                            className="flex items-center gap-1 text-left text-muted transition hover:text-text"
                            type="button"
                            onClick={() => handleSort(key as keyof OptionPosition, sortKey, sortDirection, setSortKey, setSortDirection)}
                          >
                            {label}
                            {sortKey === key ? <span>{sortDirection === "asc" ? "↑" : "↓"}</span> : null}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPositions.map((position) => (
                      <tr key={`${position.symbol}-${position.expiry}-${position.right}-${position.strike}`} className="border-t border-line/70 align-top">
                        <td className="py-3 pr-4 font-medium text-text">{position.symbol}</td>
                        <td className="py-3 pr-4">
                          <span className={`rounded-full px-2 py-1 text-xs ${position.right === "P" ? "bg-caution/10 text-caution" : "bg-accent/10 text-accent"}`}>
                            {position.right === "P" ? "Put" : "Call"}
                          </span>
                        </td>
                        <td className="py-3 pr-4">{position.quantity}</td>
                        <td className="py-3 pr-4 mono text-xs text-muted">{position.expiry}</td>
                        <td className="py-3 pr-4">{fmtCurrencySmall(position.strike)}</td>
                        <td className="py-3 pr-4">{fmtCurrencySmall(position.underlyingSpot)}</td>
                        <td className="py-3 pr-4">{fmtNumber(position.moneynessPct, "%")}</td>
                        <td className="py-3 pr-4">{position.dte}</td>
                        <td className="py-3 pr-4">{fmtCurrencySmall(position.avgCost)}</td>
                        <td className="py-3 pr-4">{fmtCurrencySmall(position.currentMid)}</td>
                        <td className={`py-3 pr-4 ${pnlTone(position.unrealizedPnL)}`}>{fmtCurrencySmall(position.unrealizedPnL)}</td>
                        <td className="py-3 pr-4">{fmtNumber(position.delta)}</td>
                        <td className="py-3 pr-4">{fmtNumber(position.theta)}</td>
                        <td className="py-3 pr-4">{fmtNumber(position.impliedVol, "%")}</td>
                        <td className="py-3 pr-4">{fmtCurrency(position.collateralEstimate)}</td>
                        <td className="py-3">
                          <div className="flex flex-col gap-2">
                            <RiskBadge level={position.assignmentRiskLevel} />
                            <span className="text-xs text-muted">{position.strategyTag.replace("-", " ")}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Orders & Commitments" eyebrow="Open Orders">
            {openOrdersQuery.isLoading ? (
              <div className="text-sm text-muted">Loading open orders...</div>
            ) : openOrdersQuery.error instanceof Error ? (
              <ErrorState message={openOrdersQuery.error.message} />
            ) : openOrdersQuery.data ? (
              <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <MetricCard label="Committed capital" value={fmtCurrency(openOrdersQuery.data.totalCommittedCapital)} />
                  <MetricCard label="Put-selling reserve" value={fmtCurrency(openOrdersQuery.data.putSellingCapital)} />
                  <MetricCard label="Stock order reserve" value={fmtCurrency(openOrdersQuery.data.stockOrderCapital)} />
                </div>
                <div className="space-y-3">
                  {openOrdersQuery.data.orders.map((order) => (
                    <div key={order.orderId} className="panel-soft rounded-2xl p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="text-sm font-medium text-text">
                            {order.symbol} {order.secType === "OPT" && order.right ? `${order.right}${order.strike}` : ""}
                          </div>
                          <div className="mt-1 text-xs uppercase tracking-[0.16em] text-muted">
                            {order.side} {fmtNumber(order.quantity)} {order.orderType} {order.expiry ?? ""}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-text">{fmtCurrency(order.estimatedCapitalImpact)}</div>
                          <div className="text-xs text-muted">{orderRiskLabel(order)}</div>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 text-sm text-muted sm:grid-cols-3">
                        <div>Limit: <span className="text-text">{fmtCurrencySmall(order.limitPrice)}</span></div>
                        <div>Intent: <span className="text-text capitalize">{order.openingOrClosing}</span></div>
                        <div>Credit: <span className="text-text">{fmtCurrencySmall(order.estimatedCredit)}</span></div>
                      </div>
                      {order.note ? <div className="mt-2 text-sm text-muted">{order.note}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </Panel>
        </div>

        <Panel
          title="Chain Explorer"
          eyebrow="NVDA / IREN / AXTI / PYPL"
          action={
            <div className="flex flex-wrap gap-2">
              {watchlist.map((symbol) => (
                <button
                  key={symbol}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    chainSymbol === symbol
                      ? "border-accent/50 bg-accent/10 text-accent"
                      : "border-line bg-panelSoft text-muted hover:border-accent/30 hover:text-text"
                  }`}
                  onClick={() =>
                    startTransition(() => {
                      setChainSymbol(symbol);
                      setSelectedExpiry(undefined);
                    })
                  }
                  type="button"
                >
                  {symbol}
                </button>
              ))}
            </div>
          }
        >
          {chainQuery.isLoading ? (
            <div className="text-sm text-muted">Loading chain...</div>
          ) : chainQuery.error instanceof Error ? (
            <ErrorState message={chainQuery.error.message} />
          ) : chainQuery.data ? (
            <div className="grid gap-5">
              {chainQuery.data.quoteNotice ? (
                <div
                  className={`rounded-2xl border px-4 py-3 text-sm ${
                    chainQuery.data.quoteSource === "historical"
                      ? "border-accent/25 bg-accent/8 text-accent"
                      : "border-caution/25 bg-caution/8 text-caution"
                  }`}
                >
                  {chainQuery.data.quoteNotice}
                </div>
              ) : !chainHasBidAsk && chainHasOptionMarks ? (
                <div className="rounded-2xl border border-accent/25 bg-accent/8 px-4 py-3 text-sm text-accent">
                  Weekend / off-hours session. The mids below are the latest available option marks from IBKR for this paper session, so live bid/ask, IV, and Greeks may remain blank until the market reopens and the API data entitlements are active.
                </div>
              ) : null}
              <div className="grid gap-4 lg:grid-cols-[1fr,320px]">
                <div className="grid gap-3 md:grid-cols-4">
                  <MetricCard label="Underlying" value={fmtCurrencySmall(chainQuery.data.underlying.price)} />
                  <MetricCard label="Bid / ask" value={`${fmtCurrencySmall(chainQuery.data.underlying.bid)} / ${fmtCurrencySmall(chainQuery.data.underlying.ask)}`} />
                  <MetricCard label="Data mode" value={chainQuery.data.underlying.marketDataStatus} />
                  <div className="panel-soft rounded-2xl p-4">
                    <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-muted">Expiration</div>
                    <select
                      className="w-full rounded-xl border border-line bg-panel px-3 py-2 text-sm text-text outline-none transition focus:border-accent/40"
                      value={selectedExpiry ?? chainQuery.data.selectedExpiry}
                      onChange={(event) => setSelectedExpiry(event.target.value)}
                    >
                      {chainQuery.data.expiries.map((expiry) => (
                        <option key={expiry} value={expiry}>
                          {expiry}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid gap-3">
                  {chainQuery.data.highlights.map((highlight) => (
                    <div key={`${highlight.label}-${highlight.strike}`} className="panel-soft rounded-2xl p-4">
                      <div className="text-[11px] uppercase tracking-[0.22em] text-muted">{highlight.label}</div>
                      <div className="mt-2 text-lg font-semibold text-text">
                        {highlight.right} {fmtCurrencySmall(highlight.strike)}
                      </div>
                      <div className="mt-1 text-sm text-muted">
                        {highlight.metricLabel}: <span className="text-text">{fmtNumber(highlight.metricValue, "%")}</span>
                      </div>
                      <div className="mt-2 text-sm text-muted">{highlight.description}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[1180px] text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-[0.16em] text-muted">
                    <tr>
                      <th className="pb-3 pr-4">Call bid</th>
                      <th className="pb-3 pr-4">Call ask</th>
                      <th className="pb-3 pr-4">Call mid</th>
                      <th className="pb-3 pr-4">Call IV</th>
                      <th className="pb-3 pr-4">Call delta</th>
                      <th className="pb-3 pr-4">Call yield</th>
                      <th className="pb-3 pr-4">Strike</th>
                      <th className="pb-3 pr-4">Distance</th>
                      <th className="pb-3 pr-4">Put yield</th>
                      <th className="pb-3 pr-4">Put delta</th>
                      <th className="pb-3 pr-4">Put IV</th>
                      <th className="pb-3 pr-4">Put mid</th>
                      <th className="pb-3 pr-4">Put ask</th>
                      <th className="pb-3">Put bid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chainQuery.data.rows.map((row) => (
                      <tr key={row.strike} className="border-t border-line/70">
                        <td className="py-3 pr-4">{fmtCurrencySmall(row.callBid)}</td>
                        <td className="py-3 pr-4">{fmtCurrencySmall(row.callAsk)}</td>
                        <td className="py-3 pr-4 text-accent">{fmtCurrencySmall(row.callMid)}</td>
                        <td className="py-3 pr-4">{fmtNumber(row.callIV, "%")}</td>
                        <td className="py-3 pr-4">{fmtNumber(row.callDelta)}</td>
                        <td className="py-3 pr-4">{fmtNumber(row.callAnnualizedYieldPct, "%")}</td>
                        <td className="py-3 pr-4 font-medium text-text">{fmtCurrencySmall(row.strike)}</td>
                        <td className={`py-3 pr-4 ${row.distanceFromSpotPct < 0 ? "text-danger" : "text-safe"}`}>{fmtNumber(row.distanceFromSpotPct, "%")}</td>
                        <td className="py-3 pr-4">{fmtNumber(row.putAnnualizedYieldPct, "%")}</td>
                        <td className="py-3 pr-4">{fmtNumber(row.putDelta)}</td>
                        <td className="py-3 pr-4">{fmtNumber(row.putIV, "%")}</td>
                        <td className="py-3 pr-4 text-caution">{fmtCurrencySmall(row.putMid)}</td>
                        <td className="py-3 pr-4">{fmtCurrencySmall(row.putAsk)}</td>
                        <td className="py-3">{fmtCurrencySmall(row.putBid)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </Panel>

        <div className="grid gap-6 xl:grid-cols-[1fr,1fr]">
          <Panel title="Risk View" eyebrow="Concentration + Expiry Buckets">
            {risk ? (
              <div className="grid gap-6">
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={risk.exposureByTicker.slice(0, 8)}>
                      <CartesianGrid stroke="rgba(95, 144, 146, 0.12)" vertical={false} />
                      <XAxis dataKey="symbol" stroke="#8ea7a4" tickLine={false} axisLine={false} />
                      <YAxis stroke="#8ea7a4" tickLine={false} axisLine={false} tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
                      <Tooltip
                        cursor={{ fill: "rgba(255,255,255,0.03)" }}
                        contentStyle={{ background: "#102126", border: "1px solid rgba(95,144,146,0.16)", borderRadius: 16 }}
                        formatter={(value: number) => fmtCurrency(value)}
                      />
                      <Bar dataKey="shortPutCollateral" fill="#f7c85b" radius={[8, 8, 0, 0]} name="Short put collateral" />
                      <Bar dataKey="openOrderCapital" fill="#66d0bf" radius={[8, 8, 0, 0]} name="Open order capital" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-[11px] uppercase tracking-[0.16em] text-muted">
                      <tr>
                        <th className="pb-3 pr-4">Ticker</th>
                        <th className="pb-3 pr-4">Concentration</th>
                        <th className="pb-3 pr-4">Stock value</th>
                        <th className="pb-3 pr-4">Put collateral</th>
                        <th className="pb-3 pr-4">Open order cap</th>
                        <th className="pb-3">Risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {risk.exposureByTicker.map((row) => (
                        <tr key={row.symbol} className="border-t border-line/70">
                          <td className="py-3 pr-4 font-medium text-text">{row.symbol}</td>
                          <td className="py-3 pr-4">{fmtNumber(row.concentrationPct, "%")}</td>
                          <td className="py-3 pr-4">{fmtCurrency(row.stockMarketValue)}</td>
                          <td className="py-3 pr-4">{fmtCurrency(row.shortPutCollateral)}</td>
                          <td className="py-3 pr-4">{fmtCurrency(row.openOrderCapital)}</td>
                          <td className="py-3">
                            <RiskBadge level={row.riskLevel} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <ErrorState message="Risk summary unavailable." />
            )}
          </Panel>

          <Panel title="Exposure by Expiry" eyebrow="Expiry Stack">
            {risk ? (
              <div className="grid gap-6">
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={risk.exposureByExpiry}>
                      <CartesianGrid stroke="rgba(95, 144, 146, 0.12)" vertical={false} />
                      <XAxis dataKey="weekLabel" stroke="#8ea7a4" tickLine={false} axisLine={false} />
                      <YAxis stroke="#8ea7a4" tickLine={false} axisLine={false} tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
                      <Tooltip
                        cursor={{ fill: "rgba(255,255,255,0.03)" }}
                        contentStyle={{ background: "#102126", border: "1px solid rgba(95,144,146,0.16)", borderRadius: 16 }}
                        formatter={(value: number) => fmtCurrency(value)}
                      />
                      <Bar dataKey="shortPutCollateral" fill="#ef6b62" radius={[8, 8, 0, 0]} name="Short put collateral" />
                      <Bar dataKey="premiumExpiringThisWeek" fill="#3bc48d" radius={[8, 8, 0, 0]} name="Premium this week" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid gap-3">
                  {risk.exposureByExpiry.map((row) => (
                    <div key={row.expiry} className="panel-soft rounded-2xl p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-sm font-medium text-text">{row.expiry}</div>
                          <div className="text-xs uppercase tracking-[0.16em] text-muted">
                            {row.positionsCount} positions • {row.coveredCallContracts} covered calls
                          </div>
                        </div>
                        <div className="grid gap-1 text-right text-sm">
                          <div className="text-text">{fmtCurrency(row.shortPutCollateral)}</div>
                          <div className="text-muted">{row.assignmentRiskContracts} elevated/high-risk contracts</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <ErrorState message="Expiry exposures unavailable." />
            )}
          </Panel>
        </div>

        <Panel title="Scenario View" eyebrow="Portfolio Shock Test">
          <div className="mb-5 grid gap-3 lg:grid-cols-4">
            <RangeField label="Spot move %" value={movePct} min={-30} max={30} step={1} onChange={setMovePct} />
            <RangeField label="Days forward" value={daysForward} min={0} max={45} step={1} onChange={setDaysForward} />
            <RangeField label="IV shock %" value={ivShockPct} min={-30} max={100} step={5} onChange={setIvShockPct} />
            <div className="panel-soft rounded-2xl p-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Approx total P/L</div>
              <div className={`mt-2 text-2xl font-semibold ${pnlTone(scenarioQuery.data?.totalApproxPnL)}`}>
                {fmtCurrency(scenarioQuery.data?.totalApproxPnL)}
              </div>
              <div className="mt-2 text-sm text-muted">Intrinsic-value shock only. Time decay and vol path are still heuristic.</div>
            </div>
          </div>
          {scenarioQuery.isLoading ? (
            <div className="text-sm text-muted">Running scenario...</div>
          ) : scenarioQuery.error instanceof Error ? (
            <ErrorState message={scenarioQuery.error.message} />
          ) : scenarioQuery.data ? (
            <div className="grid gap-4 xl:grid-cols-[0.9fr,1.1fr]">
              <div className="grid gap-3">
                <MetricCard label="Assigned put notional" value={fmtCurrency(scenarioQuery.data.totalAssignedPutNotional)} tone="caution" />
                <MetricCard label="Call-away notional" value={fmtCurrency(scenarioQuery.data.totalCallAwayNotional)} />
                <div className="panel-soft rounded-2xl p-4 text-sm text-muted">{scenarioQuery.data.methodology}</div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[860px] text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-[0.16em] text-muted">
                    <tr>
                      <th className="pb-3 pr-4">Ticker</th>
                      <th className="pb-3 pr-4">Current</th>
                      <th className="pb-3 pr-4">Projected</th>
                      <th className="pb-3 pr-4">Stock P/L</th>
                      <th className="pb-3 pr-4">Option P/L</th>
                      <th className="pb-3 pr-4">Assigned puts</th>
                      <th className="pb-3">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenarioQuery.data.impacts.map((impact) => (
                      <tr key={impact.symbol} className="border-t border-line/70">
                        <td className="py-3 pr-4 font-medium text-text">{impact.symbol}</td>
                        <td className="py-3 pr-4">{fmtCurrencySmall(impact.currentPrice)}</td>
                        <td className="py-3 pr-4">{fmtCurrencySmall(impact.projectedPrice)}</td>
                        <td className={`py-3 pr-4 ${pnlTone(impact.stockPnL)}`}>{fmtCurrencySmall(impact.stockPnL)}</td>
                        <td className={`py-3 pr-4 ${pnlTone(impact.optionIntrinsicPnL)}`}>{fmtCurrencySmall(impact.optionIntrinsicPnL)}</td>
                        <td className="py-3 pr-4">{fmtCurrency(impact.assignedPutNotional)}</td>
                        <td className={`py-3 ${pnlTone(impact.totalApproxPnL)}`}>{fmtCurrencySmall(impact.totalApproxPnL)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}

function ToggleChip({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      className={`rounded-2xl border px-3 py-2 text-sm transition ${
        checked ? "border-accent/45 bg-accent/10 text-accent" : "border-line bg-panelSoft text-muted hover:text-text"
      }`}
      onClick={onToggle}
      type="button"
    >
      {label}
    </button>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="panel-soft rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-muted">
        <span>{label}</span>
        <span className="text-text">{value}</span>
      </div>
      <input
        className="w-full accent-accent"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return <div className="rounded-2xl border border-danger/20 bg-danger/8 px-4 py-3 text-sm text-danger">{message}</div>;
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function comparePositions(
  left: OptionPosition,
  right: OptionPosition,
  key: keyof OptionPosition,
  direction: "asc" | "desc",
) {
  const factor = direction === "asc" ? 1 : -1;
  const valueLeft = sortableValue(left, key);
  const valueRight = sortableValue(right, key);
  if (valueLeft < valueRight) {
    return -1 * factor;
  }
  if (valueLeft > valueRight) {
    return 1 * factor;
  }
  return left.symbol.localeCompare(right.symbol);
}

function sortableValue(position: OptionPosition, key: keyof OptionPosition) {
  if (key === "assignmentRiskLevel") {
    return { Low: 0, Moderate: 1, Elevated: 2, High: 3 }[position.assignmentRiskLevel];
  }
  const value = position[key];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return value;
  }
  return -Infinity;
}

function handleSort(
  nextKey: keyof OptionPosition,
  currentKey: keyof OptionPosition,
  currentDirection: "asc" | "desc",
  setKey: (key: keyof OptionPosition) => void,
  setDirection: (direction: "asc" | "desc") => void,
) {
  if (nextKey === currentKey) {
    setDirection(currentDirection === "asc" ? "desc" : "asc");
    return;
  }
  setKey(nextKey);
  setDirection(nextKey === "expiry" || nextKey === "dte" ? "asc" : "desc");
}

export default App;
