import { useState, type ReactNode } from "react";

import { AccountDashboardView } from "../../components/AccountDashboardView";
import { AccountConnectorSection } from "../../components/AccountConnectorSection";
import { CoinbaseAccountSource } from "../../components/account-sources/CoinbaseAccountSource";
import { FilesystemAccountSourceContent } from "../../components/account-sources/FilesystemAccountSourceContent";
import { FilesystemAccountSourceList } from "../../components/account-sources/FilesystemAccountSourceList";
import { AccountSourceSummaryCards } from "../../components/account-sources/AccountSourceSummaryCards";
import { MetricCard } from "../../components/MetricCard";
import { Panel } from "../../components/Panel";
import { ErrorState } from "../../components/ui/ErrorState";
import { InlinePill, type InlinePillTone } from "../../components/ui/InlinePill";
import {
  DEFAULT_DASHBOARD_ACCOUNT_KEY,
  dashboardAccountHasAttachedSource,
  dashboardAccountOwnsRoute,
  getDashboardAccountByKey,
  getDashboardAccountWithAttachedSource,
  type DashboardAccountKey,
} from "../../config/dashboardAccounts";
import { CONNECTOR_CATALOG, getConnectorCatalogEntry, type ConnectorCatalogEntry, type ConnectorCatalogId } from "../../config/connectorCatalog";
import { fmtCurrency, fmtCurrencySmall, fmtGreek, fmtNumber, fmtWholeNumber } from "../../lib/formatters";
import type { ConnectionStatus, FilesystemConnectorStatus, OptionPosition, Position } from "../../lib/types";
import { useAccountData } from "../account/useAccountData";
import { useConnectorSources, type ConnectorDraftState } from "../sources/useConnectorSources";

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

type AccountSourceSummaryMetricKey = "totalPnl" | "todayPnl" | "monthlyPnl" | "netWorth" | "netContributions";
type AccountSourceSummaryPnlBasisKey = "totalPnlPctBasis" | "todayPnlPctBasis" | "monthlyPnlPctBasis";

type AccountSourceSummary = AccountConnectorCard & {
  totalPnl: number | null;
  todayPnl: number | null;
  monthlyPnl: number | null;
  totalPnlPct: number | null;
  todayPnlPct: number | null;
  monthlyPnlPct: number | null;
  totalPnlPctBasis: number | null;
  todayPnlPctBasis: number | null;
  monthlyPnlPctBasis: number | null;
  netWorth: number | null;
  netContributions: number | null;
};

const CSV_FOLDER_CONNECTOR_ID: ConnectorCatalogId = "csvFolder";

export function DashboardWorkspace() {
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [ibkrConnectorCollapsed, setIbkrConnectorCollapsed] = useState(false);
  const [coinbaseConnectorCollapsed, setCoinbaseConnectorCollapsed] = useState(false);
  const [filesystemConnectorCollapsedBySourceId, setFilesystemConnectorCollapsedBySourceId] = useState<Record<string, boolean>>({});
  const [editingFilesystemSourceId, setEditingFilesystemSourceId] = useState<string | null>(null);
  const [selectedDashboardAccountKey, setSelectedDashboardAccountKey] = useState<DashboardAccountKey>(DEFAULT_DASHBOARD_ACCOUNT_KEY);

  const {
    connectMutation,
    connectionQuery,
    executionEnabled,
    openOrders,
    optionPositions,
    positions,
    reconnectMutation,
    risk,
  } = useAccountData();
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
    setConnectorDraftsById,
    setConnectorPickerOpen,
    setConnectorSetupError,
  } = useConnectorSources({
    accountSettingsOpen,
    globalSettingsActive: false,
    selectedDashboardAccountKey,
  });

  const activeExecutionRoute = executionRoutePresentation(connectionQuery.data);
  const routedAccount = activeExecutionRoute.accountId;
  const routedAccountPill = { label: activeExecutionRoute.label, tone: activeExecutionRoute.tone };
  const connectError = connectMutation.error instanceof Error ? connectMutation.error.message : null;
  const reconnectError = reconnectMutation.error instanceof Error ? reconnectMutation.error.message : null;
  const connectionQueryError = connectionQuery.error instanceof Error ? connectionQuery.error.message : null;
  const connectionEndpoint = connectionQuery.data ? `${connectionQuery.data.host}:${connectionQuery.data.port}` : "127.0.0.1:4002";
  const sourceError = connectError ?? reconnectError ?? connectionQueryError ?? connectionQuery.data?.lastError ?? null;
  const coinbaseAssignedAccount = getDashboardAccountWithAttachedSource("coinbase");
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
          ? "Connected - stale snapshot"
          : "Connected"
        : coinbaseStatusQuery.data?.authMode === "missing"
          ? "Needs setup"
          : "Degraded";
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
  const selectedDashboardAccount = getDashboardAccountByKey(selectedDashboardAccountKey);
  const selectedDashboardOwnsRoute = dashboardAccountOwnsRoute(selectedDashboardAccount.key, routedAccount);
  const dashboardOptionPositions = selectedDashboardOwnsRoute ? optionPositions : [];
  const dashboardOpenOrders = selectedDashboardOwnsRoute ? openOrders : [];

  function buildIbkrConnectorCard(accountKey: DashboardAccountKey): AccountConnectorCard {
    const ownsRoute = dashboardAccountOwnsRoute(accountKey, routedAccount);
    return {
      id: `ibkr-${accountKey}`,
      title: "IBKR route",
      status: connectionQuery.isLoading
        ? "Checking"
        : ownsRoute
          ? risk?.isStale
            ? "Connected - stale snapshot"
            : "Connected"
          : connectionQuery.data?.connected
            ? "Connected to another route"
            : "Disconnected",
      detail: connectionQuery.isLoading
        ? "Loading broker route state"
        : ownsRoute
          ? `${connectionEndpoint} - ${executionEnabled ? "execution enabled" : "execution disabled"}`
          : sourceError ?? (routedAccount ? `Current Gateway route is ${routedAccount}` : `${connectionEndpoint} - waiting for gateway`),
      tone: connectionQuery.isLoading
        ? "caution"
        : ownsRoute
          ? risk?.isStale
            ? "caution"
            : "safe"
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
    const totalPnl = ownsRoute ? sumPositionPnl(positions) + sumOptionPositionPnl(optionPositions) : null;
    return {
      ...connector,
      totalPnl,
      todayPnl: null,
      monthlyPnl: null,
      totalPnlPct: null,
      todayPnlPct: null,
      monthlyPnlPct: null,
      totalPnlPctBasis: null,
      todayPnlPctBasis: null,
      monthlyPnlPctBasis: null,
      netWorth: ownsRoute ? risk?.account.netLiquidation ?? null : null,
      netContributions: null,
    };
  }

  function buildCoinbaseAccountSourceSummary(accountKey: DashboardAccountKey): AccountSourceSummary {
    const portfolio = coinbasePortfolioQuery.data;
    const netWorth = portfolio?.totalUsdValue ?? null;
    const netContributions = portfolio?.netContributions ?? null;
    const totalPnl = portfolio?.totalPnl ?? deriveDashboardTotalPnl(netWorth, netContributions);
    const todayPnl = portfolio?.todayPnl ?? null;
    const monthlyPnl = portfolio?.monthlyPnl ?? null;
    const todayPnlPctBasis = portfolio?.todayPnlPctBasis ?? null;
    const monthlyPnlPctBasis = portfolio?.monthlyPnlPctBasis ?? null;
    return {
      id: `coinbase-${accountKey}`,
      title: "Coinbase account",
      status: coinbaseConnectorStatus,
      detail: coinbaseConnectorDetail,
      tone: coinbaseConnectorTone,
      countsTowardHealth: true,
      icon: <CoinbaseIcon />,
      totalPnl,
      todayPnl,
      monthlyPnl,
      totalPnlPct: derivePnlPct(totalPnl, netContributions),
      todayPnlPct: derivePnlPct(todayPnl, todayPnlPctBasis),
      monthlyPnlPct: derivePnlPct(monthlyPnl, monthlyPnlPctBasis),
      totalPnlPctBasis: netContributions,
      todayPnlPctBasis,
      monthlyPnlPctBasis,
      netWorth,
      netContributions,
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
        ? `${status.directoryPath} - ${fmtWholeNumber(
            status.connectorId === CSV_FOLDER_CONNECTOR_ID ? status.csvFilesCount : documentFolder?.pdfFilesCount ?? 0,
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
    const netWorth = status.connectorId === CSV_FOLDER_CONNECTOR_ID ? portfolio?.totalValue ?? null : null;
    const netContributions = status.connectorId === CSV_FOLDER_CONNECTOR_ID ? portfolio?.netContributions ?? null : null;
    const derivedTotalPnl = deriveDashboardTotalPnl(netWorth, netContributions);
    const totalPnl =
      portfolio?.totalPnl ??
      derivedTotalPnl ??
      (status.connectorId === CSV_FOLDER_CONNECTOR_ID
        ? portfolio?.holdings.reduce((total, holding) => total + (holding.gainLoss ?? 0), 0) ?? null
        : null);
    const todayPnl = status.connectorId === CSV_FOLDER_CONNECTOR_ID ? portfolio?.todayPnl ?? null : null;
    const monthlyPnl = status.connectorId === CSV_FOLDER_CONNECTOR_ID ? portfolio?.monthlyPnl ?? null : null;
    const todayPnlPctBasis = status.connectorId === CSV_FOLDER_CONNECTOR_ID ? portfolio?.todayPnlPctBasis ?? null : null;
    const monthlyPnlPctBasis = status.connectorId === CSV_FOLDER_CONNECTOR_ID ? portfolio?.monthlyPnlPctBasis ?? null : null;
    return {
      ...connector,
      totalPnl,
      todayPnl,
      monthlyPnl,
      totalPnlPct: derivePnlPct(totalPnl, netContributions),
      todayPnlPct: derivePnlPct(todayPnl, todayPnlPctBasis),
      monthlyPnlPct: derivePnlPct(monthlyPnl, monthlyPnlPctBasis),
      totalPnlPctBasis: netContributions,
      todayPnlPctBasis,
      monthlyPnlPctBasis,
      netWorth,
      netContributions,
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
    accountStatusTone === "safe" ? "All connectors live" : accountStatusTone === "caution" ? "Partial connector coverage" : "No live connectors";
  const dashboardReportedTotalPnl = sumAccountSourceMetric(accountSourceSummaries, "totalPnl");
  const dashboardTodayPnl = sumAccountSourceMetric(accountSourceSummaries, "todayPnl");
  const dashboardMonthlyPnl = sumAccountSourceMetric(accountSourceSummaries, "monthlyPnl");
  const dashboardNetWorth = sumAccountSourceMetric(accountSourceSummaries, "netWorth");
  const dashboardSourceDerivedTotalPnl = deriveDashboardTotalPnlFromSourceContributions(accountSourceSummaries);
  const dashboardSourceContributionBasis = deriveDashboardContributionBasisFromSources(accountSourceSummaries);
  const dashboardDerivedTotalPnl = deriveDashboardTotalPnl(dashboardNetWorth, selectedDashboardAccount.netContributionsUsd);
  const dashboardTotalPnl = dashboardSourceDerivedTotalPnl ?? dashboardDerivedTotalPnl ?? dashboardReportedTotalPnl;
  const dashboardTotalPnlPct =
    (dashboardSourceDerivedTotalPnl != null ? derivePnlPct(dashboardSourceDerivedTotalPnl, dashboardSourceContributionBasis) : null) ??
    (dashboardDerivedTotalPnl != null ? derivePnlPct(dashboardDerivedTotalPnl, selectedDashboardAccount.netContributionsUsd) : null) ??
    deriveAggregatePnlPct(accountSourceSummaries, "totalPnl", "totalPnlPctBasis");
  const dashboardTodayPnlPct = deriveAggregatePnlPct(accountSourceSummaries, "todayPnl", "todayPnlPctBasis");
  const dashboardMonthlyPnlPct = deriveAggregatePnlPct(accountSourceSummaries, "monthlyPnl", "monthlyPnlPctBasis");
  const dashboardTotalPnlHint = describeDashboardTotalPnl(
    accountSourceSummaries,
    dashboardSourceDerivedTotalPnl,
    dashboardDerivedTotalPnl,
    dashboardReportedTotalPnl,
    dashboardNetWorth,
  );
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
    selectedDashboardOwnsRoute && routedAccount ? `${routedAccount} - ${routedAccountPill.label}` : "No active broker route for this account";

  function emptyConnectorDraft(): ConnectorDraftState {
    return { displayName: "", directoryPath: "", positionsDirectoryPath: "", historyCsvPath: "", detectFooter: true };
  }

  function getConnectorDraft(draftKey: string): ConnectorDraftState {
    return connectorDraftsById[draftKey] ?? emptyConnectorDraft();
  }

  function updateConnectorDraft(draftKey: string, patch: Partial<ConnectorDraftState>) {
    setConnectorDraftsById((current) => ({
      ...current,
      [draftKey]: {
        displayName: patch.displayName ?? current[draftKey]?.displayName ?? "",
        directoryPath: patch.directoryPath ?? current[draftKey]?.directoryPath ?? "",
        positionsDirectoryPath: patch.positionsDirectoryPath ?? current[draftKey]?.positionsDirectoryPath ?? "",
        historyCsvPath: patch.historyCsvPath ?? current[draftKey]?.historyCsvPath ?? "",
        detectFooter: patch.detectFooter ?? current[draftKey]?.detectFooter ?? true,
      },
    }));
  }

  function connectorDraftFromStatus(status: FilesystemConnectorStatus, detectedHistoryCsvPath?: string | null): ConnectorDraftState {
    return {
      displayName: status.displayName?.trim() ?? "",
      directoryPath: status.directoryPath?.trim() ?? "",
      positionsDirectoryPath: status.positionsDirectoryPath?.trim() ?? status.directoryPath?.trim() ?? "",
      historyCsvPath: status.historyCsvPath?.trim() ?? detectedHistoryCsvPath?.trim() ?? "",
      detectFooter: status.detectFooter,
    };
  }

  function renderCoinbasePanelContent() {
    const coinbaseNetWorth = coinbasePortfolioQuery.data?.totalUsdValue ?? null;
    const coinbaseTotalPnl = coinbaseAccountSourceSummary?.totalPnl ?? null;
    const coinbaseTodayPnl = coinbaseAccountSourceSummary?.todayPnl ?? null;
    const coinbaseMonthlyPnl = coinbaseAccountSourceSummary?.monthlyPnl ?? null;
    const coinbaseTotalPnlPct = coinbaseAccountSourceSummary?.totalPnlPct ?? null;
    const coinbaseTodayPnlPct = coinbaseAccountSourceSummary?.todayPnlPct ?? null;
    const coinbaseMonthlyPnlPct = coinbaseAccountSourceSummary?.monthlyPnlPct ?? null;
    return coinbaseStatusQuery.isLoading ? (
      <div className="grid gap-4">
        <AccountSourceSummaryCards monthlyPnl={null} netWorth={null} todayPnl={null} totalPnl={null} />
        <div className="text-sm text-muted">Checking Coinbase connector...</div>
      </div>
    ) : !coinbaseStatusQuery.data?.available ? (
      <div className="grid gap-4">
        <AccountSourceSummaryCards monthlyPnl={null} netWorth={null} todayPnl={null} totalPnl={null} />
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-4">
          <MetricCard label="Connector" value={coinbaseStatusQuery.data?.authMode === "missing" ? "Not configured" : "Unavailable"} />
          <MetricCard label="Auth mode" value={coinbaseStatusQuery.data?.authMode ? coinbaseStatusQuery.data.authMode.toUpperCase() : "-"} />
          <MetricCard label="API base" value={coinbaseStatusQuery.data?.apiBaseUrl ?? "https://api.coinbase.com"} />
        </div>
        <ErrorState message={coinbaseStatusError ?? coinbaseStatusQuery.data?.detail ?? "Coinbase connector is unavailable."} />
      </div>
    ) : coinbasePortfolioQuery.isLoading ? (
      <div className="grid gap-4">
        <AccountSourceSummaryCards monthlyPnl={null} netWorth={null} todayPnl={null} totalPnl={null} />
        <div className="text-sm text-muted">Loading Coinbase balances...</div>
      </div>
    ) : coinbasePortfolioQuery.error instanceof Error ? (
      <div className="grid gap-4">
        <AccountSourceSummaryCards monthlyPnl={null} netWorth={null} todayPnl={null} totalPnl={null} />
        <ErrorState message={coinbasePortfolioQuery.error.message} />
      </div>
    ) : coinbasePortfolioQuery.data ? (
      <div className="grid gap-4">
        <AccountSourceSummaryCards
          monthlyPnl={coinbaseMonthlyPnl}
          monthlyPnlPct={coinbaseMonthlyPnlPct}
          netWorth={coinbaseNetWorth}
          todayPnl={coinbaseTodayPnl}
          todayPnlPct={coinbaseTodayPnlPct}
          totalPnl={coinbaseTotalPnl}
          totalPnlPct={coinbaseTotalPnlPct}
        />
        {coinbasePortfolioQuery.data.sourceNotice ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              coinbasePortfolioQuery.data.isStale ? "border-caution/25 bg-caution/8 text-caution" : "border-line/80 bg-panelSoft text-muted"
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
                      {holding.ready === false ? " - Pending" : ""}
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
      <div className="grid gap-4">
        <AccountSourceSummaryCards monthlyPnl={null} netWorth={null} todayPnl={null} totalPnl={null} />
        <ErrorState message="Coinbase balances are unavailable." />
      </div>
    );
  }

  function startEditingFilesystemConnector(sourceId: string) {
    const status = filesystemConnectorStatusBySourceId[sourceId];
    const portfolio = filesystemConnectorPortfolioBySourceId[sourceId];
    if (!status) {
      setConnectorSetupError("This connector source could not be found.");
      return;
    }
    setEditingFilesystemSourceId(sourceId);
    setConnectorPickerOpen(false);
    setConnectorSetupError(null);
    setConnectorDraftsById((current) => ({
      ...current,
      [sourceId]: connectorDraftFromStatus(status, portfolio?.historyCsvPath),
    }));
  }

  function stopEditingFilesystemConnector() {
    setEditingFilesystemSourceId(null);
    setConnectorSetupError(null);
  }

  async function saveFilesystemConnector(connectorId: ConnectorCatalogId, draftKey: string, sourceId?: string) {
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
    const draft = getConnectorDraft(draftKey);
    const displayName = draft.displayName.trim();
    if (!displayName) {
      setConnectorSetupError("Add a connector name before saving this connector.");
      return;
    }
    const isCsvConnector = connectorId === CSV_FOLDER_CONNECTOR_ID;
    const directoryPath = isCsvConnector ? null : draft.directoryPath.trim();
    const positionsDirectoryPath = isCsvConnector ? draft.positionsDirectoryPath.trim() : null;
    const historyCsvPath = isCsvConnector ? draft.historyCsvPath.trim() || null : null;
    if (isCsvConnector && !positionsDirectoryPath) {
      setConnectorSetupError("Add a positions folder path before saving this connector.");
      return;
    }
    if (!isCsvConnector && !directoryPath) {
      setConnectorSetupError("Add a folder path before saving this connector.");
      return;
    }
    try {
      await filesystemConnectorConfigureMutation.mutateAsync({
        accountKey: selectedDashboardAccount.key,
        connectorId,
        displayName,
        directoryPath,
        positionsDirectoryPath,
        historyCsvPath,
        detectFooter: isCsvConnector ? draft.detectFooter : false,
        sourceId,
      });
      if (sourceId) {
        setEditingFilesystemSourceId(null);
      } else {
        setConnectorPickerOpen(false);
      }
      setConnectorSetupError(null);
    } catch (error) {
      setConnectorSetupError(error instanceof Error ? error.message : "Could not save the connector.");
    }
  }

  async function chooseConnectorFolder(draftKey: string, connectorTitle: string, field: "directoryPath" | "positionsDirectoryPath") {
    setConnectorSetupError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const draft = getConnectorDraft(draftKey);
      const selected = await open({
        directory: true,
        multiple: false,
        title: `Choose ${connectorTitle} Folder`,
        defaultPath: draft[field].trim() || undefined,
      });
      if (typeof selected === "string" && selected.trim()) {
        updateConnectorDraft(draftKey, field === "directoryPath" ? { directoryPath: selected } : { positionsDirectoryPath: selected });
      }
    } catch (error) {
      setConnectorSetupError(error instanceof Error ? error.message : "Could not open the system folder picker.");
    }
  }

  async function chooseConnectorHistoryFile(draftKey: string, connectorTitle: string) {
    setConnectorSetupError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const draft = getConnectorDraft(draftKey);
      const selected = await open({
        directory: false,
        multiple: false,
        title: `Choose ${connectorTitle} History CSV`,
        defaultPath: draft.historyCsvPath.trim() || undefined,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (typeof selected === "string" && selected.trim()) {
        updateConnectorDraft(draftKey, { historyCsvPath: selected });
      }
    } catch (error) {
      setConnectorSetupError(error instanceof Error ? error.message : "Could not open the system file picker.");
    }
  }

  function renderFilesystemConnectorForm({
    connector,
    draftKey,
    mode,
    onSubmit,
    onCancel,
  }: {
    connector: ConnectorCatalogEntry;
    draftKey: string;
    mode: "add" | "edit";
    onSubmit: () => void;
    onCancel?: () => void;
  }) {
    const connectorDraft = getConnectorDraft(draftKey);
    const isCsvConnector = connector.id === CSV_FOLDER_CONNECTOR_ID;
    const submitDisabled =
      filesystemConnectorConfigureMutation.isPending ||
      !connectorDraft.displayName.trim() ||
      (isCsvConnector ? !connectorDraft.positionsDirectoryPath.trim() : !connectorDraft.directoryPath.trim());

    return (
      <div className="rounded-2xl border border-line/80 bg-panel px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-panelSoft text-text">
              <BankIcon />
            </span>
            <div>
              <div className="text-sm font-medium text-text">{connector.title}</div>
              <div className="mt-1 text-xs uppercase tracking-[0.16em] text-muted">
                {mode === "edit" ? "Editing configured source" : connector.provider}
              </div>
            </div>
          </div>
          {onCancel ? (
            <button
              className="rounded-full border border-line/80 bg-panel px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition hover:border-accent/35 hover:text-text"
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
          ) : null}
        </div>
        <div className="mt-3 text-sm text-muted">{connector.description}</div>
        <div className="mt-4 grid gap-3">
          <label className="grid gap-2">
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted">Source name</span>
            <input
              className="w-full rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-text outline-none transition focus:border-accent/60"
              onChange={(event) => updateConnectorDraft(draftKey, { displayName: event.target.value })}
              placeholder={connector.defaultDisplayNamePlaceholder}
              spellCheck={false}
              type="text"
              value={connectorDraft.displayName}
            />
          </label>
          {isCsvConnector ? (
            <>
              <label className="grid gap-2">
                <span className="text-[11px] uppercase tracking-[0.16em] text-muted">Positions folder path</span>
                <div className="flex gap-2">
                  <input
                    className="w-full rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-text outline-none transition focus:border-accent/60"
                    onChange={(event) => updateConnectorDraft(draftKey, { positionsDirectoryPath: event.target.value })}
                    placeholder={connector.directoryPathPlaceholder}
                    spellCheck={false}
                    type="text"
                    value={connectorDraft.positionsDirectoryPath}
                  />
                  <button
                    className="shrink-0 rounded-xl border border-line/80 bg-panelSoft px-3 py-3 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition hover:border-accent/35 hover:text-text"
                    onClick={() => {
                      void chooseConnectorFolder(draftKey, connector.title, "positionsDirectoryPath");
                    }}
                    type="button"
                  >
                    Choose Folder
                  </button>
                </div>
              </label>
              <label className="grid gap-2">
                <span className="text-[11px] uppercase tracking-[0.16em] text-muted">Account History CSV (used for PnL)</span>
                <div className="flex gap-2">
                  <input
                    className="w-full rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-text outline-none transition focus:border-accent/60"
                    onChange={(event) => updateConnectorDraft(draftKey, { historyCsvPath: event.target.value })}
                    placeholder="~/Documents/investing/account-history.csv"
                    spellCheck={false}
                    type="text"
                    value={connectorDraft.historyCsvPath}
                  />
                  <button
                    className="shrink-0 rounded-xl border border-line/80 bg-panelSoft px-3 py-3 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition hover:border-accent/35 hover:text-text"
                    onClick={() => {
                      void chooseConnectorHistoryFile(draftKey, connector.title);
                    }}
                    type="button"
                  >
                    Choose File
                  </button>
                </div>
              </label>
              <label className="flex items-center gap-3 rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-text">
                <input
                  checked={connectorDraft.detectFooter}
                  className="h-4 w-4 accent-accent"
                  onChange={(event) => updateConnectorDraft(draftKey, { detectFooter: event.target.checked })}
                  type="checkbox"
                />
                <span>Detect and ignore footer</span>
              </label>
            </>
          ) : (
            <label className="grid gap-2">
              <span className="text-[11px] uppercase tracking-[0.16em] text-muted">PDF folder path</span>
              <div className="flex gap-2">
                <input
                  className="w-full rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-text outline-none transition focus:border-accent/60"
                  onChange={(event) => updateConnectorDraft(draftKey, { directoryPath: event.target.value })}
                  placeholder={connector.directoryPathPlaceholder}
                  spellCheck={false}
                  type="text"
                  value={connectorDraft.directoryPath}
                />
                <button
                  className="shrink-0 rounded-xl border border-line/80 bg-panelSoft px-3 py-3 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition hover:border-accent/35 hover:text-text"
                  onClick={() => {
                    void chooseConnectorFolder(draftKey, connector.title, "directoryPath");
                  }}
                  type="button"
                >
                  Choose Folder
                </button>
              </div>
            </label>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted">
              {isCsvConnector
                ? "Use a positions folder for holdings snapshots and optionally attach a full account-history CSV for contribution-aware PnL."
                : "This source surfaces recent PDFs and connectivity for the selected account."}
            </div>
            <button
              className="rounded-full border border-line/80 bg-panel px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition hover:border-accent/35 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
              disabled={submitDisabled}
              onClick={onSubmit}
              type="button"
            >
              {filesystemConnectorConfigureMutation.isPending ? "Saving..." : mode === "edit" ? "Update" : "Add"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderFilesystemConnectorPanelContent(sourceId: string) {
    const status = filesystemConnectorStatusBySourceId[sourceId];
    const summary = filesystemAccountSourceSummaries.find((item) => item.id === sourceId) ?? null;
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
        monthlyPnl={summary?.monthlyPnl ?? null}
        monthlyPnlPct={summary?.monthlyPnlPct ?? null}
        netWorth={summary?.netWorth ?? null}
        status={status}
        statusesError={filesystemConnectorStatusesError}
        statusesLoading={filesystemConnectorStatusesQuery.isLoading}
        todayPnl={summary?.todayPnl ?? null}
        todayPnlPct={summary?.todayPnlPct ?? null}
        totalPnl={summary?.totalPnl ?? null}
        totalPnlPct={summary?.totalPnlPct ?? null}
      />
    );
  }

  const dashboardSummaryContent = (
    <>
      <AccountSourceSummaryCards
        monthlyPnl={dashboardMonthlyPnl}
        monthlyPnlPct={dashboardMonthlyPnlPct}
        monthlyPnlHint={dashboardMonthlyPnlHint}
        netWorth={dashboardNetWorth}
        netWorthHint={dashboardNetWorthHint}
        todayPnl={dashboardTodayPnl}
        todayPnlPct={dashboardTodayPnlPct}
        todayPnlHint={dashboardTodayPnlHint}
        totalPnl={dashboardTotalPnl}
        totalPnlPct={dashboardTotalPnlPct}
        totalPnlHint={dashboardTotalPnlHint}
      />

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
            setEditingFilesystemSourceId(null);
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
              actionLabel={filesystemConnectorStatusBySourceId[connector.id] ? "Edit" : undefined}
              onOpen={
                filesystemConnectorStatusBySourceId[connector.id]
                  ? () => {
                      startEditingFilesystemConnector(connector.id);
                    }
                  : undefined
              }
              status={connector.status}
              title={connector.title}
              tone={connector.tone}
            />
          ))}
        </div>

        {editingFilesystemSourceId ? (
          (() => {
            const editingStatus = filesystemConnectorStatusBySourceId[editingFilesystemSourceId];
            const editingConnector = editingStatus ? getConnectorCatalogEntry(editingStatus.connectorId as ConnectorCatalogId) : null;
            if (!editingStatus || !editingConnector) {
              return null;
            }
            return (
              <div className="rounded-2xl border border-line/80 bg-panelSoft px-5 py-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-text">Edit Connector</div>
                    <div className="mt-1 text-sm text-muted">Update the configured inputs for {editingStatus.displayName ?? editingConnector.title}.</div>
                  </div>
                </div>
                {connectorSetupError ? (
                  <div className="mt-4 rounded-2xl border border-danger/20 bg-danger/8 px-4 py-3 text-sm text-danger">{connectorSetupError}</div>
                ) : null}
                <div className="mt-4">
                  {renderFilesystemConnectorForm({
                    connector: editingConnector,
                    draftKey: editingFilesystemSourceId,
                    mode: "edit",
                    onSubmit: () => {
                      void saveFilesystemConnector(
                        editingStatus.connectorId as ConnectorCatalogId,
                        editingFilesystemSourceId,
                        editingFilesystemSourceId,
                      );
                    },
                    onCancel: stopEditingFilesystemConnector,
                  })}
                </div>
              </div>
            );
          })()
        ) : null}

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
              {availableConnectorOptions.map((connector) =>
                connector.availability === "ready" ? (
                  <div key={connector.id}>
                    {renderFilesystemConnectorForm({
                      connector,
                      draftKey: connector.id,
                      mode: "add",
                      onSubmit: () => {
                        void saveFilesystemConnector(connector.id, connector.id);
                      },
                    })}
                  </div>
                ) : (
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
                    <div className="mt-4 flex justify-end">
                      <button
                        className="rounded-full border border-line/80 bg-panel px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition disabled:cursor-not-allowed disabled:opacity-50"
                        disabled
                        type="button"
                      >
                        Coming soon
                      </button>
                    </div>
                  </div>
                ),
              )}
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
        <div className="grid gap-6">
          <AccountSourceSummaryCards
            monthlyPnl={ibkrAccountSourceSummary?.monthlyPnl ?? null}
            monthlyPnlPct={ibkrAccountSourceSummary?.monthlyPnlPct ?? null}
            netWorth={ibkrAccountSourceSummary?.netWorth ?? null}
            todayPnl={ibkrAccountSourceSummary?.todayPnl ?? null}
            todayPnlPct={ibkrAccountSourceSummary?.todayPnlPct ?? null}
            totalPnl={ibkrAccountSourceSummary?.totalPnl ?? null}
            totalPnlPct={ibkrAccountSourceSummary?.totalPnlPct ?? null}
          />

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
                            {" - "}
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
                  {selectedDashboardOwnsRoute
                    ? "No working orders in the routed IBKR account."
                    : "Route this account through Gateway to view IBKR working orders here."}
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
                            {position.symbol} {position.expiry} {fmtNumber(position.strike)}
                            {position.right}
                          </div>
                          <div className="mt-1 text-sm text-muted">
                            {position.shortOrLong} {fmtWholeNumber(Math.abs(position.quantity))} - delta {fmtGreek(position.delta)}
                          </div>
                        </div>
                        <div className={`text-sm font-medium ${pnlTone(position.unrealizedPnL)}`}>{fmtCurrency(position.unrealizedPnL)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
                  {selectedDashboardOwnsRoute
                    ? "No open option positions in the routed IBKR account."
                    : "Route this account through Gateway to view IBKR option positions here."}
                </div>
              )}
            </div>
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
      }}
      onToggleSettings={() => setAccountSettingsOpen((value) => !value)}
      selectedAccountKey={selectedDashboardAccount.key}
      settingsContent={dashboardSettingsContent}
      summaryContent={dashboardSummaryContent}
    />
  );
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
    return "Connected - stale snapshot";
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

function deriveDashboardTotalPnl(netWorth: number | null, netContributionsUsd: number | null) {
  if (netWorth == null || Number.isNaN(netWorth) || netContributionsUsd == null || Number.isNaN(netContributionsUsd)) {
    return null;
  }
  return netWorth - netContributionsUsd;
}

function derivePnlPct(pnl: number | null | undefined, basis: number | null | undefined) {
  if (pnl == null || Number.isNaN(pnl) || basis == null || Number.isNaN(basis) || basis <= 0) {
    return null;
  }
  return (pnl / basis) * 100;
}

function deriveDashboardTotalPnlFromSourceContributions(summaries: AccountSourceSummary[]) {
  const netWorthContributors = summaries.filter((summary) => summary.netWorth != null && !Number.isNaN(summary.netWorth));
  if (!netWorthContributors.length) {
    return null;
  }
  const contributionContributors = netWorthContributors.filter(
    (summary) => summary.netContributions != null && !Number.isNaN(summary.netContributions),
  );
  if (contributionContributors.length !== netWorthContributors.length) {
    return null;
  }
  const totalNetWorth = netWorthContributors.reduce((total, summary) => total + (summary.netWorth ?? 0), 0);
  const totalNetContributions = contributionContributors.reduce((total, summary) => total + (summary.netContributions ?? 0), 0);
  return totalNetWorth - totalNetContributions;
}

function deriveDashboardContributionBasisFromSources(summaries: AccountSourceSummary[]) {
  const netWorthContributors = summaries.filter((summary) => summary.netWorth != null && !Number.isNaN(summary.netWorth));
  if (!netWorthContributors.length) {
    return null;
  }
  const contributionContributors = netWorthContributors.filter(
    (summary) => summary.netContributions != null && !Number.isNaN(summary.netContributions),
  );
  if (contributionContributors.length !== netWorthContributors.length) {
    return null;
  }
  return contributionContributors.reduce((total, summary) => total + (summary.netContributions ?? 0), 0);
}

function deriveAggregatePnlPct(
  summaries: AccountSourceSummary[],
  valueKey: "totalPnl" | "todayPnl" | "monthlyPnl",
  basisKey: AccountSourceSummaryPnlBasisKey,
) {
  const contributingSources = summaries.filter((summary) => summary[valueKey] != null && !Number.isNaN(summary[valueKey]));
  if (!contributingSources.length) {
    return null;
  }
  if (contributingSources.some((summary) => summary[basisKey] == null || Number.isNaN(summary[basisKey]))) {
    return null;
  }
  const totalPnl = contributingSources.reduce((total, summary) => total + (summary[valueKey] ?? 0), 0);
  const totalBasis = contributingSources.reduce((total, summary) => total + (summary[basisKey] ?? 0), 0);
  return derivePnlPct(totalPnl, totalBasis);
}

function describeDashboardTotalPnl(
  summaries: AccountSourceSummary[],
  sourceDerivedTotalPnl: number | null,
  derivedTotalPnl: number | null,
  reportedTotalPnl: number | null,
  netWorth: number | null,
) {
  if (sourceDerivedTotalPnl != null) {
    const netWorthCoverage = describeAccountSourceMetricCoverage(summaries, "netWorth").replace(/\.$/, "");
    return `${netWorthCoverage}. Derived from source net worth minus source net contributions.`;
  }
  if (derivedTotalPnl != null) {
    const netWorthCoverage = describeAccountSourceMetricCoverage(summaries, "netWorth").replace(/\.$/, "");
    return `${netWorthCoverage}. Derived as net worth minus configured net contributions.`;
  }
  const netWorthContributors = summaries.filter((summary) => summary.netWorth != null && !Number.isNaN(summary.netWorth));
  const contributionContributors = netWorthContributors.filter(
    (summary) => summary.netContributions != null && !Number.isNaN(summary.netContributions),
  );
  if (netWorthContributors.length && contributionContributors.length && contributionContributors.length < netWorthContributors.length) {
    return `${contributionContributors.length}/${netWorthContributors.length} net-worth sources have contribution history. Add contribution coverage for the remaining sources to derive fund-level PnL automatically.`;
  }
  if (reportedTotalPnl != null) {
    return `${describeAccountSourceMetricCoverage(summaries, "totalPnl").replace(/\.$/, "")}. Holding-level gain/loss sum; not full fund PnL.`;
  }
  if (netWorth != null) {
    return "Add net contributions to derive fund-level PnL.";
  }
  return describeAccountSourceMetricCoverage(summaries, "totalPnl");
}

function isLocalBackendUnavailable(message: string | null | undefined) {
  return Boolean(message && message.includes("Could not reach local backend at"));
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

function ConnectorStatusCard({
  title,
  status,
  detail,
  tone,
  icon,
  actionLabel,
  onOpen,
}: {
  title: string;
  status: string;
  detail: string;
  tone: ConnectionHealthTone;
  icon: ReactNode;
  actionLabel?: string;
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
            {actionLabel ?? "Open"}
          </button>
        ) : null}
      </div>
      <div className="mt-3 text-sm text-muted">{detail}</div>
    </div>
  );
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

function connectionTonePanelClass(_tone: ConnectionHealthTone) {
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

function BrokerIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M4 14.5h12" opacity="0.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <path d="M5 12V8.5M10 12V5.5M15 12V7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
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

function PlusCircleIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 20 20" width="14">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6.5v7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      <path d="M6.5 10h7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}
