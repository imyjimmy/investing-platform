import { useEffect, useState, useDeferredValue, startTransition, type ReactNode } from "react";
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
  ConnectionStatus,
  EdgarDownloadRequest,
  EdgarDownloadResponse,
  InvestorPdfDownloadRequest,
  InvestorPdfDownloadResponse,
  OpenOrderExposure,
  OptionOrderRequest,
  OptionPosition,
} from "./lib/types";
import { EdgarWorkspace } from "./components/EdgarWorkspace";
import { InvestorPdfsWorkspace } from "./components/InvestorPdfsWorkspace";
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

function uniqueAccounts(accounts: Array<string | null | undefined>) {
  return Array.from(new Set(accounts.map((accountId) => accountId?.trim().toUpperCase()).filter(Boolean) as string[]));
}

type TicketContractSide = "C" | "P";

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
type WorkspaceSurface = "home" | "ibkr" | "edgar" | "investorPdfs";
type ConnectionHealthTone = "safe" | "caution" | "danger" | "planned";

type AccountConnectorCard = {
  id: string;
  title: string;
  status: string;
  detail: string;
  tone: ConnectionHealthTone;
  countsTowardHealth: boolean;
  icon: ReactNode;
  workspace?: WorkspaceSurface;
};

function App() {
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceSurface>("home");
  const [chainSymbol, setChainSymbol] = useState("NVDA");
  const [chainSymbolInput, setChainSymbolInput] = useState("NVDA");
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(undefined);
  const [selectedExpiry, setSelectedExpiry] = useState<string | undefined>(undefined);
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

  const connectionQuery = useQuery({
    queryKey: ["connection-status"],
    queryFn: api.connectionStatus,
    refetchInterval: 10_000,
  });

  const riskSummaryQuery = useQuery({
    queryKey: ["risk-summary", selectedAccountId],
    queryFn: () => api.riskSummary(selectedAccountId),
    refetchInterval: 15_000,
  });

  const optionPositionsQuery = useQuery({
    queryKey: ["option-positions", selectedAccountId],
    queryFn: () => api.optionPositions(selectedAccountId),
    refetchInterval: 15_000,
  });

  const openOrdersQuery = useQuery({
    queryKey: ["open-orders", selectedAccountId],
    queryFn: () => api.openOrders(selectedAccountId),
    refetchInterval: 15_000,
  });

  const chainQuery = useQuery({
    queryKey: ["chain", chainSymbol, selectedExpiry],
    queryFn: () => api.chain(chainSymbol, selectedExpiry),
    refetchInterval: 20_000,
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
    setChainSymbolInput(chainSymbol);
  }, [chainSymbol]);

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
  const optionPositions = optionPositionsQuery.data?.positions ?? [];
  const openOrders = openOrdersQuery.data?.orders ?? [];
  const accountId = risk?.account.accountId ?? connectionQuery.data?.accountId ?? null;
  const watchlist = Array.from(
    new Set([chainSymbol, "NVDA", ...(risk?.watchlist ?? []), ...optionPositions.map((position) => position.symbol)]),
  ).sort();
  const chainHasBidAsk = (chainQuery.data?.rows ?? []).some(
    (row) => row.callBid != null || row.callAsk != null || row.putBid != null || row.putAsk != null,
  );
  const chainHasOptionMarks = (chainQuery.data?.rows ?? []).some((row) => row.callMid != null || row.putMid != null);
  const paperExecutionEnabled = connectionQuery.data?.executionMode === "paper";
  const selectedAccount = selectedAccountId ?? accountId ?? undefined;
  const selectedAccountIsPaper = isPaperTradingAccountId(selectedAccount);
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
  const canPreviewTicket = paperExecutionEnabled && selectedAccountIsPaper && Boolean(ticketRequest);
  const canSubmitTicket = canPreviewTicket && previewIsCurrent;
  const executionBannerMessage = !paperExecutionEnabled
    ? "Paper execution is disabled for this dashboard session."
    : !selectedAccount
      ? "Connect IBKR to discover the routed account for paper execution."
      : !selectedAccountIsPaper
        ? "Paper execution is blocked on live accounts."
        : null;

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

  function loadTicket(row: {
    strike: number;
    callBid: number | null;
    callAsk: number | null;
    callMid: number | null;
    putBid: number | null;
    putAsk: number | null;
    putMid: number | null;
  }, right: TicketContractSide) {
    const referencePrice =
      right === "C" ? row.callMid ?? row.callAsk ?? row.callBid ?? null : row.putMid ?? row.putAsk ?? row.putBid ?? null;
    setTicketDraft({
      symbol: chainSymbol,
      expiry: selectedExpiry ?? chainQuery.data?.selectedExpiry ?? "",
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
    setPreviewRequestKey(null);
  }

  const connectError = connectMutation.error instanceof Error ? connectMutation.error.message : null;
  const reconnectError = reconnectMutation.error instanceof Error ? reconnectMutation.error.message : null;
  const connectionEndpoint = connectionQuery.data ? `${connectionQuery.data.host}:${connectionQuery.data.port}` : "127.0.0.1:4002";
  const sourceError = connectError ?? reconnectError ?? connectionQuery.data?.lastError ?? null;
  const sourceTone: SourceTone = connectionQuery.data?.connected ? "live" : "off";
  const sourceBadge = connectionQuery.data?.connected ? (connectionQuery.data?.mode === "mock" ? "Mock" : "Live") : "Off";
  const sourceMeta = connectionQuery.data?.connected
    ? `${connectionEndpoint} · ${connectionQuery.data.marketDataMode}`
    : `${connectionEndpoint} · waiting for gateway`;
  const edgarStatusError = edgarStatusQuery.error instanceof Error ? edgarStatusQuery.error.message : null;
  const edgarSourceTone: SourceTone = edgarStatusQuery.data?.available ? "live" : edgarStatusError ? "off" : "off";
  const edgarBadge = edgarSyncing ? "Syncing" : edgarStatusQuery.data?.available ? "Ready" : "Off";
  const edgarMeta = "SEC API";
  const investorPdfStatusError = investorPdfStatusQuery.error instanceof Error ? investorPdfStatusQuery.error.message : null;
  const investorPdfSourceTone: SourceTone = investorPdfStatusQuery.data?.available ? "live" : investorPdfStatusError ? "off" : "off";
  const investorPdfBadge = investorPdfSyncing ? "Syncing" : investorPdfStatusQuery.data?.available ? "Ready" : "Off";
  const investorPdfMeta = "Annual reports + SEC PDF exhibits";
  const dataModeLabel = connectionQuery.data?.mode === "ibkr" ? "IBKR live session" : "Mock snapshot";
  const executionModeLabel = paperExecutionEnabled ? "Paper execution" : "Disabled";
  const refreshCadenceLabel = "Conn 10s · Risk 15s · Chain 20s";
  const heartbeatLabel = connectionQuery.data?.lastHeartbeatAt ? formatTimestamp(connectionQuery.data.lastHeartbeatAt) : "No heartbeat";
  const accountConnectors: AccountConnectorCard[] = [
    {
      id: "ibkr",
      title: "IBKR",
      status: connectionQuery.isLoading
        ? "Checking"
        : connectionQuery.data?.connected
          ? risk?.isStale
            ? "Connected · stale snapshot"
            : "Connected"
          : "Disconnected",
      detail: connectionQuery.isLoading
        ? "Loading broker connector status"
        : connectionQuery.data?.connected
          ? `${connectionEndpoint} · ${paperExecutionEnabled ? "paper routing enabled" : "read-only session"}`
          : sourceError ?? `${connectionEndpoint} · waiting for gateway`,
      tone: connectionQuery.isLoading ? "caution" : connectionQuery.data?.connected ? (risk?.isStale ? "caution" : "safe") : "danger",
      countsTowardHealth: true,
      icon: <BrokerIcon />,
      workspace: "ibkr",
    },
    {
      id: "edgar",
      title: "EDGAR",
      status: edgarStatusQuery.isLoading ? "Checking" : edgarSyncing ? "Syncing" : edgarStatusQuery.data?.available ? "Ready" : "Offline",
      detail: edgarStatusQuery.isLoading ? "Loading EDGAR source state" : edgarStatusError ?? "SEC filing research source",
      tone: edgarStatusQuery.isLoading ? "caution" : edgarStatusQuery.data?.available ? "safe" : "danger",
      countsTowardHealth: true,
      icon: <DocumentIcon />,
      workspace: "edgar",
    },
    {
      id: "investor-pdfs",
      title: "Investor PDFs",
      status: investorPdfStatusQuery.isLoading ? "Checking" : investorPdfSyncing ? "Syncing" : investorPdfStatusQuery.data?.available ? "Ready" : "Offline",
      detail: investorPdfStatusQuery.isLoading ? "Loading investor PDF source state" : investorPdfStatusError ?? "Annual reports and exhibit PDF library",
      tone: investorPdfStatusQuery.isLoading ? "caution" : investorPdfStatusQuery.data?.available ? "safe" : "danger",
      countsTowardHealth: true,
      icon: <PdfLibraryIcon />,
      workspace: "investorPdfs",
    },
    {
      id: "coinbase",
      title: "Coinbase",
      status: "Planned",
      detail: "Future crypto exchange balances and activity feed",
      tone: "planned",
      countsTowardHealth: false,
      icon: <CoinbaseIcon />,
    },
    {
      id: "plaid-fidelity",
      title: "Plaid · Fidelity",
      status: "Planned",
      detail: "Future linked brokerage cash and holdings sync",
      tone: "planned",
      countsTowardHealth: false,
      icon: <BankIcon />,
    },
    {
      id: "plaid-chase",
      title: "Plaid · Chase",
      status: "Planned",
      detail: "Future banking cash movement and treasury feed",
      tone: "planned",
      countsTowardHealth: false,
      icon: <BankIcon />,
    },
  ];
  const definedConnectors = accountConnectors.filter((connector) => connector.countsTowardHealth);
  const definedConnectorCount = definedConnectors.length;
  const liveConnectorCount = definedConnectors.filter((connector) => connector.tone === "safe").length;
  const connectedConnectorCount = definedConnectors.filter((connector) => connector.tone === "safe" || connector.tone === "caution").length;
  const plannedConnectorCount = accountConnectors.length - definedConnectorCount;
  const accountStatusTone: ConnectionHealthTone =
    connectedConnectorCount === 0 ? "danger" : liveConnectorCount === definedConnectorCount ? "safe" : "caution";
  const accountStatusLabel =
    accountStatusTone === "safe"
      ? "All connectors live"
      : accountStatusTone === "caution"
        ? "Partial connector coverage"
        : "No live connectors";
  const accountTabBadge =
    accountStatusTone === "safe"
      ? "All live"
      : accountStatusTone === "caution"
        ? `${connectedConnectorCount}/${definedConnectorCount} online`
        : "Offline";

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

  return (
    <div className={`app-shell grid-shell min-h-screen text-text ${sidebarOpen ? "is-sidebar-open" : ""}`}>
      <div className="mx-auto w-full max-w-[1880px]">
        <div className="shell-topbar">
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
            aria-pressed={activeWorkspace === "home"}
            className={`shell-toggle shell-home-button ${activeWorkspace === "home" ? "is-active" : ""}`}
            onClick={() => setActiveWorkspace("home")}
            type="button"
          >
            <HomeIcon />
          </button>
          <div className="shell-topbar-spacer" />
        </div>

        <div className="shell-frame">
          <div className="shell-sidebar-wrap">
            <aside aria-label="App shell" className="shell-sidebar">
              <div className="shell-sidebar-body">
                <div className="shell-sidebar-scroll">
                  <div className="shell-source-list">
                    <ShellSourceRow
                      active={activeWorkspace === "ibkr"}
                      badge={sourceBadge}
                      icon={<BrokerIcon />}
                      meta={sourceMeta}
                      onSelect={() => setActiveWorkspace("ibkr")}
                      title="Interactive Brokers"
                      tone={sourceTone}
                    >
                      <div className="shell-source-actions">
                        <button
                          className="shell-inline-action"
                          disabled={connectMutation.isPending}
                          onClick={() => connectMutation.mutate()}
                          type="button"
                        >
                          {connectMutation.isPending ? "Connecting..." : "Connect"}
                        </button>
                        <button
                          className="shell-inline-action"
                          disabled={reconnectMutation.isPending}
                          onClick={() => reconnectMutation.mutate()}
                          type="button"
                        >
                          {reconnectMutation.isPending ? "Refreshing..." : "Reconnect"}
                        </button>
                      </div>
                      {sourceError ? <div className="shell-source-note is-danger">{sourceError}</div> : null}
                    </ShellSourceRow>

                    <ShellSourceRow
                      active={activeWorkspace === "edgar"}
                      badge={edgarBadge}
                      icon={<DocumentIcon />}
                      meta={edgarMeta}
                      onSelect={() => setActiveWorkspace("edgar")}
                      title="EDGAR"
                      tone={edgarSourceTone}
                    />

                    <ShellSourceRow
                      active={activeWorkspace === "investorPdfs"}
                      badge={investorPdfBadge}
                      icon={<PdfLibraryIcon />}
                      meta={investorPdfMeta}
                      onSelect={() => setActiveWorkspace("investorPdfs")}
                      title="Investor PDFs"
                      tone={investorPdfSourceTone}
                    />

                    <ShellSourceRow
                      badge="Planned"
                      icon={<CoinbaseIcon />}
                      meta="Future crypto exchange balances connector"
                      title="Coinbase"
                      tone="planned"
                    />

                    <ShellSourceRow
                      badge="Planned"
                      icon={<BankIcon />}
                      meta="Future Fidelity-linked cash and holdings sync"
                      title="Plaid · Fidelity"
                      tone="planned"
                    />

                    <ShellSourceRow
                      badge="Planned"
                      icon={<BankIcon />}
                      meta="Future Chase treasury and cash flow sync"
                      title="Plaid · Chase"
                      tone="planned"
                    />
                  </div>
                </div>

                <div className="shell-sidebar-footer">
                  <div className={`shell-settings-panel ${settingsOpen ? "is-open" : ""}`}>
                    <ShellSettingRow label="Data mode" value={dataModeLabel} />
                    <ShellSettingRow label="Execution" value={executionModeLabel} />
                    <ShellSettingRow label="Endpoint" value={connectionEndpoint} />
                    <ShellSettingRow label="Refresh" value={refreshCadenceLabel} />
                    <ShellSettingRow label="Last heartbeat" value={heartbeatLabel} />
                    <ShellSettingRow
                      label="Research root"
                      value={edgarStatusQuery.data ? shortenPath(edgarStatusQuery.data.researchRootPath) : "Loading"}
                    />
                  </div>

                  <button
                    className={`shell-settings-row ${settingsOpen ? "is-active" : ""}`}
                    onClick={() => setSettingsOpen((value) => !value)}
                    type="button"
                  >
                    <span className="shell-row-icon">
                      <GearIcon />
                    </span>
                    <span className="shell-settings-label">Settings</span>
                  </button>
                </div>
              </div>
            </aside>
          </div>

          <div className="shell-stage">
            <div className="mx-auto w-full max-w-[1600px]">
              {activeWorkspace === "ibkr" ? (
                <IbkrWorkspace
                  connectPending={connectMutation.isPending}
                  endpoint={connectionEndpoint}
                  onConnect={() => connectMutation.mutate()}
                  onReconnect={() => reconnectMutation.mutate()}
                  reconnectPending={reconnectMutation.isPending}
                  selectedAccount={selectedAccount}
                  sourceError={sourceError}
                  status={connectionQuery.data}
                />
              ) : activeWorkspace === "edgar" ? (
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
              ) : activeWorkspace === "investorPdfs" ? (
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
              ) : null}
              <div className={activeWorkspace === "home" ? "" : "hidden"}>
                <div className="chrome-header-frame">
                  <div className="chrome-tabs-shell">
                    <div className="chrome-tab-strip">
                      <button aria-current="page" className="chrome-tab is-active" type="button">
                        <span className={`chrome-tab-dot ${connectionToneDotClass(accountStatusTone)}`} />
                        <span className="chrome-tab-title truncate text-sm font-medium">Van Aken</span>
                        <span className="chrome-tab-badge">{accountTabBadge}</span>
                      </button>
                    </div>
                  </div>
                  <div className="account-workspace panel rounded-[16px]">
                    <header className="chrome-header-body relative px-10 py-5 lg:px-12">
                      <button
                        aria-expanded={accountSettingsOpen}
                        aria-label={accountSettingsOpen ? "Hide account settings" : "Open account settings"}
                        className={`absolute right-10 top-3 inline-flex h-8 w-8 items-center justify-center transition ${
                          accountSettingsOpen
                            ? "rounded-md bg-accent/10 text-accent"
                            : "rounded-md text-muted hover:text-text"
                        }`}
                        onClick={() => setAccountSettingsOpen((value) => !value)}
                        type="button"
                      >
                        <GearIcon />
                      </button>
                      {accountSettingsOpen ? (
                        <div className="absolute right-10 top-12 z-20 w-[min(30rem,calc(100%-5rem))] overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_18px_48px_rgba(0,0,0,0.32)] backdrop-blur-xl">
                          <div className="flex items-center justify-between border-b border-line/70 px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.2em] text-muted">Connections</div>
                            <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{plannedConnectorCount} planned</div>
                          </div>
                          <div className="grid max-h-[70vh] gap-3 overflow-auto p-4 sm:grid-cols-2">
                            {accountConnectors.map((connector) => (
                              <ConnectorStatusCard
                                key={connector.id}
                                detail={connector.detail}
                                icon={connector.icon}
                                onOpen={connector.workspace ? () => setActiveWorkspace(connector.workspace!) : undefined}
                                status={connector.status}
                                title={connector.title}
                                tone={connector.tone}
                              />
                            ))}
                          </div>
                        </div>
                      ) : null}
                      <div className="flex flex-col gap-5 pr-12 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="mb-2 text-[11px] uppercase tracking-[0.32em] text-accent">Van Aken Investments LLC</div>
                          <div className="flex flex-wrap items-center gap-3">
                            <h1 className="text-3xl font-semibold tracking-tight text-text">Account Snapshot</h1>
                            <AccountStatusBadge label={accountStatusLabel} tone={accountStatusTone} />
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <MetricCard
                          hint={selectedAccount ? `${selectedAccount}${selectedAccountIsPaper ? " · Paper route" : " · Live route"}` : undefined}
                          label="Total net worth"
                          value={riskSummaryQuery.isLoading ? "Loading" : fmtCurrency(risk?.account.netLiquidation)}
                        />
                        <MetricCard
                          label="Available funds"
                          value={riskSummaryQuery.isLoading ? "Loading" : fmtCurrency(risk?.account.availableFunds)}
                        />
                        <MetricCard
                          label="Excess liquidity"
                          value={riskSummaryQuery.isLoading ? "Loading" : fmtCurrency(risk?.account.excessLiquidity)}
                        />
                        <MetricCard
                          hint={risk?.isStale ? "Snapshot is stale" : undefined}
                          label="Margin usage"
                          tone={
                            risk?.account.marginUsagePct == null
                              ? "neutral"
                              : risk.account.marginUsagePct > 60
                                ? "danger"
                                : risk.account.marginUsagePct > 40
                                  ? "caution"
                                  : "safe"
                          }
                          value={riskSummaryQuery.isLoading ? "Loading" : fmtNumber(risk?.account.marginUsagePct, "%")}
                        />
                      </div>
                      {connectionQuery.data?.lastError || connectError || reconnectError ? (
                        <div className="mt-4 rounded-2xl border border-danger/20 bg-danger/8 px-4 py-3 text-sm text-danger">
                          {connectError ?? reconnectError ?? connectionQuery.data?.lastError}
                        </div>
                      ) : null}
                    </header>
                    <div className="account-workspace-body flex flex-col gap-6 px-10 pb-6 lg:px-12">
        <Panel
          action={<div className="text-[11px] uppercase tracking-[0.18em] text-muted">Current capital source: IBKR</div>}
          title="Account Snapshot"
          eyebrow="Account Home"
        >
          {riskSummaryQuery.isLoading ? (
            <div className="text-sm text-muted">Loading overview...</div>
          ) : risk ? (
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="IBKR option positions" value={fmtNumber(risk.account.optionPositionsCount)} />
                <MetricCard label="IBKR open orders" value={fmtNumber(risk.account.openOrdersCount)} />
                <MetricCard
                  label="IBKR premium this week"
                  value={fmtCurrency(risk.premium.estimatedPremiumExpiringThisWeek)}
                  tone={risk.premium.estimatedPremiumExpiringThisWeek > 0 ? "safe" : "neutral"}
                />
                <MetricCard
                  label="IBKR option capacity"
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
          <Panel title="IBKR Options Book" eyebrow="Broker Feed">
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

          <Panel title="IBKR Orders & Commitments" eyebrow="Broker Feed">
            {openOrdersQuery.isLoading ? (
              <div className="text-sm text-muted">Loading open orders...</div>
            ) : openOrdersQuery.error instanceof Error ? (
              <ErrorState message={openOrdersQuery.error.message} />
            ) : openOrdersQuery.data ? (
              <div className="grid gap-4">
                {cancelError ? <ErrorState message={cancelError} /> : null}
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
                        <div className="flex items-start gap-3">
                          {paperExecutionEnabled && selectedAccountIsPaper ? (
                            <button
                              className="rounded-full border border-danger/30 bg-danger/8 px-3 py-1.5 text-xs font-medium text-danger transition hover:border-danger/50"
                              disabled={cancelMutation.isPending || !selectedAccount}
                              onClick={() => {
                                if (!selectedAccount) {
                                  return;
                                }
                                cancelMutation.mutate({ orderId: order.orderId, accountId: selectedAccount });
                              }}
                              type="button"
                            >
                              {cancelMutation.isPending ? "Cancelling..." : "Cancel"}
                            </button>
                          ) : null}
                          <div className="text-right">
                            <div className="text-sm font-medium text-text">{fmtCurrency(order.estimatedCapitalImpact)}</div>
                            <div className="text-xs text-muted">{orderRiskLabel(order)}</div>
                          </div>
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
          title="IBKR Chain Explorer"
          eyebrow={`Broker feed · ${chainSymbol}`}
          action={
            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              <form
                className="flex w-full flex-wrap justify-end gap-2 sm:w-auto"
                onSubmit={(event) => {
                  event.preventDefault();
                  handleChainSymbolSelection(chainSymbolInput);
                }}
              >
                <input
                  aria-label="Load symbol"
                  className="min-w-[120px] rounded-full border border-line bg-panelSoft px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] text-text outline-none transition focus:border-accent/40"
                  onChange={(event) => setChainSymbolInput(event.target.value.toUpperCase())}
                  placeholder="IREN"
                  type="text"
                  value={chainSymbolInput}
                />
                <button
                  className="rounded-full border border-accent/35 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!chainSymbolInput.trim() || chainSymbolInput.trim().toUpperCase() === chainSymbol}
                  type="submit"
                >
                  Load symbol
                </button>
              </form>
              <div className="flex flex-wrap justify-end gap-2">
                {watchlist.map((symbol) => (
                  <button
                    key={symbol}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      chainSymbol === symbol
                        ? "border-accent/50 bg-accent/10 text-accent"
                        : "border-line bg-panelSoft text-muted hover:border-accent/30 hover:text-text"
                    }`}
                    onClick={() => handleChainSymbolSelection(symbol)}
                    type="button"
                  >
                    {symbol}
                  </button>
                ))}
              </div>
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
                  <div className="panel-soft rounded-2xl p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Execution</div>
                        <div className="mt-2 text-lg font-semibold text-text">Paper trade ticket</div>
                      </div>
                      <span className="rounded-full border border-danger/45 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-danger">
                        Paper only
                      </span>
                    </div>
                    <div className="mt-3 space-y-3">
                      {executionBannerMessage ? (
                        <div className="rounded-2xl border border-danger/25 bg-danger/8 px-4 py-3 text-sm text-danger">
                          {executionBannerMessage}
                        </div>
                      ) : ticketDraft ? (
                        <>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-2xl border border-line/80 px-3 py-3">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Account</div>
                              <div className="mt-2 text-sm font-medium text-text">{selectedAccount}</div>
                            </div>
                            <div className="rounded-2xl border border-line/80 px-3 py-3">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Contract</div>
                              <div className="mt-2 text-sm font-medium text-text">
                                {ticketDraft.symbol} {ticketDraft.expiry} {ticketDraft.right}{fmtCurrencySmall(ticketDraft.strike)}
                              </div>
                            </div>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div className="rounded-2xl border border-line/80 px-3 py-3">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Reference</div>
                              <div className="mt-2 text-sm font-medium text-text">{fmtCurrencySmall(ticketDraft.referencePrice)}</div>
                            </div>
                            <div className="rounded-2xl border border-line/80 px-3 py-3">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Bid / ask</div>
                              <div className="mt-2 text-sm font-medium text-text">
                                {fmtCurrencySmall(ticketDraft.bid)} / {fmtCurrencySmall(ticketDraft.ask)}
                              </div>
                            </div>
                            <div className="rounded-2xl border border-line/80 px-3 py-3">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Intent</div>
                              <div className="mt-2 text-sm font-medium text-text">{ticketDraft.right === "P" ? "Short put / put buyback" : "Call sale / call buyback"}</div>
                            </div>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Action</div>
                              <div className="flex gap-2">
                                <ToggleChip checked={ticketAction === "SELL"} label="Sell" onToggle={() => setTicketAction("SELL")} />
                                <ToggleChip checked={ticketAction === "BUY"} label="Buy" onToggle={() => setTicketAction("BUY")} />
                              </div>
                            </div>
                            <label className="space-y-2">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Contracts</div>
                              <input
                                className="w-full rounded-2xl border border-line bg-panel px-3 py-2 text-sm text-text outline-none transition focus:border-accent/40"
                                min={1}
                                step={1}
                                type="number"
                                value={ticketQuantity}
                                onChange={(event) => setTicketQuantity(Math.max(1, Number(event.target.value) || 1))}
                              />
                            </label>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <label className="space-y-2">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Order type</div>
                              <select
                                className="w-full rounded-2xl border border-line bg-panel px-3 py-2 text-sm text-text outline-none transition focus:border-accent/40"
                                value={ticketOrderType}
                                onChange={(event) => setTicketOrderType(event.target.value as "LMT" | "MKT")}
                              >
                                <option value="LMT">Limit</option>
                                <option value="MKT">Market</option>
                              </select>
                            </label>
                            <label className="space-y-2">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Time in force</div>
                              <select
                                className="w-full rounded-2xl border border-line bg-panel px-3 py-2 text-sm text-text outline-none transition focus:border-accent/40"
                                value={ticketTif}
                                onChange={(event) => setTicketTif(event.target.value as "DAY" | "GTC")}
                              >
                                <option value="DAY">DAY</option>
                                <option value="GTC">GTC</option>
                              </select>
                            </label>
                            <label className="space-y-2">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Limit price</div>
                              <input
                                className="w-full rounded-2xl border border-line bg-panel px-3 py-2 text-sm text-text outline-none transition focus:border-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={ticketOrderType === "MKT"}
                                inputMode="decimal"
                                placeholder={ticketDraft.referencePrice != null ? ticketDraft.referencePrice.toFixed(2) : "0.00"}
                                type="text"
                                value={ticketOrderType === "MKT" ? "Market" : ticketLimitPrice}
                                onChange={(event) => setTicketLimitPrice(event.target.value)}
                              />
                            </label>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              className="rounded-full border border-accent/35 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={!canPreviewTicket || previewMutation.isPending}
                              onClick={() => ticketRequest && previewMutation.mutate(ticketRequest)}
                              type="button"
                            >
                              {previewMutation.isPending ? "Previewing..." : "Preview paper order"}
                            </button>
                            <button
                              className="rounded-full border border-safe/35 bg-safe/10 px-4 py-2 text-sm font-medium text-safe transition hover:border-safe/50 disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={!canSubmitTicket || submitMutation.isPending}
                              onClick={() => ticketRequest && submitMutation.mutate(ticketRequest)}
                              type="button"
                            >
                              {submitMutation.isPending ? "Submitting..." : "Submit to paper account"}
                            </button>
                          </div>
                          {previewError ? <ErrorState message={previewError} /> : null}
                          {submitError ? <ErrorState message={submitError} /> : null}
                          {previewIsCurrent && previewMutation.data ? (
                            <div className="rounded-2xl border border-line/80 bg-panel px-4 py-3 text-sm">
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Margin change</div>
                                  <div className="mt-1 text-text">
                                    Init {fmtCurrencySmall(previewMutation.data.brokerInitialMarginChange)} • Maint {fmtCurrencySmall(previewMutation.data.brokerMaintenanceMarginChange)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Premium / commission</div>
                                  <div className="mt-1 text-text">
                                    {fmtCurrencySmall(previewMutation.data.estimatedGrossPremium)} • {fmtCurrencySmall(previewMutation.data.commissionEstimate)}
                                  </div>
                                </div>
                              </div>
                              <div className="mt-3 grid gap-2 text-sm text-muted">
                                <div>
                                  Opening/closing: <span className="text-text capitalize">{previewMutation.data.openingOrClosing}</span>
                                </div>
                                <div>
                                  Conservative cash use: <span className="text-text">{fmtCurrency(previewMutation.data.conservativeCashImpact)}</span>
                                </div>
                                {previewMutation.data.warningText ? (
                                  <div className="rounded-2xl border border-caution/25 bg-caution/8 px-3 py-2 text-caution">{previewMutation.data.warningText}</div>
                                ) : null}
                                {previewMutation.data.note ? <div>{previewMutation.data.note}</div> : null}
                              </div>
                            </div>
                          ) : null}
                          {submitIsCurrent && submitMutation.data ? (
                            <div className="rounded-2xl border border-safe/25 bg-safe/8 px-4 py-3 text-sm text-safe">
                              Order {submitMutation.data.orderId} accepted with status {submitMutation.data.status}.
                              {submitMutation.data.message ? ` ${submitMutation.data.message}` : ""}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="rounded-2xl border border-line/80 px-4 py-3 text-sm text-muted">
                          Select a call or put from the chain table below to load a paper order ticket.
                        </div>
                      )}
                    </div>
                  </div>
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
                      <th className="pb-3 pr-4">Put bid</th>
                      <th className="pb-3 pr-4">Call ticket</th>
                      <th className="pb-3">Put ticket</th>
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
                        <td className="py-3 pr-4">{fmtCurrencySmall(row.putBid)}</td>
                        <td className="py-3 pr-4">
                          <button
                            className="rounded-full border border-accent/35 bg-accent/10 px-3 py-1 text-xs font-medium text-accent transition hover:border-accent/50"
                            onClick={() => loadTicket(row, "C")}
                            type="button"
                          >
                            Load call
                          </button>
                        </td>
                        <td className="py-3">
                          <button
                            className="rounded-full border border-caution/35 bg-caution/10 px-3 py-1 text-xs font-medium text-caution transition hover:border-caution/50"
                            onClick={() => loadTicket(row, "P")}
                            type="button"
                          >
                            Load put
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </Panel>

        <div className="grid gap-6 xl:grid-cols-[1fr,1fr]">
          <Panel title="IBKR Risk View" eyebrow="Broker Analytics">
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

          <Panel title="IBKR Expiry Stack" eyebrow="Broker Analytics">
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

        <Panel title="IBKR Scenario View" eyebrow="Broker Analytics">
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
              </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function IbkrWorkspace({
  status,
  endpoint,
  sourceError,
  selectedAccount,
  connectPending,
  reconnectPending,
  onConnect,
  onReconnect,
}: {
  status: ConnectionStatus | undefined;
  endpoint: string;
  sourceError: string | null;
  selectedAccount: string | undefined;
  connectPending: boolean;
  reconnectPending: boolean;
  onConnect: () => void;
  onReconnect: () => void;
}) {
  const managedAccounts = uniqueAccounts([...(status?.managedAccounts ?? []), status?.accountId]);
  const connectionLabel = status?.connected ? "Connected" : "Disconnected";
  const sessionModeLabel = status?.mode === "ibkr" ? "IBKR live session" : "Mock snapshot";
  const executionLabel = status?.executionMode === "paper" ? "Paper execution" : "Disabled";
  const lastConnectedLabel = status?.lastSuccessfulConnectAt ? formatTimestamp(status.lastSuccessfulConnectAt) : "Never";
  const lastHeartbeatLabel = status?.lastHeartbeatAt ? formatTimestamp(status.lastHeartbeatAt) : "No heartbeat";
  const nextReconnectLabel = status?.nextReconnectAttemptAt ? formatTimestamp(status.nextReconnectAttemptAt) : "None scheduled";

  return (
    <div className="chrome-header-frame">
      <div className="account-workspace panel overflow-hidden rounded-[16px]">
        <header className="border-b border-line/70 px-10 py-7 lg:px-12">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="mb-2 text-[11px] uppercase tracking-[0.32em] text-accent">Broker connector</div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-tight text-text">Interactive Brokers</h1>
                <StatusBadge status={status} />
              </div>
              <p className="mt-2 max-w-3xl text-sm text-muted">
                Use this connector workspace to manage the IB Gateway or TWS session. The Home button returns to the Van Aken account dashboard.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                className="rounded-full border border-accent/35 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:border-accent/50 hover:text-white disabled:cursor-default disabled:opacity-45"
                disabled={connectPending}
                onClick={onConnect}
                type="button"
              >
                {connectPending ? "Connecting..." : "Connect"}
              </button>
              <button
                className="rounded-full border border-line bg-panelSoft px-4 py-2 text-sm font-medium text-text transition hover:border-accent/35 disabled:cursor-default disabled:opacity-45"
                disabled={reconnectPending}
                onClick={onReconnect}
                type="button"
              >
                {reconnectPending ? "Refreshing..." : "Reconnect"}
              </button>
            </div>
          </div>
        </header>

        <section className="px-10 py-8 lg:px-12">
          <div className="grid gap-6">
            {sourceError ? <ErrorState message={sourceError} /> : null}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                hint={endpoint}
                label="Connection"
                tone={status?.connected ? "safe" : "danger"}
                value={connectionLabel}
              />
              <MetricCard label="Session mode" value={sessionModeLabel} />
              <MetricCard
                hint={selectedAccount ? `Current home route: ${selectedAccount}` : "No active home route yet"}
                label="Execution"
                tone={status?.executionMode === "paper" ? "safe" : "neutral"}
                value={executionLabel}
              />
              <MetricCard
                hint={managedAccounts.length > 0 ? managedAccounts.join(" · ") : "Connect to discover routed accounts"}
                label="Managed accounts"
                value={fmtNumber(managedAccounts.length)}
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-[0.92fr,1.08fr]">
              <Panel title="Gateway Session" eyebrow="Connector State">
                <div className="grid gap-3 sm:grid-cols-2">
                  <ConnectorFact label="Endpoint" value={endpoint} />
                  <ConnectorFact label="Client ID" value={status ? String(status.clientId) : "—"} />
                  <ConnectorFact label="Market data" value={status?.marketDataMode ?? "Unknown"} />
                  <ConnectorFact label="Last connect" value={lastConnectedLabel} />
                  <ConnectorFact label="Last heartbeat" value={lastHeartbeatLabel} />
                  <ConnectorFact label="Next reconnect" value={nextReconnectLabel} />
                </div>
              </Panel>

              <Panel title="Account Routing" eyebrow="Account Home">
                {managedAccounts.length > 0 ? (
                  <div className="grid gap-3">
                    {managedAccounts.map((accountId) => {
                      const isPaperAccount = isPaperTradingAccountId(accountId);
                      const isCurrent = selectedAccount === accountId;
                      return (
                        <div
                          key={accountId}
                          className={`rounded-2xl border px-4 py-3 ${
                            isCurrent ? "border-accent/35 bg-accent/8" : "border-line/80 bg-panelSoft"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-text">{accountId}</div>
                              <div className="mt-1 text-sm text-muted">
                                {isCurrent ? "Currently routed into the Van Aken home dashboard." : "Available to route into the home dashboard."}
                              </div>
                            </div>
                            <span
                              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                                isPaperAccount
                                  ? "border-danger/35 bg-danger/8 text-danger"
                                  : "border-line bg-panel text-text"
                              }`}
                            >
                              {isPaperAccount ? "Paper" : "Live"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
                    Connect to IB Gateway or TWS to populate the Van Aken home dashboard.
                  </div>
                )}
              </Panel>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function ConnectorFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="mt-2 text-sm font-medium text-text">{value}</div>
    </div>
  );
}

function AccountStatusBadge({ label, tone }: { label: string; tone: ConnectionHealthTone }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${connectionToneBadgeClass(tone)}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${connectionToneIndicatorClass(tone)}`} />
      {label}
    </span>
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
  meta,
  badge,
  icon,
  tone,
  active = false,
  children,
  onSelect,
}: {
  title: string;
  meta: string;
  badge: string;
  icon: ReactNode;
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
        <span className="shell-row-icon">{icon}</span>
        <div className="shell-source-copy">
          <div className="shell-source-title">{title}</div>
          <div className="shell-source-meta">{meta}</div>
        </div>
        <span className={`shell-source-badge is-${tone}`}>{badge}</span>
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

function ShellSettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="shell-setting-row">
      <span className="shell-setting-label">{label}</span>
      <span className="shell-setting-value">{value}</span>
    </div>
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

function FolderIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path
        d="M3.75 6.75h4.1l1.3 1.3h7.1v5.7a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path d="M3.75 6.75v-.5a1.5 1.5 0 0 1 1.5-1.5H7.2l1.15 1.2" opacity="0.55" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
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

function connectionToneBadgeClass(tone: ConnectionHealthTone) {
  if (tone === "safe") {
    return "border-safe/30 bg-safe/10 text-safe";
  }
  if (tone === "caution") {
    return "border-caution/30 bg-caution/10 text-caution";
  }
  if (tone === "danger") {
    return "border-danger/30 bg-danger/10 text-danger";
  }
  return "border-line/80 bg-panelSoft text-muted";
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

export default App;
