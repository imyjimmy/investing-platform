import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { accountApi } from "../lib/api/account";
import { sourceApi } from "../lib/api/sources";
import { queryKeys } from "../lib/queryKeys";
import type {
  EdgarBodyCacheState,
  EdgarIntelligenceState,
  EdgarMetadataState,
  EdgarSourceStatus,
  EdgarSyncRequest,
  EdgarSyncResponse,
  EdgarWorkspaceRequest,
  EdgarWorkspaceResponse,
} from "../lib/types";
import {
  workspaceBodyClassName,
  workspaceDividedBodyClassName,
  workspaceEyebrowClassName,
  workspaceTitleClassName,
} from "./shell/WorkspaceStage";
import { WorkspaceFrame } from "./shell/WorkspaceFrame";

interface EdgarWorkspaceProps {
  defaultTicker: string;
  onRun: (request: EdgarSyncRequest) => void;
  status?: EdgarSourceStatus;
  statusError: string | null;
  statusLoading: boolean;
  syncError: string | null;
  syncResult?: EdgarSyncResponse;
  syncing: boolean;
}

const inputClassName =
  "w-full rounded-[10px] border border-line bg-[rgba(255,255,255,0.03)] px-4 py-3 text-sm text-text outline-none transition placeholder:text-muted/60 focus:border-accent/45 focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-55";

export function EdgarWorkspace({
  defaultTicker,
  onRun,
  status,
  statusError,
  statusLoading,
  syncError,
  syncResult,
  syncing,
}: EdgarWorkspaceProps) {
  const queryClient = useQueryClient();
  const [issuerQuery, setIssuerQuery] = useState(defaultTicker);
  const [advancedOutputDir, setAdvancedOutputDir] = useState("");
  const [advancedStartDate, setAdvancedStartDate] = useState("");
  const [advancedEndDate, setAdvancedEndDate] = useState("");
  const [advancedFormTypes, setAdvancedFormTypes] = useState("");
  const [forceRefresh, setForceRefresh] = useState(false);
  const [includeExhibits, setIncludeExhibits] = useState(false);
  const [warmingMode, setWarmingMode] = useState<"defaults" | "watchlist" | null>(null);
  const [warmMessage, setWarmMessage] = useState<string | null>(null);
  const [warmError, setWarmError] = useState<string | null>(null);
  const [watchlistInput, setWatchlistInput] = useState("");
  const [watchlistUpdating, setWatchlistUpdating] = useState(false);
  const [watchlistMessage, setWatchlistMessage] = useState<string | null>(null);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);

  const normalizedQuery = issuerQuery.trim();
  const likelyTicker = normalizeTickerCandidate(normalizedQuery);
  const workspaceRequest: EdgarWorkspaceRequest | null =
    syncResult?.workspace.ticker
      ? { ticker: syncResult.workspace.ticker, outputDir: syncResult.workspace.outputDir ?? undefined }
      : likelyTicker
        ? { ticker: likelyTicker }
        : null;

  const workspaceQuery = useQuery({
    queryKey: queryKeys.sources.edgarWorkspace(workspaceRequest),
    queryFn: () => sourceApi.edgarWorkspace(workspaceRequest as EdgarWorkspaceRequest),
    enabled: Boolean(status?.available) && workspaceRequest !== null && !syncing,
    staleTime: 30_000,
    retry: false,
  });

  const watchlistQuery = useQuery({
    queryKey: queryKeys.account.watchlist,
    queryFn: accountApi.watchlist,
    staleTime: 30_000,
    retry: false,
  });

  const activeWorkspace = workspaceQuery.data ?? undefined;
  const metadataState = activeWorkspace?.metadataState ?? syncResult?.metadataState;
  const bodyCacheState = activeWorkspace?.bodyCacheState ?? syncResult?.bodyCacheState;
  const intelligenceState = activeWorkspace?.intelligenceState ?? syncResult?.intelligenceState;
  const effectiveTicker = activeWorkspace?.ticker ?? syncResult?.resolvedTicker ?? likelyTicker ?? "";
  const effectiveCompany = activeWorkspace?.companyName ?? syncResult?.resolvedCompanyName ?? normalizedQuery ?? "No company selected";
  const canRun = Boolean(status?.available) && Boolean(normalizedQuery) && !syncing;
  const warming = warmingMode !== null;
  const watchlistSymbols = watchlistQuery.data?.symbols ?? [];
  const watchlistRefreshSymbols = watchlistSymbols.slice(0, 50);
  const normalizedWatchlistInput = normalizeTickerCandidate(watchlistInput.trim());
  const watchlistInputSymbol = normalizedWatchlistInput ?? "";
  const canWarm = Boolean(status?.available) && !warming;
  const canWarmWatchlist = Boolean(status?.available) && watchlistRefreshSymbols.length > 0 && !warming;
  const canAddWatchlistSymbol = Boolean(watchlistInputSymbol) && !watchlistSymbols.includes(watchlistInputSymbol) && !watchlistUpdating;
  const workspaceError = workspaceQuery.error instanceof Error ? workspaceQuery.error.message : null;
  const loadedWatchlistError = watchlistQuery.error instanceof Error ? watchlistQuery.error.message : null;
  const companyRefreshTarget = effectiveTicker || likelyTicker || normalizedQuery.toUpperCase() || "company";
  const companyRefreshButtonLabel = syncing
    ? `Refreshing ${companyRefreshTarget} filings...`
    : activeWorkspace
      ? `Refresh ${companyRefreshTarget} filings`
      : "Sync company filings";
  const syncSuccessMessage = syncResult ? formatCompanySyncMessage(syncResult) : null;
  const syncMessageTone =
    syncResult?.metadataState.status === "degraded" || syncResult?.bodyCacheState.status === "degraded" ? "neutral" : "success";
  const watchlistRefreshCount = watchlistRefreshSymbols.length;
  const watchlistPanelScopeLabel =
    watchlistSymbols.length > watchlistRefreshCount
      ? `first ${watchlistRefreshCount} symbols`
      : `${watchlistRefreshCount} symbol${watchlistRefreshCount === 1 ? "" : "s"}`;
  const watchlistPanelRefreshButtonLabel =
    warmingMode === "watchlist"
      ? "Refreshing watchlist..."
      : watchlistRefreshCount > 0
        ? `Refresh ${watchlistPanelScopeLabel}`
        : "Refresh watchlist";

  function handleRun() {
    if (!canRun) {
      return;
    }
    const request: EdgarSyncRequest = { issuerQuery: normalizedQuery };
    const outputDir = advancedOutputDir.trim();
    const formTypes = parseFormTypes(advancedFormTypes);
    if (outputDir) {
      request.outputDir = outputDir;
    }
    if (forceRefresh) {
      request.forceRefresh = true;
    }
    if (advancedStartDate) {
      request.startDate = advancedStartDate;
    }
    if (advancedEndDate) {
      request.endDate = advancedEndDate;
    }
    if (formTypes.length > 0) {
      request.formTypes = formTypes;
    }
    if (includeExhibits) {
      request.includeExhibits = true;
    }
    onRun(request);
  }

  async function handleWarm() {
    if (!canWarm) {
      return;
    }
    setWarmingMode("defaults");
    setWarmMessage(null);
    setWarmError(null);
    try {
      const response = await sourceApi.edgarWarm({ mode: "metadata-only", maxIssuers: 10 });
      setWarmMessage(`Warmed ${response.warmedIssuers} issuer${response.warmedIssuers === 1 ? "" : "s"}.`);
      await queryClient.invalidateQueries({ queryKey: ["edgar-workspace"] });
    } catch (error) {
      setWarmError(error instanceof Error ? error.message : "EDGAR warm failed.");
    } finally {
      setWarmingMode(null);
    }
  }

  async function handleWarmWatchlist() {
    if (!canWarmWatchlist) {
      return;
    }
    setWarmingMode("watchlist");
    setWarmMessage(null);
    setWarmError(null);
    try {
      const response = await sourceApi.edgarWarm({
        issuerQueries: watchlistRefreshSymbols,
        mode: "body-cache",
        maxIssuers: watchlistRefreshSymbols.length,
        maxFilingBodiesPerIssuer: 2,
        forceRefresh,
        includeWatchlist: false,
        includeRecentIssuers: false,
        includeAskedIssuers: false,
      });
      const cappedSuffix = watchlistSymbols.length > watchlistRefreshSymbols.length ? ` First ${watchlistRefreshSymbols.length} symbols were included.` : "";
      setWarmMessage(
        `Refreshed ${response.warmedIssuers} of ${response.requestedIssuers} watchlist issuer${
          response.requestedIssuers === 1 ? "" : "s"
        }.${cappedSuffix}`,
      );
      await queryClient.invalidateQueries({ queryKey: ["edgar-workspace"] });
    } catch (error) {
      setWarmError(error instanceof Error ? error.message : "Watchlist filing refresh failed.");
    } finally {
      setWarmingMode(null);
    }
  }

  async function persistWatchlist(nextSymbols: string[], message: string) {
    setWatchlistUpdating(true);
    setWatchlistMessage(null);
    setWatchlistError(null);
    try {
      const response = await accountApi.updateWatchlist({ symbols: nextSymbols });
      queryClient.setQueryData(queryKeys.account.watchlist, response);
      await queryClient.invalidateQueries({ queryKey: ["risk-summary"] });
      setWatchlistMessage(message);
    } catch (error) {
      setWatchlistError(error instanceof Error ? error.message : "Watchlist update failed.");
    } finally {
      setWatchlistUpdating(false);
    }
  }

  async function handleAddWatchlistSymbol() {
    if (!watchlistInputSymbol || !canAddWatchlistSymbol) {
      return;
    }
    const nextSymbols = [...watchlistSymbols, watchlistInputSymbol];
    setWatchlistInput("");
    await persistWatchlist(nextSymbols, `Added ${watchlistInputSymbol} to the watchlist.`);
  }

  async function handleRemoveWatchlistSymbol(symbol: string) {
    const nextSymbols = watchlistSymbols.filter((item) => item !== symbol);
    await persistWatchlist(nextSymbols, `Removed ${symbol} from the watchlist.`);
  }

  const header = (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between" data-testid="edgar-workspace-header">
      <div>
        <div className={workspaceEyebrowClassName}>Stocks</div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className={workspaceTitleClassName}>EDGAR Filings</h1>
          <div className="inline-flex items-center rounded-full border border-line bg-panelSoft px-4 py-1 text-sm font-medium text-text" data-testid="edgar-source-status">
            {status?.available ? "Ready" : statusLoading ? "Checking" : "Needs config"}
          </div>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Resolve one company, sync that company's SEC filing library, and keep watchlist filing caches current.
        </p>
      </div>
      <div className="flex flex-col items-start gap-3 lg:items-end">
        <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
          <button
            className="rounded-full border border-line bg-panelSoft px-4 py-2 text-sm font-medium text-text transition hover:border-accent/35 hover:text-white disabled:cursor-default disabled:opacity-45"
            data-testid="edgar-warm-button"
            disabled={!canWarm}
            onClick={handleWarm}
            type="button"
          >
            {warmingMode === "defaults" ? "Warming metadata..." : "Warm filing metadata"}
          </button>
          <button
            className="rounded-full border border-accent/35 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:border-accent/50 hover:text-white disabled:cursor-default disabled:opacity-45"
            data-testid="edgar-sync-button"
            disabled={!canRun}
            onClick={handleRun}
            type="button"
          >
            {companyRefreshButtonLabel}
          </button>
        </div>
        {!status?.available ? (
          <div className="max-w-md rounded-[20px] border border-caution/25 bg-caution/10 px-4 py-3 text-sm text-caution">
            Add a descriptive SEC <span className="mono">User-Agent</span> to enable filing sync.
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <WorkspaceFrame bodyClassName={null} header={header}>
      <section className={workspaceBodyClassName} data-testid="edgar-workspace">
        <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
          <section className="grid content-start gap-5">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Company</div>
              <h2 className="mt-1 text-xl font-semibold text-text">Company filing library</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
                Enter a ticker, company name, or CIK. The backend resolves one issuer, applies default filing coverage, and refreshes that company's local library.
              </p>
            </div>

            <label className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.18em] text-muted">Company</span>
              <input
                className={inputClassName}
                data-testid="edgar-company-input"
                onChange={(event) => setIssuerQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleRun();
                  }
                }}
                placeholder="Ticker, company name, or CIK"
                type="text"
                value={issuerQuery}
              />
            </label>

            <div className="rounded-[18px] border border-line bg-panelSoft/65 px-4 py-4 text-sm leading-6 text-muted">
              <div className="font-medium text-text">Default coverage</div>
              <div className="mt-2">
                Company sync includes annual, quarterly, current-report, and amended filings automatically. Filing bodies are cached locally under the stock workspace; app-global EDGAR metadata stays under the configured research root.
              </div>
            </div>

            <div className="rounded-[18px] border border-line bg-panelSoft/55 px-4 py-4" data-testid="edgar-watchlist-panel">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Watchlist filing refresh</div>
                  <div className="mt-1 text-base font-semibold text-text">{watchlistSymbols.length} saved symbols</div>
                </div>
                <button
                  className="inline-flex w-full justify-center rounded-full border border-accent/35 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:border-accent/50 hover:text-white disabled:cursor-default disabled:opacity-45 md:w-auto"
                  data-testid="edgar-watchlist-refresh-inline-button"
                  disabled={!canWarmWatchlist}
                  onClick={handleWarmWatchlist}
                  type="button"
                >
                  {watchlistPanelRefreshButtonLabel}
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {watchlistSymbols.length > 0 ? (
                  watchlistSymbols.map((symbol) => (
                    <span
                      className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-sm font-medium text-text"
                      data-testid={`edgar-watchlist-chip-${symbol}`}
                      key={symbol}
                    >
                      {symbol}
                      <button
                        aria-label={`Remove ${symbol} from watchlist`}
                        className="text-muted transition hover:text-danger disabled:cursor-default disabled:opacity-45"
                        data-testid={`edgar-watchlist-remove-${symbol}`}
                        disabled={watchlistUpdating}
                        onClick={() => void handleRemoveWatchlistSymbol(symbol)}
                        type="button"
                      >
                        x
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-muted">{watchlistQuery.isLoading ? "Loading watchlist..." : "No watchlist symbols saved."}</span>
                )}
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Watchlist ticker</span>
                  <input
                    className={inputClassName}
                    data-testid="edgar-watchlist-input"
                    onChange={(event) => setWatchlistInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleAddWatchlistSymbol();
                      }
                    }}
                    placeholder="Ticker"
                    type="text"
                    value={watchlistInput}
                  />
                </label>
                <button
                  className="rounded-full border border-line bg-panelSoft px-4 py-2 text-sm font-medium text-text transition hover:border-accent/35 hover:text-white disabled:cursor-default disabled:opacity-45"
                  data-testid="edgar-watchlist-add-button"
                  disabled={!canAddWatchlistSymbol}
                  onClick={() => void handleAddWatchlistSymbol()}
                  type="button"
                >
                  Add
                </button>
              </div>
              {watchlistMessage ? <div className="mt-3 text-sm text-muted">{watchlistMessage}</div> : null}
            </div>

            <details className="rounded-[18px] border border-line bg-panelSoft/45 px-4 py-4" data-testid="edgar-advanced-controls">
              <summary className="cursor-pointer text-sm font-medium text-text" data-testid="edgar-advanced-toggle">Advanced sync options</summary>
              <div className="mt-4 grid gap-4">
                <label className="grid gap-2">
                  <span className="text-xs uppercase tracking-[0.18em] text-muted">Output folder</span>
                  <input
                    className={inputClassName}
                    data-testid="edgar-output-dir-input"
                    onChange={(event) => setAdvancedOutputDir(event.target.value)}
                    placeholder={status?.researchRootPath ?? "Research root"}
                    type="text"
                    value={advancedOutputDir}
                  />
                </label>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-xs uppercase tracking-[0.18em] text-muted">Start date</span>
                    <input
                      className={inputClassName}
                      data-testid="edgar-start-date-input"
                      onChange={(event) => setAdvancedStartDate(event.target.value)}
                      type="date"
                      value={advancedStartDate}
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-xs uppercase tracking-[0.18em] text-muted">End date</span>
                    <input
                      className={inputClassName}
                      data-testid="edgar-end-date-input"
                      onChange={(event) => setAdvancedEndDate(event.target.value)}
                      type="date"
                      value={advancedEndDate}
                    />
                  </label>
                </div>
                <label className="grid gap-2">
                  <span className="text-xs uppercase tracking-[0.18em] text-muted">Form types</span>
                  <input
                    className={inputClassName}
                    data-testid="edgar-form-types-input"
                    onChange={(event) => setAdvancedFormTypes(event.target.value)}
                    placeholder="10-K, 10-Q, 8-K"
                    type="text"
                    value={advancedFormTypes}
                  />
                </label>
                <div className="grid gap-3 text-sm text-muted md:grid-cols-2">
                  <label className="flex items-center gap-3">
                    <input
                      checked={forceRefresh}
                      className="h-4 w-4 accent-accent"
                      data-testid="edgar-force-refresh-checkbox"
                      onChange={(event) => setForceRefresh(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Force live SEC refresh</span>
                  </label>
                  <label className="flex items-center gap-3">
                    <input
                      checked={includeExhibits}
                      className="h-4 w-4 accent-accent"
                      data-testid="edgar-include-exhibits-checkbox"
                      onChange={(event) => setIncludeExhibits(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Include exhibits</span>
                  </label>
                </div>
              </div>
            </details>

            <div className="grid gap-3 md:grid-cols-2">
              <InfoCard
                eyebrow="Workspace"
                title={effectiveTicker || "Pending resolution"}
                detail={
                  activeWorkspace?.stockPath
                    ? activeWorkspace.stockPath
                    : status?.researchRootPath
                      ? `${status.researchRootPath}/stocks/[ticker]`
                      : "The configured research root will hold the ticker workspace."
                }
              />
              <InfoCard
                eyebrow="Company"
                title={effectiveCompany}
                detail="Issuer resolution happens in the backend so the default flow stays company-first."
              />
            </div>
          </section>

          <section className="grid content-start gap-4 border-t border-line/70 pt-6 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Readiness</div>
              <h3 className="mt-1 text-base font-semibold text-text">Current state</h3>
            </div>

            <StateBlock
              testId="edgar-state-metadata"
              title="Metadata"
              state={metadataState}
              emptyDetail="Run the first EDGAR sync to build the local issuer workspace."
            />
            <StateBlock
              testId="edgar-state-body-cache"
              title="Filing bodies"
              state={bodyCacheState}
              emptyDetail="The working set of filing bodies will be cached locally after sync."
            />
            <StateBlock
              testId="edgar-state-intelligence"
              title="Local filing Q&A"
              state={intelligenceState}
              emptyDetail="The intelligence layer is not enabled yet in this build."
            />
          </section>
        </div>

        {statusError ? <InlineMessage tone="danger" message={statusError} /> : null}
        {workspaceError ? <InlineMessage tone="danger" message={workspaceError} /> : null}
        {loadedWatchlistError ? <InlineMessage tone="danger" message={loadedWatchlistError} /> : null}
        {watchlistError ? <InlineMessage tone="danger" message={watchlistError} /> : null}
        {warmError ? <InlineMessage tone="danger" message={warmError} /> : null}
        {warmMessage ? <InlineMessage tone="neutral" message={warmMessage} /> : null}
        {syncError ? <InlineMessage tone="danger" message={syncError} /> : null}
        {syncSuccessMessage ? <InlineMessage tone={syncMessageTone} message={syncSuccessMessage} testId="edgar-sync-success-message" /> : null}
      </section>

      <section className={workspaceDividedBodyClassName}>
        <div className="mb-4">
          <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Workspace</div>
          <h2 className="mt-1 text-xl font-semibold text-text">Local filing library</h2>
        </div>

        {activeWorkspace ? (
          <div className="grid gap-4 xl:grid-cols-[1.04fr,0.96fr]" data-testid="edgar-workspace-details">
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <StatItem label="Matched filings" testId="edgar-stat-matched-filings" value={String(activeWorkspace.bodyCacheState.matchedFilings)} />
                <StatItem label="Cached filings" testId="edgar-stat-cached-filings" value={String(activeWorkspace.bodyCacheState.cachedFilings)} />
                <StatItem label="New accessions" testId="edgar-stat-new-accessions" value={String(activeWorkspace.metadataState.newAccessions)} />
              </div>
              <div className="rounded-[18px] border border-line bg-panelSoft/55 px-4 py-4 text-sm leading-6 text-muted">
                <div className="font-medium text-text">{activeWorkspace.companyName}</div>
                <div className="mt-2">Ticker {activeWorkspace.ticker} · CIK {activeWorkspace.cik}</div>
                <div className="mt-2">
                  Last synced{" "}
                  <span className="text-text">
                    {activeWorkspace.lastSyncedAt ? formatTimestamp(activeWorkspace.lastSyncedAt) : "not yet recorded"}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid gap-3 text-sm text-muted">
              <PathField label="Stock folder" value={activeWorkspace.stockPath} />
              <PathField label=".edgar" value={activeWorkspace.edgarPath} />
              {activeWorkspace.exportsJsonPath ? <PathField label="Matched JSON" value={activeWorkspace.exportsJsonPath} /> : null}
              {activeWorkspace.exportsCsvPath ? <PathField label="Matched CSV" value={activeWorkspace.exportsCsvPath} /> : null}
              {activeWorkspace.manifestPath ? <PathField label="Manifest" value={activeWorkspace.manifestPath} /> : null}
            </div>
          </div>
        ) : workspaceQuery.isLoading ? (
          <div className="px-2 py-8 text-center text-sm text-muted">Looking for a saved EDGAR workspace…</div>
        ) : (
          <div className="rounded-[18px] border border-dashed border-line px-5 py-8 text-center text-sm text-muted" data-testid="edgar-workspace-empty">
            No simplified EDGAR workspace is recorded for this company yet. Run `Sync company filings` to create the local filing library.
          </div>
        )}
      </section>
    </WorkspaceFrame>
  );
}

function StateBlock({
  title,
  state,
  emptyDetail,
  testId,
}: {
  title: string;
  state: EdgarMetadataState | EdgarBodyCacheState | EdgarIntelligenceState | undefined;
  emptyDetail: string;
  testId?: string;
}) {
  const detail = state ? describeState(state) : emptyDetail;
  const label = state ? state.status : "idle";
  return (
    <div className="rounded-[18px] border border-line bg-panelSoft/55 px-4 py-4" data-testid={testId}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-text">{title}</div>
        <StatusPill status={label} />
      </div>
      <div className="mt-3 text-sm leading-6 text-muted">{detail}</div>
    </div>
  );
}

function InfoCard({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return (
    <div className="rounded-[18px] border border-line bg-panelSoft/55 px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{eyebrow}</div>
      <div className="mt-2 text-base font-semibold text-text">{title}</div>
      <div className="mt-2 text-sm leading-6 text-muted">{detail}</div>
    </div>
  );
}

function InlineMessage({ message, testId, tone }: { message: string; testId?: string; tone: "danger" | "neutral" | "success" }) {
  const toneClassName =
    tone === "danger"
      ? "border-danger/25 bg-danger/10 text-danger"
      : tone === "success"
        ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
        : "border-line bg-panelSoft text-muted";
  return (
    <div
      className={`mt-5 rounded-[20px] border px-4 py-3 text-sm ${toneClassName}`}
      data-testid={testId}
    >
      {message}
    </div>
  );
}

function PathField({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-line/70 pt-3 first:border-t-0 first:pt-0">
      <div className="mb-1 text-xs uppercase tracking-[0.16em] text-muted">{label}</div>
      <div className="mono break-all text-xs text-[#9cead8]">{value}</div>
    </div>
  );
}

function StatItem({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-[16px] border border-line bg-panelSoft/55 px-4 py-4" data-testid={testId}>
      <div className="text-xs uppercase tracking-[0.16em] text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-text">{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "fresh" || status === "ready" || status === "updated" || status === "completed" || status === "high"
      ? "safe"
      : status === "queued" || status === "indexing" || status === "not-ready" || status === "medium" || status === "partial"
        ? "caution"
        : status === "degraded" || status === "failed"
          ? "danger"
          : "neutral";
  const className =
    tone === "safe"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
      : tone === "caution"
        ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
        : tone === "danger"
          ? "border-danger/30 bg-danger/10 text-danger"
          : "border-line bg-panelSoft text-muted";
  return <span className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] ${className}`}>{status}</span>;
}

function normalizeTickerCandidate(value: string) {
  if (!value || !/^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(value)) {
    return null;
  }
  return value.toUpperCase();
}

function parseFormTypes(value: string) {
  const deduped: string[] = [];
  for (const item of value.split(/[,\s]+/)) {
    const normalized = item.trim().toUpperCase();
    if (normalized && !deduped.includes(normalized)) {
      deduped.push(normalized);
    }
  }
  return deduped;
}

function describeState(state: EdgarMetadataState | EdgarBodyCacheState | EdgarIntelligenceState) {
  if ("newAccessions" in state) {
    const freshness = state.lastLiveCheckedAt ? `Last live check ${formatTimestamp(state.lastLiveCheckedAt)}.` : "No live check recorded yet.";
    return state.message ? `${state.message} ${freshness}` : `${state.newAccessions} new accessions discovered. ${freshness}`;
  }
  if ("cachedFilings" in state) {
    return state.message ?? `${state.cachedFilings} filing bodies are cached locally.`;
  }
  return state.detail ?? "Local filing intelligence is not enabled yet.";
}

function formatCompanySyncMessage(result: EdgarSyncResponse) {
  const newAccessions = formatCount(result.metadataState.newAccessions, "new accession");
  const downloadedBodies = formatCount(result.bodyCacheState.downloadedFilings, "filing body", "filing bodies");
  const matchedFilings = formatCount(result.bodyCacheState.matchedFilings, "selected filing");
  const cachedFilings = formatCount(result.bodyCacheState.cachedFilings, "cached filing");
  const failedSuffix =
    result.bodyCacheState.failedFilings > 0 ? ` ${formatCount(result.bodyCacheState.failedFilings, "filing body", "filing bodies")} failed.` : "";
  const liveCheck = result.metadataState.lastLiveCheckedAt ? ` Live check ${formatTimestamp(result.metadataState.lastLiveCheckedAt)}.` : "";
  return `${result.resolvedTicker} filings refreshed: ${newAccessions}, ${downloadedBodies} downloaded, ${cachedFilings} across ${matchedFilings}.${failedSuffix}${liveCheck}`;
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
