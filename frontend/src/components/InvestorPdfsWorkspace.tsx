import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "../lib/api";
import type { InvestorPdfDownloadRequest, InvestorPdfDownloadResponse, InvestorPdfSourceStatus } from "../lib/types";

type LookupMode = "ticker" | "companyName" | "cik";

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

const lookupOptions: Array<{ label: string; value: LookupMode }> = [
  { value: "ticker", label: "Ticker" },
  { value: "companyName", label: "Company" },
  { value: "cik", label: "CIK" },
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
  const [lookupMode, setLookupMode] = useState<LookupMode>("ticker");
  const [tickerValue, setTickerValue] = useState(defaultTicker);
  const [companyNameValue, setCompanyNameValue] = useState("");
  const [cikValue, setCikValue] = useState("");
  const [lookbackYears, setLookbackYears] = useState("5");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [includeSecExhibits, setIncludeSecExhibits] = useState(true);
  const [resume, setResume] = useState(true);
  const [outputDir, setOutputDir] = useState("");

  useEffect(() => {
    if (outputDir || !status?.researchRootPath) {
      return;
    }
    setOutputDir(status.researchRootPath);
  }, [outputDir, status?.researchRootPath]);

  const normalizedTicker = tickerValue.trim().toUpperCase();
  const normalizedCompanyName = companyNameValue.trim();
  const normalizedCik = cikValue.trim();
  const identifierValue =
    lookupMode === "ticker" ? normalizedTicker : lookupMode === "companyName" ? normalizedCompanyName : normalizedCik;
  const parsedLookbackYears = Math.max(1, Number.parseInt(lookbackYears, 10) || 5);

  const request: InvestorPdfDownloadRequest = {
    ticker: lookupMode === "ticker" ? normalizedTicker : undefined,
    companyName: lookupMode === "companyName" ? normalizedCompanyName : undefined,
    cik: lookupMode === "cik" ? normalizedCik : undefined,
    lookbackYears: parsedLookbackYears,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    outputDir: outputDir.trim() || undefined,
    includeAnnualReports: true,
    includeCompanyReports: true,
    includeEarningsDecks: false,
    includeInvestorPresentations: false,
    includeSecExhibits,
    resume,
  };

  const lastSyncQuery = useQuery({
    queryKey: ["investor-pdfs-last-sync", request],
    queryFn: () => api.investorPdfLastSync(request),
    enabled: Boolean(status?.available) && Boolean(identifierValue) && !syncing,
    staleTime: 30_000,
    retry: false,
  });

  const scopedSyncResult = matchesCurrentIssuer(syncResult, {
    cik: normalizedCik,
    companyName: normalizedCompanyName,
    lookupMode,
    ticker: normalizedTicker,
  })
    ? syncResult
    : undefined;
  const activeSyncResult = scopedSyncResult ?? lastSyncQuery.data ?? undefined;

  const canRun = Boolean(status?.available) && Boolean(identifierValue) && !syncing;
  const effectiveOutputRoot = outputDir.trim() || status?.researchRootPath || "[research-root]";
  const resolvedTicker = normalizedTicker || activeSyncResult?.ticker || "[resolved-ticker]";
  const predictedStockRoot = `${effectiveOutputRoot}/stocks/${resolvedTicker}`;
  const predictedPdfsPath = `${predictedStockRoot}/pdfs`;
  const predictedWorkspacePath = `${predictedStockRoot}/.investor-pdfs`;

  function handleRun() {
    if (!canRun) {
      return;
    }
    onRun(request);
  }

  return (
    <div className="chrome-header-frame">
      <div className="account-workspace panel overflow-hidden rounded-[16px]">
        <header className="border-b border-line/70 px-10 py-7 lg:px-12">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="mb-2 text-[11px] uppercase tracking-[0.32em] text-accent">Company PDFs</div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-tight text-text">Investor PDFs</h1>
                <div className="inline-flex items-center rounded-full border border-line bg-panelSoft px-4 py-1 text-sm font-medium text-text">
                  {status?.available ? "Ready" : statusLoading ? "Checking" : "Needs config"}
                </div>
              </div>
              <p className="mt-2 max-w-3xl text-sm text-muted">
                Pull real PDFs into the visible stock folder. This workspace currently harvests annual reports plus any SEC PDF exhibits it finds in the time window. It does not generate PDFs.
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
        </header>

        <section className="px-10 py-8 lg:px-12">
          <div className="grid items-start gap-8 xl:grid-cols-[1.08fr,0.92fr]">
            <div className="grid gap-7">
              <section className="border-b border-line/70 pb-6">
                <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Issuer</div>
                <div className="mt-3 flex gap-6 border-b border-line/70">
                  {lookupOptions.map((option) => {
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
                <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Window</div>
                <div className="mt-3 grid gap-4 md:grid-cols-[180px,1fr,1fr]">
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
                <p className="mt-3 text-sm text-muted">
                  Leave the dates blank to use a rolling lookback window. With the defaults, a run against <span className="mono text-text">MSFT</span> means “previous {parsedLookbackYears} years.”
                </p>
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
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-muted">Research root</div>
                  <input
                    className={inputClassName}
                    onChange={(event) => setOutputDir(event.target.value)}
                    placeholder={status?.researchRootPath ?? "/path/to/research"}
                    type="text"
                    value={outputDir}
                  />
                </div>
              </section>
            </div>

            <div className="grid gap-6 border-t border-line/70 pt-6 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
              <section className="grid gap-3">
                <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Target paths</div>
                <PathField label="Visible PDFs" value={activeSyncResult?.pdfsPath || predictedPdfsPath} />
                <PathField label="Hidden workspace" value={activeSyncResult?.workspacePath || predictedWorkspacePath} />
              </section>

              <section className="grid gap-4 border-t border-line/70 pt-6">
                <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Latest run</div>
                {activeSyncResult ? (
                  <>
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
              {lastSyncQuery.error instanceof Error ? <div className="text-sm text-danger">{lastSyncQuery.error.message}</div> : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function matchesCurrentIssuer(
  response: InvestorPdfDownloadResponse | undefined,
  current: { cik: string; companyName: string; lookupMode: LookupMode; ticker: string },
) {
  if (!response) {
    return false;
  }
  if (current.lookupMode === "ticker") {
    return response.ticker === current.ticker;
  }
  if (current.lookupMode === "companyName") {
    return response.companyName.toLowerCase() === current.companyName.toLowerCase();
  }
  return response.cik === current.cik;
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
