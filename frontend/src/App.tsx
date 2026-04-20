import { Fragment, useEffect, useRef, useState, useDeferredValue, startTransition, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
} from "./lib/types";
import {
  DASHBOARD_ACCOUNTS,
  DEFAULT_DASHBOARD_ACCOUNT_KEY,
  dashboardAccountOwnsRoute,
  getDashboardAccountByKey,
  getDashboardAccountForRoute,
  getDashboardAccountWithCoinbase,
  type DashboardAccountKey,
} from "./config/dashboardAccounts";
import { getConnectorCatalogEntry, type ConnectorCatalogId } from "./config/connectorCatalog";
import { AccountDashboardView } from "./components/AccountDashboardView";
import { AccountConnectorSection } from "./components/AccountConnectorSection";
import { EdgarWorkspace } from "./components/EdgarWorkspace";
import { InvestorPdfsWorkspace } from "./components/InvestorPdfsWorkspace";
import { MetricCard } from "./components/MetricCard";
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

const number = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const greekNumber = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 3,
});

const wholeNumber = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const ITM_PROBABILITY_RISK_FREE_RATE = 0.045;

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

function normalCdf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function probabilityItmPct(
  spot: number | null | undefined,
  strike: number | null | undefined,
  ivPct: number | null | undefined,
  expiry: string | undefined,
  right: "C" | "P",
) {
  if (spot == null || strike == null || ivPct == null || Number.isNaN(spot) || Number.isNaN(strike) || Number.isNaN(ivPct) || !expiry) {
    return null;
  }
  const expiryDate = new Date(`${expiry}T23:59:59`);
  const millisToExpiry = expiryDate.getTime() - Date.now();
  const years = Math.max(millisToExpiry / (365 * 24 * 60 * 60 * 1000), 1 / 365);
  const sigma = ivPct / 100;
  if (sigma <= 0 || spot <= 0 || strike <= 0) {
    return null;
  }
  const sqrtT = Math.sqrt(years);
  const d2 = (Math.log(spot / strike) + (ITM_PROBABILITY_RISK_FREE_RATE - 0.5 * sigma * sigma) * years) / (sigma * sqrtT);
  const probability = right === "C" ? normalCdf(d2) : normalCdf(-d2);
  return Math.max(0, Math.min(100, probability * 100));
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

function filesystemConnectorTone(
  status: FilesystemConnectorStatus | undefined,
  portfolio: FilesystemConnectorPortfolioResponse | undefined,
  portfolioError: string | null,
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
  return portfolio?.isStale || Boolean(portfolioError) ? "caution" : "safe";
}

function filesystemConnectorStatusLabel(
  status: FilesystemConnectorStatus | undefined,
  portfolio: FilesystemConnectorPortfolioResponse | undefined,
  portfolioError: string | null,
) {
  if (!status) {
    return "Checking";
  }
  if (!status.connected) {
    return "Ready";
  }
  if (status.status === "degraded" || portfolio?.isStale || portfolioError) {
    return "Connected · stale snapshot";
  }
  return "Connected";
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

type TicketContractSide = "C" | "P";
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
  | "crypto"
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

type ChainGreekKey = "iv" | "delta" | "gamma" | "theta" | "vega" | "rho";

type ChainGreekOption = {
  key: ChainGreekKey;
  label: string;
  callValue: (row: ChainRow) => number | null;
  putValue: (row: ChainRow) => number | null;
  suffix?: string;
};

const CHAIN_GREEK_STORAGE_KEY = "options-chain-visible-greeks";
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

function App() {
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [connectorPickerOpen, setConnectorPickerOpen] = useState(false);
  const [ibkrConnectorCollapsed, setIbkrConnectorCollapsed] = useState(false);
  const [coinbaseConnectorCollapsed, setCoinbaseConnectorCollapsed] = useState(false);
  const [csvFolderConnectorCollapsed, setCsvFolderConnectorCollapsed] = useState(false);
  const [connectorSetupError, setConnectorSetupError] = useState<string | null>(null);
  const [csvFolderNameDraft, setCsvFolderNameDraft] = useState("");
  const [fidelityCsvDirectoryDraft, setFidelityCsvDirectoryDraft] = useState("");
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceSurface>("dashboard");
  const [selectedDashboardAccountKey, setSelectedDashboardAccountKey] = useState<DashboardAccountKey>(DEFAULT_DASHBOARD_ACCOUNT_KEY);
  const [dashboardAccountSelectionLocked, setDashboardAccountSelectionLocked] = useState(false);
  const [marketMinBeta, setMarketMinBeta] = useState(1.7);
  const [marketMinPrice, setMarketMinPrice] = useState(10);
  const [marketMinDollarVolumeM, setMarketMinDollarVolumeM] = useState(200);
  const [marketMinShortInterestPct, setMarketMinShortInterestPct] = useState(0);
  const [marketSearch, setMarketSearch] = useState("");
  const [marketSectorFilter, setMarketSectorFilter] = useState<MarketSector | "All">("All");
  const [marketSortKey, setMarketSortKey] = useState<MarketSortKey>("beta");
  const [marketOptionableOnly, setMarketOptionableOnly] = useState(true);
  const [marketShortableOnly, setMarketShortableOnly] = useState(false);
  const [chainSymbol, setChainSymbol] = useState("NVDA");
  const [chainSymbolInput, setChainSymbolInput] = useState("NVDA");
  const [visibleChainGreeks, setVisibleChainGreeks] = useState<ChainGreekKey[]>(() => readVisibleChainGreeks());
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(undefined);
  const [selectedExpiry, setSelectedExpiry] = useState<string | undefined>(undefined);
  const [ticketDraft, setTicketDraft] = useState<TicketDraft | null>(null);
  const [ticketAction, setTicketAction] = useState<"BUY" | "SELL">("SELL");
  const [ticketQuantity, setTicketQuantity] = useState(1);
  const [ticketOrderType, setTicketOrderType] = useState<"LMT" | "MKT">("LMT");
  const [ticketLimitPrice, setTicketLimitPrice] = useState("");
  const [ticketTif, setTicketTif] = useState<"DAY" | "GTC">("DAY");
  const [previewRequestKey, setPreviewRequestKey] = useState<string | null>(null);
  const [visibleChain, setVisibleChain] = useState<OptionChainResponse | null>(null);
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
  const prefetchedExpiriesRef = useRef<Set<string>>(new Set());
  const prefetchSessionRef = useRef(0);
  const chainSymbolInputRef = useRef<HTMLInputElement | null>(null);

  const deferredTickerFilter = useDeferredValue(tickerFilter);

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
  const csvFolderStatusQuery = useQuery({
    queryKey: ["filesystem-connector-status", CSV_FOLDER_CONNECTOR_ID],
    queryFn: () => api.filesystemConnectorStatus(CSV_FOLDER_CONNECTOR_ID),
    refetchInterval: 30_000,
  });
  const csvFolderPortfolioQuery = useQuery({
    queryKey: ["filesystem-connector-portfolio", CSV_FOLDER_CONNECTOR_ID],
    queryFn: () => api.filesystemConnectorPortfolio(CSV_FOLDER_CONNECTOR_ID),
    enabled: csvFolderStatusQuery.data?.connected ?? false,
    refetchInterval: 30_000,
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

  const chainQuery = useQuery({
    queryKey: ["chain", chainSymbol, selectedExpiry],
    queryFn: () => api.chain(chainSymbol, selectedExpiry),
    refetchInterval: false,
    staleTime: 120_000,
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
    mutationFn: ({ connectorId, displayName, directoryPath }: { connectorId: ConnectorCatalogId; displayName: string; directoryPath: string }) =>
      api.filesystemConnectorConfigure(connectorId, { displayName, directoryPath }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["filesystem-connector-status", CSV_FOLDER_CONNECTOR_ID] }),
        queryClient.invalidateQueries({ queryKey: ["filesystem-connector-portfolio", CSV_FOLDER_CONNECTOR_ID] }),
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
    const nextExpiry = chainQuery.data?.selectedExpiry;
    if (nextExpiry && nextExpiry !== selectedExpiry) {
      setSelectedExpiry(nextExpiry);
    }
  }, [chainQuery.data?.selectedExpiry, selectedExpiry]);

  useEffect(() => {
    if (!chainQuery.data) {
      return;
    }
    setVisibleChain(chainQuery.data);
  }, [chainQuery.data]);

  useEffect(() => {
    prefetchedExpiriesRef.current.clear();
  }, [chainSymbol]);

  useEffect(() => {
    const chain = chainQuery.data;
    if (!chain) {
      return;
    }
    const sessionId = ++prefetchSessionRef.current;
    const expiriesToPrefetch = chain.expiries.filter((expiry) => expiry !== chain.selectedExpiry).slice(0, 2);
    const timer = window.setTimeout(() => {
      void (async () => {
        for (const expiry of expiriesToPrefetch) {
          if (prefetchSessionRef.current !== sessionId) {
            continue;
          }
          const cacheKey = `${chain.symbol}:${expiry}`;
          if (prefetchedExpiriesRef.current.has(cacheKey)) {
            continue;
          }
          prefetchedExpiriesRef.current.add(cacheKey);
          await queryClient.prefetchQuery({
            queryKey: ["chain", chain.symbol, expiry],
            queryFn: () => api.chain(chain.symbol, expiry),
            staleTime: 20_000,
          });
        }
      })();
    }, 3_500);

    return () => window.clearTimeout(timer);
  }, [chainQuery.data, queryClient]);

  useEffect(() => {
    setChainSymbolInput(chainSymbol);
  }, [chainSymbol]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(CHAIN_GREEK_STORAGE_KEY, JSON.stringify(visibleChainGreeks));
  }, [visibleChainGreeks]);

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
    if (dashboardAccountSelectionLocked) {
      return;
    }
    const routedAccount = connectionQuery.data?.accountId;
    if (!routedAccount) {
      return;
    }
    const matchingAccount = getDashboardAccountForRoute(routedAccount)?.key ?? null;
    if (matchingAccount && matchingAccount !== selectedDashboardAccountKey) {
      setSelectedDashboardAccountKey(matchingAccount);
    }
  }, [connectionQuery.data?.accountId, dashboardAccountSelectionLocked, selectedDashboardAccountKey]);

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
    setCsvFolderNameDraft(csvFolderStatusQuery.data?.displayName ?? "");
    setFidelityCsvDirectoryDraft(csvFolderStatusQuery.data?.directoryPath ?? "");
  }, [connectorPickerOpen, csvFolderStatusQuery.data?.directoryPath, csvFolderStatusQuery.data?.displayName]);

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
  const activeDisplayedChain = visibleChain;
  const activeChainMatchesRequest = activeDisplayedChain?.symbol === chainSymbol;
  const isLoadingDifferentSymbol = chainQuery.isFetching && Boolean(activeDisplayedChain) && !activeChainMatchesRequest;
  const chainHasBidAsk = ((activeChainMatchesRequest ? chainQuery.data?.rows : activeDisplayedChain?.rows) ?? []).some(
    (row) => row.callBid != null || row.callAsk != null || row.putBid != null || row.putAsk != null,
  );
  const chainHasOptionMarks = ((activeChainMatchesRequest ? chainQuery.data?.rows : activeDisplayedChain?.rows) ?? []).some(
    (row) => row.callMid != null || row.putMid != null,
  );
  const chainError = chainQuery.error instanceof Error ? chainQuery.error.message : null;
  const chainErrorHeaderLabel =
    chainError && activeDisplayedChain && !activeChainMatchesRequest
      ? `Could not load ${chainSymbol}. Still showing the last loaded chain. ${chainError}`
      : chainError;
  const displayedChainRows = activeDisplayedChain?.rows ?? [];
  const displayedExpiries = activeChainMatchesRequest ? activeDisplayedChain?.expiries ?? [] : [];
  const activeExpiry = selectedExpiry ?? activeDisplayedChain?.selectedExpiry ?? undefined;
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
  const csvFolderStatusError = csvFolderStatusQuery.error instanceof Error ? csvFolderStatusQuery.error.message : null;
  const csvFolderPortfolioError =
    csvFolderPortfolioQuery.error instanceof Error ? csvFolderPortfolioQuery.error.message : null;
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
  const coinbaseAssignedAccount = getDashboardAccountWithCoinbase();
  const coinbaseConnectorDetail = coinbaseStatusQuery.isLoading
    ? "Loading Coinbase connector status"
    : coinbaseStatusQuery.data?.available
      ? `Assigned to ${coinbaseAssignedAccount?.name ?? "configured"} dashboard`
      : `Connector settings for ${coinbaseAssignedAccount?.name ?? "configured"} dashboard`;
  const csvFolderConnectorDisplayName = csvFolderStatusQuery.data?.displayName?.trim() || "CSV Folder";
  const localBackendUnavailable =
    isLocalBackendUnavailable(connectionQueryError) ||
    isLocalBackendUnavailable(csvFolderStatusError) ||
    isLocalBackendUnavailable(csvFolderPortfolioError);
  const csvFolderConnectorTone = localBackendUnavailable
    ? "danger"
    : filesystemConnectorTone(
        csvFolderStatusQuery.data,
        csvFolderPortfolioQuery.data,
        csvFolderPortfolioError ?? csvFolderStatusError,
      );
  const csvFolderConnectorStatus = localBackendUnavailable
    ? "Backend unavailable"
    : filesystemConnectorStatusLabel(
        csvFolderStatusQuery.data,
        csvFolderPortfolioQuery.data,
        csvFolderPortfolioError ?? csvFolderStatusError,
      );
  const csvFolderConnectorDetail = csvFolderStatusQuery.isLoading
    ? "Loading CSV folder connector status"
    : localBackendUnavailable
      ? connectionQueryError ?? csvFolderStatusError ?? csvFolderPortfolioError ?? "The local backend is unavailable."
      : csvFolderStatusError
      ? csvFolderStatusError
      : csvFolderStatusQuery.data?.directoryPath
        ? `${csvFolderStatusQuery.data.directoryPath} · ${fmtWholeNumber(csvFolderStatusQuery.data.csvFilesCount)} files`
        : csvFolderStatusQuery.data?.detail ?? "Add a CSV folder connector.";
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
  const dashboardTotalPnl = sumPositionPnl(dashboardPositions) + sumOptionPositionPnl(dashboardOptionPositions);
  const dashboardSourceNotice =
    selectedDashboardOwnsRoute || !routedAccount
      ? null
      : `${selectedDashboardAccount.name} is selected, but the current Gateway route is ${routedAccount}. Switch the Gateway session to this account to view routed balances, orders, and positions here.`;
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

  function buildFilesystemConnectorCard(connectorId: ConnectorCatalogId): AccountConnectorCard | null {
    const connector = getConnectorCatalogEntry(connectorId);
    if (!connector) {
      return null;
    }
    if (connectorId === CSV_FOLDER_CONNECTOR_ID) {
      if (!csvFolderStatusQuery.data?.connected && !localBackendUnavailable) {
        return null;
      }
      return {
        id: connector.id,
        title: csvFolderConnectorDisplayName,
        status: csvFolderConnectorStatus,
        detail: csvFolderConnectorDetail,
        tone: csvFolderConnectorTone,
        countsTowardHealth: true,
        icon: <BankIcon />,
      };
    }
    return null;
  }

  const accountConnectorCardsByKey = Object.fromEntries(
    DASHBOARD_ACCOUNTS.map((account) => {
      const connectorCards: AccountConnectorCard[] = [buildIbkrConnectorCard(account.key)];
      if (account.dashboardSections.coinbase) {
        connectorCards.push({
          id: `coinbase-${account.key}`,
          title: "Coinbase account",
          status: coinbaseConnectorStatus,
          detail: coinbaseConnectorDetail,
          tone: coinbaseConnectorTone,
          countsTowardHealth: true,
          icon: <CoinbaseIcon />,
        });
      }
      account.availableConnectorIds.forEach((connectorId) => {
        const connectorCard = buildFilesystemConnectorCard(connectorId);
        if (connectorCard) {
          connectorCards.push(connectorCard);
        }
      });
      return [account.key, connectorCards];
    }),
  ) as Record<DashboardAccountKey, AccountConnectorCard[]>;
  const accountSettingsConnectors = accountConnectorCardsByKey[selectedDashboardAccount.key];
  const definedConnectors = accountSettingsConnectors.filter((connector) => connector.countsTowardHealth);
  const definedConnectorCount = definedConnectors.length;
  const liveConnectorCount = definedConnectors.filter((connector) => connector.tone === "safe").length;
  const connectedConnectorCount = definedConnectors.filter((connector) => connector.tone === "safe" || connector.tone === "caution").length;
  const activeConnectorIds = new Set(accountSettingsConnectors.map((connector) => connector.id));
  const availableConnectorOptions = selectedDashboardAccount.availableConnectorIds
    .map((connectorId) => getConnectorCatalogEntry(connectorId))
    .filter((connector): connector is NonNullable<ReturnType<typeof getConnectorCatalogEntry>> => Boolean(connector))
    .filter((connector) => connector.id === CSV_FOLDER_CONNECTOR_ID || !activeConnectorIds.has(connector.id));
  const availableConnectorCount = availableConnectorOptions.length;
  const dashboardAccountStatuses = Object.fromEntries(
    DASHBOARD_ACCOUNTS.map((account) => {
      const connectors = accountConnectorCardsByKey[account.key];
      const accountDefinedConnectors = connectors.filter((connector) => connector.countsTowardHealth);
      const accountLiveConnectors = accountDefinedConnectors.filter((connector) => connector.tone === "safe").length;
      const accountConnectedConnectors = accountDefinedConnectors.filter(
        (connector) => connector.tone === "safe" || connector.tone === "caution",
      ).length;
      const tone: ConnectionHealthTone =
        accountConnectedConnectors === 0 ? "danger" : accountLiveConnectors === accountDefinedConnectors.length ? "safe" : "caution";
      const label =
        tone === "safe" ? "Ready" : tone === "caution" ? `${accountConnectedConnectors}/${accountDefinedConnectors.length || 0} online` : "Offline";
      return [account.key, { label, toneDotClassName: connectionToneDotClass(tone) }];
    }),
  ) as Record<DashboardAccountKey, { label: string; toneDotClassName: string }>;
  const accountStatusTone: ConnectionHealthTone =
    connectedConnectorCount === 0 ? "danger" : liveConnectorCount === definedConnectorCount ? "safe" : "caution";
  const accountStatusLabel =
    accountStatusTone === "safe"
      ? "All connectors live"
      : accountStatusTone === "caution"
        ? "Partial connector coverage"
        : "No live connectors";
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

  function handleChainSymbolSelection(nextSymbol: string) {
    const normalizedSymbol = nextSymbol.trim().toUpperCase();
    if (!normalizedSymbol || normalizedSymbol === chainSymbol) {
      return;
    }
    startTransition(() => {
      setChainSymbol(normalizedSymbol);
      setSelectedExpiry(undefined);
    });
  }

  function submitChainSymbolInput() {
    handleChainSymbolSelection(chainSymbolInputRef.current?.value ?? chainSymbolInput);
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

  function handleExpirySelection(nextExpiry: string) {
    if (!nextExpiry || nextExpiry === selectedExpiry) {
      return;
    }
    startTransition(() => {
      setSelectedExpiry(nextExpiry);
    });
  }

  function toggleVisibleGreek(nextGreek: ChainGreekKey) {
    setVisibleChainGreeks((current) =>
      current.includes(nextGreek) ? current.filter((value) => value !== nextGreek) : [...current, nextGreek],
    );
  }

  function resetTicketFeedback() {
    previewMutation.reset();
    submitMutation.reset();
    cancelMutation.reset();
    setPreviewRequestKey(null);
  }

  function renderIbkrOptionsSurface() {
    const busySymbolLabel = chainSymbol;
    const selectedChainGreekOptions = CHAIN_GREEK_OPTIONS.filter((option) => visibleChainGreeks.includes(option.key));
    const chainTableColumnCount = 15 + selectedChainGreekOptions.length * 2;
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
    const requestedSymbolPriceLabel = isLoadingDifferentSymbol
      ? "Loading spot"
      : activeDisplayedChain
        ? `Spot ${fmtCurrencySmall(activeDisplayedChain.underlying.price)}`
        : "No chain loaded";
    const spotPrice = activeDisplayedChain?.underlying.price ?? null;
    const hasExactSpotStrike =
      spotPrice != null && displayedChainRows.some((row) => Math.abs(row.strike - spotPrice) < 0.0001);
    const spotInsertIndex =
      spotPrice == null || hasExactSpotStrike
        ? -1
        : displayedChainRows.findIndex((row) => row.strike >= spotPrice);
    const normalizedSpotInsertIndex =
      spotInsertIndex === -1 && spotPrice != null && !hasExactSpotStrike ? displayedChainRows.length : spotInsertIndex;

    return (
      <div className="grid gap-4">
        <div className="grid gap-3 rounded-2xl border border-line/80 bg-panel px-4 py-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center">
              <label className="flex-1">
                <span className="sr-only">Option symbol</span>
                <input
                  className="w-full rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-base text-text outline-none transition focus:border-accent/60"
                  data-testid="chain-symbol-input"
                  onChange={(event) => setChainSymbolInput(event.target.value.toUpperCase())}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      submitChainSymbolInput();
                    }
                  }}
                  placeholder="Enter ticker"
                  ref={chainSymbolInputRef}
                  spellCheck={false}
                  type="text"
                  value={chainSymbolInput}
                />
              </label>
              <button
                className="inline-flex h-12 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 px-4 text-sm font-medium text-accent transition hover:border-accent/50 hover:bg-accent/16 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="chain-load-button"
                disabled={!chainSymbolInput.trim() || connectMutation.isPending || reconnectMutation.isPending}
                onClick={submitChainSymbolInput}
                type="button"
              >
                {chainQuery.isFetching && chainSymbolInput.trim().toUpperCase() === chainSymbol ? `Loading ${chainSymbol}…` : "Load chain"}
              </button>
            </div>
            <div className="text-xs text-muted">{requestedSymbolPriceLabel}</div>
          </div>

        </div>
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

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Options Chain</div>
                  <div className="mt-1 text-lg font-semibold text-text" data-testid="chain-heading">
                    {chainHeadingLabel}
                  </div>
                  {chainContextLabel ? <div className="mt-2 max-w-3xl text-xs leading-5 text-muted">{chainContextLabel}</div> : null}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
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

            {displayedChainRows.length ? (
              <div className={`${isLoadingDifferentSymbol ? "opacity-55" : chainQuery.isFetching ? "opacity-80" : ""} overflow-x-auto`}>
                <table className="min-w-max text-left text-sm">
                  <thead className="bg-panel/95 text-[11px] uppercase tracking-[0.18em] text-muted">
                    <tr className="border-b border-line/70 text-[10px] tracking-[0.24em]">
                      <th className="px-4 pb-2 pt-3 text-accent" colSpan={6 + selectedChainGreekOptions.length}>
                        Calls
                      </th>
                      <th className="px-4 pb-2 pt-3 text-text" colSpan={1}>
                        Strike
                      </th>
                      <th className="px-4 pb-2 pt-3 text-caution" colSpan={selectedChainGreekOptions.length + 6}>
                        Puts
                      </th>
                      <th className="px-4 pb-2 pt-3 text-right text-muted" colSpan={2}>
                        Ticket
                      </th>
                    </tr>
                    <tr>
                      <th className="px-4 py-3">Bid</th>
                      <th className="px-4 py-3">Ask</th>
                      <th className="px-4 py-3">Mark</th>
                      <th className="px-4 py-3">Vol</th>
                      <th className="px-4 py-3">OI</th>
                      {selectedChainGreekOptions.map((option) => (
                        <th key={`call-${option.key}`} className="px-4 py-3">
                          {option.label}
                        </th>
                      ))}
                      <th className="px-4 py-3">ITM %</th>
                      <th className="px-4 py-3">Strike</th>
                      <th className="px-4 py-3">ITM %</th>
                      {selectedChainGreekOptions.map((option) => (
                        <th key={`put-${option.key}`} className="px-4 py-3">
                          {option.label}
                        </th>
                      ))}
                      <th className="px-4 py-3">OI</th>
                      <th className="px-4 py-3">Vol</th>
                      <th className="px-4 py-3">Mark</th>
                      <th className="px-4 py-3">Ask</th>
                      <th className="px-4 py-3">Bid</th>
                      <th className="px-4 py-3 text-right">Call</th>
                      <th className="px-4 py-3 text-right">Put</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedChainRows.map((row, index) => {
                      const callItmPct = probabilityItmPct(spotPrice, row.strike, row.callIV, activeExpiry, "C");
                      const putItmPct = probabilityItmPct(spotPrice, row.strike, row.putIV, activeExpiry, "P");
                      const previousFiveBucket =
                        index === 0 ? null : Math.floor(Math.abs(displayedChainRows[index - 1].distanceFromSpotPct) / 5);
                      const currentFiveBucket = Math.floor(Math.abs(row.distanceFromSpotPct) / 5);
                      const previousTenBucket =
                        index === 0 ? null : Math.floor(Math.abs(displayedChainRows[index - 1].distanceFromSpotPct) / 10);
                      const currentTenBucket = Math.floor(Math.abs(row.distanceFromSpotPct) / 10);
                      const isTenPercentBreak = index > 0 && currentTenBucket !== previousTenBucket;
                      const isFivePercentBreak = index > 0 && !isTenPercentBreak && currentFiveBucket !== previousFiveBucket;
                      const boundaryClass = isTenPercentBreak
                        ? "border-t-2 border-accent/40"
                        : isFivePercentBreak
                          ? "border-t-2 border-line/95"
                          : "border-t border-line/70";
                      const boundaryToneClass = isTenPercentBreak
                        ? "bg-accent/[0.035]"
                        : isFivePercentBreak
                          ? "bg-white/[0.018] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                          : "";

                      return (
                        <Fragment key={`${activeDisplayedChain?.symbol ?? chainSymbol}-${row.strike}-${index}-group`}>
                          {normalizedSpotInsertIndex === index && spotPrice != null ? (
                            <tr
                              key={`${activeDisplayedChain?.symbol ?? chainSymbol}-spot-row-${index}`}
                              className="border-t border-line/70"
                              data-testid="chain-spot-row"
                            >
                              <td
                                className="px-4 py-2"
                                colSpan={chainTableColumnCount}
                                style={{
                                  backgroundImage:
                                    "repeating-linear-gradient(135deg, rgba(123, 243, 214, 0.08) 0, rgba(123, 243, 214, 0.08) 10px, transparent 10px, transparent 20px)",
                                }}
                              >
                                <div className="flex items-center justify-center gap-3 text-[11px] uppercase tracking-[0.18em] text-accent">
                                  <span>Spot</span>
                                  <span className="text-text">{fmtCurrencySmall(spotPrice)}</span>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                          <tr
                            key={`${activeDisplayedChain?.symbol ?? chainSymbol}-${row.strike}-${index}`}
                            className={`${boundaryClass} ${boundaryToneClass} transition hover:bg-white/[0.02]`}
                            data-testid={`chain-row-${index}`}
                          >
                            <td className="px-4 py-3">{fmtCurrencySmall(row.callBid)}</td>
                            <td className="px-4 py-3">{fmtCurrencySmall(row.callAsk)}</td>
                            <td className="px-4 py-3">{fmtCurrencySmall(row.callMid)}</td>
                            <td className="px-4 py-3">{fmtWholeNumber(row.callVolume)}</td>
                            <td className="px-4 py-3">{fmtWholeNumber(row.callOpenInterest)}</td>
                            {selectedChainGreekOptions.map((option) => (
                              <td key={`call-cell-${option.key}-${row.strike}`} className="px-4 py-3">
                                {fmtGreek(option.callValue(row), option.suffix ?? "")}
                              </td>
                            ))}
                            <td className="px-4 py-3">{fmtNumber(callItmPct, "%")}</td>
                            <td className="px-4 py-3 font-medium text-text">{fmtCurrencySmall(row.strike)}</td>
                            <td className="px-4 py-3">{fmtNumber(putItmPct, "%")}</td>
                            {selectedChainGreekOptions.map((option) => (
                              <td key={`put-cell-${option.key}-${row.strike}`} className="px-4 py-3">
                                {fmtGreek(option.putValue(row), option.suffix ?? "")}
                              </td>
                            ))}
                            <td className="px-4 py-3">{fmtWholeNumber(row.putOpenInterest)}</td>
                            <td className="px-4 py-3">{fmtWholeNumber(row.putVolume)}</td>
                            <td className="px-4 py-3">{fmtCurrencySmall(row.putMid)}</td>
                            <td className="px-4 py-3">{fmtCurrencySmall(row.putAsk)}</td>
                            <td className="px-4 py-3">{fmtCurrencySmall(row.putBid)}</td>
                            <td className="px-4 py-3 text-right">
                              <button
                                className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition hover:border-accent/50 hover:bg-accent/16"
                                data-testid={`load-call-${index}`}
                                disabled={isLoadingDifferentSymbol}
                                onClick={() => loadTicket(row, "C")}
                                type="button"
                              >
                                Load call
                              </button>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                className="rounded-full border border-caution/30 bg-caution/10 px-3 py-1.5 text-xs font-medium text-caution transition hover:border-caution/50 hover:bg-caution/16"
                                data-testid={`load-put-${index}`}
                                disabled={isLoadingDifferentSymbol}
                                onClick={() => loadTicket(row, "P")}
                                type="button"
                              >
                                Load put
                              </button>
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
                    {normalizedSpotInsertIndex === displayedChainRows.length && spotPrice != null ? (
                      <tr
                        key={`${activeDisplayedChain?.symbol ?? chainSymbol}-spot-row-tail`}
                        className="border-t border-line/70"
                        data-testid="chain-spot-row"
                      >
                        <td
                          className="px-4 py-2"
                          colSpan={chainTableColumnCount}
                          style={{
                            backgroundImage:
                              "repeating-linear-gradient(135deg, rgba(123, 243, 214, 0.08) 0, rgba(123, 243, 214, 0.08) 10px, transparent 10px, transparent 20px)",
                          }}
                        >
                          <div className="flex items-center justify-center gap-3 text-[11px] uppercase tracking-[0.18em] text-accent">
                            <span>Spot</span>
                            <span className="text-text">{fmtCurrencySmall(spotPrice)}</span>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : chainQuery.isLoading || chainQuery.isFetching ? (
              <div className="px-4 py-10 text-sm text-muted">Loading option chain…</div>
            ) : (
              <div className="px-4 py-10 text-sm text-muted">Load an optionable ticker to see the chain.</div>
            )}
          </div>

          <div className="grid content-start gap-4">
            <div className="rounded-2xl border border-line/80 bg-panel px-4 py-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Trade Ticket</div>
                <div className="mt-1 text-lg font-semibold text-text">{selectedContractLabel ?? "Select a contract"}</div>
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
    const displayName = csvFolderNameDraft.trim();
    const directoryPath = fidelityCsvDirectoryDraft.trim();
    if (!displayName) {
      setConnectorSetupError("Add a connector name before saving this connector.");
      return;
    }
    if (!directoryPath) {
      setConnectorSetupError("Add a folder path before saving this connector.");
      return;
    }
    try {
      await filesystemConnectorConfigureMutation.mutateAsync({ connectorId, displayName, directoryPath });
      setConnectorPickerOpen(false);
      setConnectorSetupError(null);
    } catch (error) {
      setConnectorSetupError(error instanceof Error ? error.message : "Could not save the CSV folder.");
    }
  }

  async function chooseCsvFolder() {
    setConnectorSetupError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose CSV Folder",
        defaultPath: fidelityCsvDirectoryDraft.trim() || undefined,
      });
      if (typeof selected === "string" && selected.trim()) {
        setFidelityCsvDirectoryDraft(selected);
      }
    } catch (error) {
      setConnectorSetupError(error instanceof Error ? error.message : "Could not open the system folder picker.");
    }
  }

  function renderFidelityCsvPanelContent() {
    return localBackendUnavailable ? (
      <ErrorState message={connectionQueryError ?? csvFolderStatusError ?? csvFolderPortfolioError ?? "The local backend is unavailable."} />
    ) : csvFolderStatusQuery.isLoading ? (
      <div className="text-sm text-muted">Checking CSV folder connector...</div>
    ) : !csvFolderStatusQuery.data?.available ? (
      <div className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard label="Connector" value="Not configured" />
          <MetricCard label="Provider" value="Filesystem" />
          <MetricCard label="Folder" value="Add a path in Settings" />
        </div>
        <ErrorState message={csvFolderStatusError ?? csvFolderStatusQuery.data?.detail ?? "CSV folder is unavailable."} />
      </div>
    ) : !csvFolderStatusQuery.data.connected ? (
      <div className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard label="Connector" value="Ready for CSVs" />
          <MetricCard label="Provider" value="Filesystem" />
          <MetricCard label="Folder" value={csvFolderStatusQuery.data.directoryPath ?? "Not set"} />
        </div>
        <ErrorState message={csvFolderStatusQuery.data.detail} />
      </div>
    ) : csvFolderPortfolioQuery.isLoading ? (
      <div className="text-sm text-muted">Loading CSV holdings...</div>
    ) : csvFolderPortfolioQuery.error instanceof Error ? (
      <ErrorState message={csvFolderPortfolioQuery.error.message} />
    ) : csvFolderPortfolioQuery.data ? (
      <div className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Total value" value={fmtCurrency(csvFolderPortfolioQuery.data.totalValue)} />
          <MetricCard label="Accounts" value={fmtNumber(csvFolderPortfolioQuery.data.investmentAccountsCount)} />
          <MetricCard label="Holdings" value={fmtNumber(csvFolderPortfolioQuery.data.holdingsCount)} />
          <MetricCard
            label="Snapshot"
            value={csvFolderPortfolioQuery.data.latestCsvPath?.split("/").pop() ?? "Latest CSV"}
          />
        </div>
        <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-muted">
          <div className="font-medium text-text">Connector</div>
          <div className="mt-1">{csvFolderPortfolioQuery.data.displayName ?? "CSV Folder"}</div>
          <div className="font-medium text-text">Folder</div>
          <div className="mt-1 break-all">{csvFolderPortfolioQuery.data.directoryPath}</div>
          {csvFolderPortfolioQuery.data.latestCsvPath ? (
            <>
              <div className="mt-3 font-medium text-text">Latest CSV</div>
              <div className="mt-1 break-all">{csvFolderPortfolioQuery.data.latestCsvPath}</div>
            </>
          ) : null}
        </div>
        {csvFolderPortfolioQuery.data.sourceNotice ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              csvFolderPortfolioQuery.data.isStale
                ? "border-caution/25 bg-caution/8 text-caution"
                : "border-line/80 bg-panelSoft text-muted"
            }`}
          >
            {csvFolderPortfolioQuery.data.sourceNotice}
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="min-w-[920px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-[0.16em] text-muted">
              <tr>
                <th className="pb-3 pr-4">Holding</th>
                <th className="pb-3 pr-4">Account</th>
                <th className="pb-3 pr-4">Qty</th>
                <th className="pb-3 pr-4">Price</th>
                <th className="pb-3 pr-4">Value</th>
                <th className="pb-3 pr-4">Cost basis</th>
                <th className="pb-3">Gain / loss</th>
              </tr>
            </thead>
            <tbody>
              {csvFolderPortfolioQuery.data.holdings.map((holding) => (
                <tr key={`${holding.accountId}-${holding.symbol ?? holding.name}`} className="border-t border-line/70 align-top">
                  <td className="py-3 pr-4">
                    <div className="font-medium text-text">{holding.symbol ?? holding.name}</div>
                    <div className="mt-1 text-xs text-muted">{holding.symbol ? holding.name : "CSV holding"}</div>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="text-text">{holding.accountName}</div>
                  </td>
                  <td className="py-3 pr-4">{fmtNumber(holding.quantity)}</td>
                  <td className="py-3 pr-4">{fmtCurrencySmall(holding.price)}</td>
                  <td className="py-3 pr-4 font-medium text-text">{fmtCurrency(holding.value)}</td>
                  <td className="py-3 pr-4">{fmtCurrency(holding.costBasis)}</td>
                  <td className={`py-3 ${pnlTone(holding.gainLoss)}`}>{fmtCurrency(holding.gainLoss)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    ) : (
      <ErrorState message="CSV holdings are unavailable." />
    );
  }

  const dashboardSummaryContent = (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          hint={selectedDashboardOwnsRoute && routedAccount ? `${routedAccount} · ${routedAccountPill.label}` : "Current Gateway route is not this account"}
          label="Total PnL"
          tone={pnlMetricTone(selectedDashboardOwnsRoute ? dashboardTotalPnl : null)}
          value={selectedDashboardOwnsRoute ? fmtCurrency(dashboardTotalPnl) : "—"}
        />
        <MetricCard
          hint="Daily account PnL is not exposed in the current broker snapshot yet."
          label="Today's PnL"
          value="—"
        />
        <MetricCard
          hint="Month-to-date account PnL is not exposed in the current broker snapshot yet."
          label="Month PnL"
          value="—"
        />
        <MetricCard label="Net Worth" value={dashboardRisk ? fmtCurrency(dashboardRisk.account.netLiquidation) : "—"} />
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
                  {connector.id === CSV_FOLDER_CONNECTOR_ID && connector.availability === "ready" ? (
                    <div className="mt-4 grid gap-3">
                      <label className="grid gap-2">
                        <span className="text-[11px] uppercase tracking-[0.16em] text-muted">Connector name</span>
                        <input
                          className="w-full rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-text outline-none transition focus:border-accent/60"
                          onChange={(event) => setCsvFolderNameDraft(event.target.value)}
                          placeholder="Fidelity"
                          spellCheck={false}
                          type="text"
                          value={csvFolderNameDraft}
                        />
                      </label>
                      <label className="grid gap-2">
                        <span className="text-[11px] uppercase tracking-[0.16em] text-muted">CSV folder path</span>
                        <div className="flex gap-2">
                          <input
                            className="w-full rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-text outline-none transition focus:border-accent/60"
                            onChange={(event) => setFidelityCsvDirectoryDraft(event.target.value)}
                            placeholder="/Users/imyjimmy/Documents/.../fidelity/daily-positions"
                            spellCheck={false}
                            type="text"
                            value={fidelityCsvDirectoryDraft}
                          />
                          <button
                            className="shrink-0 rounded-xl border border-line/80 bg-panelSoft px-3 py-3 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition hover:border-accent/35 hover:text-text"
                            onClick={() => {
                              void chooseCsvFolder();
                            }}
                            type="button"
                          >
                            Choose Folder
                          </button>
                        </div>
                      </label>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs text-muted">
                          {csvFolderStatusQuery.data?.directoryPath
                            ? "Updating the saved connector name or folder path."
                            : "The latest CSV in this folder will drive the connector snapshot."}
                        </div>
                        <button
                          className="rounded-full border border-line/80 bg-panel px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition hover:border-accent/35 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={filesystemConnectorConfigureMutation.isPending || !csvFolderNameDraft.trim() || !fidelityCsvDirectoryDraft.trim()}
                          onClick={() => {
                            void saveFilesystemConnector(connector.id);
                          }}
                          type="button"
                        >
                          {filesystemConnectorConfigureMutation.isPending ? "Saving…" : csvFolderStatusQuery.data?.directoryPath ? "Update" : "Add"}
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
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  );

  const dashboardBodyContent = (
    <>
      {dashboardSourceNotice ? (
        <div className="rounded-2xl border border-caution/25 bg-caution/8 px-4 py-3 text-sm text-caution">
          {dashboardSourceNotice}
        </div>
      ) : null}

      <AccountConnectorSection
        collapsed={ibkrConnectorCollapsed}
        details={
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <InlinePill
              label={routedAccount ? `Acct ${routedAccount}` : "Acct pending"}
              tone={connectionQuery.data?.connected ? "safe" : "neutral"}
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

      {selectedDashboardAccount.dashboardSections.coinbase ? (
        <AccountConnectorSection
          collapsed={coinbaseConnectorCollapsed}
          details={
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <InlinePill
                label={coinbaseConnectorStatus}
                tone={coinbaseConnectorTone === "danger" ? "danger" : coinbaseConnectorTone === "safe" ? "safe" : "neutral"}
              />
            </div>
          }
          eyebrow="Coinbase source"
          onToggle={() => setCoinbaseConnectorCollapsed((value) => !value)}
          title="Coinbase"
        >
          {renderCoinbasePanelContent()}
        </AccountConnectorSection>
      ) : null}

      {selectedDashboardAccount.availableConnectorIds.includes(CSV_FOLDER_CONNECTOR_ID) && csvFolderStatusQuery.data?.connected ? (
        <AccountConnectorSection
          collapsed={csvFolderConnectorCollapsed}
          details={
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <InlinePill
                label={csvFolderConnectorStatus}
                tone={csvFolderConnectorTone === "danger" ? "danger" : csvFolderConnectorTone === "safe" ? "safe" : "neutral"}
              />
              <InlinePill label={csvFolderConnectorDisplayName} tone="neutral" />
            </div>
          }
          eyebrow={getConnectorCatalogEntry(CSV_FOLDER_CONNECTOR_ID)?.dashboardEyebrow ?? "Filesystem source"}
          onToggle={() => setCsvFolderConnectorCollapsed((value) => !value)}
          title={csvFolderPortfolioQuery.data?.displayName ?? csvFolderStatusQuery.data?.displayName ?? getConnectorCatalogEntry(CSV_FOLDER_CONNECTOR_ID)?.dashboardTitle ?? "CSV Folder"}
        >
          {renderFidelityCsvPanelContent()}
        </AccountConnectorSection>
      ) : null}
    </>
  );

  function renderDashboardWorkspace() {
    return (
      <AccountDashboardView
        accountSettingsOpen={accountSettingsOpen}
        accountStatuses={dashboardAccountStatuses}
        bodyContent={dashboardBodyContent}
        headerRouteLabel={dashboardHeaderRouteLabel}
        headerStatusIndicatorClassName={connectionToneIndicatorClass(accountStatusTone)}
        headerStatusLabel={accountStatusLabel}
        onSelectAccount={(accountKey) => {
          setSelectedDashboardAccountKey(accountKey);
          setDashboardAccountSelectionLocked(true);
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
        description="Inspect an underlying without entering an account view. Market lookup stays separate from portfolio state."
        title="Ticker"
      >
        <div className="grid gap-6">
          <div className="grid gap-3 rounded-2xl border border-line/80 bg-panel px-4 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center">
                <label className="flex-1">
                  <span className="sr-only">Ticker symbol</span>
                  <input
                    className="w-full rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-base text-text outline-none transition focus:border-accent/60"
                    onChange={(event) => setChainSymbolInput(event.target.value.toUpperCase())}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        submitChainSymbolInput();
                      }
                    }}
                    placeholder="Enter ticker"
                    ref={chainSymbolInputRef}
                    spellCheck={false}
                    type="text"
                    value={chainSymbolInput}
                  />
                </label>
                <button
                  className="inline-flex h-12 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 px-4 text-sm font-medium text-accent transition hover:border-accent/50 hover:bg-accent/16 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!chainSymbolInput.trim() || connectMutation.isPending || reconnectMutation.isPending}
                  onClick={submitChainSymbolInput}
                  type="button"
                >
                  {chainQuery.isFetching && chainSymbolInput.trim().toUpperCase() === chainSymbol ? `Loading ${chainSymbol}…` : "Load ticker"}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <InlinePill
                  label={connectionQuery.data?.marketDataMode ?? "DATA"}
                  tone={connectionQuery.data?.marketDataMode === "LIVE" ? "safe" : "neutral"}
                />
                <InlinePill
                  label={activeDisplayedChain ? `Spot ${fmtCurrencySmall(activeDisplayedChain.underlying.price)}` : "No quote loaded"}
                  tone="neutral"
                />
              </div>
            </div>
          </div>

          {chainErrorHeaderLabel ? (
            <div className="rounded-2xl border border-danger/20 bg-danger/8 px-4 py-3 text-sm text-danger">{chainErrorHeaderLabel}</div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Ticker" value={chainSymbol} />
            <MetricCard label="Spot" value={activeDisplayedChain ? fmtCurrency(activeDisplayedChain.underlying.price) : "—"} />
            <MetricCard label="Selected expiry" value={activeDisplayedChain?.selectedExpiry ?? "—"} />
            <MetricCard label="Expiries loaded" value={activeDisplayedChain ? fmtNumber(activeDisplayedChain.expiries.length) : "—"} />
          </div>

          {activeDisplayedChain?.quoteNotice ? (
            <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-muted">
              {activeDisplayedChain.quoteNotice}
            </div>
          ) : null}
        </div>
      </ToolWorkspaceFrame>
    );
  }

  function renderOptionsWorkspace() {
    return (
      <ToolWorkspaceFrame
        description="Inspect options chains with market data, execution route, and overlays kept explicit instead of leaking in from the dashboard."
        headerSlot={
          <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-muted">
            <InlinePill
              label={optionsDataSourcePill.label}
              tone={optionsDataSourcePill.tone}
            />
            <InlinePill
              label={routedAccount ? `Execution route · ${routedAccount}` : `Execution route · ${activeExecutionRoute.label.toLowerCase()}`}
              tone={routedAccount ? "safe" : activeExecutionRoute.tone}
            />
            <InlinePill label="Overlay account · off" tone="neutral" />
          </div>
        }
        title="Options"
      >
        {renderIbkrOptionsSurface()}
      </ToolWorkspaceFrame>
    );
  }

  function renderCryptoWorkspace() {
    return (
      <ToolWorkspaceFrame
        description="Track the crypto market without jumping directly into one account's holdings. Account-owned balances stay on the dashboard."
        title="Crypto"
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

                    <ShellSourceRow
                      active={activeWorkspace === "options"}
                      icon={<OptionsIcon />}
                      onSelect={() => setActiveWorkspace("options")}
                      title="Options"
                      tone="live"
                    />

                    <ShellSourceRow
                      active={activeWorkspace === "research"}
                      icon={<DocumentIcon />}
                      onSelect={() => setActiveWorkspace("research")}
                      title="Research"
                      tone="live"
                    />

                    <ShellSourceRow
                      active={activeWorkspace === "crypto"}
                      icon={<CoinbaseIcon />}
                      onSelect={() => setActiveWorkspace("crypto")}
                      title="Crypto"
                      tone="live"
                    />
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
            <div className="mx-auto w-full max-w-[1600px]">
              {activeWorkspace === "dashboard" ? renderDashboardWorkspace() : null}
              {activeWorkspace === "market" ? renderMarketWorkspace() : null}
              {activeWorkspace === "ticker" ? renderTickerWorkspace() : null}
              {activeWorkspace === "options" ? renderOptionsWorkspace() : null}
              {activeWorkspace === "crypto" ? renderCryptoWorkspace() : null}
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
  children,
}: {
  title: string;
  description: string;
  headerSlot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="chrome-header-frame">
      <div className="account-workspace panel overflow-hidden rounded-[16px]">
        <header className="border-b border-line/70 px-10 py-7 lg:px-12">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-tight text-text">{title}</h1>
              </div>
              <p className="mt-2 max-w-3xl text-sm text-muted">{description}</p>
              {headerSlot}
            </div>
          </div>
        </header>

        <section className="px-10 py-8 lg:px-12">{children}</section>
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
