import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { sourceApi } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import type { InvestorPdfDownloadRequest, InvestorPdfDownloadResponse, InvestorPdfSourceStatus } from "../lib/types";
import {
  matchesInvestorPdfIssuer,
  stockIntelLookupOptions,
  type StockIntelLookupMode,
} from "../features/stock-intel/issuer";
import {
  buildInvestorPdfDownloadRequest,
  deriveOutputRootFromStockTemplate,
  isStockFolderTemplate,
  materializeStockFolder,
} from "../features/stock-intel/requests";
import {
  workspaceEyebrowClassName,
  workspaceTitleClassName,
} from "./shell/WorkspaceStage";
import { WorkspaceFrame } from "./shell/WorkspaceFrame";

type WindowMode = "rolling" | "exact";

interface InvestorPdfsWorkspaceProps {
  defaultTicker: string;
  onRun: (request: InvestorPdfDownloadRequest) => void;
  status?: InvestorPdfSourceStatus;
  statusError: string | null;
  statusLoading: boolean;
  syncError: string | null;
  syncResult?: InvestorPdfDownloadResponse;
  syncing: boolean;
}

const windowOptions: Array<{ label: string; value: WindowMode }> = [
  { value: "rolling", label: "Rolling window" },
  { value: "exact", label: "Exact dates" },
];

const inputClassName =
  "w-full rounded-[10px] border border-line bg-[rgba(255,255,255,0.03)] px-4 py-3 text-sm text-text outline-none transition placeholder:text-muted/60 focus:border-accent/45 focus:ring-2 focus:ring-accent/20";

export function InvestorPdfsWorkspace({
  defaultTicker,
  onRun,
  status,
  statusError,
  statusLoading,
  syncError,
  syncResult,
  syncing,
}: InvestorPdfsWorkspaceProps) {
  const [lookupMode, setLookupMode] = useState<StockIntelLookupMode>("ticker");
  const [tickerValue, setTickerValue] = useState(defaultTicker);
  const [companyNameValue, setCompanyNameValue] = useState("");
  const [cikValue, setCikValue] = useState("");
  const [windowMode, setWindowMode] = useState<WindowMode>("rolling");
  const [lookbackYears, setLookbackYears] = useState("5");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [includeSecExhibits, setIncludeSecExhibits] = useState(true);
  const [resume, setResume] = useState(true);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [seedUrl, setSeedUrl] = useState("");
  const [stockFolderTemplate, setStockFolderTemplate] = useState("");

  useEffect(() => {
    if (stockFolderTemplate || !status?.stocksRootPath) {
      return;
    }
    setStockFolderTemplate(`${status.stocksRootPath}/[ticker]`);
  }, [stockFolderTemplate, status?.stocksRootPath]);

  const normalizedTicker = tickerValue.trim().toUpperCase();
  const normalizedCompanyName = companyNameValue.trim();
  const normalizedCik = cikValue.trim();
  const identifierValue =
    lookupMode === "ticker" ? normalizedTicker : lookupMode === "companyName" ? normalizedCompanyName : normalizedCik;
  const lookbackYearsText = lookbackYears.trim();
  const parsedLookbackYears = Number.parseInt(lookbackYearsText, 10);
  const lookbackYearsValid =
    lookbackYearsText.length === 0 || (/^\d+$/.test(lookbackYearsText) && parsedLookbackYears >= 1 && parsedLookbackYears <= 50);
  const effectiveLookbackYears = lookbackYearsValid && lookbackYearsText.length > 0 ? parsedLookbackYears : 5;
  const lookbackYearsError =
    lookbackYearsText.length > 0 && !lookbackYearsValid ? "Years back must be a whole number between 1 and 50." : null;
  const defaultStockTemplate = status?.stocksRootPath ? `${status.stocksRootPath}/[ticker]` : "[research-root]/stocks/[ticker]";
  const effectiveStockTemplate = stockFolderTemplate.trim() || defaultStockTemplate;
  const stockTemplateValid = isStockFolderTemplate(effectiveStockTemplate);
  const derivedOutputDir = deriveOutputRootFromStockTemplate(effectiveStockTemplate, status?.researchRootPath);
  const effectiveStartDate = windowMode === "exact" ? startDate : "";
  const effectiveEndDate = endDate;
  const dateRangeValid = !(effectiveStartDate && effectiveEndDate) || effectiveStartDate <= effectiveEndDate;
  const dateRangeError = dateRangeValid ? null : "Start date must be on or before end date.";
  const normalizedSeedUrl = seedUrl.trim();
  const seedUrlValid = !normalizedSeedUrl || /^https?:\/\/\S+$/i.test(normalizedSeedUrl);
  const seedUrlError = seedUrlValid ? null : "Start URL must begin with http:// or https://.";
  const formValidationError = (windowMode === "rolling" ? lookbackYearsError : dateRangeError) ?? seedUrlError;

  const request = buildInvestorPdfDownloadRequest({
    cik: normalizedCik,
    companyName: normalizedCompanyName,
    endDate: effectiveEndDate || undefined,
    includeAnnualReports: true,
    includeCompanyReports: true,
    includeEarningsDecks: false,
    includeInvestorPresentations: false,
    includeSecExhibits,
    forceRefresh,
    lookbackYears: effectiveLookbackYears,
    lookupMode,
    outputDir: derivedOutputDir,
    resume,
    seedUrl: normalizedSeedUrl || undefined,
    startDate: effectiveStartDate || undefined,
    ticker: normalizedTicker,
  });

  const lastSyncQuery = useQuery({
    queryKey: queryKeys.sources.investorPdfLastSync(request),
    queryFn: () => sourceApi.investorPdfLastSync(request),
    enabled: Boolean(status?.available) && Boolean(identifierValue) && !normalizedSeedUrl && !syncing && stockTemplateValid && !formValidationError,
    staleTime: 30_000,
    retry: false,
  });

  const scopedSyncResult = matchesInvestorPdfIssuer(syncResult, {
    cik: normalizedCik,
    companyName: normalizedCompanyName,
    lookupMode,
    ticker: normalizedTicker,
  })
    ? syncResult
    : undefined;
  const activeSyncResult = scopedSyncResult ?? lastSyncQuery.data ?? undefined;

  const canRun = Boolean(status?.available) && Boolean(identifierValue) && !syncing && stockTemplateValid && !formValidationError;
  const resolvedTicker = normalizedTicker || activeSyncResult?.ticker || "[resolved-ticker]";
  const predictedStockRoot = materializeStockFolder(effectiveStockTemplate, resolvedTicker);
  const predictedPdfsPath = `${predictedStockRoot}/pdfs`;
  const predictedWorkspacePath = `${predictedStockRoot}/.investor-pdfs`;

  function handleRun() {
    if (!canRun) {
      return;
    }
    onRun(request);
  }

  const header = (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <div className={workspaceEyebrowClassName}>Stocks</div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className={workspaceTitleClassName}>Company PDFs</h1>
          <div className="inline-flex items-center rounded-full border border-line bg-panelSoft px-4 py-1 text-sm font-medium text-text">
            {status?.available ? "Ready" : statusLoading ? "Checking" : "Needs config"}
          </div>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Pull public investor PDFs into the visible stock folder. This finds annual reports, company reports, and SEC PDF exhibits; it does not generate PDFs.
        </p>
      </div>
      <div className="flex flex-col items-start gap-3 lg:items-end">
        <button
          className="rounded-full border border-accent/35 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:border-accent/50 hover:text-white disabled:cursor-default disabled:opacity-45"
          disabled={!canRun}
          onClick={handleRun}
          type="button"
        >
          {syncing ? "Finding PDFs..." : "Run PDF sync"}
        </button>
      </div>
    </div>
  );

  return (
    <WorkspaceFrame header={header}>
          <div className="grid items-start gap-8 xl:grid-cols-[1.08fr,0.92fr]">
            <div className="grid gap-7">
              <section className="border-b border-line/70 pb-6">
                <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Issuer</div>
                <div className="mt-3 flex gap-6 border-b border-line/70">
                  {stockIntelLookupOptions.map((option) => {
                    const selected = option.value === lookupMode;
                    return (
                      <button
                        key={option.value}
                        className={`border-b-2 pb-3 text-sm font-medium transition ${
                          selected ? "border-accent text-text" : "border-transparent text-muted hover:text-text"
                        }`}
                        onClick={() => setLookupMode(option.value)}
                        type="button"
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4">
                  <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-muted">
                    {lookupMode === "ticker" ? "Ticker" : lookupMode === "companyName" ? "Company" : "CIK"}
                  </div>
                  {lookupMode === "ticker" ? (
                    <input
                      className={inputClassName}
                      onChange={(event) => setTickerValue(event.target.value)}
                      placeholder="MSFT"
                      type="text"
                      value={tickerValue}
                    />
                  ) : null}
                  {lookupMode === "companyName" ? (
                    <input
                      className={inputClassName}
                      onChange={(event) => setCompanyNameValue(event.target.value)}
                      placeholder="Microsoft Corporation"
                      type="text"
                      value={companyNameValue}
                    />
                  ) : null}
                  {lookupMode === "cik" ? (
                    <input
                      className={inputClassName}
                      onChange={(event) => setCikValue(event.target.value)}
                      placeholder="0000789019"
                      type="text"
                      value={cikValue}
                    />
                  ) : null}
                </div>
              </section>

              <section className="border-b border-line/70 pb-6">
                <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-muted">Start URL</div>
                <input
                  className={inputClassName}
                  onChange={(event) => setSeedUrl(event.target.value)}
                  placeholder="https://investors.company.com/financials/quarterly-results"
                  spellCheck={false}
                  type="url"
                  value={seedUrl}
                />
                {seedUrlError ? <p className="mt-2 text-sm text-danger">{seedUrlError}</p> : null}
              </section>

              <section className="border-b border-line/70 pb-6">
                <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Window</div>
                <div className="mt-3 flex gap-6 border-b border-line/70">
                  {windowOptions.map((option) => {
                    const selected = option.value === windowMode;
                    return (
                      <button
                        key={option.value}
                        className={`border-b-2 pb-3 text-sm font-medium transition ${
                          selected ? "border-accent text-text" : "border-transparent text-muted hover:text-text"
                        }`}
                        onClick={() => setWindowMode(option.value)}
                        type="button"
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                {windowMode === "rolling" ? (
                  <div className="mt-4 grid gap-4 md:grid-cols-[180px,1fr]">
                    <div>
                      <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-muted">Years back</div>
                      <input
                        className={inputClassName}
                        inputMode="numeric"
                        onChange={(event) => setLookbackYears(event.target.value)}
                        type="text"
                        value={lookbackYears}
                      />
                    </div>
                    <div>
                      <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-muted">End date</div>
                      <input
                        className={inputClassName}
                        onChange={(event) => setEndDate(event.target.value)}
                        type="date"
                        value={endDate}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 grid gap-4 md:grid-cols-[1fr,1fr]">
                    <div>
                      <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-muted">Start date</div>
                      <input
                        className={inputClassName}
                        onChange={(event) => setStartDate(event.target.value)}
                        type="date"
                        value={startDate}
                      />
                    </div>
                    <div>
                      <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-muted">End date</div>
                      <input
                        className={inputClassName}
                        onChange={(event) => setEndDate(event.target.value)}
                        type="date"
                        value={endDate}
                      />
                    </div>
                  </div>
                )}
                <p className="mt-3 text-sm text-muted">
                  {windowMode === "rolling" ? (
                    <>
                      Leave <span className="mono text-text">End date</span> blank to count back from today. With the defaults, a run against{" "}
                      <span className="mono text-text">MSFT</span> means “previous {effectiveLookbackYears} years.”
                    </>
                  ) : (
                    <>Use exact dates when you want a fixed filing window. Leave one side blank only if you want an open-ended range.</>
                  )}
                </p>
                {formValidationError ? <p className="mt-2 text-sm text-danger">{formValidationError}</p> : null}
              </section>

              <section className="grid gap-5">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-muted">What saves</div>
                  <div className="mt-3 flex flex-wrap gap-5 text-sm text-text">
                    <label className="inline-flex items-center gap-3">
                      <input
                        checked={true}
                        className="h-4 w-4 rounded border-line bg-panelSoft text-accent"
                        readOnly
                        type="checkbox"
                      />
                      Annual reports
                    </label>
                    <label className="inline-flex items-center gap-3">
                      <input
                        checked={includeSecExhibits}
                        className="h-4 w-4 rounded border-line bg-panelSoft text-accent"
                        onChange={(event) => setIncludeSecExhibits(event.target.checked)}
                        type="checkbox"
                      />
                      SEC PDF exhibits
                    </label>
                    <label className="inline-flex items-center gap-3">
                      <input
                        checked={resume}
                        className="h-4 w-4 rounded border-line bg-panelSoft text-accent"
                        onChange={(event) => setResume(event.target.checked)}
                        type="checkbox"
                      />
                      Resume safely
                    </label>
                    <label className="inline-flex items-center gap-3">
                      <input
                        checked={forceRefresh}
                        className="h-4 w-4 rounded border-line bg-panelSoft text-accent"
                        onChange={(event) => setForceRefresh(event.target.checked)}
                        type="checkbox"
                      />
                      Force refresh
                    </label>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-muted">Stock folder</div>
                  <input
                    className={inputClassName}
                    onChange={(event) => setStockFolderTemplate(event.target.value)}
                    placeholder={defaultStockTemplate}
                    type="text"
                    value={stockFolderTemplate}
                  />
                  <p className="mt-3 text-sm text-muted">
                    Use <span className="mono text-text">[ticker]</span>. This run lands in{" "}
                    <span className="mono text-[#9cead8]">{activeSyncResult?.stockPath || predictedStockRoot}</span>.
                  </p>
                  {!stockTemplateValid ? (
                    <p className="mt-2 text-sm text-danger">
                      End the path with <span className="mono">/stocks/[ticker]</span> so the target stock folder is unambiguous.
                    </p>
                  ) : null}
                </div>
              </section>
            </div>

            <div className="grid gap-6 border-t border-line/70 pt-6 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
              <section className="grid gap-3">
                <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Target paths</div>
                <PathField label="Stock folder" value={activeSyncResult?.stockPath || predictedStockRoot} />
                <PathField label="Visible PDFs" value={activeSyncResult?.pdfsPath || predictedPdfsPath} />
                <PathField label="Hidden .investor-pdfs" value={activeSyncResult?.workspacePath || predictedWorkspacePath} />
              </section>

              <section className="grid gap-4 border-t border-line/70 pt-6">
                <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Latest run</div>
                {activeSyncResult ? (
                  <>
                    {activeSyncResult.matchedPdfs === 0 ? (
                      <div className="rounded-[12px] border border-line/80 bg-panelSoft px-4 py-3 text-sm text-muted">
                        No PDFs matched for <span className="text-text">{activeSyncResult.companyName}</span> in{" "}
                        <span className="text-text">{describeWindow(activeSyncResult)}</span>. Clear the dates or widen the window if you expected older documents.
                      </div>
                    ) : null}
                    {activeSyncResult.cacheHit ? (
                      <div className="rounded-[12px] border border-line/80 bg-panelSoft px-4 py-3 text-sm text-muted">
                        Cached discovery served this result
                        {activeSyncResult.cacheExpiresAt ? (
                          <>
                            {" "}
                            until <span className="text-text">{formatDateTime(activeSyncResult.cacheExpiresAt)}</span>
                          </>
                        ) : null}
                        .
                      </div>
                    ) : null}
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Stat label="Matched PDFs" value={String(activeSyncResult.matchedPdfs)} />
                      <Stat label="Downloaded" value={String(activeSyncResult.downloadedFiles)} />
                      <Stat label="Skipped" value={String(activeSyncResult.skippedFiles)} />
                    </div>
                    <div className="grid gap-3">
                      {activeSyncResult.artifacts.slice(0, 10).map((artifact) => (
                        <div key={`${artifact.sourceUrl}-${artifact.savedPath ?? "unsaved"}`} className="border-t border-line/70 pt-3 first:border-t-0 first:pt-0">
                          <div className="text-sm font-medium text-text">{artifact.title}</div>
                          <div className="mt-1 flex flex-wrap gap-3 text-xs uppercase tracking-[0.16em] text-muted">
                            <span>{artifact.category}</span>
                            <span>{artifact.host}</span>
                            {artifact.publishedAt ? <span>{artifact.publishedAt}</span> : null}
                          </div>
                          {artifact.savedPath ? <div className="mono mt-2 break-all text-xs text-[#9cead8]">{artifact.savedPath}</div> : null}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted">Run a PDF sync to populate the visible stock folder.</div>
                )}
              </section>

              {statusError ? <div className="text-sm text-danger">{statusError}</div> : null}
              {syncError ? <div className="text-sm text-danger">{syncError}</div> : null}
              {!formValidationError && lastSyncQuery.error instanceof Error ? (
                <div className="text-sm text-danger">{lastSyncQuery.error.message}</div>
              ) : null}
            </div>
          </div>
    </WorkspaceFrame>
  );
}

function describeWindow(result: InvestorPdfDownloadResponse) {
  if (result.startDate && result.endDate) {
    if (result.startDate === result.endDate) {
      return `the one-day window on ${result.startDate}`;
    }
    return `${result.startDate} through ${result.endDate}`;
  }
  if (result.startDate) {
    return `the window starting ${result.startDate}`;
  }
  if (result.endDate) {
    return `the window ending ${result.endDate}`;
  }
  return `the previous ${result.lookbackYears} years`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function PathField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-muted">{label}</div>
      <div className="mono break-all text-sm text-[#9cead8]">{value}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-line/80 bg-panelSoft px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.2em] text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-text">{value}</div>
    </div>
  );
}
