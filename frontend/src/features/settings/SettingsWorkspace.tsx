import { type ReactNode } from "react";

import { MetricCard } from "../../components/MetricCard";
import { Panel } from "../../components/Panel";
import { ToolWorkspaceFrame } from "../../components/shell/ToolWorkspaceFrame";
import { ErrorState } from "../../components/ui/ErrorState";
import { DEFAULT_DASHBOARD_ACCOUNT_KEY } from "../../config/dashboardAccounts";
import { formatTimestamp } from "../../lib/formatters";
import type { ConnectionStatus, MarketDataSourceStatus } from "../../lib/types";
import { useConnectorSources } from "../sources/useConnectorSources";
import { useStockIntelOverview } from "../stock-intel/useStockIntelOverview";

type ConnectionHealthTone = "safe" | "caution" | "danger" | "planned";

type AccountConnectorCard = {
  id: string;
  title: string;
  status: string;
  detail: string;
  tone: ConnectionHealthTone;
  icon: ReactNode;
};

type SettingsWorkspaceProps = {
  connectionStatus?: ConnectionStatus;
  executionEnabled: boolean;
};

export function SettingsWorkspace({ connectionStatus, executionEnabled }: SettingsWorkspaceProps) {
  const { researchRootPath, sourceCards: stockIntelSourceCards } = useStockIntelOverview();
  const {
    finnhubApiKeyInput,
    finnhubConfigureError,
    finnhubConfigureMutation,
    finnhubStatusError,
    finnhubStatusQuery,
    marketDataSourceConfigureError,
    marketDataSourceConfigureMutation,
    marketDataSourceKeyInputs,
    marketDataSourcesStatusError,
    marketDataSourcesStatusQuery,
    okxStatusError,
    okxStatusQuery,
    setFinnhubApiKeyInput,
    setMarketDataSourceKeyInputs,
  } = useConnectorSources({
    accountSettingsOpen: false,
    globalSettingsActive: true,
    selectedDashboardAccountKey: DEFAULT_DASHBOARD_ACCOUNT_KEY,
  });

  const okxHealthStatus = okxStatusQuery.isLoading
    ? "Checking"
    : okxStatusError
      ? "Unavailable"
      : okxStatusQuery.data?.status === "ready"
        ? "Healthy"
        : "Degraded";
  const okxHealthTone: ConnectionHealthTone = okxStatusQuery.isLoading
    ? "caution"
    : okxStatusError
      ? "danger"
      : okxStatusQuery.data?.status === "ready"
        ? "safe"
        : "danger";
  const okxStatusMessage = okxStatusError ?? okxStatusQuery.data?.detail ?? "Public crypto market data provider";
  const okxHealthError = okxStatusError ?? okxStatusQuery.data?.lastError ?? null;
  const finnhubConfigured = finnhubStatusQuery.data?.configured ?? false;
  const finnhubHealthStatus = finnhubStatusQuery.isLoading
    ? "Checking"
    : finnhubStatusError
      ? "Unavailable"
      : !finnhubConfigured
        ? "Not configured"
        : finnhubStatusQuery.data?.status === "ready"
          ? "Healthy"
          : "Degraded";
  const finnhubHealthTone: ConnectionHealthTone = finnhubStatusQuery.isLoading
    ? "caution"
    : finnhubStatusError
      ? "danger"
      : !finnhubConfigured
        ? "caution"
        : finnhubStatusQuery.data?.status === "ready"
          ? "safe"
          : "danger";
  const finnhubStatusMessage = finnhubStatusError ?? finnhubStatusQuery.data?.detail ?? "Stock tool data provider";
  const finnhubHealthError = finnhubConfigureError ?? finnhubStatusError ?? finnhubStatusQuery.data?.lastError ?? null;
  const dataModeLabel = connectionStatus?.mode === "ibkr" ? "IBKR gateway session" : "Mock snapshot";
  const executionModeLabel = executionEnabled ? "Gateway-routed execution" : "Disabled";
  const refreshCadenceLabel = "Conn 10s - Risk 15s - Chain 20s";
  const connectionEndpoint = connectionStatus ? `${connectionStatus.host}:${connectionStatus.port}` : "127.0.0.1:4002";
  const heartbeatLabel = connectionStatus?.lastHeartbeatAt ? formatTimestamp(connectionStatus.lastHeartbeatAt) : "No heartbeat";
  const connectionEndpointLabel = connectionStatus?.connected ? `Connected on ${connectionEndpoint}` : connectionEndpoint;
  const marketDataSources = marketDataSourcesStatusQuery.data?.sources ?? [];
  const configuredMarketSources = marketDataSources.filter((source) => source.configured).length;
  const readyMarketSources = marketDataSources.filter((source) => source.available).length;
  const globalSourceCards: AccountConnectorCard[] = [
    {
      id: "okx",
      title: "OKX Market Data",
      status: okxHealthStatus,
      detail: okxStatusQuery.isLoading ? "Running live public crypto market data health check" : okxStatusMessage,
      tone: okxHealthTone,
      icon: <MarketIcon />,
    },
    {
      id: "finnhub",
      title: "Finnhub",
      status: finnhubStatusQuery.isLoading
        ? "Checking"
        : finnhubConfigureMutation.isPending
          ? "Saving"
          : !finnhubConfigured
            ? "Needs setup"
            : finnhubStatusQuery.data?.status === "ready"
              ? "Healthy"
              : "Degraded",
      detail: finnhubStatusQuery.isLoading ? "Running live Finnhub health check" : finnhubStatusMessage,
      tone: finnhubConfigureMutation.isPending ? "caution" : finnhubHealthTone,
      icon: <MarketIcon />,
    },
    {
      id: "market-intelligence",
      title: "Earnings Sources",
      status: marketDataSourcesStatusQuery.isLoading
        ? "Checking"
        : marketDataSourcesStatusError
          ? "Unavailable"
          : `${readyMarketSources}/${marketDataSources.length} ready`,
      detail: marketDataSourcesStatusError ?? `${configuredMarketSources} external consensus/news provider${configuredMarketSources === 1 ? "" : "s"} configured.`,
      tone: marketDataSourcesStatusError ? "danger" : readyMarketSources > 0 ? "safe" : configuredMarketSources > 0 ? "caution" : "planned",
      icon: <MarketIcon />,
    },
    ...stockIntelSourceCards.map((source) => ({
      ...source,
      icon: source.id === "edgar" ? <DocumentIcon /> : <PdfLibraryIcon />,
    })),
  ];

  async function saveFinnhubConnector() {
    await finnhubConfigureMutation.mutateAsync({ apiKey: finnhubApiKeyInput.trim() || null });
  }

  async function clearFinnhubConnector() {
    await finnhubConfigureMutation.mutateAsync({ apiKey: null });
  }

  async function saveMarketDataSource(providerId: string) {
    await marketDataSourceConfigureMutation.mutateAsync({
      providerId,
      request: { apiKey: marketDataSourceKeyInputs[providerId]?.trim() ?? "" },
    });
  }

  async function clearMarketDataSource(providerId: string) {
    await marketDataSourceConfigureMutation.mutateAsync({ providerId, request: { clearApiKey: true } });
  }

  async function toggleMarketDataSource(providerId: string, enabled: boolean) {
    await marketDataSourceConfigureMutation.mutateAsync({ providerId, request: { enabled } });
  }

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

        <Panel eyebrow="Crypto market provider" title="OKX Market Data">
          <div className="grid gap-6">
            <div className="grid gap-4 md:grid-cols-4">
              <MetricCard label="Health" value={okxHealthStatus} />
              <MetricCard label="Auth mode" value={okxStatusQuery.data?.authMode?.toUpperCase() ?? "PUBLIC"} />
              <MetricCard label="API base" value={okxStatusQuery.data?.apiBaseUrl ?? "https://www.okx.com"} />
              <MetricCard
                label="Last healthy check"
                value={okxStatusQuery.data?.lastSuccessfulSyncAt ? formatTimestamp(okxStatusQuery.data.lastSuccessfulSyncAt) : "Pending"}
              />
            </div>
            {okxHealthError ? <ErrorState message={okxHealthError} /> : null}
            <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
              OKX is the global public crypto market-data provider. No API keys are required right now, and this page runs a live upstream ticker probe every 30 seconds while it remains open.
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Stock data connector" title="Finnhub">
          <div className="grid gap-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <MetricCard
                label="Configuration"
                value={
                  finnhubStatusQuery.isLoading
                    ? "Checking"
                    : finnhubStatusError
                      ? "Unavailable"
                      : finnhubConfigured
                        ? "Configured"
                        : "Not configured"
                }
              />
              <MetricCard label="Health" value={finnhubHealthStatus} />
              <MetricCard
                label="Active key"
                value={finnhubStatusQuery.data?.maskedApiKey ?? (finnhubStatusQuery.isLoading ? "Loading" : "None")}
              />
              <MetricCard label="API base" value={finnhubStatusQuery.data?.apiBaseUrl ?? "https://finnhub.io/api/v1"} />
              <MetricCard
                label="Last healthy check"
                value={finnhubStatusQuery.data?.lastSuccessfulSyncAt ? formatTimestamp(finnhubStatusQuery.data.lastSuccessfulSyncAt) : "Pending"}
              />
            </div>
            {finnhubHealthError ? <ErrorState message={finnhubHealthError} /> : null}
            <div className="grid gap-3 rounded-2xl border border-line/80 bg-panelSoft px-4 py-4">
              <label className="grid gap-2">
                <span className="text-[11px] uppercase tracking-[0.16em] text-muted">API key</span>
                <input
                  className="w-full rounded-xl border border-line/80 bg-panel px-4 py-3 text-sm text-text outline-none transition focus:border-accent/60"
                  onChange={(event) => setFinnhubApiKeyInput(event.target.value)}
                  placeholder={finnhubConfigured ? "Paste a replacement Finnhub API key" : "Enter a Finnhub API key"}
                  spellCheck={false}
                  type="password"
                  value={finnhubApiKeyInput}
                />
              </label>
              <div className="text-sm text-muted">
                {finnhubConfigured
                  ? "Configured Finnhub credentials back the Stock tool when the broker session is unavailable, and this page runs a live health check while it is open."
                  : "Add a Finnhub API key to supply basic stock data when the Stock tool cannot rely on the broker session."}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-muted">Live status refreshes every 30 seconds while Global Settings stays open.</div>
                <div className="flex flex-wrap gap-2">
                  {finnhubConfigured ? (
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
                    {finnhubConfigureMutation.isPending ? "Saving..." : finnhubConfigured ? "Update Key" : "Save Key"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Earnings intelligence providers" title="Market Data Sources">
          <div className="grid gap-5">
            {marketDataSourceConfigureError || marketDataSourcesStatusError ? (
              <ErrorState message={marketDataSourceConfigureError ?? marketDataSourcesStatusError ?? "Market data sources are unavailable."} />
            ) : null}
            <div className="grid gap-3 lg:grid-cols-2">
              {marketDataSources.map((source) => (
                <MarketDataSourceCard
                  key={source.providerId}
                  inputValue={marketDataSourceKeyInputs[source.providerId] ?? ""}
                  isSaving={marketDataSourceConfigureMutation.isPending}
                  onClear={() => {
                    void clearMarketDataSource(source.providerId);
                  }}
                  onInputChange={(value) =>
                    setMarketDataSourceKeyInputs((current) => ({ ...current, [source.providerId]: value }))
                  }
                  onSave={() => {
                    void saveMarketDataSource(source.providerId);
                  }}
                  onToggle={(enabled) => {
                    void toggleMarketDataSource(source.providerId, enabled);
                  }}
                  source={source}
                />
              ))}
            </div>
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
                {researchRootPath ? shortenPath(researchRootPath) : "Loading"}
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </ToolWorkspaceFrame>
  );
}

function MarketDataSourceCard({
  source,
  inputValue,
  isSaving,
  onInputChange,
  onSave,
  onClear,
  onToggle,
}: {
  source: MarketDataSourceStatus;
  inputValue: string;
  isSaving: boolean;
  onInputChange: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const tone = marketDataSourceTone(source);
  const canSave = source.configurable && inputValue.trim().length > 0;
  return (
    <div className="rounded-2xl border border-line/80 bg-panelSoft p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${connectionToneIconClass(tone)}`}>
            <MarketIcon />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-text">{source.displayName}</div>
            <div className="mt-1 text-xs uppercase tracking-[0.16em] text-muted">{source.category}</div>
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${statusPillClass(tone)}`}>
          {marketDataSourceStatusLabel(source)}
        </span>
      </div>

      <div className="mt-3 text-sm text-muted">{source.detail}</div>

      <div className="mt-3 flex flex-wrap gap-2">
        {source.capabilities.map((capability) => (
          <span key={capability} className="rounded-full border border-line/70 bg-panel px-2 py-1 text-[11px] text-muted">
            {capability}
          </span>
        ))}
      </div>

      <div className="mt-4 grid gap-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <MetricCard label="Key" value={source.maskedApiKey ?? (source.requiresApiKey ? "None" : "Not required")} />
          <MetricCard label="API base" value={source.apiBaseUrl ?? "Vendor configured"} />
        </div>

        {source.configurable ? (
          <>
            <label className="grid gap-2">
              <span className="text-[11px] uppercase tracking-[0.16em] text-muted">API key</span>
              <input
                className="w-full rounded-xl border border-line/80 bg-panel px-4 py-3 text-sm text-text outline-none transition focus:border-accent/60"
                onChange={(event) => onInputChange(event.target.value)}
                placeholder={source.configured ? `Paste replacement ${source.displayName} key` : `Enter ${source.displayName} key`}
                spellCheck={false}
                type="password"
                value={inputValue}
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-muted">
                <input
                  checked={source.enabled}
                  className="h-4 w-4 rounded border-line bg-panel text-accent"
                  disabled={!source.configured || isSaving}
                  onChange={(event) => onToggle(event.target.checked)}
                  type="checkbox"
                />
                Enabled
              </label>
              <div className="flex flex-wrap gap-2">
                {source.configured ? (
                  <button
                    className="rounded-full border border-line/80 bg-panel px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition hover:border-danger/30 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isSaving}
                    onClick={onClear}
                    type="button"
                  >
                    Clear
                  </button>
                ) : null}
                <button
                  className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-accent transition hover:border-accent/50 hover:bg-accent/16 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!canSave || isSaving}
                  onClick={onSave}
                  type="button"
                >
                  {isSaving ? "Saving..." : source.configured ? "Update Key" : "Save Key"}
                </button>
              </div>
            </div>
          </>
        ) : null}
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
}: {
  title: string;
  status: string;
  detail: string;
  tone: ConnectionHealthTone;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-line/80 bg-panelSoft p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${connectionToneIconClass(tone)}`}>{icon}</span>
          <div>
            <div className="text-sm font-medium text-text">{title}</div>
            <div className="mt-1 text-xs uppercase tracking-[0.16em] text-muted">{status}</div>
          </div>
        </div>
      </div>
      <div className="mt-3 text-sm text-muted">{detail}</div>
    </div>
  );
}

function shortenPath(value: string, maxLength = 42) {
  if (value.length <= maxLength) {
    return value;
  }
  const edge = Math.max(12, Math.floor((maxLength - 1) / 2));
  return `${value.slice(0, edge)}...${value.slice(-edge)}`;
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

function marketDataSourceTone(source: MarketDataSourceStatus): ConnectionHealthTone {
  if (source.status === "ready") {
    return "safe";
  }
  if (source.status === "not_configured") {
    return "caution";
  }
  if (source.status === "disabled" || source.status === "planned") {
    return "planned";
  }
  return "danger";
}

function marketDataSourceStatusLabel(source: MarketDataSourceStatus) {
  if (source.status === "ready") {
    return "Ready";
  }
  if (source.status === "disabled") {
    return "Disabled";
  }
  if (source.status === "planned") {
    return "Planned";
  }
  return "Needs key";
}

function statusPillClass(tone: ConnectionHealthTone) {
  if (tone === "safe") {
    return "border-safe/30 bg-safe/10 text-safe";
  }
  if (tone === "caution") {
    return "border-caution/30 bg-caution/10 text-caution";
  }
  if (tone === "danger") {
    return "border-danger/30 bg-danger/10 text-danger";
  }
  return "border-line/80 bg-panel text-muted";
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
