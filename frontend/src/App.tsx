import { useEffect, useState, useDeferredValue, startTransition, type ReactNode } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
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
import type {
  ChainRow,
  ConnectionStatus,
  EdgarDownloadRequest,
  EdgarDownloadResponse,
  FilesystemDocumentFolderResponse,
  FilesystemConnectorPortfolioResponse,
  FilesystemConnectorStatus,
  InvestorPdfDownloadRequest,
  InvestorPdfDownloadResponse,
  OpenOrderExposure,
  OptionChainResponse,
  OrderCancelResponse,
  OptionOrderPreview,
  OptionOrderRequest,
  OptionPosition,
  Position,
  SubmittedOrder,
  TickerOverviewResponse,
} from "./lib/types";
import {
  DASHBOARD_ACCOUNTS,
  DEFAULT_DASHBOARD_ACCOUNT_KEY,
  dashboardAccountHasAttachedSource,
  dashboardAccountOwnsRoute,
  getDashboardAccountByKey,
  getDashboardAccountWithAttachedSource,
  type DashboardAccountKey,
} from "./config/dashboardAccounts";
import { CONNECTOR_CATALOG, getConnectorCatalogEntry, type ConnectorCatalogId } from "./config/connectorCatalog";
import { AccountDashboardView } from "./components/AccountDashboardView";
import { AccountConnectorSection } from "./components/AccountConnectorSection";
import { CoinbaseAccountSource } from "./components/account-sources/CoinbaseAccountSource";
import { FilesystemAccountSourceContent } from "./components/account-sources/FilesystemAccountSourceContent";
import { FilesystemAccountSourceList } from "./components/account-sources/FilesystemAccountSourceList";
import { EdgarWorkspace } from "./components/EdgarWorkspace";
import { InvestorPdfsWorkspace } from "./components/InvestorPdfsWorkspace";
import { MetricCard } from "./components/MetricCard";
import {
  OptionBuilderTool,
  OptionScannerTool,
  OptionStructuresTool,
  OptionValuationTool,
  OptionVolatilityTool,
  type OptionToolSharedProps,
} from "./components/options/OptionToolWorkspaces";
import {
  OptionsChainTable,
  type OptionsChainGreekOption,
  type TicketContractSide,
} from "./components/options/OptionsChainTable";
import { useOptionChain } from "./components/options/useOptionChain";
import { Panel } from "./components/Panel";

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

const compactCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

const number = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const greekNumber = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 3,
});

const wholeNumber = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
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

function fmtCompactCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return compactCurrency.format(value);
}

function fmtCompactNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return compactNumber.format(value);
}

function fmtSignedPct(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return null;
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${number.format(value)}%`;
}

function fmtParenSignedPct(value: number | null | undefined) {
  const formatted = fmtSignedPct(value);
  return formatted ? `(${formatted})` : null;
}

function fmtDateShort(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function fmtGreek(value: number | null | undefined, suffix = "") {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return `${greekNumber.format(value)}${suffix}`;
}

function fmtWholeNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return wholeNumber.format(value);
}

function fmtCoverageCount(available: number, total: number) {
  return `${wholeNumber.format(available)}/${wholeNumber.format(total)}`;
}

function fmtBillions(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return `${number.format(value)}B`;
}

function fmtMillions(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return `${wholeNumber.format(value)}M`;
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

function pnlMetricTone(value: number | null | undefined): "neutral" | "safe" | "danger" {
  if (value == null || Number.isNaN(value) || value === 0) {
    return "neutral";
  }
  return value > 0 ? "safe" : "danger";
}

function sumPositionPnl(positions: Position[]) {
  return positions.reduce((total, position) => total + (position.unrealizedPnL ?? 0) + (position.realizedPnL ?? 0), 0);
}

function sumOptionPositionPnl(positions: OptionPosition[]) {
  return positions.reduce((total, position) => total + (position.unrealizedPnL ?? 0) + (position.realizedPnL ?? 0), 0);
}

function isOptionsWorkspace(workspace: WorkspaceSurface) {
  return (
    workspace === "options" ||
    workspace === "optionsValuation" ||
    workspace === "optionsBuilder" ||
    workspace === "optionsStructures" ||
    workspace === "optionsVolatility" ||
    workspace === "optionsScanner"
  );
}

function filesystemConnectorTone(
  status: FilesystemConnectorStatus | undefined,
  detailIsStale: boolean,
  detailError: string | null,
): ConnectionHealthTone {
  if (!status) {
    return "caution";
  }
  if (status.status === "degraded") {
    return "caution";
  }
  if (!status.connected) {
    return "planned";
  }
  return detailIsStale || Boolean(detailError) ? "caution" : "safe";
}

function filesystemConnectorStatusLabel(
  status: FilesystemConnectorStatus | undefined,
  detailIsStale: boolean,
  detailError: string | null,
) {
  if (!status) {
    return "Checking";
  }
  if (!status.connected) {
    return "Ready";
  }
  if (status.status === "degraded" || detailIsStale || detailError) {
    return "Connected · stale snapshot";
  }
  return "Connected";
}

function isConnectedSourceTone(tone: ConnectionHealthTone) {
  return tone === "safe" || tone === "caution";
}

function toInlinePillTone(tone: ConnectionHealthTone): InlinePillTone {
  if (tone === "safe") {
    return "safe";
  }
  if (tone === "caution") {
    return "caution";
  }
  if (tone === "danger") {
    return "danger";
  }
  return "neutral";
}

function sumAccountSourceMetric(summaries: AccountSourceSummary[], key: AccountSourceSummaryMetricKey) {
  const values = summaries
    .map((summary) => summary[key])
    .filter((value): value is number => value != null && !Number.isNaN(value));
  if (!values.length) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0);
}

function describeAccountSourceMetricCoverage(summaries: AccountSourceSummary[], key: AccountSourceSummaryMetricKey) {
  if (!summaries.length) {
    return "No account sources attached.";
  }
  const contributingSources = summaries.filter((summary) => summary[key] != null && !Number.isNaN(summary[key]));
  if (!contributingSources.length) {
    return `Reported by 0/${summaries.length} sources.`;
  }
  return `Reported by ${contributingSources.length}/${summaries.length} sources.`;
}

function isLocalBackendUnavailable(message: string | null | undefined) {
  return Boolean(message && message.includes("Could not reach local backend at"));
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

function uniqueAccounts(accounts: Array<string | null | undefined>) {
  return Array.from(new Set(accounts.map((accountId) => accountId?.trim().toUpperCase()).filter(Boolean) as string[]));
}

function routeKindFromAccountId(accountId: string | null | undefined): "live" | "paper" | "unknown" {
  if (!accountId) {
    return "unknown";
  }
  return accountId.trim().toUpperCase().startsWith("DU") ? "paper" : "live";
}

function routePresentation(routeKind: "live" | "paper" | "unknown") {
  if (routeKind === "paper") {
    return { label: "Paper trading", tone: "accent" as const };
  }
  if (routeKind === "live") {
    return { label: "Live trading", tone: "danger" as const };
  }
  return { label: "Route pending", tone: "neutral" as const };
}

type InlinePillTone = "neutral" | "safe" | "caution" | "danger" | "accent";

function gatewaySessionPresentation(status: ConnectionStatus | undefined): { label: string; tone: InlinePillTone } {
  if (!status) {
    return { label: "Gateway checking", tone: "neutral" };
  }
  if (!status.connected) {
    return { label: "Gateway offline", tone: "danger" };
  }
  if (status.marketDataMode === "LIVE") {
    return { label: "Gateway connected", tone: "safe" };
  }
  if (status.marketDataMode === "DELAYED" || status.marketDataMode === "DELAYED_FROZEN") {
    return { label: "Gateway delayed", tone: "caution" };
  }
  if (status.marketDataMode === "FROZEN") {
    return { label: "Gateway frozen", tone: "caution" };
  }
  return { label: `Gateway ${status.marketDataMode.toLowerCase()}`, tone: "neutral" };
}

function executionRoutePresentation(
  status: ConnectionStatus | undefined,
): { accountId: string | null; label: string; tone: InlinePillTone; routeKind: "live" | "paper" | "unknown" } {
  if (!status) {
    return { accountId: null, label: "Route checking", tone: "neutral", routeKind: "unknown" };
  }
  if (!status.connected) {
    return { accountId: null, label: "Route offline", tone: "danger", routeKind: "unknown" };
  }
  if (!status.accountId) {
    return { accountId: null, label: "Route unavailable", tone: "caution", routeKind: "unknown" };
  }
  const routeKind = status.routedAccountType ?? routeKindFromAccountId(status.accountId);
  const presentation = routePresentation(routeKind);
  return {
    accountId: status.accountId,
    label: presentation.label,
    tone: presentation.tone,
    routeKind,
  };
}

function optionDataSourcePresentation(
  chain: OptionChainResponse | null | undefined,
  status: ConnectionStatus | undefined,
  hasBidAsk: boolean,
  hasMarks: boolean,
): { label: string; tone: InlinePillTone } {
  if (chain?.isStale) {
    if (chain.quoteSource === "historical") {
      return { label: "Data source · cached historical chain", tone: "caution" };
    }
    if (chain.quoteSource === "streaming") {
      return { label: "Data source · cached streaming chain", tone: "caution" };
    }
    return { label: "Data source · cached chain", tone: "caution" };
  }
  if (chain?.quoteSource === "historical") {
    return { label: "Data source · historical fallback", tone: "caution" };
  }
  if (chain?.underlying.marketDataStatus === "DELAYED" || chain?.underlying.marketDataStatus === "DELAYED_FROZEN") {
    if (hasBidAsk) {
      return { label: "Data source · delayed IBKR", tone: "caution" };
    }
    if (hasMarks) {
      return { label: "Data source · delayed marks only", tone: "caution" };
    }
    return { label: "Data source · delayed IBKR", tone: "caution" };
  }
  if (chain?.underlying.marketDataStatus === "FROZEN") {
    return { label: hasMarks ? "Data source · frozen marks only" : "Data source · frozen IBKR", tone: "caution" };
  }
  if (chain?.quoteSource === "streaming") {
    return hasBidAsk ? { label: "Data source · streaming IBKR", tone: "safe" } : { label: "Data source · marks only", tone: "neutral" };
  }
  if (chain?.quoteSource === "unavailable") {
    return { label: "Data source · quotes unavailable", tone: "danger" };
  }
  if (!status) {
    return { label: "Data source · checking", tone: "neutral" };
  }
  if (!status.connected) {
    return { label: "Data source · gateway offline", tone: "danger" };
  }
  if (status.marketDataMode === "LIVE") {
    return { label: "Data source · gateway connected", tone: "safe" };
  }
  if (status.marketDataMode === "DELAYED" || status.marketDataMode === "DELAYED_FROZEN") {
    return { label: "Data source · delayed session", tone: "caution" };
  }
  return { label: "Data source · connected session", tone: "neutral" };
}

function optionQuoteStatePresentation({
  chain,
  hasBidAsk,
  hasMarks,
  isLoadingDifferentSymbol,
}: {
  chain: OptionChainResponse | null | undefined;
  hasBidAsk: boolean;
  hasMarks: boolean;
  isLoadingDifferentSymbol: boolean;
}): { label: string; tone: InlinePillTone } {
  if (isLoadingDifferentSymbol) {
    return { label: "Loading requested symbol", tone: "accent" };
  }
  if (!chain) {
    return { label: "No chain loaded", tone: "neutral" };
  }
  if (chain.isStale) {
    if (hasBidAsk) {
      return { label: "Cached bid/ask", tone: "caution" };
    }
    if (hasMarks) {
      return { label: "Cached marks", tone: "caution" };
    }
    return { label: "Cached quotes", tone: "caution" };
  }
  if (chain.quoteSource === "historical") {
    return { label: hasMarks ? "Historical marks" : "Historical fallback", tone: "caution" };
  }
  if (chain.quoteSource === "streaming") {
    if (hasBidAsk) {
      return { label: "Streaming bid/ask", tone: "safe" };
    }
    if (hasMarks) {
      return { label: "Streaming marks", tone: "neutral" };
    }
  }
  if (hasMarks) {
    return { label: "Marks only", tone: "neutral" };
  }
  return { label: "Quotes unavailable", tone: "danger" };
}

function optionQuoteSourcePresentation(chain: OptionChainResponse | null | undefined): { label: string; tone: InlinePillTone } {
  if (!chain) {
    return { label: "Source unavailable", tone: "neutral" };
  }
  if (chain.isStale) {
    if (chain.quoteSource === "historical") {
      return { label: "Cached historical", tone: "caution" };
    }
    if (chain.quoteSource === "streaming") {
      return { label: "Cached streaming", tone: "caution" };
    }
    return { label: "Cached chain", tone: "caution" };
  }
  if (chain.quoteSource === "streaming") {
    return { label: "Current session", tone: "safe" };
  }
  if (chain.quoteSource === "historical") {
    return { label: "Historical fallback", tone: "caution" };
  }
  return { label: "No option quotes", tone: "danger" };
}

type MarketSector =
  | "Communication Services"
  | "Consumer"
  | "Energy"
  | "Financials"
  | "Healthcare"
  | "Industrials"
  | "Materials"
  | "Semiconductors"
  | "Software"
  | "Space"
  | "Technology";
type MarketSortKey = "beta" | "avgDollarVolumeM" | "weekChangePct" | "monthChangePct" | "shortInterestPct";
type MarketPreset = "high-beta" | "squeeze-watch" | "liquid-leaders" | "reset";
type MarketRow = {
  symbol: string;
  name: string;
  sector: MarketSector;
  price: number;
  beta: number;
  weekChangePct: number;
  monthChangePct: number;
  avgDollarVolumeM: number;
  marketCapB: number;
  shortInterestPct: number;
  optionsable: boolean;
  shortable: boolean;
};

type TicketDraft = {
  symbol: string;
  expiry: string;
  strike: number;
  right: TicketContractSide;
  referencePrice: number | null;
  bid: number | null;
  ask: number | null;
};

type SourceTone = "live" | "off" | "planned";
type WorkspaceSurface =
  | "dashboard"
  | "market"
  | "ticker"
  | "options"
  | "optionsValuation"
  | "optionsBuilder"
  | "optionsStructures"
  | "optionsVolatility"
  | "optionsScanner"
  | "crypto"
  | "cryptoLeverage"
  | "research"
  | "globalSettings";
type ConnectionHealthTone = "safe" | "caution" | "danger" | "planned";

type AccountConnectorCard = {
  id: string;
  title: string;
  status: string;
  detail: string;
  tone: ConnectionHealthTone;
  countsTowardHealth: boolean;
  icon: ReactNode;
};

type AccountSourceSummaryMetricKey = "totalPnl" | "todayPnl" | "monthlyPnl" | "netWorth";

type AccountSourceSummary = AccountConnectorCard & {
  totalPnl: number | null;
  todayPnl: number | null;
  monthlyPnl: number | null;
  netWorth: number | null;
};

type ConnectorDraftState = {
  displayName: string;
  directoryPath: string;
  detectFooter: boolean;
};

type ChainGreekKey = "iv" | "delta" | "gamma" | "theta" | "vega" | "rho";

type ChainGreekOption = OptionsChainGreekOption;

const CHAIN_GREEK_STORAGE_KEY = "options-chain-visible-greeks";
const CHAIN_MARK_STORAGE_KEY = "options-chain-show-mark";
const OPTIONS_TRADE_RAIL_STORAGE_KEY = "options-trade-rail-open";
const DEFAULT_VISIBLE_CHAIN_GREEKS: ChainGreekKey[] = ["iv", "delta", "gamma", "theta", "vega"];
const CHAIN_GREEK_OPTIONS: ChainGreekOption[] = [
  {
    key: "iv",
    label: "IV",
    callValue: (row) => row.callIV,
    putValue: (row) => row.putIV,
    suffix: "%",
  },
  {
    key: "delta",
    label: "Delta",
    callValue: (row) => row.callDelta,
    putValue: (row) => row.putDelta,
  },
  {
    key: "gamma",
    label: "Gamma",
    callValue: (row) => row.callGamma,
    putValue: (row) => row.putGamma,
  },
  {
    key: "theta",
    label: "Theta",
    callValue: (row) => row.callTheta,
    putValue: (row) => row.putTheta,
  },
  {
    key: "vega",
    label: "Vega",
    callValue: (row) => row.callVega,
    putValue: (row) => row.putVega,
  },
  {
    key: "rho",
    label: "Rho",
    callValue: (row) => row.callRho,
    putValue: (row) => row.putRho,
  },
];

const MARKET_SORT_OPTIONS: Array<{ key: MarketSortKey; label: string }> = [
  { key: "beta", label: "Highest beta" },
  { key: "avgDollarVolumeM", label: "Most liquid" },
  { key: "weekChangePct", label: "Strongest 1W move" },
  { key: "monthChangePct", label: "Strongest 1M move" },
  { key: "shortInterestPct", label: "Highest short interest" },
];

const MARKET_SCREEN_ROWS: MarketRow[] = [
  { symbol: "SMCI", name: "Super Micro Computer", sector: "Technology", price: 84.2, beta: 2.63, weekChangePct: 9.1, monthChangePct: 18.6, avgDollarVolumeM: 1880, marketCapB: 49.1, shortInterestPct: 9.4, optionsable: true, shortable: true },
  { symbol: "MSTR", name: "Strategy", sector: "Technology", price: 1712.5, beta: 2.58, weekChangePct: 7.3, monthChangePct: 24.8, avgDollarVolumeM: 2140, marketCapB: 115.4, shortInterestPct: 7.2, optionsable: true, shortable: true },
  { symbol: "UPST", name: "Upstart Holdings", sector: "Financials", price: 41.8, beta: 2.52, weekChangePct: 11.2, monthChangePct: 16.5, avgDollarVolumeM: 402, marketCapB: 4.1, shortInterestPct: 14.6, optionsable: true, shortable: true },
  { symbol: "COIN", name: "Coinbase Global", sector: "Financials", price: 238.7, beta: 2.34, weekChangePct: 5.7, monthChangePct: 14.9, avgDollarVolumeM: 1675, marketCapB: 58.8, shortInterestPct: 5.9, optionsable: true, shortable: true },
  { symbol: "APP", name: "AppLovin", sector: "Software", price: 79.4, beta: 2.29, weekChangePct: 8.8, monthChangePct: 19.2, avgDollarVolumeM: 923, marketCapB: 27.4, shortInterestPct: 6.1, optionsable: true, shortable: true },
  { symbol: "AFRM", name: "Affirm Holdings", sector: "Financials", price: 48.9, beta: 2.23, weekChangePct: 4.4, monthChangePct: 10.1, avgDollarVolumeM: 611, marketCapB: 15.2, shortInterestPct: 8.3, optionsable: true, shortable: true },
  { symbol: "SOUN", name: "SoundHound AI", sector: "Software", price: 6.3, beta: 2.21, weekChangePct: 14.6, monthChangePct: 27.3, avgDollarVolumeM: 278, marketCapB: 2.5, shortInterestPct: 15.8, optionsable: true, shortable: true },
  { symbol: "RKLB", name: "Rocket Lab", sector: "Space", price: 10.4, beta: 2.16, weekChangePct: 6.5, monthChangePct: 12.6, avgDollarVolumeM: 246, marketCapB: 5.1, shortInterestPct: 9.8, optionsable: true, shortable: true },
  { symbol: "IONQ", name: "IonQ", sector: "Technology", price: 13.9, beta: 2.09, weekChangePct: 3.2, monthChangePct: 9.4, avgDollarVolumeM: 190, marketCapB: 3.0, shortInterestPct: 12.2, optionsable: true, shortable: true },
  { symbol: "ASTS", name: "AST SpaceMobile", sector: "Space", price: 5.9, beta: 2.04, weekChangePct: 12.4, monthChangePct: 31.8, avgDollarVolumeM: 162, marketCapB: 1.8, shortInterestPct: 24.7, optionsable: true, shortable: true },
  { symbol: "PLTR", name: "Palantir Technologies", sector: "Software", price: 31.6, beta: 1.91, weekChangePct: 2.7, monthChangePct: 8.2, avgDollarVolumeM: 1540, marketCapB: 72.6, shortInterestPct: 4.6, optionsable: true, shortable: true },
  { symbol: "NVDA", name: "NVIDIA", sector: "Semiconductors", price: 201.0, beta: 1.88, weekChangePct: 5.5, monthChangePct: 13.7, avgDollarVolumeM: 9320, marketCapB: 4930.0, shortInterestPct: 1.1, optionsable: true, shortable: true },
  { symbol: "CELH", name: "Celsius Holdings", sector: "Consumer", price: 63.5, beta: 1.82, weekChangePct: -1.9, monthChangePct: 6.3, avgDollarVolumeM: 294, marketCapB: 14.8, shortInterestPct: 11.4, optionsable: true, shortable: true },
  { symbol: "CRWD", name: "CrowdStrike", sector: "Software", price: 388.1, beta: 1.74, weekChangePct: 3.9, monthChangePct: 7.8, avgDollarVolumeM: 1234, marketCapB: 95.1, shortInterestPct: 2.0, optionsable: true, shortable: true },
  { symbol: "HIMS", name: "Hims & Hers Health", sector: "Healthcare", price: 18.4, beta: 1.72, weekChangePct: 10.9, monthChangePct: 22.6, avgDollarVolumeM: 211, marketCapB: 4.2, shortInterestPct: 13.2, optionsable: true, shortable: true },
  { symbol: "HOOD", name: "Robinhood Markets", sector: "Financials", price: 22.8, beta: 1.67, weekChangePct: 4.8, monthChangePct: 11.7, avgDollarVolumeM: 708, marketCapB: 20.3, shortInterestPct: 6.9, optionsable: true, shortable: true },
  { symbol: "XOM", name: "Exxon Mobil", sector: "Energy", price: 119.7, beta: 1.58, weekChangePct: 1.2, monthChangePct: 4.6, avgDollarVolumeM: 1410, marketCapB: 475.0, shortInterestPct: 0.8, optionsable: true, shortable: true },
  { symbol: "FCX", name: "Freeport-McMoRan", sector: "Materials", price: 46.1, beta: 1.55, weekChangePct: 2.3, monthChangePct: 5.4, avgDollarVolumeM: 497, marketCapB: 66.0, shortInterestPct: 1.9, optionsable: true, shortable: true },
];

const CSV_FOLDER_CONNECTOR_ID: ConnectorCatalogId = "csvFolder";
const PDF_FOLDER_CONNECTOR_ID: ConnectorCatalogId = "pdfFolder";

function readVisibleChainGreeks(): ChainGreekKey[] {
  if (typeof window === "undefined") {
    return [...DEFAULT_VISIBLE_CHAIN_GREEKS];
  }
  try {
    const raw = window.localStorage.getItem(CHAIN_GREEK_STORAGE_KEY);
    if (!raw) {
      return [...DEFAULT_VISIBLE_CHAIN_GREEKS];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [...DEFAULT_VISIBLE_CHAIN_GREEKS];
    }
    return parsed.filter((value): value is ChainGreekKey => CHAIN_GREEK_OPTIONS.some((option) => option.key === value));
  } catch {
    return [...DEFAULT_VISIBLE_CHAIN_GREEKS];
  }
}

function readShowChainMark(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    const raw = window.localStorage.getItem(CHAIN_MARK_STORAGE_KEY);
    if (raw == null) {
      return true;
    }
    return raw === "true";
  } catch {
    return true;
  }
}

function readOptionsTradeRailOpen(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    const raw = window.localStorage.getItem(OPTIONS_TRADE_RAIL_STORAGE_KEY);
    if (raw == null) {
      return true;
    }
    return raw === "true";
  } catch {
    return true;
  }
}

function App() {
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [connectorPickerOpen, setConnectorPickerOpen] = useState(false);
  const [ibkrConnectorCollapsed, setIbkrConnectorCollapsed] = useState(false);
  const [coinbaseConnectorCollapsed, setCoinbaseConnectorCollapsed] = useState(false);
  const [filesystemConnectorCollapsedBySourceId, setFilesystemConnectorCollapsedBySourceId] = useState<Record<string, boolean>>({});
  const [connectorSetupError, setConnectorSetupError] = useState<string | null>(null);
  const [connectorDraftsById, setConnectorDraftsById] = useState<Partial<Record<ConnectorCatalogId, ConnectorDraftState>>>({});
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceSurface>("dashboard");
  const [selectedDashboardAccountKey, setSelectedDashboardAccountKey] = useState<DashboardAccountKey>(DEFAULT_DASHBOARD_ACCOUNT_KEY);
  const [marketMinBeta, setMarketMinBeta] = useState(1.7);
  const [marketMinPrice, setMarketMinPrice] = useState(10);
  const [marketMinDollarVolumeM, setMarketMinDollarVolumeM] = useState(200);
  const [marketMinShortInterestPct, setMarketMinShortInterestPct] = useState(0);
  const [marketSearch, setMarketSearch] = useState("");
  const [marketSectorFilter, setMarketSectorFilter] = useState<MarketSector | "All">("All");
  const [marketSortKey, setMarketSortKey] = useState<MarketSortKey>("beta");
  const [marketOptionableOnly, setMarketOptionableOnly] = useState(true);
  const [marketShortableOnly, setMarketShortableOnly] = useState(false);
  const [showChainMark, setShowChainMark] = useState<boolean>(() => readShowChainMark());
  const [optionsTradeRailOpen, setOptionsTradeRailOpen] = useState<boolean>(() => readOptionsTradeRailOpen());
  const [visibleChainGreeks, setVisibleChainGreeks] = useState<ChainGreekKey[]>(() => readVisibleChainGreeks());
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(undefined);
  const [ticketDraft, setTicketDraft] = useState<TicketDraft | null>(null);
  const [ticketAction, setTicketAction] = useState<"BUY" | "SELL">("SELL");
  const [ticketQuantity, setTicketQuantity] = useState(1);
  const [ticketOrderType, setTicketOrderType] = useState<"LMT" | "MKT">("LMT");
  const [ticketLimitPrice, setTicketLimitPrice] = useState("");
  const [ticketTif, setTicketTif] = useState<"DAY" | "GTC">("DAY");
  const [previewRequestKey, setPreviewRequestKey] = useState<string | null>(null);
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
  const [edgarSyncing, setEdgarSyncing] = useState(false);
  const [edgarSyncResult, setEdgarSyncResult] = useState<EdgarDownloadResponse | undefined>(undefined);
  const [edgarSyncError, setEdgarSyncError] = useState<string | null>(null);
  const [investorPdfSyncing, setInvestorPdfSyncing] = useState(false);
  const [investorPdfSyncResult, setInvestorPdfSyncResult] = useState<InvestorPdfDownloadResponse | undefined>(undefined);
  const [investorPdfSyncError, setInvestorPdfSyncError] = useState<string | null>(null);
  const deferredTickerFilter = useDeferredValue(tickerFilter);
  const {
    activeDisplayedChain,
    activeExpiry,
    chainBandFetchDirection,
    chainErrorHeaderLabel,
    chainHasBidAsk,
    chainHasOptionMarks,
    chainLoadedRangePct,
    chainQuery,
    chainSymbol,
    chainSymbolInput,
    displayedChainRows,
    displayedExpiries,
    handleChainSymbolSelection,
    handleExpirySelection,
    isLoadingDifferentSymbol,
    maxChainWindowPct,
    requestWiderChainWindow,
    rowDisplayStates,
    selectedExpiry,
    setChainSymbolInput,
    submitChainSymbolInput,
    tickerOverviewQuery,
  } = useOptionChain("NVDA");

  const connectionQuery = useQuery({
    queryKey: ["connection-status"],
    queryFn: api.connectionStatus,
    refetchInterval: 10_000,
  });
  const coinbaseStatusQuery = useQuery({
    queryKey: ["coinbase-status"],
    queryFn: api.coinbaseStatus,
    refetchInterval: 30_000,
  });
  const coinbasePortfolioQuery = useQuery({
    queryKey: ["coinbase-portfolio"],
    queryFn: api.coinbasePortfolio,
    enabled: coinbaseStatusQuery.data?.available ?? false,
    refetchInterval: 30_000,
  });
  const filesystemConnectorStatusesQuery = useQuery({
    queryKey: ["filesystem-connector-statuses", selectedDashboardAccountKey],
    queryFn: () => api.filesystemConnectorStatuses(selectedDashboardAccountKey),
    refetchInterval: 30_000,
  });
  const filesystemConnectorStatuses = filesystemConnectorStatusesQuery.data ?? [];
  const filesystemCsvConnectorStatuses = filesystemConnectorStatuses.filter((status) => status.connectorId === CSV_FOLDER_CONNECTOR_ID);
  const filesystemPdfConnectorStatuses = filesystemConnectorStatuses.filter((status) => status.connectorId === PDF_FOLDER_CONNECTOR_ID);
  const filesystemConnectorPortfolioQueries = useQueries({
    queries: filesystemCsvConnectorStatuses.map((connectorStatus) => ({
      queryKey: ["filesystem-connector-portfolio", selectedDashboardAccountKey, connectorStatus.sourceId],
      queryFn: () => api.filesystemConnectorPortfolio(selectedDashboardAccountKey, connectorStatus.sourceId),
      enabled: connectorStatus.connected,
      refetchInterval: 30_000,
    })),
  });
  const filesystemConnectorDocumentQueries = useQueries({
    queries: filesystemPdfConnectorStatuses.map((connectorStatus) => ({
      queryKey: ["filesystem-connector-documents", selectedDashboardAccountKey, connectorStatus.sourceId],
      queryFn: () => api.filesystemConnectorDocuments(selectedDashboardAccountKey, connectorStatus.sourceId),
      enabled: connectorStatus.connected,
      refetchInterval: 30_000,
    })),
  });
  const cryptoMajorsQuery = useQuery({
    queryKey: ["crypto-majors"],
    queryFn: api.cryptoMajors,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const riskSummaryQuery = useQuery({
    queryKey: ["risk-summary", selectedAccountId],
    queryFn: () => api.riskSummary(selectedAccountId),
    refetchInterval: false,
  });

  const positionsQuery = useQuery({
    queryKey: ["positions", selectedAccountId],
    queryFn: () => api.positions(selectedAccountId),
    refetchInterval: false,
  });

  const optionPositionsQuery = useQuery({
    queryKey: ["option-positions", selectedAccountId],
    queryFn: () => api.optionPositions(selectedAccountId),
    refetchInterval: false,
  });

  const openOrdersQuery = useQuery({
    queryKey: ["open-orders", selectedAccountId],
    queryFn: () => api.openOrders(selectedAccountId),
    refetchInterval: false,
  });

  const scenarioQuery = useQuery({
    queryKey: ["scenario", selectedAccountId, movePct, daysForward, ivShockPct],
    queryFn: () => api.scenario(movePct, daysForward, ivShockPct, selectedAccountId),
  });
  const edgarStatusQuery = useQuery({
    queryKey: ["edgar-status"],
    queryFn: api.edgarStatus,
  });
  const investorPdfStatusQuery = useQuery({
    queryKey: ["investor-pdf-status"],
    queryFn: api.investorPdfStatus,
  });

  const connectMutation = useMutation({ mutationFn: api.connect });
  const reconnectMutation = useMutation({ mutationFn: api.reconnect });
  const filesystemConnectorConfigureMutation = useMutation({
    mutationFn: ({
      accountKey,
      connectorId,
      displayName,
      directoryPath,
      detectFooter,
      sourceId,
    }: {
      accountKey: DashboardAccountKey;
      connectorId: ConnectorCatalogId;
      displayName: string;
      directoryPath: string;
      detectFooter: boolean;
      sourceId?: string;
    }) => api.filesystemConnectorConfigure(accountKey, connectorId, { displayName, directoryPath, detectFooter }, sourceId),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["filesystem-connector-statuses", variables.accountKey] }),
        queryClient.invalidateQueries({ queryKey: ["filesystem-connector-portfolio", variables.accountKey] }),
        queryClient.invalidateQueries({ queryKey: ["filesystem-connector-documents", variables.accountKey] }),
      ]);
    },
  });
  const edgarDownloadMutation = useMutation({
    mutationFn: api.edgarDownload,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["edgar-status"] });
    },
  });
  const investorPdfDownloadMutation = useMutation({
    mutationFn: api.investorPdfDownload,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["investor-pdf-status"] });
    },
  });
  const previewMutation = useMutation({
    mutationFn: api.previewOptionOrder,
    onSuccess: (_data, variables) => setPreviewRequestKey(JSON.stringify(variables)),
  });
  const submitMutation = useMutation({
    mutationFn: api.submitOptionOrder,
    onSuccess: async (_data, variables) => {
      setPreviewRequestKey(JSON.stringify(variables));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["risk-summary", selectedAccountId] }),
        queryClient.invalidateQueries({ queryKey: ["option-positions", selectedAccountId] }),
        queryClient.invalidateQueries({ queryKey: ["open-orders", selectedAccountId] }),
      ]);
    },
  });
  const cancelMutation = useMutation({
    mutationFn: ({ orderId, accountId }: { orderId: number; accountId: string }) => api.cancelOrder(orderId, accountId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["risk-summary", selectedAccountId] }),
        queryClient.invalidateQueries({ queryKey: ["option-positions", selectedAccountId] }),
        queryClient.invalidateQueries({ queryKey: ["open-orders", selectedAccountId] }),
      ]);
    },
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(CHAIN_GREEK_STORAGE_KEY, JSON.stringify(visibleChainGreeks));
  }, [visibleChainGreeks]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(CHAIN_MARK_STORAGE_KEY, String(showChainMark));
  }, [showChainMark]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(OPTIONS_TRADE_RAIL_STORAGE_KEY, String(optionsTradeRailOpen));
  }, [optionsTradeRailOpen]);

  useEffect(() => {
    const availableAccounts = uniqueAccounts([
      ...(connectionQuery.data?.managedAccounts ?? []),
      connectionQuery.data?.accountId,
      riskSummaryQuery.data?.account.accountId,
    ]);
    if (availableAccounts.length === 0) {
      return;
    }
    if (!selectedAccountId || !availableAccounts.includes(selectedAccountId)) {
      setSelectedAccountId(availableAccounts[0]);
    }
  }, [connectionQuery.data?.accountId, connectionQuery.data?.managedAccounts, riskSummaryQuery.data?.account.accountId, selectedAccountId]);

  useEffect(() => {
    if (!accountSettingsOpen) {
      setConnectorPickerOpen(false);
      setConnectorSetupError(null);
    }
  }, [accountSettingsOpen]);

  useEffect(() => {
    if (!connectorPickerOpen) {
      return;
    }
    setConnectorDraftsById({});
  }, [connectorPickerOpen]);

  useEffect(() => {
    if (!ticketDraft) {
      return;
    }
    if (ticketDraft.symbol !== chainSymbol) {
      setTicketDraft(null);
      setPreviewRequestKey(null);
      previewMutation.reset();
      submitMutation.reset();
    }
  }, [chainSymbol, previewMutation, submitMutation, ticketDraft]);

  useEffect(() => {
    if (!ticketDraft || !selectedExpiry) {
      return;
    }
    if (ticketDraft.expiry !== selectedExpiry) {
      setTicketDraft(null);
      setPreviewRequestKey(null);
      previewMutation.reset();
      submitMutation.reset();
    }
  }, [previewMutation, selectedExpiry, submitMutation, ticketDraft]);

  useEffect(() => {
    if (!sidebarOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sidebarOpen]);

  const risk = riskSummaryQuery.data;
  const positions = positionsQuery.data?.positions ?? [];
  const optionPositions = optionPositionsQuery.data?.positions ?? [];
  const openOrders = openOrdersQuery.data?.orders ?? [];
  const accountId = risk?.account.accountId ?? connectionQuery.data?.accountId ?? null;
  const tickerOverview = tickerOverviewQuery.data;
  const tickerOverviewError = tickerOverviewQuery.error instanceof Error ? tickerOverviewQuery.error.message : null;
  const openOptionOrders = openOrders.filter((order) => order.secType === "OPT");
  const executionEnabled = connectionQuery.data?.executionMode === "enabled";
  const selectedAccount = selectedAccountId ?? accountId ?? undefined;
  const activeExecutionRoute = executionRoutePresentation(connectionQuery.data);
  const routedAccount = activeExecutionRoute.accountId;
  const routedAccountPill = { label: activeExecutionRoute.label, tone: activeExecutionRoute.tone };
  const optionsDataSourcePill = optionDataSourcePresentation(activeDisplayedChain, connectionQuery.data, chainHasBidAsk, chainHasOptionMarks);
  const parsedLimitPrice = ticketOrderType === "LMT" ? Number(ticketLimitPrice) : null;
  const validLimitPrice =
    ticketOrderType === "MKT" ? null : Number.isFinite(parsedLimitPrice) && parsedLimitPrice != null && parsedLimitPrice > 0 ? parsedLimitPrice : null;
  const ticketRequest: OptionOrderRequest | null =
    ticketDraft && selectedAccount && (ticketOrderType === "MKT" || validLimitPrice != null)
      ? {
          accountId: selectedAccount,
          symbol: ticketDraft.symbol,
          expiry: ticketDraft.expiry,
          strike: ticketDraft.strike,
          right: ticketDraft.right,
          action: ticketAction,
          quantity: Math.max(1, Math.floor(ticketQuantity || 1)),
          orderType: ticketOrderType,
          limitPrice: ticketOrderType === "LMT" ? validLimitPrice : null,
          tif: ticketTif,
        }
      : null;
  const ticketRequestKey = ticketRequest ? JSON.stringify(ticketRequest) : null;
  const previewIsCurrent = Boolean(previewMutation.data && previewRequestKey && ticketRequestKey === previewRequestKey);
  const submitIsCurrent = Boolean(submitMutation.data && previewRequestKey && ticketRequestKey === previewRequestKey);
  const previewError = previewMutation.error instanceof Error ? previewMutation.error.message : null;
  const submitError = submitMutation.error instanceof Error ? submitMutation.error.message : null;
  const cancelError = cancelMutation.error instanceof Error ? cancelMutation.error.message : null;
  const canPreviewTicket = executionEnabled && Boolean(ticketRequest);
  const canSubmitTicket = canPreviewTicket && previewIsCurrent;

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

  function loadTicket(row: ChainRow, right: TicketContractSide) {
    const referencePrice =
      right === "C" ? row.callMid ?? row.callAsk ?? row.callBid ?? null : row.putMid ?? row.putAsk ?? row.putBid ?? null;
    setTicketDraft({
      symbol: chainSymbol,
      expiry: selectedExpiry ?? activeDisplayedChain?.selectedExpiry ?? "",
      strike: row.strike,
      right,
      referencePrice,
      bid: right === "C" ? row.callBid : row.putBid,
      ask: right === "C" ? row.callAsk : row.putAsk,
    });
    setTicketAction("SELL");
    setTicketQuantity(1);
    setTicketOrderType("LMT");
    setTicketLimitPrice(referencePrice != null ? referencePrice.toFixed(2) : "");
    setTicketTif("DAY");
    previewMutation.reset();
    submitMutation.reset();
    cancelMutation.reset();
    setPreviewRequestKey(null);
  }

  const connectError = connectMutation.error instanceof Error ? connectMutation.error.message : null;
  const reconnectError = reconnectMutation.error instanceof Error ? reconnectMutation.error.message : null;
  const connectionQueryError = connectionQuery.error instanceof Error ? connectionQuery.error.message : null;
  const connectionEndpoint = connectionQuery.data ? `${connectionQuery.data.host}:${connectionQuery.data.port}` : "127.0.0.1:4002";
  const sourceError = connectError ?? reconnectError ?? connectionQueryError ?? connectionQuery.data?.lastError ?? null;
  const coinbaseStatusError = coinbaseStatusQuery.error instanceof Error ? coinbaseStatusQuery.error.message : null;
  const coinbasePortfolioError = coinbasePortfolioQuery.error instanceof Error ? coinbasePortfolioQuery.error.message : null;
  const filesystemConnectorStatusesError =
    filesystemConnectorStatusesQuery.error instanceof Error ? filesystemConnectorStatusesQuery.error.message : null;
  const filesystemConnectorStatusBySourceId = Object.fromEntries(
    filesystemConnectorStatuses.map((status) => [status.sourceId, status]),
  ) as Record<string, FilesystemConnectorStatus>;
  const filesystemConnectorPortfolioBySourceId = Object.fromEntries(
    filesystemConnectorPortfolioQueries.flatMap((query, index) => {
      const sourceId = filesystemCsvConnectorStatuses[index]?.sourceId;
      return sourceId && query.data ? [[sourceId, query.data]] : [];
    }),
  ) as Record<string, FilesystemConnectorPortfolioResponse>;
  const filesystemConnectorPortfolioLoadingBySourceId = Object.fromEntries(
    filesystemConnectorPortfolioQueries.flatMap((query, index) => {
      const sourceId = filesystemCsvConnectorStatuses[index]?.sourceId;
      return sourceId ? [[sourceId, query.isLoading]] : [];
    }),
  ) as Record<string, boolean>;
  const filesystemConnectorPortfolioErrorBySourceId = Object.fromEntries(
    filesystemConnectorPortfolioQueries.flatMap((query, index) => {
      const sourceId = filesystemCsvConnectorStatuses[index]?.sourceId;
      const error = query.error instanceof Error ? query.error.message : null;
      return sourceId ? [[sourceId, error]] : [];
    }),
  ) as Record<string, string | null>;
  const filesystemDocumentFolderBySourceId = Object.fromEntries(
    filesystemConnectorDocumentQueries.flatMap((query, index) => {
      const sourceId = filesystemPdfConnectorStatuses[index]?.sourceId;
      return sourceId && query.data ? [[sourceId, query.data]] : [];
    }),
  ) as Record<string, FilesystemDocumentFolderResponse>;
  const filesystemDocumentFolderLoadingBySourceId = Object.fromEntries(
    filesystemConnectorDocumentQueries.flatMap((query, index) => {
      const sourceId = filesystemPdfConnectorStatuses[index]?.sourceId;
      return sourceId ? [[sourceId, query.isLoading]] : [];
    }),
  ) as Record<string, boolean>;
  const filesystemDocumentFolderErrorBySourceId = Object.fromEntries(
    filesystemConnectorDocumentQueries.flatMap((query, index) => {
      const sourceId = filesystemPdfConnectorStatuses[index]?.sourceId;
      const error = query.error instanceof Error ? query.error.message : null;
      return sourceId ? [[sourceId, error]] : [];
    }),
  ) as Record<string, string | null>;
  const coinbaseConnectorTone: ConnectionHealthTone = coinbaseStatusQuery.isLoading
    ? "caution"
    : coinbaseStatusQuery.data?.available
      ? coinbasePortfolioQuery.data?.isStale || Boolean(coinbasePortfolioError)
        ? "caution"
        : "safe"
      : "danger";
  const coinbaseConnectorStatus = coinbaseStatusQuery.isLoading
    ? "Checking"
    : coinbasePortfolioQuery.isLoading
      ? "Syncing"
      : coinbaseStatusQuery.data?.available
        ? coinbasePortfolioQuery.data?.isStale
          ? "Connected · stale snapshot"
          : "Connected"
        : coinbaseStatusQuery.data?.authMode === "missing"
          ? "Needs setup"
          : "Degraded";
  const coinbaseAssignedAccount = getDashboardAccountWithAttachedSource("coinbase");
  const coinbaseConnectorDetail = coinbaseStatusQuery.isLoading
    ? "Loading Coinbase connector status"
    : coinbaseStatusQuery.data?.available
      ? `Assigned to ${coinbaseAssignedAccount?.name ?? "configured"} dashboard`
      : `Connector settings for ${coinbaseAssignedAccount?.name ?? "configured"} dashboard`;
  const localBackendUnavailable =
    isLocalBackendUnavailable(connectionQueryError) ||
    isLocalBackendUnavailable(filesystemConnectorStatusesError) ||
    Object.values(filesystemConnectorPortfolioErrorBySourceId).some((message) => isLocalBackendUnavailable(message)) ||
    Object.values(filesystemDocumentFolderErrorBySourceId).some((message) => isLocalBackendUnavailable(message));
  const edgarStatusError = edgarStatusQuery.error instanceof Error ? edgarStatusQuery.error.message : null;
  const investorPdfStatusError = investorPdfStatusQuery.error instanceof Error ? investorPdfStatusQuery.error.message : null;
  const dataModeLabel = connectionQuery.data?.mode === "ibkr" ? "IBKR gateway session" : "Mock snapshot";
  const executionModeLabel = executionEnabled ? "Gateway-routed execution" : "Disabled";
  const refreshCadenceLabel = "Conn 10s · Risk 15s · Chain 20s";
  const heartbeatLabel = connectionQuery.data?.lastHeartbeatAt ? formatTimestamp(connectionQuery.data.lastHeartbeatAt) : "No heartbeat";
  const connectionEndpointLabel = connectionQuery.data?.connected ? `Connected on ${connectionEndpoint}` : connectionEndpoint;
  const selectedDashboardAccount = getDashboardAccountByKey(selectedDashboardAccountKey);
  const selectedDashboardOwnsRoute = dashboardAccountOwnsRoute(selectedDashboardAccount.key, routedAccount);
  const dashboardRisk = selectedDashboardOwnsRoute ? risk : null;
  const dashboardPositions = selectedDashboardOwnsRoute ? positions : [];
  const dashboardOptionPositions = selectedDashboardOwnsRoute ? optionPositions : [];
  const dashboardOpenOrders = selectedDashboardOwnsRoute ? openOrders : [];
  const globalSourceCards: AccountConnectorCard[] = [
    {
      id: "edgar",
      title: "EDGAR",
      status: edgarStatusQuery.isLoading ? "Checking" : edgarSyncing ? "Syncing" : edgarStatusQuery.data?.available ? "Ready" : "Offline",
      detail: edgarStatusQuery.isLoading ? "Loading SEC filing source state" : edgarStatusError ?? "SEC filing research source",
      tone: edgarStatusQuery.isLoading ? "caution" : edgarStatusQuery.data?.available ? "safe" : "danger",
      countsTowardHealth: true,
      icon: <DocumentIcon />,
    },
    {
      id: "investor-pdfs",
      title: "Investor PDFs",
      status: investorPdfStatusQuery.isLoading ? "Checking" : investorPdfSyncing ? "Syncing" : investorPdfStatusQuery.data?.available ? "Ready" : "Offline",
      detail: investorPdfStatusQuery.isLoading ? "Loading investor PDF source state" : investorPdfStatusError ?? "Annual reports and exhibit PDF library",
      tone: investorPdfStatusQuery.isLoading ? "caution" : investorPdfStatusQuery.data?.available ? "safe" : "danger",
      countsTowardHealth: true,
      icon: <PdfLibraryIcon />,
    },
  ];
  function buildIbkrConnectorCard(accountKey: DashboardAccountKey): AccountConnectorCard {
    const ownsRoute = dashboardAccountOwnsRoute(accountKey, routedAccount);
    return {
      id: `ibkr-${accountKey}`,
      title: "IBKR route",
      status: connectionQuery.isLoading
        ? "Checking"
        : ownsRoute
          ? risk?.isStale
            ? "Connected · stale snapshot"
            : "Connected"
          : connectionQuery.data?.connected
            ? "Connected to another route"
            : "Disconnected",
      detail: connectionQuery.isLoading
        ? "Loading broker route state"
        : ownsRoute
          ? `${connectionEndpoint} · ${executionEnabled ? "execution enabled" : "execution disabled"}`
          : sourceError ?? (routedAccount ? `Current Gateway route is ${routedAccount}` : `${connectionEndpoint} · waiting for gateway`),
      tone: connectionQuery.isLoading
        ? "caution"
        : ownsRoute
          ? (risk?.isStale ? "caution" : "safe")
          : connectionQuery.data?.connected
            ? "caution"
            : "danger",
      countsTowardHealth: true,
      icon: <BrokerIcon />,
    };
  }

  function buildIbkrAccountSourceSummary(accountKey: DashboardAccountKey): AccountSourceSummary {
    const connector = buildIbkrConnectorCard(accountKey);
    const ownsRoute = dashboardAccountOwnsRoute(accountKey, routedAccount);
    return {
      ...connector,
      totalPnl: ownsRoute ? sumPositionPnl(positions) + sumOptionPositionPnl(optionPositions) : null,
      todayPnl: null,
      monthlyPnl: null,
      netWorth: ownsRoute ? risk?.account.netLiquidation ?? null : null,
    };
  }

  function buildCoinbaseAccountSourceSummary(accountKey: DashboardAccountKey): AccountSourceSummary {
    return {
      id: `coinbase-${accountKey}`,
      title: "Coinbase account",
      status: coinbaseConnectorStatus,
      detail: coinbaseConnectorDetail,
      tone: coinbaseConnectorTone,
      countsTowardHealth: true,
      icon: <CoinbaseIcon />,
      totalPnl: null,
      todayPnl: null,
      monthlyPnl: null,
      netWorth: coinbasePortfolioQuery.data?.totalUsdValue ?? null,
    };
  }

  function buildFilesystemConnectorCard(status: FilesystemConnectorStatus): AccountConnectorCard {
    const connector = getConnectorCatalogEntry(status.connectorId as ConnectorCatalogId);
    const portfolio = filesystemConnectorPortfolioBySourceId[status.sourceId];
    const portfolioError = filesystemConnectorPortfolioErrorBySourceId[status.sourceId] ?? null;
    const documentFolder = filesystemDocumentFolderBySourceId[status.sourceId];
    const documentFolderError = filesystemDocumentFolderErrorBySourceId[status.sourceId] ?? null;
    const detailIsStale = status.connectorId === CSV_FOLDER_CONNECTOR_ID ? Boolean(portfolio?.isStale) : Boolean(documentFolder?.isStale);
    const detailError = status.connectorId === CSV_FOLDER_CONNECTOR_ID ? portfolioError : documentFolderError;
    const connectorTone = localBackendUnavailable
      ? "danger"
      : filesystemConnectorTone(status, detailIsStale, detailError ?? filesystemConnectorStatusesError);
    const connectorStatus = localBackendUnavailable
      ? "Backend unavailable"
      : filesystemConnectorStatusLabel(status, detailIsStale, detailError ?? filesystemConnectorStatusesError);
    const connectorDetail = localBackendUnavailable
      ? connectionQueryError ?? filesystemConnectorStatusesError ?? detailError ?? "The local backend is unavailable."
      : status.directoryPath
        ? `${status.directoryPath} · ${fmtWholeNumber(
            status.connectorId === CSV_FOLDER_CONNECTOR_ID
              ? status.csvFilesCount
              : documentFolder?.pdfFilesCount ?? 0,
          )} files`
        : status.detail;
    return {
      id: status.sourceId,
      title: status.displayName?.trim() || connector?.dashboardTitle || "CSV Folder",
      status: connectorStatus,
      detail: connectorDetail,
      tone: connectorTone,
      countsTowardHealth: true,
      icon: <BankIcon />,
    };
  }

  function buildFilesystemAccountSourceSummary(status: FilesystemConnectorStatus): AccountSourceSummary {
    const connector = buildFilesystemConnectorCard(status);
    const portfolio = filesystemConnectorPortfolioBySourceId[status.sourceId];
    return {
      ...connector,
      totalPnl:
        status.connectorId === CSV_FOLDER_CONNECTOR_ID
          ? portfolio?.holdings.reduce((total, holding) => total + (holding.gainLoss ?? 0), 0) ?? null
          : null,
      todayPnl: null,
      monthlyPnl: null,
      netWorth: status.connectorId === CSV_FOLDER_CONNECTOR_ID ? portfolio?.totalValue ?? null : null,
    };
  }

  const accountSourceSummaries: AccountSourceSummary[] = [buildIbkrAccountSourceSummary(selectedDashboardAccount.key)];
  if (dashboardAccountHasAttachedSource(selectedDashboardAccount, "coinbase")) {
    accountSourceSummaries.push(buildCoinbaseAccountSourceSummary(selectedDashboardAccount.key));
  }
  const filesystemAccountSourceSummaries = filesystemConnectorStatuses.map((status) => buildFilesystemAccountSourceSummary(status));
  accountSourceSummaries.push(...filesystemAccountSourceSummaries);
  const accountSettingsConnectors = accountSourceSummaries;
  const definedConnectors = accountSourceSummaries.filter((connector) => connector.countsTowardHealth);
  const definedConnectorCount = definedConnectors.length;
  const liveConnectorCount = definedConnectors.filter((connector) => connector.tone === "safe").length;
  const connectedConnectorCount = definedConnectors.filter((connector) => isConnectedSourceTone(connector.tone)).length;
  const availableConnectorOptions = CONNECTOR_CATALOG.filter((connector) => connector.availability === "ready");
  const availableConnectorCount = availableConnectorOptions.length;
  const accountStatusTone: ConnectionHealthTone =
    connectedConnectorCount === 0 ? "danger" : liveConnectorCount === definedConnectorCount ? "safe" : "caution";
  const accountStatusLabel =
    accountStatusTone === "safe"
      ? "All connectors live"
      : accountStatusTone === "caution"
        ? "Partial connector coverage"
        : "No live connectors";
  const dashboardTotalPnl = sumAccountSourceMetric(accountSourceSummaries, "totalPnl");
  const dashboardTodayPnl = sumAccountSourceMetric(accountSourceSummaries, "todayPnl");
  const dashboardMonthlyPnl = sumAccountSourceMetric(accountSourceSummaries, "monthlyPnl");
  const dashboardNetWorth = sumAccountSourceMetric(accountSourceSummaries, "netWorth");
  const dashboardTodayPnlHint = describeAccountSourceMetricCoverage(accountSourceSummaries, "todayPnl");
  const dashboardMonthlyPnlHint = describeAccountSourceMetricCoverage(accountSourceSummaries, "monthlyPnl");
  const dashboardNetWorthHint = describeAccountSourceMetricCoverage(accountSourceSummaries, "netWorth");
  const ibkrAccountSourceSummary = accountSourceSummaries.find((summary) => summary.id === `ibkr-${selectedDashboardAccount.key}`) ?? null;
  const coinbaseAccountSourceSummary =
    accountSourceSummaries.find((summary) => summary.id === `coinbase-${selectedDashboardAccount.key}`) ?? null;
  const filesystemAccountSourceItems = filesystemAccountSourceSummaries.map((filesystemAccountSourceSummary) => {
    const filesystemStatus = filesystemConnectorStatusBySourceId[filesystemAccountSourceSummary.id];
    return {
      id: filesystemAccountSourceSummary.id,
      title: filesystemAccountSourceSummary.title,
      status: filesystemAccountSourceSummary.status,
      tone: toInlinePillTone(filesystemAccountSourceSummary.tone),
      connectorId: (filesystemStatus?.connectorId as ConnectorCatalogId | undefined) ?? CSV_FOLDER_CONNECTOR_ID,
    };
  });
  const dashboardHeaderRouteLabel =
    selectedDashboardOwnsRoute && routedAccount ? `${routedAccount} · ${routedAccountPill.label}` : "No active broker route for this account";
  const marketGatewayPill = gatewaySessionPresentation(connectionQuery.data);
  const marketSearchNeedle = marketSearch.trim().toLowerCase();
  const marketScreenRows = MARKET_SCREEN_ROWS
    .filter((row) => !marketSearchNeedle || row.symbol.toLowerCase().includes(marketSearchNeedle) || row.name.toLowerCase().includes(marketSearchNeedle))
    .filter((row) => row.beta >= marketMinBeta)
    .filter((row) => row.price >= marketMinPrice)
    .filter((row) => row.avgDollarVolumeM >= marketMinDollarVolumeM)
    .filter((row) => row.shortInterestPct >= marketMinShortInterestPct)
    .filter((row) => marketSectorFilter === "All" || row.sector === marketSectorFilter)
    .filter((row) => !marketOptionableOnly || row.optionsable)
    .filter((row) => !marketShortableOnly || row.shortable)
    .slice()
    .sort((left, right) => {
      const delta = right[marketSortKey] - left[marketSortKey];
      if (Math.abs(delta) > 0.0001) {
        return delta;
      }
      return right.beta - left.beta;
    });

  function getConnectorDraft(connectorId: ConnectorCatalogId): ConnectorDraftState {
    return connectorDraftsById[connectorId] ?? { displayName: "", directoryPath: "", detectFooter: true };
  }

  function updateConnectorDraft(connectorId: ConnectorCatalogId, patch: Partial<ConnectorDraftState>) {
    setConnectorDraftsById((current) => ({
      ...current,
      [connectorId]: {
        displayName: patch.displayName ?? current[connectorId]?.displayName ?? "",
        directoryPath: patch.directoryPath ?? current[connectorId]?.directoryPath ?? "",
        detectFooter: patch.detectFooter ?? current[connectorId]?.detectFooter ?? true,
      },
    }));
  }
  const marketTopRows = marketScreenRows.slice(0, 12);
  const marketChartRows = marketScreenRows.slice(0, 8).map((row) => ({
    symbol: row.symbol,
    beta: row.beta,
  }));
  const averageScreenBeta =
    marketScreenRows.length > 0 ? marketScreenRows.reduce((sum, row) => sum + row.beta, 0) / marketScreenRows.length : null;
  const averageScreenVolume =
    marketScreenRows.length > 0 ? marketScreenRows.reduce((sum, row) => sum + row.avgDollarVolumeM, 0) / marketScreenRows.length : null;
  const highVelocityCount = marketScreenRows.filter((row) => row.beta >= 2).length;
  const topScreenSymbol = marketScreenRows[0] ?? null;
  const advancingCount = marketScreenRows.filter((row) => row.weekChangePct > 0).length;
  const decliningCount = marketScreenRows.filter((row) => row.weekChangePct < 0).length;
  const crowdedCount = marketScreenRows.filter((row) => row.shortInterestPct >= 10).length;
  const marketSectorMix = Array.from(
    marketScreenRows.reduce((accumulator, row) => {
      accumulator.set(row.sector, (accumulator.get(row.sector) ?? 0) + 1);
      return accumulator;
    }, new Map<MarketSector, number>()),
  )
    .map(([sector, count]) => ({ sector, count }))
    .sort((left, right) => right.count - left.count);
  const marketCandidateRows = marketScreenRows
    .slice()
    .sort((left, right) => {
      const scoreLeft = left.beta * 28 + left.shortInterestPct * 1.8 + left.weekChangePct * 3 + Math.min(left.avgDollarVolumeM / 40, 32);
      const scoreRight = right.beta * 28 + right.shortInterestPct * 1.8 + right.weekChangePct * 3 + Math.min(right.avgDollarVolumeM / 40, 32);
      return scoreRight - scoreLeft;
    })
    .slice(0, 5);

  async function runEdgarDownload(request: EdgarDownloadRequest) {
    setEdgarSyncing(true);
    setEdgarSyncError(null);
    try {
      const result = await edgarDownloadMutation.mutateAsync(request);
      setEdgarSyncResult(result);
    } catch (error) {
      setEdgarSyncError(error instanceof Error ? error.message : "EDGAR sync failed.");
    } finally {
      setEdgarSyncing(false);
    }
  }

  async function runInvestorPdfDownload(request: InvestorPdfDownloadRequest) {
    setInvestorPdfSyncing(true);
    setInvestorPdfSyncError(null);
    try {
      const result = await investorPdfDownloadMutation.mutateAsync(request);
      setInvestorPdfSyncResult(result);
    } catch (error) {
      setInvestorPdfSyncError(error instanceof Error ? error.message : "Investor PDF sync failed.");
    } finally {
      setInvestorPdfSyncing(false);
    }
  }

  function applyMarketPreset(preset: MarketPreset) {
    startTransition(() => {
      if (preset === "high-beta") {
        setMarketSearch("");
        setMarketMinBeta(1.9);
        setMarketMinPrice(10);
        setMarketMinDollarVolumeM(200);
        setMarketMinShortInterestPct(0);
        setMarketSectorFilter("All");
        setMarketSortKey("beta");
        setMarketOptionableOnly(true);
        setMarketShortableOnly(false);
        return;
      }
      if (preset === "squeeze-watch") {
        setMarketSearch("");
        setMarketMinBeta(1.6);
        setMarketMinPrice(5);
        setMarketMinDollarVolumeM(150);
        setMarketMinShortInterestPct(10);
        setMarketSectorFilter("All");
        setMarketSortKey("shortInterestPct");
        setMarketOptionableOnly(true);
        setMarketShortableOnly(true);
        return;
      }
      if (preset === "liquid-leaders") {
        setMarketSearch("");
        setMarketMinBeta(1.3);
        setMarketMinPrice(20);
        setMarketMinDollarVolumeM(800);
        setMarketMinShortInterestPct(0);
        setMarketSectorFilter("All");
        setMarketSortKey("avgDollarVolumeM");
        setMarketOptionableOnly(true);
        setMarketShortableOnly(false);
        return;
      }
      setMarketSearch("");
      setMarketMinBeta(1.7);
      setMarketMinPrice(10);
      setMarketMinDollarVolumeM(200);
      setMarketMinShortInterestPct(0);
      setMarketSectorFilter("All");
      setMarketSortKey("beta");
      setMarketOptionableOnly(true);
      setMarketShortableOnly(false);
    });
  }

  function openSymbolWorkspace(nextSymbol: string, nextWorkspace: "ticker" | "options") {
    const normalizedSymbol = nextSymbol.trim().toUpperCase();
    if (!normalizedSymbol) {
      return;
    }
    setChainSymbolInput(normalizedSymbol);
    handleChainSymbolSelection(normalizedSymbol);
    setActiveWorkspace(nextWorkspace);
  }

  function toggleVisibleGreek(nextGreek: ChainGreekKey) {
    setVisibleChainGreeks((current) =>
      current.includes(nextGreek) ? current.filter((value) => value !== nextGreek) : [...current, nextGreek],
    );
  }

  function toggleShowChainMark() {
    setShowChainMark((current) => !current);
  }

  function resetTicketFeedback() {
    previewMutation.reset();
    submitMutation.reset();
    cancelMutation.reset();
    setPreviewRequestKey(null);
  }

  const requestedSymbolPriceLabel = isLoadingDifferentSymbol
    ? "Loading spot"
    : activeDisplayedChain
      ? `Spot ${fmtCurrencySmall(activeDisplayedChain.underlying.price)}`
      : "No chain loaded";
  const chainLoadLabel =
    chainQuery.isFetching && chainSymbolInput.trim().toUpperCase() === chainSymbol ? `Loading ${chainSymbol}…` : "Load chain";

  function renderOptionsQueryBar() {
    return (
      <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Option symbol</span>
            <input
              className="h-9 w-full rounded-xl border border-line/80 bg-panelSoft px-3 text-sm text-text outline-none transition focus:border-accent/60"
              data-testid="chain-symbol-input"
              onChange={(event) => setChainSymbolInput(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submitChainSymbolInput();
                }
              }}
              placeholder="Enter ticker"
              spellCheck={false}
              type="text"
              value={chainSymbolInput}
            />
          </label>
          <button
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 px-3 text-sm font-medium text-accent transition hover:border-accent/50 hover:bg-accent/16 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="chain-load-button"
            disabled={!chainSymbolInput.trim() || connectMutation.isPending || reconnectMutation.isPending}
            onClick={submitChainSymbolInput}
            type="button"
          >
            {chainLoadLabel}
          </button>
        </div>
        <div className="shrink-0 text-[11px] text-muted lg:text-right">{requestedSymbolPriceLabel}</div>
      </div>
    );
  }

  function renderTickerQueryBar() {
    return (
      <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Ticker symbol</span>
            <input
              className="h-9 w-full rounded-xl border border-line/80 bg-panelSoft px-3 text-sm text-text outline-none transition focus:border-accent/60"
              onChange={(event) => setChainSymbolInput(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submitChainSymbolInput();
                }
              }}
              placeholder="Enter ticker"
              spellCheck={false}
              type="text"
              value={chainSymbolInput}
            />
          </label>
          <button
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 px-3 text-sm font-medium text-accent transition hover:border-accent/50 hover:bg-accent/16 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!chainSymbolInput.trim() || connectMutation.isPending || reconnectMutation.isPending}
            onClick={submitChainSymbolInput}
            type="button"
          >
            {chainQuery.isFetching && chainSymbolInput.trim().toUpperCase() === chainSymbol ? `Loading ${chainSymbol}…` : "Load ticker"}
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

  function renderTickerOverviewValue(value: string, change?: string | null) {
    return (
      <div className="flex items-baseline justify-end gap-2 text-right">
        <span className="font-medium text-text">{value}</span>
        {change ? <span className={change.startsWith("-") ? "text-danger" : "text-safe"}>{change}</span> : null}
      </div>
    );
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
            ? "—"
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
            ? "—"
            : `${fmtCurrencySmall(overview.dayRangeLow)} - ${fmtCurrencySmall(overview.dayRangeHigh)}`,
        ),
      },
      {
        label: "52-Week Range",
        value: renderTickerOverviewValue(
          overview.week52Low == null || overview.week52High == null
            ? "—"
            : `${fmtCurrencySmall(overview.week52Low)} - ${fmtCurrencySmall(overview.week52High)}`,
        ),
      },
      { label: "Beta", value: renderTickerOverviewValue(fmtNumber(overview.beta)) },
      { label: "Analysts", value: renderTickerOverviewValue(overview.analystRating ?? "—") },
      {
        label: "Price Target",
        value: renderTickerOverviewValue(fmtCurrencySmall(overview.priceTarget), fmtParenSignedPct(overview.priceTargetUpsidePct)),
      },
      { label: "Earnings Date", value: renderTickerOverviewValue(fmtDateShort(overview.earningsDate)) },
    ];
  }

  function renderTickerOverview() {
    if (tickerOverviewQuery.isLoading) {
      return <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">Loading ticker overview…</div>;
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
      >
        <div className="overflow-hidden rounded-2xl border border-line/80 bg-panel">
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

  function renderIbkrOptionsSurface() {
    const busySymbolLabel = chainSymbol;
    const selectedChainGreekOptions = CHAIN_GREEK_OPTIONS.filter((option) => visibleChainGreeks.includes(option.key));
    const selectedContractLabel = ticketDraft
      ? `${ticketDraft.symbol} ${ticketDraft.expiry} ${fmtNumber(ticketDraft.strike)}${ticketDraft.right}`
      : null;
    const chainHeadingLabel = isLoadingDifferentSymbol
      ? chainSymbol
      : activeDisplayedChain
        ? `${activeDisplayedChain.symbol} ${activeExpiry ?? ""}`.trim()
        : chainSymbol;
    const chainContextLabel = isLoadingDifferentSymbol
      ? "Showing the last loaded chain until the new one is ready."
      : activeDisplayedChain?.quoteNotice;

    return (
      <div className="grid gap-4">
        {displayedExpiries.length ? (
          <div className="flex flex-wrap gap-2">
            {displayedExpiries.map((expiry) => (
              <button
                key={expiry}
                className={`rounded-full border px-3 py-2 text-sm transition ${
                  expiry === activeExpiry
                    ? "border-accent/45 bg-accent/12 text-accent"
                    : "border-line/80 bg-panelSoft text-muted hover:border-accent/25 hover:text-text"
                }`}
                data-testid={`expiry-button-${expiry}`}
                disabled={isLoadingDifferentSymbol}
                onClick={() => handleExpirySelection(expiry)}
                type="button"
              >
                {expiry}
              </button>
            ))}
          </div>
        ) : null}

        <div className={`grid gap-4 ${optionsTradeRailOpen ? "xl:grid-cols-[minmax(0,1fr)_340px]" : "xl:grid-cols-[minmax(0,1fr)_44px]"}`}>
          <div className="relative overflow-hidden rounded-2xl border border-line/80 bg-panel">
            {chainQuery.isFetching ? (
              <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-full border border-accent/20 bg-shell/90 px-3 py-1 text-xs text-accent">
                Loading {busySymbolLabel}
                {selectedExpiry ? ` · ${selectedExpiry}` : ""}
              </div>
            ) : null}
            {isLoadingDifferentSymbol ? (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-shell/38 backdrop-blur-[1px]">
                <div className="rounded-2xl border border-accent/20 bg-shell/90 px-4 py-3 text-center text-sm text-text shadow-lg">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-accent">Loading requested chain</div>
                  <div className="mt-2 text-base font-medium">{chainSymbol}</div>
                  <div className="mt-1 text-sm text-muted">Showing the last loaded chain until the new one is ready.</div>
                </div>
              </div>
            ) : null}
            <div className="border-b border-line/70 px-4 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Options Chain</div>
                  <div className="mt-1 text-lg font-semibold text-text" data-testid="chain-heading">
                    {chainHeadingLabel}
                  </div>
                  {chainContextLabel ? <div className="mt-2 max-w-3xl text-xs leading-5 text-muted">{chainContextLabel}</div> : null}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3 lg:max-w-[55%]">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Columns</div>
                    <button
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        showChainMark
                          ? "border-accent/45 bg-accent/12 text-accent"
                          : "border-line/80 bg-panelSoft text-muted hover:border-accent/25 hover:text-text"
                      }`}
                      data-testid="toggle-column-mark"
                      onClick={toggleShowChainMark}
                      type="button"
                    >
                      Mark
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Greeks</div>
                    {CHAIN_GREEK_OPTIONS.map((option) => {
                      const checked = visibleChainGreeks.includes(option.key);
                      return (
                        <button
                          key={option.key}
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                            checked
                              ? "border-accent/45 bg-accent/12 text-accent"
                              : "border-line/80 bg-panelSoft text-muted hover:border-accent/25 hover:text-text"
                          }`}
                          data-testid={`toggle-greek-${option.key}`}
                          onClick={() => toggleVisibleGreek(option.key)}
                          type="button"
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {displayedChainRows.length ? (
              <OptionsChainTable
                activeChain={activeDisplayedChain}
                activeExpiry={activeExpiry}
                chainSymbol={chainSymbol}
                dimmed={isLoadingDifferentSymbol || chainQuery.isFetching}
                fetchDirection={chainBandFetchDirection}
                fetchDisabled={chainQuery.isFetching || Boolean(chainBandFetchDirection)}
                loadedRangePct={chainLoadedRangePct}
                maxRangePct={maxChainWindowPct}
                onFetchBand={requestWiderChainWindow}
                onLoadTicket={loadTicket}
                rows={displayedChainRows}
                rowDisplayStates={rowDisplayStates}
                selectedGreekOptions={selectedChainGreekOptions}
                showMark={showChainMark}
                ticketSelection={ticketDraft}
              />
            ) : chainQuery.isLoading || chainQuery.isFetching ? (
              <div className="px-4 py-10 text-sm text-muted">Loading option chain…</div>
            ) : (
              <div className="px-4 py-10 text-sm text-muted">Load an optionable ticker to see the chain.</div>
            )}
          </div>

          {optionsTradeRailOpen ? (
            <div className="grid content-start gap-4">
              <div className="rounded-2xl border border-line/80 bg-panel px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Trade Ticket</div>
                    <div className="mt-1 text-lg font-semibold text-text">{selectedContractLabel ?? "Select a contract"}</div>
                  </div>
                  <button
                    aria-expanded={optionsTradeRailOpen}
                    aria-label="Collapse trade ticket rail"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line/80 bg-panelSoft text-muted transition hover:border-accent/25 hover:text-text"
                    data-testid="toggle-trade-rail"
                    onClick={() => setOptionsTradeRailOpen(false)}
                    type="button"
                  >
                    <SidebarToggleIcon open={optionsTradeRailOpen} />
                  </button>
                </div>

                {ticketDraft ? (
                  <div className="mt-4 grid gap-4">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                          ticketAction === "BUY"
                            ? "border-accent/45 bg-accent/12 text-accent"
                            : "border-line/80 bg-panelSoft text-muted hover:text-text"
                        }`}
                        data-testid="ticket-buy-button"
                        onClick={() => {
                          setTicketAction("BUY");
                          resetTicketFeedback();
                        }}
                        type="button"
                      >
                        Buy
                      </button>
                      <button
                        className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                          ticketAction === "SELL"
                            ? "border-accent/45 bg-accent/12 text-accent"
                            : "border-line/80 bg-panelSoft text-muted hover:text-text"
                        }`}
                        data-testid="ticket-sell-button"
                        onClick={() => {
                          setTicketAction("SELL");
                          resetTicketFeedback();
                        }}
                        type="button"
                      >
                        Sell
                      </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-2">
                        <span className="text-xs uppercase tracking-[0.18em] text-muted">Qty</span>
                        <input
                          className="rounded-xl border border-line/80 bg-panelSoft px-3 py-2 text-sm text-text outline-none transition focus:border-accent/60"
                          data-testid="ticket-quantity-input"
                          min={1}
                          onChange={(event) => {
                            setTicketQuantity(Math.max(1, Number.parseInt(event.target.value || "1", 10) || 1));
                            resetTicketFeedback();
                          }}
                          type="number"
                          value={ticketQuantity}
                        />
                      </label>
                      <label className="grid gap-2">
                        <span className="text-xs uppercase tracking-[0.18em] text-muted">Order type</span>
                        <select
                          className="rounded-xl border border-line/80 bg-panelSoft px-3 py-2 text-sm text-text outline-none transition focus:border-accent/60"
                          data-testid="ticket-order-type-select"
                          onChange={(event) => {
                            setTicketOrderType(event.target.value as "LMT" | "MKT");
                            resetTicketFeedback();
                          }}
                          value={ticketOrderType}
                        >
                          <option value="LMT">LMT</option>
                          <option value="MKT">MKT</option>
                        </select>
                      </label>
                      {ticketOrderType === "LMT" ? (
                        <label className="grid gap-2">
                          <span className="text-xs uppercase tracking-[0.18em] text-muted">Limit</span>
                          <input
                            className="rounded-xl border border-line/80 bg-panelSoft px-3 py-2 text-sm text-text outline-none transition focus:border-accent/60"
                            data-testid="ticket-limit-price-input"
                            onChange={(event) => {
                              setTicketLimitPrice(event.target.value);
                              resetTicketFeedback();
                            }}
                            type="number"
                            value={ticketLimitPrice}
                          />
                        </label>
                      ) : null}
                      <label className="grid gap-2">
                        <span className="text-xs uppercase tracking-[0.18em] text-muted">Time in force</span>
                        <select
                          className="rounded-xl border border-line/80 bg-panelSoft px-3 py-2 text-sm text-text outline-none transition focus:border-accent/60"
                          data-testid="ticket-tif-select"
                          onChange={(event) => {
                            setTicketTif(event.target.value as "DAY" | "GTC");
                            resetTicketFeedback();
                          }}
                          value={ticketTif}
                        >
                          <option value="DAY">DAY</option>
                          <option value="GTC">GTC</option>
                        </select>
                      </label>
                    </div>

                    <div className="grid gap-2 text-sm text-muted">
                      <div className="flex items-center justify-between gap-3">
                        <span>Bid / ask</span>
                        <span>{fmtCurrencySmall(ticketDraft.bid)} / {fmtCurrencySmall(ticketDraft.ask)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Reference</span>
                        <span>{fmtCurrencySmall(ticketDraft.referencePrice)}</span>
                      </div>
                    </div>

                    {previewIsCurrent && previewMutation.data ? <PreviewSummary preview={previewMutation.data} /> : null}
                    {previewError ? <ErrorState message={previewError} /> : null}
                    {submitError ? <ErrorState message={submitError} /> : null}
                    {cancelError ? <ErrorState message={cancelError} /> : null}
                    {submitIsCurrent && submitMutation.data ? <SubmitSummary submitted={submitMutation.data} /> : null}

                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        className="rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-sm font-medium text-text transition hover:border-accent/25 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid="preview-order-button"
                        disabled={!canPreviewTicket || previewMutation.isPending}
                        onClick={() => {
                          if (ticketRequest) {
                            void previewMutation.mutateAsync(ticketRequest);
                          }
                        }}
                        type="button"
                      >
                        {previewMutation.isPending ? "Previewing…" : "Preview order"}
                      </button>
                      <button
                        className="rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm font-medium text-accent transition hover:border-accent/50 hover:bg-accent/16 disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid="submit-order-button"
                        disabled={!canSubmitTicket || submitMutation.isPending}
                        onClick={() => {
                          if (ticketRequest) {
                            void submitMutation.mutateAsync(ticketRequest);
                          }
                        }}
                        type="button"
                      >
                        {submitMutation.isPending ? "Submitting…" : "Submit order"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-line/80 bg-panelSoft px-3 py-4 text-sm text-muted">
                    Load any call or put from the chain to build an order ticket.
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-line/80 bg-panel px-4 py-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Working Orders</div>
                  <div className="mt-1 text-lg font-semibold text-text">{openOptionOrders.length}</div>
                </div>
                <div className="mt-4 grid gap-3">
                  {cancelMutation.data ? <CancelSummary cancelled={cancelMutation.data} /> : null}
                  {openOptionOrders.length ? (
                    openOptionOrders.map((order) => (
                      <div
                        key={order.orderId}
                        className="rounded-xl border border-line/80 bg-panelSoft px-3 py-3"
                        data-testid={`open-order-${order.orderId}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium text-text">
                              {order.side} {fmtNumber(order.quantity)} {order.symbol} {order.expiry} {fmtNumber(order.strike)}
                              {order.right ?? ""}
                            </div>
                            <div className="mt-1 text-xs text-muted">
                              {order.orderType}
                              {order.limitPrice != null ? ` ${fmtCurrencySmall(order.limitPrice)}` : ""}
                              {" · "}
                              {order.status}
                              {" · filled "}
                              {fmtNumber(order.filledQuantity)}
                              {" / remaining "}
                              {fmtNumber(order.remainingQuantity)}
                            </div>
                          </div>
                          <button
                            className="rounded-full border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger transition hover:border-danger/50 hover:bg-danger/16 disabled:cursor-not-allowed disabled:opacity-50"
                            data-testid={`cancel-order-${order.orderId}`}
                            disabled={!selectedAccount || cancelMutation.isPending}
                            onClick={() => {
                              if (selectedAccount) {
                                void cancelMutation.mutateAsync({ orderId: order.orderId, accountId: selectedAccount });
                              }
                            }}
                            type="button"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl border border-line/80 bg-panelSoft px-3 py-4 text-sm text-muted">
                      No working option orders in the selected routed account.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-line/80 bg-panel px-4 py-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Open Option Positions</div>
                  <div className="mt-1 text-lg font-semibold text-text">{optionPositions.length}</div>
                </div>
                <div className="mt-4 grid gap-3">
                  {optionPositions.length ? (
                    optionPositions.slice(0, 6).map((position) => (
                      <div key={`${position.symbol}-${position.expiry}-${position.strike}-${position.right}`} className="rounded-xl border border-line/80 bg-panelSoft px-3 py-3">
                        <div className="font-medium text-text">
                          {position.symbol} {position.expiry} {fmtNumber(position.strike)}
                          {position.right}
                        </div>
                        <div className="mt-1 text-xs text-muted">
                          {position.shortOrLong} {fmtNumber(position.quantity)} · mid {fmtCurrencySmall(position.currentMid)} · delta {fmtNumber(position.delta)}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl border border-line/80 bg-panelSoft px-3 py-4 text-sm text-muted">
                      No option positions yet. The trade flow above comes first.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-[280px] items-start justify-center">
              <div className="flex h-full min-h-[280px] w-full flex-col items-center rounded-xl border border-line/80 bg-panel py-2">
                <button
                  aria-expanded={optionsTradeRailOpen}
                  aria-label="Expand trade ticket rail"
                  className="inline-flex h-8 w-full items-center justify-center text-muted transition hover:text-text"
                  data-testid="toggle-trade-rail"
                  onClick={() => setOptionsTradeRailOpen(true)}
                  type="button"
                >
                  <SidebarToggleIcon open={optionsTradeRailOpen} />
                </button>
                <div className="mt-2 flex-1 [writing-mode:vertical-rl] rotate-180 text-center text-[10px] uppercase tracking-[0.16em] text-muted">
                  Trade Ticket
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderCoinbasePanelContent() {
    return coinbaseStatusQuery.isLoading ? (
      <div className="text-sm text-muted">Checking Coinbase connector...</div>
    ) : !coinbaseStatusQuery.data?.available ? (
      <div className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard
            label="Connector"
            value={coinbaseStatusQuery.data?.authMode === "missing" ? "Not configured" : "Unavailable"}
          />
          <MetricCard
            label="Auth mode"
            value={coinbaseStatusQuery.data?.authMode ? coinbaseStatusQuery.data.authMode.toUpperCase() : "—"}
          />
          <MetricCard label="API base" value={coinbaseStatusQuery.data?.apiBaseUrl ?? "https://api.coinbase.com"} />
        </div>
        <ErrorState message={coinbaseStatusError ?? coinbaseStatusQuery.data?.detail ?? "Coinbase connector is unavailable."} />
      </div>
    ) : coinbasePortfolioQuery.isLoading ? (
      <div className="text-sm text-muted">Loading Coinbase balances...</div>
    ) : coinbasePortfolioQuery.error instanceof Error ? (
      <ErrorState message={coinbasePortfolioQuery.error.message} />
    ) : coinbasePortfolioQuery.data ? (
      <div className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Total value" value={fmtCurrency(coinbasePortfolioQuery.data.totalUsdValue)} />
          <MetricCard label="Cash-like" value={fmtCurrency(coinbasePortfolioQuery.data.cashLikeUsdValue)} />
          <MetricCard label="Crypto" value={fmtCurrency(coinbasePortfolioQuery.data.cryptoUsdValue)} />
          <MetricCard
            hint={`${coinbasePortfolioQuery.data.totalAccountsCount} total accounts returned`}
            label="Visible holdings"
            value={fmtNumber(coinbasePortfolioQuery.data.visibleHoldingsCount)}
          />
        </div>
        {coinbasePortfolioQuery.data.sourceNotice ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              coinbasePortfolioQuery.data.isStale
                ? "border-caution/25 bg-caution/8 text-caution"
                : "border-line/80 bg-panelSoft text-muted"
            }`}
          >
            {coinbasePortfolioQuery.data.sourceNotice}
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="min-w-[900px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-[0.16em] text-muted">
              <tr>
                <th className="pb-3 pr-4">Asset</th>
                <th className="pb-3 pr-4">Account</th>
                <th className="pb-3 pr-4">Type</th>
                <th className="pb-3 pr-4">Balance</th>
                <th className="pb-3 pr-4">Available</th>
                <th className="pb-3 pr-4">On hold</th>
                <th className="pb-3 pr-4">USD rate</th>
                <th className="pb-3 pr-4">Value</th>
                <th className="pb-3">Allocation</th>
              </tr>
            </thead>
            <tbody>
              {coinbasePortfolioQuery.data.holdings.map((holding) => (
                <tr key={`${holding.accountId}-${holding.currencyCode}`} className="border-t border-line/70 align-top">
                  <td className="py-3 pr-4">
                    <div className="font-medium text-text">{holding.currencyCode}</div>
                    <div className="mt-1 text-xs text-muted">{holding.currencyName ?? "Coinbase asset"}</div>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="text-text">{holding.accountName}</div>
                    <div className="mt-1 text-xs text-muted">
                      {holding.primary ? "Primary" : "Secondary"}
                      {holding.ready === false ? " · Pending" : ""}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="text-text capitalize">{holding.accountType}</div>
                    <div className="mt-1 text-xs text-muted">{holding.isCashLike ? "Cash-like" : holding.currencyType ?? "Crypto"}</div>
                  </td>
                  <td className="py-3 pr-4">
                    {fmtNumber(holding.balance)}
                    <div className="mt-1 text-xs text-muted">{holding.currencyCode}</div>
                  </td>
                  <td className="py-3 pr-4">{fmtNumber(holding.availableBalance)}</td>
                  <td className="py-3 pr-4">{fmtNumber(holding.holdBalance)}</td>
                  <td className="py-3 pr-4">{fmtCurrencySmall(holding.usdRate)}</td>
                  <td className="py-3 pr-4 font-medium text-text">{fmtCurrency(holding.usdValue)}</td>
                  <td className="py-3">{fmtNumber(holding.allocationPct, "%")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    ) : (
      <ErrorState message="Coinbase balances are unavailable." />
    );
  }

  async function saveFilesystemConnector(connectorId: ConnectorCatalogId) {
    setConnectorSetupError(null);
    const connector = getConnectorCatalogEntry(connectorId);
    if (!connector) {
      setConnectorSetupError("This connector is not available in the local catalog.");
      return;
    }
    if (connector.availability !== "ready") {
      setConnectorSetupError(`${connector.title} is not ready yet.`);
      return;
    }
    const draft = getConnectorDraft(connectorId);
    const displayName = draft.displayName.trim();
    const directoryPath = draft.directoryPath.trim();
    if (!displayName) {
      setConnectorSetupError("Add a connector name before saving this connector.");
      return;
    }
    if (!directoryPath) {
      setConnectorSetupError("Add a folder path before saving this connector.");
      return;
    }
    try {
      await filesystemConnectorConfigureMutation.mutateAsync({
        accountKey: selectedDashboardAccount.key,
        connectorId,
        displayName,
        directoryPath,
        detectFooter: connectorId === CSV_FOLDER_CONNECTOR_ID ? draft.detectFooter : false,
      });
      setConnectorPickerOpen(false);
      setConnectorSetupError(null);
    } catch (error) {
      setConnectorSetupError(error instanceof Error ? error.message : "Could not save the CSV folder.");
    }
  }

  async function chooseConnectorFolder(connectorId: ConnectorCatalogId, connectorTitle: string) {
    setConnectorSetupError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const draft = getConnectorDraft(connectorId);
      const selected = await open({
        directory: true,
        multiple: false,
        title: `Choose ${connectorTitle} Folder`,
        defaultPath: draft.directoryPath.trim() || undefined,
      });
      if (typeof selected === "string" && selected.trim()) {
        updateConnectorDraft(connectorId, { directoryPath: selected });
      }
    } catch (error) {
      setConnectorSetupError(error instanceof Error ? error.message : "Could not open the system folder picker.");
    }
  }

  function renderFilesystemConnectorPanelContent(sourceId: string) {
    const status = filesystemConnectorStatusBySourceId[sourceId];
    const portfolio = filesystemConnectorPortfolioBySourceId[sourceId];
    const portfolioError = filesystemConnectorPortfolioErrorBySourceId[sourceId] ?? null;
    const portfolioLoading = filesystemConnectorPortfolioLoadingBySourceId[sourceId] ?? false;
    const documentFolder = filesystemDocumentFolderBySourceId[sourceId];
    const documentFolderError = filesystemDocumentFolderErrorBySourceId[sourceId] ?? null;
    const documentFolderLoading = filesystemDocumentFolderLoadingBySourceId[sourceId] ?? false;

    return (
      <FilesystemAccountSourceContent
        documentFolder={documentFolder}
        documentFolderError={documentFolderError}
        documentFolderLoading={documentFolderLoading}
        localBackendError={connectionQueryError}
        localBackendUnavailable={localBackendUnavailable}
        portfolio={portfolio}
        portfolioError={portfolioError}
        portfolioLoading={portfolioLoading}
        status={status}
        statusesError={filesystemConnectorStatusesError}
        statusesLoading={filesystemConnectorStatusesQuery.isLoading}
      />
    );
  }

  const dashboardSummaryContent = (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          hint={describeAccountSourceMetricCoverage(accountSourceSummaries, "totalPnl")}
          label="Total PnL"
          tone={pnlMetricTone(dashboardTotalPnl)}
          value={fmtCurrency(dashboardTotalPnl)}
        />
        <MetricCard
          hint={dashboardTodayPnlHint}
          label="Today's PnL"
          value={fmtCurrency(dashboardTodayPnl)}
        />
        <MetricCard
          hint={dashboardMonthlyPnlHint}
          label="Month PnL"
          value={fmtCurrency(dashboardMonthlyPnl)}
        />
        <MetricCard hint={dashboardNetWorthHint} label="Net Worth" value={fmtCurrency(dashboardNetWorth)} />
      </div>

      {connectionQuery.data?.lastError || connectError || reconnectError ? (
        <div className="mt-4 rounded-2xl border border-danger/20 bg-danger/8 px-4 py-3 text-sm text-danger">
          {connectError ?? reconnectError ?? connectionQuery.data?.lastError}
        </div>
      ) : null}
    </>
  );

  const dashboardSettingsContent = (
    <Panel
      action={
        <button
          className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-accent transition hover:border-accent/50 hover:bg-accent/16 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={availableConnectorCount === 0}
          onClick={() => {
            setConnectorPickerOpen((value) => !value);
            setConnectorSetupError(null);
          }}
          type="button"
        >
          <span>Add</span>
          <PlusCircleIcon />
        </button>
      }
      title={`${selectedDashboardAccount.name} Connectors`}
    >
      <div className="grid gap-6">
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {accountSettingsConnectors.map((connector) => (
            <ConnectorStatusCard
              key={connector.id}
              detail={connector.detail}
              icon={connector.icon}
              status={connector.status}
              title={connector.title}
              tone={connector.tone}
            />
          ))}
        </div>

        {connectorPickerOpen ? (
          <div className="rounded-2xl border border-line/80 bg-panelSoft px-5 py-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-text">Available Connectors</div>
                <div className="mt-1 text-sm text-muted">Add another account-owned connector for {selectedDashboardAccount.name}.</div>
              </div>
            </div>
            {connectorSetupError ? (
              <div className="mt-4 rounded-2xl border border-danger/20 bg-danger/8 px-4 py-3 text-sm text-danger">{connectorSetupError}</div>
            ) : null}
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {availableConnectorOptions.map((connector) => (
                (() => {
                  const connectorDraft = getConnectorDraft(connector.id);
                  return (
                <div key={connector.id} className="rounded-2xl border border-line/80 bg-panel px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-panelSoft text-text">
                        <BankIcon />
                      </span>
                      <div>
                        <div className="text-sm font-medium text-text">{connector.title}</div>
                        <div className="mt-1 text-xs uppercase tracking-[0.16em] text-muted">{connector.provider}</div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 text-sm text-muted">{connector.description}</div>
                  {connector.availability === "ready" ? (
                    <div className="mt-4 grid gap-3">
                      <label className="grid gap-2">
                        <span className="text-[11px] uppercase tracking-[0.16em] text-muted">Source name</span>
                        <input
                          className="w-full rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-text outline-none transition focus:border-accent/60"
                          onChange={(event) => updateConnectorDraft(connector.id, { displayName: event.target.value })}
                          placeholder={connector.defaultDisplayNamePlaceholder}
                          spellCheck={false}
                          type="text"
                          value={connectorDraft.displayName}
                        />
                      </label>
                      <label className="grid gap-2">
                        <span className="text-[11px] uppercase tracking-[0.16em] text-muted">
                          {connector.id === CSV_FOLDER_CONNECTOR_ID ? "CSV folder path" : "PDF folder path"}
                        </span>
                        <div className="flex gap-2">
                          <input
                            className="w-full rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-text outline-none transition focus:border-accent/60"
                            onChange={(event) => updateConnectorDraft(connector.id, { directoryPath: event.target.value })}
                            placeholder={connector.directoryPathPlaceholder}
                            spellCheck={false}
                            type="text"
                            value={connectorDraft.directoryPath}
                          />
                          <button
                            className="shrink-0 rounded-xl border border-line/80 bg-panelSoft px-3 py-3 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition hover:border-accent/35 hover:text-text"
                            onClick={() => {
                              void chooseConnectorFolder(connector.id, connector.title);
                            }}
                            type="button"
                          >
                            Choose Folder
                          </button>
                        </div>
                      </label>
                      {connector.id === CSV_FOLDER_CONNECTOR_ID ? (
                        <label className="flex items-center gap-3 rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-text">
                          <input
                            checked={connectorDraft.detectFooter}
                            className="h-4 w-4 accent-accent"
                            onChange={(event) => updateConnectorDraft(connector.id, { detectFooter: event.target.checked })}
                            type="checkbox"
                          />
                          <span>Detect and ignore footer</span>
                        </label>
                      ) : null}
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs text-muted">
                          {connector.id === CSV_FOLDER_CONNECTOR_ID
                            ? "This adds a new account-owned source. The latest CSV in this folder will drive its snapshot."
                            : "This adds a new account-owned document source. The folder will surface recent PDFs and connectivity."}
                        </div>
                        <button
                          className="rounded-full border border-line/80 bg-panel px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition hover:border-accent/35 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={filesystemConnectorConfigureMutation.isPending || !connectorDraft.displayName.trim() || !connectorDraft.directoryPath.trim()}
                          onClick={() => {
                            void saveFilesystemConnector(connector.id);
                          }}
                          type="button"
                        >
                          {filesystemConnectorConfigureMutation.isPending ? "Saving…" : "Add"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 flex justify-end">
                      <button
                        className="rounded-full border border-line/80 bg-panel px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition disabled:cursor-not-allowed disabled:opacity-50"
                        disabled
                        type="button"
                      >
                        Coming soon
                      </button>
                    </div>
                  )}
                </div>
                  );
                })()
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  );

  const dashboardBodyContent = (
    <>
      <AccountConnectorSection
        collapsed={ibkrConnectorCollapsed}
        details={
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <InlinePill
              label={routedAccount ? `Acct ${routedAccount}` : "Acct pending"}
              tone={connectionQuery.data?.connected ? (selectedDashboardOwnsRoute ? "safe" : "caution") : "neutral"}
            />
            <InlinePill label={routedAccountPill.label} tone={routedAccountPill.tone} />
          </div>
        }
        eyebrow="IBKR source"
        onToggle={() => setIbkrConnectorCollapsed((value) => !value)}
        title="Interactive Brokers"
      >
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="grid gap-3">
            <h3 className="text-lg font-semibold text-text">Working Orders</h3>
            {dashboardOpenOrders.length > 0 ? (
              <div className="grid gap-3">
                {dashboardOpenOrders.slice(0, 6).map((order) => (
                  <div key={order.orderId} className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-text">
                          {order.side} {fmtWholeNumber(order.quantity)} {order.symbol}
                          {order.expiry && order.strike && order.right ? ` ${order.expiry} ${fmtNumber(order.strike)}${order.right}` : ""}
                        </div>
                        <div className="mt-1 text-sm text-muted">
                          {order.orderType}
                          {order.limitPrice != null ? ` ${fmtCurrencySmall(order.limitPrice)}` : ""}
                          {" · "}
                          {order.status}
                        </div>
                      </div>
                      <div className="text-sm text-muted">{fmtCurrency(order.estimatedCapitalImpact)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
                {selectedDashboardOwnsRoute ? "No working orders in the routed IBKR account." : "Route this account through Gateway to view IBKR working orders here."}
              </div>
            )}
          </div>

          <div className="grid gap-3">
            <h3 className="text-lg font-semibold text-text">Open Option Positions</h3>
            {dashboardOptionPositions.length > 0 ? (
              <div className="grid gap-3">
                {dashboardOptionPositions.slice(0, 6).map((position) => (
                  <div key={`${position.symbol}-${position.expiry}-${position.strike}-${position.right}`} className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-text">
                          {position.symbol} {position.expiry} {fmtNumber(position.strike)}{position.right}
                        </div>
                        <div className="mt-1 text-sm text-muted">
                          {position.shortOrLong} {fmtWholeNumber(Math.abs(position.quantity))} · delta {fmtGreek(position.delta)}
                        </div>
                      </div>
                      <div className={`text-sm font-medium ${pnlTone(position.unrealizedPnL)}`}>{fmtCurrency(position.unrealizedPnL)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
                {selectedDashboardOwnsRoute ? "No open option positions in the routed IBKR account." : "Route this account through Gateway to view IBKR option positions here."}
              </div>
            )}
          </div>
        </div>
      </AccountConnectorSection>

      {dashboardAccountHasAttachedSource(selectedDashboardAccount, "coinbase") ? (
        <CoinbaseAccountSource
          collapsed={coinbaseConnectorCollapsed}
          onToggle={() => setCoinbaseConnectorCollapsed((value) => !value)}
          statusLabel={coinbaseConnectorStatus}
          statusTone={toInlinePillTone(coinbaseAccountSourceSummary?.tone ?? coinbaseConnectorTone)}
        >
          {renderCoinbasePanelContent()}
        </CoinbaseAccountSource>
      ) : null}

      <FilesystemAccountSourceList
        collapsedBySourceId={filesystemConnectorCollapsedBySourceId}
        onToggleSource={(sourceId) =>
            setFilesystemConnectorCollapsedBySourceId((value) => ({
              ...value,
              [sourceId]: !(value[sourceId] ?? false),
            }))
        }
        renderSourceContent={renderFilesystemConnectorPanelContent}
        sources={filesystemAccountSourceItems}
      />
    </>
  );

  function renderDashboardWorkspace() {
    return (
      <AccountDashboardView
        accountSettingsOpen={accountSettingsOpen}
        bodyContent={dashboardBodyContent}
        headerRouteLabel={dashboardHeaderRouteLabel}
        headerStatusIndicatorClassName={connectionToneIndicatorClass(accountStatusTone)}
        headerStatusLabel={accountStatusLabel}
        onSelectAccount={(accountKey) => {
          setSelectedDashboardAccountKey(accountKey);
          setAccountSettingsOpen(false);
          setActiveWorkspace("dashboard");
        }}
        onToggleSettings={() => setAccountSettingsOpen((value) => !value)}
        selectedAccountKey={selectedDashboardAccount.key}
        settingsContent={dashboardSettingsContent}
        summaryContent={dashboardSummaryContent}
      />
    );
  }

  function renderGlobalSettingsWorkspace() {
    return (
      <ToolWorkspaceFrame
        description="Configure app-wide behavior and the product-wide data sources that sit behind the tools."
        title="Global Settings"
      >
        <div className="grid gap-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Data mode" value={dataModeLabel} />
            <MetricCard label="Execution" value={executionModeLabel} />
            <MetricCard hint={connectionEndpoint} label="IBKR socket" value={connectionEndpointLabel} />
            <MetricCard label="Last heartbeat" value={heartbeatLabel} />
          </div>

          <Panel eyebrow="Global data sources" title="Data Sources">
            <div className="grid gap-3 lg:grid-cols-2">
              {globalSourceCards.map((source) => (
                <ConnectorStatusCard
                  key={source.id}
                  detail={source.detail}
                  icon={source.icon}
                  status={source.status}
                  title={source.title}
                  tone={source.tone}
                />
              ))}
            </div>
          </Panel>

          <Panel eyebrow="Shared defaults" title="App Defaults">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Refresh cadence</div>
                <div className="mt-2 text-sm font-medium text-text">{refreshCadenceLabel}</div>
              </div>
              <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Research root</div>
                <div className="mt-2 text-sm font-medium text-text">
                  {edgarStatusQuery.data ? shortenPath(edgarStatusQuery.data.researchRootPath) : "Loading"}
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </ToolWorkspaceFrame>
    );
  }

  function renderMarketWorkspace() {
    return (
      <ToolWorkspaceFrame
        description="Screen the US stock universe by beta, crowding, and liquidity, then push the names that matter into `Ticker` or `Options` without detouring through the dashboard."
        headerSlot={
          <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-muted">
            <InlinePill label={`Gateway session · ${marketGatewayPill.label.toLowerCase()}`} tone={marketGatewayPill.tone} />
            <InlinePill label="Data source · US stock L1 feeds planned" tone="caution" />
            <InlinePill label="Overlay account · off" tone="neutral" />
          </div>
        }
        title="Market"
      >
        <div className="grid gap-6">
          <Panel eyebrow="Universe" title="US Stock Screener">
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-5">
              <label className="panel-soft rounded-2xl p-4">
                <div className="mb-3 text-[11px] uppercase tracking-[0.22em] text-muted">Search</div>
                <input
                  className="w-full rounded-xl border border-line/80 bg-panel px-3 py-3 text-sm text-text outline-none transition focus:border-accent/60"
                  onChange={(event) => setMarketSearch(event.target.value.toUpperCase())}
                  placeholder="Symbol or company"
                  spellCheck={false}
                  type="text"
                  value={marketSearch}
                />
                <div className="mt-3 text-xs text-muted">Search works across ticker and company name.</div>
              </label>
              <RangeField label="Min beta" max={3} min={1} onChange={setMarketMinBeta} step={0.05} value={marketMinBeta} />
              <RangeField label="Min price" max={200} min={5} onChange={setMarketMinPrice} step={5} value={marketMinPrice} />
              <RangeField
                label="Min avg $ volume (M)"
                max={2000}
                min={50}
                onChange={setMarketMinDollarVolumeM}
                step={25}
                value={marketMinDollarVolumeM}
              />
              <RangeField
                label="Min short %"
                max={25}
                min={0}
                onChange={setMarketMinShortInterestPct}
                step={1}
                value={marketMinShortInterestPct}
              />
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="rounded-full border border-accent/25 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition hover:border-accent/45 hover:bg-accent/16"
                  onClick={() => applyMarketPreset("high-beta")}
                  type="button"
                >
                  High beta
                </button>
                <button
                  className="rounded-full border border-line/80 bg-panelSoft px-3 py-1.5 text-xs font-medium text-muted transition hover:border-accent/25 hover:text-text"
                  onClick={() => applyMarketPreset("squeeze-watch")}
                  type="button"
                >
                  Squeeze watch
                </button>
                <button
                  className="rounded-full border border-line/80 bg-panelSoft px-3 py-1.5 text-xs font-medium text-muted transition hover:border-accent/25 hover:text-text"
                  onClick={() => applyMarketPreset("liquid-leaders")}
                  type="button"
                >
                  Liquid leaders
                </button>
                <button
                  className="rounded-full border border-line/80 bg-panelSoft px-3 py-1.5 text-xs font-medium text-muted transition hover:border-accent/25 hover:text-text"
                  onClick={() => applyMarketPreset("reset")}
                  type="button"
                >
                  Reset screen
                </button>
                <ToggleChip checked={marketOptionableOnly} label="Options-ready only" onToggle={() => setMarketOptionableOnly((value) => !value)} />
                <ToggleChip checked={marketShortableOnly} label="Shortable only" onToggle={() => setMarketShortableOnly((value) => !value)} />
              </div>

              <div className="panel-soft rounded-2xl p-4">
                <div className="mb-3 text-[11px] uppercase tracking-[0.22em] text-muted">Sort and sector</div>
                <select
                  className="w-full rounded-xl border border-line/80 bg-panel px-3 py-3 text-sm text-text outline-none transition focus:border-accent/60"
                  onChange={(event) => setMarketSectorFilter(event.target.value as MarketSector | "All")}
                  value={marketSectorFilter}
                >
                  <option value="All">All sectors</option>
                  {Array.from(new Set(MARKET_SCREEN_ROWS.map((row) => row.sector))).map((sector) => (
                    <option key={sector} value={sector}>
                      {sector}
                    </option>
                  ))}
                </select>
                <div className="mt-3 text-[11px] uppercase tracking-[0.22em] text-muted">Sort</div>
                <select
                  className="mt-2 w-full rounded-xl border border-line/80 bg-panel px-3 py-3 text-sm text-text outline-none transition focus:border-accent/60"
                  onChange={(event) => setMarketSortKey(event.target.value as MarketSortKey)}
                  value={marketSortKey}
                >
                  {MARKET_SORT_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="mt-3 text-xs text-muted">The screen stays stock-universe first. Drill into one name only after it survives the market filter.</div>
              </div>
            </div>
          </Panel>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard hint="Names matching the current screen." label="Matches" value={fmtWholeNumber(marketScreenRows.length)} />
            <MetricCard hint="Average beta across the visible results." label="Avg beta" value={fmtNumber(averageScreenBeta)} />
            <MetricCard hint="Average daily dollar volume for this filtered set." label="Avg $ volume" value={averageScreenVolume != null ? `$${fmtMillions(averageScreenVolume)}` : "—"} />
            <MetricCard hint="Names with weekly momentum still pointing up." label="Advancers" value={fmtWholeNumber(advancingCount)} />
            <MetricCard
              hint={topScreenSymbol ? `${topScreenSymbol.name} · ${topScreenSymbol.sector}` : "No symbols currently match the screen."}
              label="Top result"
              value={topScreenSymbol ? `${topScreenSymbol.symbol} · ${fmtNumber(topScreenSymbol.beta)}` : "—"}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <Panel eyebrow="Pulse" title="Market Posture">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted">High-beta pocket</div>
                  <div className="mt-2 text-3xl font-semibold text-text">{fmtWholeNumber(highVelocityCount)}</div>
                  <div className="mt-2 text-sm text-muted">Names at beta 2.0+ inside the current screen.</div>
                </div>
                <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Crowded pocket</div>
                  <div className="mt-2 text-3xl font-semibold text-text">{fmtWholeNumber(crowdedCount)}</div>
                  <div className="mt-2 text-sm text-muted">Names with double-digit short interest still surviving the filter.</div>
                </div>
                <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Weekly breadth</div>
                  <div className="mt-2 text-3xl font-semibold text-text">{fmtWholeNumber(advancingCount)} / {fmtWholeNumber(decliningCount)}</div>
                  <div className="mt-2 text-sm text-muted">Advancers versus decliners in the visible result set.</div>
                </div>
              </div>
            </Panel>

            <Panel eyebrow="Queue" title="Candidates To Open Next">
              <div className="grid gap-3">
                {marketCandidateRows.map((row, index) => (
                  <div key={`${row.symbol}-candidate`} className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Candidate {index + 1}</div>
                        <div className="mt-1 text-lg font-semibold text-text">{row.symbol}</div>
                        <div className="mt-1 text-sm text-muted">{row.name} · {row.sector}</div>
                      </div>
                      <div className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs uppercase tracking-[0.16em] text-accent">
                        beta {fmtNumber(row.beta)}
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted">
                      <InlinePill label={`1w ${fmtNumber(row.weekChangePct, "%")}`} tone={row.weekChangePct >= 0 ? "safe" : "danger"} />
                      <InlinePill label={`short ${fmtNumber(row.shortInterestPct, "%")}`} tone={row.shortInterestPct >= 10 ? "caution" : "neutral"} />
                      <InlinePill label={`vol $${fmtMillions(row.avgDollarVolumeM)}`} tone="neutral" />
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button
                        className="rounded-full border border-line/80 bg-panel px-3 py-1.5 text-xs font-medium text-muted transition hover:border-accent/25 hover:text-text"
                        onClick={() => openSymbolWorkspace(row.symbol, "ticker")}
                        type="button"
                      >
                        Open ticker
                      </button>
                      <button
                        className="rounded-full border border-accent/25 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition hover:border-accent/45 hover:bg-accent/16"
                        onClick={() => openSymbolWorkspace(row.symbol, "options")}
                        type="button"
                      >
                        Open options
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
            <Panel eyebrow="Ranking" title="Screen Results">
              {marketTopRows.length ? (
                <div className="overflow-x-auto rounded-2xl border border-line/80 bg-panel">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-panel/95 text-[11px] uppercase tracking-[0.18em] text-muted">
                      <tr className="border-b border-line/70">
                        <th className="px-4 py-3">Symbol</th>
                        <th className="px-4 py-3">Beta</th>
                        <th className="px-4 py-3">Price</th>
                        <th className="px-4 py-3">1W</th>
                        <th className="px-4 py-3">1M</th>
                        <th className="px-4 py-3">Avg $ Vol</th>
                        <th className="px-4 py-3">Mkt Cap</th>
                        <th className="px-4 py-3">Short %</th>
                        <th className="px-4 py-3">Sector</th>
                        <th className="px-4 py-3 text-right">Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      {marketTopRows.map((row) => (
                        <tr key={row.symbol} className="border-b border-line/70 last:border-b-0">
                          <td className="px-4 py-3">
                            <div className="font-medium text-text">{row.symbol}</div>
                            <div className="mt-1 text-xs text-muted">{row.name}</div>
                          </td>
                          <td className="px-4 py-3 text-text">{fmtNumber(row.beta)}</td>
                          <td className="px-4 py-3 text-text">{fmtCurrencySmall(row.price)}</td>
                          <td className={`px-4 py-3 ${pnlTone(row.weekChangePct)}`}>{fmtNumber(row.weekChangePct, "%")}</td>
                          <td className={`px-4 py-3 ${pnlTone(row.monthChangePct)}`}>{fmtNumber(row.monthChangePct, "%")}</td>
                          <td className="px-4 py-3 text-text">${fmtMillions(row.avgDollarVolumeM)}</td>
                          <td className="px-4 py-3 text-text">${fmtBillions(row.marketCapB)}</td>
                          <td className="px-4 py-3 text-text">{fmtNumber(row.shortInterestPct, "%")}</td>
                          <td className="px-4 py-3 text-muted">{row.sector}</td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
                              <button
                                className="rounded-full border border-line/80 bg-panelSoft px-3 py-1.5 text-xs font-medium text-muted transition hover:border-accent/25 hover:text-text"
                                onClick={() => openSymbolWorkspace(row.symbol, "ticker")}
                                type="button"
                              >
                                Ticker
                              </button>
                              <button
                                className="rounded-full border border-accent/25 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition hover:border-accent/45 hover:bg-accent/16"
                                onClick={() => openSymbolWorkspace(row.symbol, "options")}
                                type="button"
                              >
                                Options
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
                  No symbols match the current beta, price, and liquidity screen yet. Loosen a filter to broaden the universe.
                </div>
                )}
              </Panel>

            <div className="grid gap-4">
              <Panel eyebrow="Signal" title="Beta Leaders">
                {marketChartRows.length ? (
                  <div className="h-[320px] rounded-2xl border border-line/80 bg-panelSoft px-3 py-3">
                    <ResponsiveContainer height="100%" width="100%">
                      <BarChart data={marketChartRows} layout="vertical" margin={{ top: 8, right: 12, left: 4, bottom: 8 }}>
                        <CartesianGrid horizontal={false} stroke="rgba(133,155,149,0.14)" />
                        <XAxis domain={[1, 3]} tick={{ fill: "#8f9f98", fontSize: 11 }} tickLine={false} type="number" />
                        <YAxis dataKey="symbol" tick={{ fill: "#d5dfdb", fontSize: 12 }} tickLine={false} type="category" width={52} />
                        <Tooltip
                          contentStyle={{
                            background: "#101a1e",
                            border: "1px solid rgba(104, 144, 129, 0.22)",
                            borderRadius: "14px",
                            color: "#e8f1ed",
                          }}
                          cursor={{ fill: "rgba(84, 138, 119, 0.08)" }}
                          formatter={(value: number) => [fmtNumber(value), "Beta"]}
                        />
                        <Bar dataKey="beta" fill="#4f8e78" radius={[0, 8, 8, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
                    The beta chart will populate once at least one symbol passes the screen.
                  </div>
                )}
              </Panel>

              <Panel eyebrow="Distribution" title="Sector Mix">
                <div className="grid gap-3">
                  {marketSectorMix.length ? (
                    marketSectorMix.slice(0, 6).map((entry) => {
                      const share = marketScreenRows.length ? (entry.count / marketScreenRows.length) * 100 : 0;
                      return (
                        <div key={entry.sector}>
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-text">{entry.sector}</span>
                            <span className="text-muted">{fmtWholeNumber(entry.count)} · {fmtNumber(share, "%")}</span>
                          </div>
                          <div className="mt-2 h-2 rounded-full bg-panel">
                            <div className="h-2 rounded-full bg-accent/70" style={{ width: `${share}%` }} />
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
                      Sector mix appears once the screen returns names.
                    </div>
                  )}
                </div>
              </Panel>

              <Panel eyebrow="Method" title="Screen Notes">
                <div className="grid gap-3">
                  <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted">What this prototype assumes</div>
                    <div className="mt-2 text-sm text-muted">
                      The upcoming `Network A`, `Network B`, and `Network C` subscriptions will back live US stock screening, while the current rows are fixture data that let us shape the workflow now.
                    </div>
                  </div>
                  <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
                    Beta is shown here as a stock-universe factor, not an options Greek. The tool is built so we can later rank by any factor that belongs to the overall market, not just one chain.
                  </div>
                </div>
              </Panel>
            </div>
          </div>
        </div>
      </ToolWorkspaceFrame>
    );
  }

  function renderTickerWorkspace() {
    return (
      <ToolWorkspaceFrame
        compact
        titleRowSlot={renderTickerQueryBar()}
        title="Ticker"
      >
        <div className="grid gap-6">
          {renderTickerOverview()}
        </div>
      </ToolWorkspaceFrame>
    );
  }

  function renderOptionsToolFrame(title: string, children: ReactNode, description?: string) {
    return (
      <ToolWorkspaceFrame
        compact
        description={description}
        titleEndSlot={
          <button
            aria-label="Options tool settings"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-line/80 bg-panelSoft text-muted transition hover:border-accent/25 hover:text-text"
            data-testid="options-settings-button"
            title="Options settings"
            type="button"
          >
            <GearIcon />
          </button>
        }
        titleRowSlot={renderOptionsQueryBar()}
        title={title}
      >
        {children}
      </ToolWorkspaceFrame>
    );
  }

  function renderOptionsWorkspace() {
    return renderOptionsToolFrame("Chain", renderIbkrOptionsSurface());
  }

  function buildOptionToolProps(): OptionToolSharedProps {
    return {
      chainSymbol,
      activeDisplayedChain,
      displayedChainRows,
      activeExpiry,
      optionPositions,
      tickerOverview,
      optionsDataSourceLabel: optionsDataSourcePill.label,
      onLoadTicket: loadTicket,
      onOpenChain: () => setActiveWorkspace("options"),
    };
  }

  function renderOptionsValuationWorkspace() {
    return renderOptionsToolFrame(
      "Valuation",
      <OptionValuationTool {...buildOptionToolProps()} />,
      "Combine fair-value estimates with put and call premium scenarios for the loaded stock.",
    );
  }

  function renderOptionsBuilderWorkspace() {
    return renderOptionsToolFrame(
      "Builder",
      <OptionBuilderTool {...buildOptionToolProps()} />,
      "Stage single-leg and defined-risk option ideas from the currently loaded stock chain.",
    );
  }

  function renderOptionsStructuresWorkspace() {
    return renderOptionsToolFrame(
      "Structures",
      <OptionStructuresTool {...buildOptionToolProps()} />,
      "Group open option positions by strategy so the account reads as structures instead of loose contracts.",
    );
  }

  function renderOptionsVolatilityWorkspace() {
    return renderOptionsToolFrame(
      "Volatility",
      <OptionVolatilityTool {...buildOptionToolProps()} />,
      "Inspect IV, skew, and open-interest context for the currently loaded stock option chain.",
    );
  }

  function renderOptionsScannerWorkspace() {
    return renderOptionsToolFrame(
      "Scanner",
      <OptionScannerTool {...buildOptionToolProps()} />,
      "Rank contracts from the loaded stock option chain by yield, liquidity, and distance from spot.",
    );
  }

  function renderCryptoWorkspace() {
    return (
      <ToolWorkspaceFrame
        description="Track the crypto market without jumping directly into one account's holdings. Account-owned balances stay on the dashboard."
        title="Crypto Market"
      >
        {cryptoMajorsQuery.isLoading ? (
          <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">Loading BTC and ETH prices…</div>
        ) : cryptoMajorsQuery.error instanceof Error ? (
          <ErrorState message={cryptoMajorsQuery.error.message} />
        ) : cryptoMajorsQuery.data ? (
          <div className="grid gap-6">
            <div className="grid gap-4 md:grid-cols-2">
              {cryptoMajorsQuery.data.quotes.map((quote) => (
                <div key={quote.symbol} className="rounded-[20px] border border-line/80 bg-panelSoft px-6 py-6">
                  <div className="text-[11px] uppercase tracking-[0.28em] text-accent">{quote.name}</div>
                  <div className="mt-2 text-sm text-muted">{quote.symbol}/USD</div>
                  <div className="mt-6 text-4xl font-semibold tracking-tight text-text">{fmtCurrency(quote.priceUsd)}</div>
                </div>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Source" value={cryptoMajorsQuery.data.source} />
              <MetricCard label="Assets" value={`${cryptoMajorsQuery.data.quotes.length} majors`} />
              <MetricCard label="Updated" value={formatTimestamp(cryptoMajorsQuery.data.generatedAt)} />
              <MetricCard label="Account overlay" value="Off" />
            </div>

            {cryptoMajorsQuery.data.sourceNotice ? (
              <div
                className={`rounded-2xl border px-4 py-3 text-sm ${
                  cryptoMajorsQuery.data.isStale
                    ? "border-caution/25 bg-caution/8 text-caution"
                    : "border-line/80 bg-panelSoft text-muted"
                }`}
              >
                {cryptoMajorsQuery.data.sourceNotice}
              </div>
            ) : null}
          </div>
        ) : (
          <ErrorState message="Crypto prices are unavailable." />
        )}
      </ToolWorkspaceFrame>
    );
  }

  function renderCryptoLeverageWorkspace() {
    return (
      <ToolWorkspaceFrame
        description="Watch derivatives-led pressure, crowding, and forced-unwind risk without opening directly into exchange account balances."
        title="Crypto Leverage"
      >
        <div className="grid gap-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard hint="Aggregate BTC and ETH perpetual open interest placeholder until derivatives feeds are connected." label="Open Interest" value="$28.4B" />
            <MetricCard hint="Weighted funding snapshot across major perpetual venues." label="Funding" value="0.018%" />
            <MetricCard hint="Perpetual premium versus spot across the major crypto pair set." label="Basis" value="4.2%" />
            <MetricCard hint="Directional pressure estimate; not tied to a Coinbase account." label="Crowding" value="Long-heavy" />
          </div>

          <Panel eyebrow="Derivatives Context" title="Leverage Map">
            <div className="grid gap-3">
              {[
                { label: "BTC perpetuals", detail: "Open interest expanding while funding sits modestly positive.", tone: "caution" as const },
                { label: "ETH perpetuals", detail: "Funding is calm, basis remains constructive, and liquidation pressure is contained.", tone: "safe" as const },
                { label: "Alt majors", detail: "Crowding read is pending until broader exchange coverage is connected.", tone: "neutral" as const },
              ].map((row) => (
                <div key={row.label} className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-sm font-medium text-text">{row.label}</div>
                      <div className="mt-1 text-sm text-muted">{row.detail}</div>
                    </div>
                    <InlinePill label={row.tone === "safe" ? "Stable" : row.tone === "caution" ? "Watch" : "Planned"} tone={row.tone} />
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel eyebrow="Source Model" title="Data Boundary">
            <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
              This workspace is intentionally market-native. Exchange connectors can provide data later, but the sidebar entry stays a crypto leverage tool rather than a connector or balances page.
            </div>
          </Panel>
        </div>
      </ToolWorkspaceFrame>
    );
  }

  function renderResearchWorkspace() {
    return (
      <div className="grid gap-6">
        <EdgarWorkspace
          defaultTicker={chainSymbol}
          onRun={(request) => {
            void runEdgarDownload(request);
          }}
          status={edgarStatusQuery.data}
          statusLoading={edgarStatusQuery.isLoading}
          statusError={edgarStatusError}
          syncError={edgarSyncError}
          syncResult={edgarSyncResult}
          syncing={edgarSyncing}
        />
        <InvestorPdfsWorkspace
          defaultTicker={chainSymbol}
          onRun={(request) => {
            void runInvestorPdfDownload(request);
          }}
          status={investorPdfStatusQuery.data}
          statusLoading={investorPdfStatusQuery.isLoading}
          statusError={investorPdfStatusError}
          syncError={investorPdfSyncError}
          syncResult={investorPdfSyncResult}
          syncing={investorPdfSyncing}
        />
      </div>
    );
  }

  return (
    <div className={`app-shell grid-shell min-h-screen text-text ${sidebarOpen ? "is-sidebar-open" : ""}`}>
      <div className="shell-topbar">
        <div className="shell-topbar-inner mx-auto w-full max-w-[1880px]">
          <button
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            className="shell-toggle"
            onClick={() => setSidebarOpen((value) => !value)}
            type="button"
          >
            <SidebarToggleIcon open={sidebarOpen} />
          </button>
          <button
            aria-label="Go to dashboard"
            aria-pressed={activeWorkspace === "dashboard"}
            className={`shell-toggle shell-home-button ${activeWorkspace === "dashboard" ? "is-active" : ""}`}
            onClick={() => {
              setActiveWorkspace("dashboard");
              setAccountSettingsOpen(false);
            }}
            type="button"
          >
            <HomeIcon />
          </button>
          <div className="shell-topbar-spacer" />
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1880px]">

        <div className="shell-frame">
          <div className="shell-sidebar-wrap">
            <aside aria-label="App shell" className="shell-sidebar">
              <div className="shell-sidebar-body">
                <div className="shell-sidebar-scroll">
                  <div className="shell-source-list">
                    <ShellSourceGroup title="Stocks">
                      <ShellSourceRow
                        active={activeWorkspace === "market"}
                        icon={<MarketIcon />}
                        onSelect={() => setActiveWorkspace("market")}
                        title="Market"
                        tone="live"
                      />

                      <ShellSourceRow
                        active={activeWorkspace === "ticker"}
                        icon={<BrokerIcon />}
                        onSelect={() => setActiveWorkspace("ticker")}
                        title="Ticker"
                        tone="live"
                      />

                      <ShellSourceSubsection title="Options" />

                      <ShellSourceRow
                        active={activeWorkspace === "options"}
                        icon={<OptionsIcon />}
                        onSelect={() => setActiveWorkspace("options")}
                        title="Chain"
                        tone="live"
                      />

                      <ShellSourceRow
                        active={activeWorkspace === "optionsValuation"}
                        icon={<ValuationIcon />}
                        onSelect={() => setActiveWorkspace("optionsValuation")}
                        title="Valuation"
                        tone="live"
                      />

                      <ShellSourceRow
                        active={activeWorkspace === "optionsBuilder"}
                        icon={<BuilderIcon />}
                        onSelect={() => setActiveWorkspace("optionsBuilder")}
                        title="Builder"
                        tone="live"
                      />

                      <ShellSourceRow
                        active={activeWorkspace === "optionsStructures"}
                        icon={<StructuresIcon />}
                        onSelect={() => setActiveWorkspace("optionsStructures")}
                        title="Structures"
                        tone="live"
                      />

                      <ShellSourceRow
                        active={activeWorkspace === "optionsVolatility"}
                        icon={<VolatilityIcon />}
                        onSelect={() => setActiveWorkspace("optionsVolatility")}
                        title="Volatility"
                        tone="live"
                      />

                      <ShellSourceRow
                        active={activeWorkspace === "optionsScanner"}
                        icon={<ScannerIcon />}
                        onSelect={() => setActiveWorkspace("optionsScanner")}
                        title="Scanner"
                        tone="live"
                      />
                    </ShellSourceGroup>

                    <ShellSourceGroup title="Crypto">
                      <ShellSourceRow
                        active={activeWorkspace === "crypto"}
                        icon={<MarketIcon />}
                        onSelect={() => setActiveWorkspace("crypto")}
                        title="Market"
                        tone="live"
                      />

                      <ShellSourceRow
                        active={activeWorkspace === "cryptoLeverage"}
                        icon={<LeverageIcon />}
                        onSelect={() => setActiveWorkspace("cryptoLeverage")}
                        title="Leverage"
                        tone="live"
                      />
                    </ShellSourceGroup>
                  </div>
                </div>

                <div className="shell-sidebar-footer">
                  <button
                    className={`shell-settings-row ${activeWorkspace === "globalSettings" ? "is-active" : ""}`}
                    onClick={() => setActiveWorkspace("globalSettings")}
                    type="button"
                  >
                    <span className="shell-row-icon">
                      <GearIcon />
                    </span>
                    <span className="shell-settings-label">Global Settings</span>
                  </button>
                </div>
              </div>
            </aside>
          </div>

          <div className="shell-stage">
            <div className={`mx-auto w-full ${isOptionsWorkspace(activeWorkspace) ? "max-w-[1840px]" : "max-w-[1600px]"}`}>
              {activeWorkspace === "dashboard" ? renderDashboardWorkspace() : null}
              {activeWorkspace === "market" ? renderMarketWorkspace() : null}
              {activeWorkspace === "ticker" ? renderTickerWorkspace() : null}
              {activeWorkspace === "options" ? renderOptionsWorkspace() : null}
              {activeWorkspace === "optionsValuation" ? renderOptionsValuationWorkspace() : null}
              {activeWorkspace === "optionsBuilder" ? renderOptionsBuilderWorkspace() : null}
              {activeWorkspace === "optionsStructures" ? renderOptionsStructuresWorkspace() : null}
              {activeWorkspace === "optionsVolatility" ? renderOptionsVolatilityWorkspace() : null}
              {activeWorkspace === "optionsScanner" ? renderOptionsScannerWorkspace() : null}
              {activeWorkspace === "crypto" ? renderCryptoWorkspace() : null}
              {activeWorkspace === "cryptoLeverage" ? renderCryptoLeverageWorkspace() : null}
              {activeWorkspace === "research" ? renderResearchWorkspace() : null}
              {activeWorkspace === "globalSettings" ? renderGlobalSettingsWorkspace() : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolWorkspaceFrame({
  title,
  description,
  headerSlot,
  titleRowSlot,
  titleEndSlot,
  children,
  compact = false,
}: {
  title: string;
  description?: string;
  headerSlot?: ReactNode;
  titleRowSlot?: ReactNode;
  titleEndSlot?: ReactNode;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="chrome-header-frame">
      <div className="account-workspace panel overflow-hidden rounded-[16px]">
        <header className={compact ? "border-b border-line/70 px-8 py-6 lg:px-10" : "border-b border-line/70 px-10 py-7 lg:px-12"}>
          <div className="grid gap-4">
            {titleRowSlot ? (
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
                <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
                  <div className="shrink-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <h1 className="text-3xl font-semibold tracking-tight text-text">{title}</h1>
                    </div>
                  </div>
                  <div className="min-w-0 lg:w-full lg:max-w-[56rem] lg:flex-[0_1_56rem]">{titleRowSlot}</div>
                </div>
                {titleEndSlot ? <div className="shrink-0">{titleEndSlot}</div> : null}
              </div>
            ) : (
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-3xl font-semibold tracking-tight text-text">{title}</h1>
                  </div>
                </div>
              </div>
            )}
            {description ? <p className="max-w-3xl text-sm text-muted">{description}</p> : null}
            {headerSlot}
          </div>
        </header>

        <section className={compact ? "px-8 py-6 lg:px-10" : "px-10 py-8 lg:px-12"}>{children}</section>
      </div>
    </div>
  );
}

function ConnectorStatusCard({
  title,
  status,
  detail,
  tone,
  icon,
  onOpen,
}: {
  title: string;
  status: string;
  detail: string;
  tone: ConnectionHealthTone;
  icon: ReactNode;
  onOpen?: () => void;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${connectionTonePanelClass(tone)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${connectionToneIconClass(tone)}`}>{icon}</span>
          <div>
            <div className="text-sm font-medium text-text">{title}</div>
            <div className="mt-1 text-xs uppercase tracking-[0.16em] text-muted">{status}</div>
          </div>
        </div>
        {onOpen ? (
          <button
            className="rounded-full border border-line/80 bg-panel px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition hover:border-accent/35 hover:text-text"
            onClick={onOpen}
            type="button"
          >
            Open
          </button>
        ) : null}
      </div>
      <div className="mt-3 text-sm text-muted">{detail}</div>
    </div>
  );
}

function ShellSourceGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="shell-source-group" aria-label={title}>
      <div className="shell-source-group-title">{title}</div>
      <div className="shell-source-group-list">{children}</div>
    </section>
  );
}

function ShellSourceSubsection({ title }: { title: string }) {
  return (
    <div className="shell-source-subsection" aria-hidden="true">
      <span>{title}</span>
    </div>
  );
}

function ShellSourceRow({
  title,
  icon,
  tone,
  active = false,
  children,
  onSelect,
}: {
  title: string;
  icon?: ReactNode;
  tone: SourceTone;
  active?: boolean;
  children?: ReactNode;
  onSelect?: () => void;
}) {
  const interactiveProps = onSelect
    ? {
        onClick: onSelect,
        onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        },
        role: "button" as const,
        tabIndex: 0,
      }
    : {};

  return (
    <section
      className={`shell-source-row ${active ? "is-active" : ""} is-${tone} ${onSelect ? "is-selectable" : ""}`}
      {...interactiveProps}
    >
      <div className="shell-source-top">
        {icon ? <span className="shell-row-icon">{icon}</span> : null}
        <div className="shell-source-copy">
          <div className="shell-source-title">{title}</div>
        </div>
      </div>
      {children ? (
        <div
          className="shell-source-extra"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}

function SidebarToggleIcon({ open }: { open: boolean }) {
  const dividerX = open ? 7.8 : 9.45;
  const dividerY = open ? 5.9 : 3.5;
  const dividerHeight = open ? 12.2 : 17;

  return (
    <svg aria-hidden="true" fill="none" height="24" viewBox="0 0 24 24" width="24">
      <rect height="17" rx="4.5" stroke="currentColor" strokeWidth="1.75" width="17" x="3.5" y="3.5" />
      <rect fill="currentColor" height={dividerHeight} rx="0.8" width="1.55" x={dividerX} y={dividerY} />
    </svg>
  );
}

function BrokerIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M4 14.5h12" opacity="0.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <path d="M5 12V8.5M10 12V5.5M15 12V7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  );
}

function MarketIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M4.2 14.8h11.6" opacity="0.45" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <path d="m4.8 12.3 2.8-2.7 2.4 1.9 4.4-4.7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55" />
      <path d="M12.6 6.8h2.9v2.9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M6.5 3.75h4.8l2.7 2.7v9.8H6.5z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M11.3 3.75v2.9h2.7" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M8.3 10h4.8M8.3 12.8h4.1" opacity="0.55" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </svg>
  );
}

function PdfLibraryIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M4.1 5.25h7.2a1.6 1.6 0 0 1 1.6 1.6v8.05H5.7a1.6 1.6 0 0 1-1.6-1.6z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.45" />
      <path d="M8.75 3.85h6.15a1.6 1.6 0 0 1 1.6 1.6v8.7" opacity="0.5" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.45" />
      <path d="M7.2 9.05h4.1M7.2 11.55h2.9" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
    </svg>
  );
}

function OptionsIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M4.25 14.75h11.5" opacity="0.45" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <path d="M6.2 11.7c1.15-2.6 2.67-3.9 4.55-3.9 1.36 0 2.54.63 3.55 1.9" stroke="currentColor" strokeLinecap="round" strokeWidth="1.55" />
      <circle cx="6" cy="12" r="1.1" fill="currentColor" />
      <circle cx="14.2" cy="9.6" r="1.1" fill="currentColor" />
    </svg>
  );
}

function ValuationIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M4.1 15.1h11.8" opacity="0.45" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
      <path d="M5.2 12.5 8 8.1l2.35 2.3 4.45-5.4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55" />
      <path d="M12.6 5h2.2v2.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.45" />
      <circle cx="7.8" cy="8.2" fill="currentColor" r="0.9" />
      <circle cx="10.4" cy="10.4" fill="currentColor" r="0.9" />
    </svg>
  );
}

function BuilderIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M5.2 5.2h9.6M5.2 10h9.6M5.2 14.8h9.6" opacity="0.45" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
      <path d="M6 14.2 9.5 7l2.25 4.4L14 6.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55" />
    </svg>
  );
}

function StructuresIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <rect height="4.4" rx="1.4" stroke="currentColor" strokeWidth="1.4" width="4.4" x="3.7" y="4" />
      <rect height="4.4" rx="1.4" stroke="currentColor" strokeWidth="1.4" width="4.4" x="11.9" y="4" />
      <rect height="4.4" rx="1.4" stroke="currentColor" strokeWidth="1.4" width="4.4" x="7.8" y="11.6" />
      <path d="M8.1 6.2h3.8M10 8.4v3.2" opacity="0.55" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
    </svg>
  );
}

function VolatilityIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M4 14.6h12" opacity="0.45" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
      <path d="M4.8 11.5c1.3 0 1.3-5.9 2.6-5.9s1.3 8.8 2.6 8.8 1.3-6.9 2.6-6.9 1.3 4 2.6 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.55" />
    </svg>
  );
}

function ScannerIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <circle cx="8.6" cy="8.6" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="m12 12 3.5 3.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
      <path d="M6.5 8.4h4.2M8.6 6.3v4.2" opacity="0.55" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <rect height="11.2" rx="2" stroke="currentColor" strokeWidth="1.45" width="12.5" x="3.75" y="5.15" />
      <path d="M6.4 3.75v2.7M13.6 3.75v2.7M3.75 8.2h12.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.45" />
    </svg>
  );
}

function CoinbaseIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <circle cx="10" cy="10" r="6.1" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12.65 7.5a3.3 3.3 0 1 0 0 5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}

function LeverageIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M4.2 14.8h11.6" opacity="0.45" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <path d="M5.3 11.8 8.1 7.5l3.2 3 3.4-5.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55" />
      <path d="M13.15 5.3h1.55v1.55" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55" />
      <path d="M6 6.2v6.1M10 8.4v3.9M14 4.9v7.4" opacity="0.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
    </svg>
  );
}

function BankIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M3.5 7.2 10 4l6.5 3.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M5.3 8.2v6.1M8.85 8.2v6.1M11.15 8.2v6.1M14.7 8.2v6.1" stroke="currentColor" strokeLinecap="round" strokeWidth="1.45" />
      <path d="M3.7 15.3h12.6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20">
      <path
        d="M8.1 3.2h3.8l.45 1.75a5.9 5.9 0 0 1 1.15.67l1.67-.86 1.9 3.28-1.35 1.25c.04.24.06.47.06.71s-.02.47-.06.71l1.35 1.25-1.9 3.28-1.67-.86a5.9 5.9 0 0 1-1.15.67l-.45 1.75H8.1l-.45-1.75a5.9 5.9 0 0 1-1.15-.67l-1.67.86-1.9-3.28 1.35-1.25A4.8 4.8 0 0 1 4.2 10c0-.24.02-.47.06-.71L2.91 8.04l1.9-3.28 1.67.86c.36-.27.74-.5 1.15-.67z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
      <circle cx="10" cy="10" r="2.35" stroke="currentColor" strokeWidth="1.35" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="24" viewBox="0 0 24 24" width="24">
      <path
        d="M3.9 10.6 12 4.1l8.1 6.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M5.55 10v9h12.9v-9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path d="M9.25 19v-5.3h5.5V19" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
    </svg>
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

function InlinePill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "safe" | "caution" | "danger" | "accent" }) {
  const toneClasses = {
    neutral: "border-line/80 bg-panelSoft text-muted",
    safe: "border-safe/25 bg-safe/10 text-safe",
    caution: "border-caution/25 bg-caution/10 text-caution",
    danger: "border-danger/25 bg-danger/10 text-danger",
    accent: "border-accent/25 bg-accent/10 text-accent",
  } as const;
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] ${toneClasses[tone]}`}>{label}</span>;
}

function PreviewSummary({ preview }: { preview: OptionOrderPreview }) {
  return (
    <div className="rounded-xl border border-line/80 bg-panelSoft px-3 py-3 text-sm">
      <div className="text-xs uppercase tracking-[0.18em] text-muted">Preview</div>
      <div className="mt-3 grid gap-2 text-muted">
        <div className="flex items-center justify-between gap-3">
          <span>Opening/closing</span>
          <span className="text-text">{preview.openingOrClosing}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Reference</span>
          <span className="text-text">{fmtCurrencySmall(preview.marketReferencePrice)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Gross premium</span>
          <span className="text-text">{fmtCurrencySmall(preview.estimatedGrossPremium)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Cash impact</span>
          <span className="text-text">{fmtCurrencySmall(preview.conservativeCashImpact)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Init margin</span>
          <span className="text-text">{fmtCurrencySmall(preview.brokerInitialMarginChange)}</span>
        </div>
      </div>
      {preview.warningText ? <div className="mt-3 text-sm text-caution">{preview.warningText}</div> : null}
      {preview.note ? <div className="mt-2 text-sm text-muted">{preview.note}</div> : null}
    </div>
  );
}

function SubmitSummary({ submitted }: { submitted: SubmittedOrder }) {
  return (
    <div className="rounded-xl border border-safe/25 bg-safe/10 px-3 py-3 text-sm text-safe" data-testid="submit-banner">
      Order {submitted.orderId} accepted with status {submitted.status}.
      {submitted.message ? ` ${submitted.message}` : ""}
    </div>
  );
}

function CancelSummary({ cancelled }: { cancelled: OrderCancelResponse }) {
  return (
    <div className="rounded-xl border border-danger/25 bg-danger/10 px-3 py-3 text-sm text-danger" data-testid="cancel-banner">
      Order {cancelled.orderId} cancel request returned status {cancelled.status}.
      {cancelled.message ? ` ${cancelled.message}` : ""}
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

function shortenPath(value: string, maxLength = 42) {
  if (value.length <= maxLength) {
    return value;
  }
  const edge = Math.max(12, Math.floor((maxLength - 1) / 2));
  return `${value.slice(0, edge)}…${value.slice(-edge)}`;
}

function connectionToneIndicatorClass(tone: ConnectionHealthTone) {
  if (tone === "safe") {
    return "bg-safe";
  }
  if (tone === "caution") {
    return "bg-caution";
  }
  if (tone === "danger") {
    return "bg-danger";
  }
  return "bg-muted";
}

function connectionToneDotClass(tone: ConnectionHealthTone) {
  if (tone === "safe") {
    return "is-live";
  }
  if (tone === "caution") {
    return "is-caution";
  }
  if (tone === "danger") {
    return "is-danger";
  }
  return "is-muted";
}

function connectionTonePanelClass(tone: ConnectionHealthTone) {
  if (tone === "planned") {
    return "border-line/80 bg-panelSoft";
  }
  return "border-line/80 bg-panelSoft";
}

function connectionToneIconClass(tone: ConnectionHealthTone) {
  if (tone === "safe") {
    return "bg-safe/10 text-safe";
  }
  if (tone === "caution") {
    return "bg-caution/10 text-caution";
  }
  if (tone === "danger") {
    return "bg-danger/10 text-danger";
  }
  return "bg-white/5 text-text";
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

function PlusCircleIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 20 20" width="14">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6.5v7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      <path d="M6.5 10h7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}

export default App;
