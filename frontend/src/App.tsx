import { useState, type ReactNode } from "react";
import {
  formatTimestamp,
  fmtCoverageCount,
  fmtCurrency,
  fmtCurrencySmall,
  fmtGreek,
  fmtNumber,
  fmtWholeNumber,
} from "./lib/formatters";
import type {
  ConnectionStatus,
  FilesystemConnectorStatus,
  OpenOrderExposure,
  OptionPosition,
  Position,
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
import { MetricCard } from "./components/MetricCard";
import { TickerWorkspace } from "./components/TickerWorkspace";
import { Panel } from "./components/Panel";
import { AppShell } from "./components/shell/AppShell";
import { ToolWorkspaceFrame } from "./components/shell/ToolWorkspaceFrame";
import { WorkspaceStage } from "./components/shell/WorkspaceStage";
import { WorkspaceRouter, type WorkspaceRoute } from "./components/shell/WorkspaceRouter";
import { useAccountData } from "./features/account/useAccountData";
import { CryptoLeverageWorkspace } from "./features/crypto/CryptoLeverageWorkspace";
import { CryptoMarketWorkspace } from "./features/crypto/CryptoMarketWorkspace";
import { OptionsWorkspace, type OptionsWorkspaceSurface } from "./features/options/OptionsWorkspace";
import { useConnectorSources, type ConnectorDraftState } from "./features/sources/useConnectorSources";
import { StockIntelWorkspace } from "./features/stock-intel/StockIntelWorkspace";
import { useStockIntelSourceStatus } from "./features/stock-intel/useStockIntelSourceStatus";
import { StockMarketWorkspace } from "./features/stocks/market/StockMarketWorkspace";

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
  | "stockIntel"
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

const CSV_FOLDER_CONNECTOR_ID: ConnectorCatalogId = "csvFolder";

function App() {
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [ibkrConnectorCollapsed, setIbkrConnectorCollapsed] = useState(false);
  const [coinbaseConnectorCollapsed, setCoinbaseConnectorCollapsed] = useState(false);
  const [filesystemConnectorCollapsedBySourceId, setFilesystemConnectorCollapsedBySourceId] = useState<Record<string, boolean>>({});
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceSurface>("dashboard");
  const [selectedDashboardAccountKey, setSelectedDashboardAccountKey] = useState<DashboardAccountKey>(DEFAULT_DASHBOARD_ACCOUNT_KEY);
  const [selectedStockSymbol, setSelectedStockSymbol] = useState("NVDA");

  const {
    connectMutation,
    connectionQuery,
    executionEnabled,
    openOrders,
    optionPositions,
    positions,
    reconnectMutation,
    risk,
    selectedAccount,
    setSelectedAccountId,
  } = useAccountData();
  const {
    edgarStatusError,
    edgarStatusQuery,
    edgarSyncing,
    investorPdfStatusError,
    investorPdfStatusQuery,
    investorPdfSyncing,
  } = useStockIntelSourceStatus();
  const {
    coinbasePortfolioError,
    coinbasePortfolioQuery,
    coinbaseStatusError,
    coinbaseStatusQuery,
    connectorDraftsById,
    connectorPickerOpen,
    connectorSetupError,
    filesystemConnectorConfigureMutation,
    filesystemConnectorPortfolioBySourceId,
    filesystemConnectorPortfolioErrorBySourceId,
    filesystemConnectorPortfolioLoadingBySourceId,
    filesystemConnectorStatusBySourceId,
    filesystemConnectorStatuses,
    filesystemConnectorStatusesError,
    filesystemConnectorStatusesQuery,
    filesystemDocumentFolderBySourceId,
    filesystemDocumentFolderErrorBySourceId,
    filesystemDocumentFolderLoadingBySourceId,
    finnhubApiKeyInput,
    finnhubConfigureError,
    finnhubConfigureMutation,
    finnhubStatusError,
    finnhubStatusQuery,
    okxStatusError,
    okxStatusQuery,
    setConnectorDraftsById,
    setConnectorPickerOpen,
    setConnectorSetupError,
    setFinnhubApiKeyInput,
  } = useConnectorSources({ accountSettingsOpen, selectedDashboardAccountKey });
  const activeExecutionRoute = executionRoutePresentation(connectionQuery.data);
  const routedAccount = activeExecutionRoute.accountId;
  const routedAccountPill = { label: activeExecutionRoute.label, tone: activeExecutionRoute.tone };

  const connectError = connectMutation.error instanceof Error ? connectMutation.error.message : null;
  const reconnectError = reconnectMutation.error instanceof Error ? reconnectMutation.error.message : null;
  const connectionQueryError = connectionQuery.error instanceof Error ? connectionQuery.error.message : null;
  const connectionEndpoint = connectionQuery.data ? `${connectionQuery.data.host}:${connectionQuery.data.port}` : "127.0.0.1:4002";
  const sourceError = connectError ?? reconnectError ?? connectionQueryError ?? connectionQuery.data?.lastError ?? null;
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
  const dataModeLabel = connectionQuery.data?.mode === "ibkr" ? "IBKR gateway session" : "Mock snapshot";
  const executionModeLabel = executionEnabled ? "Gateway-routed execution" : "Disabled";
  const refreshCadenceLabel = "Conn 10s · Risk 15s · Chain 20s";
  const heartbeatLabel = connectionQuery.data?.lastHeartbeatAt ? formatTimestamp(connectionQuery.data.lastHeartbeatAt) : "No heartbeat";
  const connectionEndpointLabel = connectionQuery.data?.connected ? `Connected on ${connectionEndpoint}` : connectionEndpoint;
  const selectedDashboardAccount = getDashboardAccountByKey(selectedDashboardAccountKey);
  const selectedDashboardOwnsRoute = dashboardAccountOwnsRoute(selectedDashboardAccount.key, routedAccount);
  const dashboardOptionPositions = selectedDashboardOwnsRoute ? optionPositions : [];
  const dashboardOpenOrders = selectedDashboardOwnsRoute ? openOrders : [];
  const globalSourceCards: AccountConnectorCard[] = [
    {
      id: "okx",
      title: "OKX Market Data",
      status: okxStatusQuery.isLoading ? "Checking" : okxStatusQuery.data?.available ? "Ready" : "Degraded",
      detail: okxStatusQuery.isLoading
        ? "Loading public crypto market data source state"
        : okxStatusError ?? okxStatusQuery.data?.detail ?? "Public crypto market data provider",
      tone: okxStatusQuery.isLoading ? "caution" : okxStatusQuery.data?.available ? "safe" : "danger",
      countsTowardHealth: true,
      icon: <MarketIcon />,
    },
    {
      id: "finnhub",
      title: "Finnhub",
      status: finnhubStatusQuery.isLoading
        ? "Checking"
        : finnhubConfigureMutation.isPending
          ? "Saving"
          : finnhubStatusQuery.data?.available
            ? "Connected"
            : "Needs setup",
      detail: finnhubStatusQuery.isLoading
        ? "Loading stock data connector state"
        : finnhubStatusError ?? finnhubStatusQuery.data?.detail ?? "Stock tool data provider",
      tone: finnhubStatusQuery.isLoading ? "caution" : finnhubStatusQuery.data?.available ? "safe" : "caution",
      countsTowardHealth: true,
      icon: <MarketIcon />,
    },
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

  function openSymbolWorkspace(nextSymbol: string, nextWorkspace: "ticker" | "options") {
    const normalizedSymbol = nextSymbol.trim().toUpperCase();
    if (!normalizedSymbol) {
      return;
    }
    setSelectedStockSymbol(normalizedSymbol);
    setActiveWorkspace(nextWorkspace);
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

  async function saveFinnhubConnector() {
    await finnhubConfigureMutation.mutateAsync({ apiKey: finnhubApiKeyInput.trim() || null });
  }

  async function clearFinnhubConnector() {
    await finnhubConfigureMutation.mutateAsync({ apiKey: null });
  }

  function renderFinnhubSettingsPanel() {
    return (
      <Panel eyebrow="Stock data connector" title="Finnhub">
        <div className="grid gap-6">
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard
              label="Connector"
              value={
                finnhubStatusQuery.isLoading
                  ? "Checking"
                  : finnhubStatusQuery.data?.available
                    ? "Configured"
                    : "Not configured"
              }
            />
            <MetricCard
              label="Active key"
              value={finnhubStatusQuery.data?.maskedApiKey ?? (finnhubStatusQuery.isLoading ? "Loading" : "None")}
            />
            <MetricCard label="API base" value={finnhubStatusQuery.data?.apiBaseUrl ?? "https://finnhub.io/api/v1"} />
          </div>
          {finnhubStatusError || finnhubConfigureError ? (
            <ErrorState message={finnhubConfigureError ?? finnhubStatusError ?? "Finnhub connector is unavailable."} />
          ) : null}
          <div className="grid gap-3 rounded-2xl border border-line/80 bg-panelSoft px-4 py-4">
            <label className="grid gap-2">
              <span className="text-[11px] uppercase tracking-[0.16em] text-muted">API key</span>
              <input
                className="w-full rounded-xl border border-line/80 bg-panel px-4 py-3 text-sm text-text outline-none transition focus:border-accent/60"
                onChange={(event) => setFinnhubApiKeyInput(event.target.value)}
                placeholder={finnhubStatusQuery.data?.available ? "Paste a replacement Finnhub API key" : "Enter a Finnhub API key"}
                spellCheck={false}
                type="password"
                value={finnhubApiKeyInput}
              />
            </label>
            <div className="text-sm text-muted">
              {finnhubStatusQuery.data?.available
                ? "Configured Finnhub credentials are used for basic stock quotes and fundamentals in the Stock tool."
                : "Add a Finnhub API key to supply basic stock data when the Stock tool cannot rely on the broker session."}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-muted">
                {finnhubStatusQuery.data?.lastSuccessfulSyncAt
                  ? `Last successful check ${formatTimestamp(finnhubStatusQuery.data.lastSuccessfulSyncAt)}`
                  : "No successful Finnhub check yet."}
              </div>
              <div className="flex flex-wrap gap-2">
                {finnhubStatusQuery.data?.configured ? (
                  <button
                    className="rounded-full border border-line/80 bg-panel px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition hover:border-danger/30 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={finnhubConfigureMutation.isPending}
                    onClick={() => {
                      void clearFinnhubConnector();
                    }}
                    type="button"
                  >
                    Disconnect
                  </button>
                ) : null}
                <button
                  className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-accent transition hover:border-accent/50 hover:bg-accent/16 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={finnhubConfigureMutation.isPending || !finnhubApiKeyInput.trim()}
                  onClick={() => {
                    void saveFinnhubConnector();
                  }}
                  type="button"
                >
                  {finnhubConfigureMutation.isPending ? "Saving…" : finnhubStatusQuery.data?.available ? "Update Key" : "Save Key"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Panel>
    );
  }

  function renderOkxSettingsPanel() {
    return (
      <Panel eyebrow="Crypto market provider" title="OKX Market Data">
        <div className="grid gap-6">
          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard
              label="Connector"
              value={okxStatusQuery.isLoading ? "Checking" : okxStatusQuery.data?.available ? "Enabled" : "Unavailable"}
            />
            <MetricCard label="Auth mode" value={okxStatusQuery.data?.authMode?.toUpperCase() ?? "PUBLIC"} />
            <MetricCard label="API base" value={okxStatusQuery.data?.apiBaseUrl ?? "https://www.okx.com"} />
            <MetricCard
              label="Last healthy check"
              value={okxStatusQuery.data?.lastSuccessfulSyncAt ? formatTimestamp(okxStatusQuery.data.lastSuccessfulSyncAt) : "Pending"}
            />
          </div>
          {okxStatusError ? <ErrorState message={okxStatusError} /> : null}
          <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
            OKX is configured as a global public crypto market-data provider. No API keys are required right now, and the
            crypto market workspace can use it without coupling market prices to an account connector.
          </div>
        </div>
      </Panel>
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
        topDivider={false}
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
        eyebrow="Settings"
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

          {renderOkxSettingsPanel()}

          {renderFinnhubSettingsPanel()}

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

  function renderTickerWorkspace() {
    return (
      <TickerWorkspace
        connectionStatus={connectionQuery.data}
        controlsDisabled={connectMutation.isPending || reconnectMutation.isPending}
        executionEnabled={executionEnabled}
        onSelectedAccountChange={setSelectedAccountId}
        onSymbolChange={setSelectedStockSymbol}
        positions={positions}
        selectedSymbol={selectedStockSymbol}
        selectedAccount={selectedAccount}
      />
    );
  }

  function renderStockIntelWorkspace() {
    return <StockIntelWorkspace defaultTicker={selectedStockSymbol} />;
  }

  function renderOptionsWorkspace() {
    return (
      <OptionsWorkspace
        connectionStatus={connectionQuery.data}
        controlsDisabled={connectMutation.isPending || reconnectMutation.isPending}
        executionEnabled={executionEnabled}
        initialSymbol={selectedStockSymbol}
        onOpenChain={() => setActiveWorkspace("options")}
        onSymbolChange={setSelectedStockSymbol}
        optionPositions={optionPositions}
        selectedAccount={selectedAccount}
        workspace={activeWorkspace as OptionsWorkspaceSurface}
      />
    );
  }

  const workspaceRoutes: Array<WorkspaceRoute<WorkspaceSurface>> = [
    { key: "dashboard", render: renderDashboardWorkspace },
    { key: "market", render: () => <StockMarketWorkspace gatewayPill={marketGatewayPill} onOpenSymbol={openSymbolWorkspace} /> },
    { key: "ticker", render: renderTickerWorkspace },
    { key: "options", render: renderOptionsWorkspace },
    { key: "optionsValuation", render: renderOptionsWorkspace },
    { key: "optionsBuilder", render: renderOptionsWorkspace },
    { key: "optionsStructures", render: renderOptionsWorkspace },
    { key: "optionsVolatility", render: renderOptionsWorkspace },
    { key: "optionsScanner", render: renderOptionsWorkspace },
    { key: "crypto", render: () => <CryptoMarketWorkspace /> },
    { key: "cryptoLeverage", render: () => <CryptoLeverageWorkspace /> },
    { key: "stockIntel", render: renderStockIntelWorkspace },
    { key: "globalSettings", render: renderGlobalSettingsWorkspace },
  ];

  const sidebarContent = (
    <div className="shell-source-list">
      <ShellSourceGroup title="Stocks">
        <ShellSourceRow
          active={activeWorkspace === "market"}
          icon={<MarketIcon />}
          onSelect={() => setActiveWorkspace("market")}
          testId="nav-stocks-market"
          title="Market"
          tone="live"
        />

        <ShellSourceRow
          active={activeWorkspace === "ticker"}
          icon={<BrokerIcon />}
          onSelect={() => setActiveWorkspace("ticker")}
          testId="nav-stocks-ticker"
          title="Ticker"
          tone="live"
        />

        <ShellSourceRow
          active={activeWorkspace === "stockIntel"}
          icon={<DocumentIcon />}
          onSelect={() => setActiveWorkspace("stockIntel")}
          testId="nav-stocks-intel"
          title="Stock Intel"
          tone="live"
        />

        <ShellSourceSubsection title="Options" />

        <ShellSourceRow
          active={activeWorkspace === "options"}
          icon={<OptionsIcon />}
          onSelect={() => setActiveWorkspace("options")}
          testId="nav-options-chain"
          title="Chain"
          tone="live"
        />

        <ShellSourceRow
          active={activeWorkspace === "optionsValuation"}
          icon={<ValuationIcon />}
          onSelect={() => setActiveWorkspace("optionsValuation")}
          testId="nav-options-valuation"
          title="Valuation"
          tone="live"
        />

        <ShellSourceRow
          active={activeWorkspace === "optionsBuilder"}
          icon={<BuilderIcon />}
          onSelect={() => setActiveWorkspace("optionsBuilder")}
          testId="nav-options-builder"
          title="Builder"
          tone="live"
        />

        <ShellSourceRow
          active={activeWorkspace === "optionsStructures"}
          icon={<StructuresIcon />}
          onSelect={() => setActiveWorkspace("optionsStructures")}
          testId="nav-options-structures"
          title="Structures"
          tone="live"
        />

        <ShellSourceRow
          active={activeWorkspace === "optionsVolatility"}
          icon={<VolatilityIcon />}
          onSelect={() => setActiveWorkspace("optionsVolatility")}
          testId="nav-options-volatility"
          title="Volatility"
          tone="live"
        />

        <ShellSourceRow
          active={activeWorkspace === "optionsScanner"}
          icon={<ScannerIcon />}
          onSelect={() => setActiveWorkspace("optionsScanner")}
          testId="nav-options-scanner"
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
  );

  const sidebarFooter = (
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
  );

  return (
    <AppShell
      activeIsHome={activeWorkspace === "dashboard"}
      footer={sidebarFooter}
      onHome={() => {
        setActiveWorkspace("dashboard");
        setAccountSettingsOpen(false);
      }}
      sidebar={sidebarContent}
    >
      <WorkspaceStage>
        <WorkspaceRouter activeWorkspace={activeWorkspace} routes={workspaceRoutes} />
      </WorkspaceStage>
    </AppShell>
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
    <section aria-label={title} className="shell-source-group" data-testid={`shell-group-${slugifyTestId(title)}`}>
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
  testId,
}: {
  title: string;
  icon?: ReactNode;
  tone: SourceTone;
  active?: boolean;
  children?: ReactNode;
  onSelect?: () => void;
  testId?: string;
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
      data-testid={testId}
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

function slugifyTestId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
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

function ErrorState({ message }: { message: string }) {
  return <div className="rounded-2xl border border-danger/20 bg-danger/8 px-4 py-3 text-sm text-danger">{message}</div>;
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
