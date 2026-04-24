import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { sourceApi } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import type { EdgarDownloadRequest, EdgarDownloadResponse, EdgarSourceStatus } from "../lib/types";
import {
  workspaceBodyClassName,
  workspaceDividedBodyClassName,
  workspaceEyebrowClassName,
  workspaceTitleClassName,
} from "./shell/WorkspaceStage";
import { WorkspaceFrame } from "./shell/WorkspaceFrame";

type EdgarLookupMode = "ticker" | "companyName" | "cik";
type EdgarDownloadMode = NonNullable<EdgarDownloadRequest["downloadMode"]>;

interface EdgarWorkspaceProps {
  defaultTicker: string;
  onRun: (request: EdgarDownloadRequest) => void;
  status?: EdgarSourceStatus;
  statusError: string | null;
  statusLoading: boolean;
  syncError: string | null;
  syncResult?: EdgarDownloadResponse;
  syncing: boolean;
}

const lookupOptions: Array<{ label: string; value: EdgarLookupMode }> = [
  { value: "ticker", label: "Ticker" },
  { value: "companyName", label: "Company" },
  { value: "cik", label: "CIK" },
];

const modeOptions: Array<{ label: string; summary: string; value: EdgarDownloadMode }> = [
  {
    value: "all-attachments",
    label: "All filing files",
    summary: "Every SEC filing file is saved exactly as EDGAR serves it.",
  },
  {
    value: "full-filing-bundle",
    label: "All filing files + SEC internals",
    summary: "Every filing file is saved, plus SEC index artifacts such as index JSON and HTML.",
  },
  {
    value: "primary-document",
    label: "Primary filing file",
    summary: "One primary EDGAR document is saved for each matched filing.",
  },
  {
    value: "metadata-only",
    label: "Metadata only",
    summary: "Only SEC metadata exports are saved. No filing documents are downloaded.",
  },
];

const inputClassName =
  "w-full rounded-[10px] border border-line bg-[rgba(255,255,255,0.03)] px-4 py-3 text-sm text-text outline-none transition placeholder:text-muted/60 focus:border-accent/45 focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-55";
const checkboxClassName =
  "h-4 w-4 rounded border-line bg-panelSoft text-accent focus:ring-accent/35 focus:ring-offset-0";

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
  const [lookupMode, setLookupMode] = useState<EdgarLookupMode>("ticker");
  const [tickerValue, setTickerValue] = useState(defaultTicker);
  const [companyNameValue, setCompanyNameValue] = useState("");
  const [cikValue, setCikValue] = useState("");
  const [showLookupHelp, setShowLookupHelp] = useState(false);
  const [showPreviewHelp, setShowPreviewHelp] = useState(false);
  const [formTypesInput, setFormTypesInput] = useState("8-K, 10-K, 10-Q");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [downloadMode, setDownloadMode] = useState<EdgarDownloadMode>("all-attachments");
  const [outputDir, setOutputDir] = useState("");
  const [includeExhibits, setIncludeExhibits] = useState(true);
  const [resume, setResume] = useState(true);

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
  const parsedForms = parseFormTypes(formTypesInput);

  const request = buildRequest({
    cik: normalizedCik,
    companyName: normalizedCompanyName,
    downloadMode,
    endDate,
    formTypes: parsedForms,
    includeExhibits,
    lookupMode,
    outputDir: outputDir.trim(),
    resume,
    startDate,
    ticker: normalizedTicker,
  });

  const lastSyncQuery = useQuery({
    queryKey: queryKeys.sources.edgarLastSync(request),
    queryFn: () => sourceApi.edgarLastSync(request),
    enabled: Boolean(status?.available) && Boolean(identifierValue) && !syncing && identifierValue.length >= (lookupMode === "companyName" ? 3 : 1),
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

  const sameDayRange = Boolean(startDate) && Boolean(endDate) && startDate === endDate;
  const selectedMode = modeOptions.find((option) => option.value === downloadMode) ?? modeOptions[0];
  const canRun = Boolean(status?.available) && Boolean(identifierValue) && !syncing;

  const effectiveOutputRoot = outputDir.trim() || status?.researchRootPath || "[research-root]";
  const resolvedTicker = normalizedTicker || activeSyncResult?.ticker || "[resolved-ticker]";
  const stockRoot = `${effectiveOutputRoot}/stocks/${resolvedTicker}`;
  const predictedEdgarPath =
    lookupMode === "ticker" ? `${stockRoot}/.edgar` : activeSyncResult?.edgarPath || `${effectiveOutputRoot}/stocks/[resolved-ticker]/.edgar`;

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
          <h1 className={workspaceTitleClassName}>SEC Source Files</h1>
          <div className="inline-flex items-center rounded-full border border-line bg-panelSoft px-4 py-1 text-sm font-medium text-text">
            {status?.available ? "Ready" : statusLoading ? "Checking" : "Needs config"}
          </div>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Search EDGAR by ticker, company, or CIK. This saves SEC source files exactly as published.
        </p>
      </div>
      <div className="flex flex-col items-start gap-3 lg:items-end">
        <button
          className="rounded-full border border-accent/35 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:border-accent/50 hover:text-white disabled:cursor-default disabled:opacity-45"
          disabled={!canRun}
          onClick={handleRun}
          type="button"
        >
          {syncing ? "Syncing filings..." : "Run sync"}
        </button>
        {!status?.available ? (
          <div className="max-w-md rounded-[20px] border border-caution/25 bg-caution/10 px-4 py-3 text-sm text-caution">
            Add a descriptive SEC <span className="mono">User-Agent</span> to enable downloads.
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <WorkspaceFrame bodyClassName={null} header={header}>
        <section className={workspaceBodyClassName}>
          <div className="mb-4">
            <div className="text-[11px] uppercase tracking-[0.22em] text-muted">SEC filings</div>
            <h2 className="mt-1 text-xl font-semibold text-text">Download Filings</h2>
          </div>
          <div className="grid items-start gap-6 xl:grid-cols-[1.18fr,0.82fr]">
            <div className="grid content-start gap-6 self-start">
              <section className="border-b border-line/70 pb-5">
                <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Issuer</div>
                <div className="mt-3 grid gap-3">
                  <div className="flex items-end justify-between gap-4">
                    <div className="flex gap-6 border-b border-line/70">
                      {lookupOptions.map((option) => {
                        const selected = option.value === lookupMode;
                        return (
                          <button
                            key={option.value}
                            className={`border-b-2 pb-3 text-sm font-medium transition ${
                              selected
                                ? "border-accent text-text"
                                : "border-transparent text-muted hover:text-text"
                            }`}
                            onClick={() => setLookupMode(option.value)}
                            type="button"
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="relative shrink-0 pb-2">
                      <button
                        aria-expanded={showLookupHelp}
                        aria-label="Issuer lookup help"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line bg-[rgba(255,255,255,0.02)] text-muted transition hover:border-accent/25 hover:text-text"
                        onClick={() => setShowLookupHelp((value) => !value)}
                        type="button"
                      >
                        <InfoIcon />
                      </button>
                      {showLookupHelp ? (
                        <div className="absolute right-0 top-full z-20 mt-3 w-[320px] rounded-[14px] border border-line bg-[#091214] px-4 py-4 text-sm text-muted shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
                          <div className="text-sm font-medium text-text">How issuer lookup works</div>
                          <div className="mt-3 grid gap-2 leading-6">
                            <div><span className="text-text">Ticker</span> is the fastest path when you already know the symbol.</div>
                            <div><span className="text-text">Company</span> asks the SEC issuer table to resolve the exact company name.</div>
                            <div><span className="text-text">CIK</span> uses the raw SEC filer identifier directly.</div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <label className="grid gap-2">
                    <span className="text-xs uppercase tracking-[0.18em] text-muted">
                      {lookupMode === "ticker" ? "Ticker" : lookupMode === "companyName" ? "Company name" : "CIK"}
                    </span>
                    <input
                      className={inputClassName}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (lookupMode === "ticker") {
                          setTickerValue(value);
                          return;
                        }
                        if (lookupMode === "companyName") {
                          setCompanyNameValue(value);
                          return;
                        }
                        setCikValue(value);
                      }}
                      placeholder={
                        lookupMode === "ticker" ? "NVDA" : lookupMode === "companyName" ? "NVIDIA CORP" : "0001045810"
                      }
                      type="text"
                      value={lookupMode === "ticker" ? tickerValue : lookupMode === "companyName" ? companyNameValue : cikValue}
                    />
                  </label>
                </div>
              </section>

              <section className="border-b border-line/70 pb-6">
                <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Filters</div>
                <div className="mt-1 text-base font-semibold text-text">Choose the filing window and saved files.</div>

                <div className="mt-4 grid gap-2">
                  <span className="text-xs uppercase tracking-[0.18em] text-muted">Date range</span>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2">
                      <span className="text-xs uppercase tracking-[0.16em] text-muted">Start</span>
                      <input className={inputClassName} onChange={(event) => setStartDate(event.target.value)} type="date" value={startDate} />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-xs uppercase tracking-[0.16em] text-muted">End</span>
                      <input className={inputClassName} onChange={(event) => setEndDate(event.target.value)} type="date" value={endDate} />
                    </label>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="rounded-[10px] border border-line px-3 py-1.5 text-xs font-medium text-muted transition hover:border-accent/30 hover:text-text"
                    onClick={() => {
                      setStartDate("2020-01-01");
                      setEndDate("");
                    }}
                    type="button"
                  >
                    Since 2020
                  </button>
                  <button
                    className="rounded-[10px] border border-line px-3 py-1.5 text-xs font-medium text-muted transition hover:border-accent/30 hover:text-text"
                    onClick={() => {
                      const now = new Date();
                      const end = now.toISOString().slice(0, 10);
                      const start = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()).toISOString().slice(0, 10);
                      setStartDate(start);
                      setEndDate(end);
                    }}
                    type="button"
                  >
                    Last 2 years
                  </button>
                  <button
                    className="rounded-[10px] border border-line px-3 py-1.5 text-xs font-medium text-muted transition hover:border-accent/30 hover:text-text"
                    onClick={() => {
                      setStartDate("");
                      setEndDate("");
                    }}
                    type="button"
                  >
                    All available
                  </button>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-xs uppercase tracking-[0.18em] text-muted">Form types</span>
                    <input
                      className={inputClassName}
                      onChange={(event) => setFormTypesInput(event.target.value)}
                      placeholder="8-K, 10-K, 10-Q"
                      type="text"
                      value={formTypesInput}
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-xs uppercase tracking-[0.18em] text-muted">Files to save</span>
                    <select
                      className={inputClassName}
                      onChange={(event) => setDownloadMode(event.target.value as EdgarDownloadMode)}
                      value={downloadMode}
                    >
                      {modeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="mt-4 text-sm leading-6 text-muted">
                  {selectedMode.summary} Company-site PDFs are collected by the Company PDFs sync below.
                </div>
                {sameDayRange ? (
                  <div className="mt-3 rounded-[14px] border border-caution/25 bg-caution/10 px-3 py-2 text-xs leading-5 text-caution">
                    Start date and end date are the same. That creates a one-day filing window and often returns nothing unless you know the exact filing date.
                  </div>
                ) : null}
              </section>

              <section>
                <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Output</div>
                <div className="mt-1 text-base font-semibold text-text">Pick where the stock folder lives and how reruns behave.</div>
                <div className="mt-4 grid gap-4">
                  <label className="grid gap-2">
                    <span className="text-xs uppercase tracking-[0.18em] text-muted">Research root</span>
                    <input
                      className={inputClassName}
                      onChange={(event) => setOutputDir(event.target.value)}
                      placeholder={status?.researchRootPath ?? "/path/to/research"}
                      type="text"
                      value={outputDir}
                    />
                  </label>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <label className="flex items-start gap-3 border-t border-line/70 pt-4">
                      <input
                        checked={includeExhibits}
                        className={checkboxClassName}
                        onChange={(event) => setIncludeExhibits(event.target.checked)}
                        type="checkbox"
                      />
                      <span>
                        <span className="block text-sm font-medium text-text">Include exhibits</span>
                        <span className="mt-1 block text-xs leading-5 text-muted">
                          Attachment-heavy modes keep exhibit files unless you turn them off here.
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-3 border-t border-line/70 pt-4">
                      <input
                        checked={resume}
                        className={checkboxClassName}
                        onChange={(event) => setResume(event.target.checked)}
                        type="checkbox"
                      />
                      <span>
                        <span className="block text-sm font-medium text-text">Checksum resume</span>
                        <span className="mt-1 block text-xs leading-5 text-muted">
                          Files are skipped only when the checksum still matches the saved manifest.
                        </span>
                      </span>
                    </label>
                  </div>
                </div>
              </section>
            </div>

          <div className="grid content-start gap-6 self-start border-t border-line/70 pt-6 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
            <section className="relative">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-muted">This run</div>
                  <h3 className="mt-1 text-base font-semibold text-text">Compact preview</h3>
                </div>
                <button
                  aria-expanded={showPreviewHelp}
                  aria-label="Run preview help"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line bg-[rgba(255,255,255,0.02)] text-muted transition hover:border-accent/25 hover:text-text"
                  onClick={() => setShowPreviewHelp((value) => !value)}
                  type="button"
                >
                  <InfoIcon />
                </button>
              </div>
              {showPreviewHelp ? (
                <div className="absolute right-0 top-0 z-20 mt-10 w-[340px] rounded-[14px] border border-line bg-[#091214] px-4 py-4 text-sm text-muted shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
                  <div className="text-sm font-medium text-text">Run preview help</div>
                  <div className="mt-3 grid gap-2 leading-6">
                    <div>Blank dates mean every available filing date is eligible.</div>
                    <div>The stock folder stays human-visible, while metadata and manifests stay under <span className="mono text-text">.edgar</span>.</div>
                    <div>Company-site PDFs are collected by the Company PDFs sync, using the same issuer context.</div>
                  </div>
                </div>
              ) : null}
              <div className="mt-4 divide-y divide-line/70">
                <InfoRow detail={describeDownloadMode(downloadMode)} label="Files" value={selectedMode.label} />
                <InfoRow
                  detail={startDate || endDate ? `Inclusive window ${startDate || "open"} to ${endDate || "open"}` : "Blank dates mean every available filing date."}
                  label="Date range"
                  value={startDate || endDate ? `${startDate || "open"} to ${endDate || "open"}` : "All available dates"}
                />
                <InfoRow
                  detail={parsedForms.length > 0 ? summarizeFilters(parsedForms, startDate, endDate) : "Leave this blank to let every SEC form through."}
                  label="Form types"
                  value={parsedForms.length > 0 ? parsedForms.join(", ") : "No form filter"}
                />
                <InfoRow
                  detail="Each filing gets its own visible folder directly in the stock directory."
                  label="Stock folder"
                  value={activeSyncResult?.stockPath || stockRoot}
                />
                <InfoRow
                  detail="Metadata exports, raw submissions, and manifests stay hidden here."
                  label=".edgar"
                  value={predictedEdgarPath}
                />
              </div>
            </section>
          </div>
          </div>
          {statusError ? <InlineMessage tone="danger" message={statusError} /> : null}
          {syncError ? <InlineMessage tone="danger" message={syncError} /> : null}
        </section>

        <section className={workspaceDividedBodyClassName}>
          <div className="mb-4">
            <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Saved state</div>
            <h2 className="mt-1 text-xl font-semibold text-text">Last Sync</h2>
          </div>
          {activeSyncResult ? (
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatItem hint="Issuer resolved and filings matched." label="Matched filings" value={String(activeSyncResult.matchedFilings)} />
                <StatItem hint="Fresh files saved during the run." label="Downloaded files" value={String(activeSyncResult.downloadedFiles)} />
                <StatItem hint="Checksum matches let these files skip download." label="Skipped files" value={String(activeSyncResult.skippedFiles)} />
                <StatItem hint="Metadata artifacts synced into .edgar." label="Metadata files" value={String(activeSyncResult.metadataFilesSynced)} />
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.08fr,0.92fr]">
                <div className="border-t border-line/70 pt-4 xl:border-t-0 xl:border-r xl:pr-8 xl:pt-0">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Company</div>
                  <div className="mt-2 text-xl font-semibold text-text">{activeSyncResult.companyName}</div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.16em] text-muted">
                    <span className="rounded-full border border-line px-3 py-1">{activeSyncResult.ticker}</span>
                    <span className="rounded-full border border-line px-3 py-1">CIK {activeSyncResult.cik}</span>
                    <span className="rounded-full border border-line px-3 py-1">{formatMode(activeSyncResult.downloadMode)}</span>
                  </div>
                  <div className="mt-4 grid gap-2 text-sm text-muted">
                    <div>
                      Synced at <span className="text-text">{formatTimestamp(activeSyncResult.syncedAt)}</span>
                    </div>
                    <div>
                      Resume <span className="text-text">{activeSyncResult.resume ? "enabled" : "disabled"}</span>
                    </div>
                    <div>
                      Include exhibits <span className="text-text">{activeSyncResult.includeExhibits ? "yes" : "no"}</span>
                    </div>
                    <div>
                      Failures <span className="text-text">{activeSyncResult.failedFiles}</span>
                    </div>
                  </div>
                </div>

                <div className="border-t border-line/70 pt-4 xl:border-t-0 xl:pl-8 xl:pt-0">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Saved to</div>
                  <div className="mt-4 grid gap-3 text-sm text-muted">
                    <PathField label="Stock folder" value={activeSyncResult.stockPath} />
                    <PathField label=".edgar" value={activeSyncResult.edgarPath} />
                    <PathField label="Matched JSON" value={activeSyncResult.exportsJsonPath} />
                    <PathField label="Matched CSV" value={activeSyncResult.exportsCsvPath} />
                    <PathField label="Manifest" value={activeSyncResult.manifestPath} />
                  </div>
                </div>
              </div>
            </div>
          ) : lastSyncQuery.isLoading ? (
            <div className="px-2 py-8 text-center">
              <div className="text-lg font-semibold text-text">Looking for a saved sync…</div>
            </div>
          ) : (
            <div className="px-2 py-10 text-center">
              <div className="mx-auto mb-5 inline-flex h-14 w-14 items-center justify-center rounded-[18px] bg-accent/10 text-accent">
                <WorkspaceIcon />
              </div>
              <div className="text-xl font-semibold text-text">No saved sync for this issuer yet.</div>
              <p className="mx-auto mt-3 max-w-2xl text-sm text-muted">
                Run the downloader once and this panel will show the saved paths, file counts, and rerun behavior for the selected stock.
              </p>
              <div className="mt-6 text-xs uppercase tracking-[0.18em] text-muted">
                Next stock folder: {syncing ? "sync in progress..." : stockRoot}
              </div>
            </div>
          )}
        </section>
    </WorkspaceFrame>
  );
}

function InlineMessage({ message, tone }: { message: string; tone: "danger" | "neutral" }) {
  return (
    <div
      className={`mt-5 rounded-[20px] border px-4 py-3 text-sm ${
        tone === "danger" ? "border-danger/25 bg-danger/10 text-danger" : "border-line bg-panelSoft text-muted"
      }`}
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

function InfoRow({
  detail,
  label,
  showDetail = false,
  value,
}: {
  detail: string;
  label: string;
  showDetail?: boolean;
  value: string;
}) {
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="text-xs uppercase tracking-[0.16em] text-muted">{label}</div>
      <div className="mt-2 break-words text-sm font-medium leading-6 text-text">{value}</div>
      {showDetail ? <div className="mt-2 break-words text-sm leading-6 text-muted">{detail}</div> : null}
    </div>
  );
}

function WorkspaceIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M6.5 3.75h4.8l2.7 2.7v9.8H6.5z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M11.3 3.75v2.9h2.7" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M8.3 10h4.8M8.3 12.8h4.1" opacity="0.55" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </svg>
  );
}

function InfoIcon() {
  return <span aria-hidden="true" className="text-[12px] font-semibold leading-none">i</span>;
}

function parseFormTypes(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]+/)
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

function buildRequest({
  cik,
  companyName,
  downloadMode,
  endDate,
  formTypes,
  includeExhibits,
  lookupMode,
  outputDir,
  resume,
  startDate,
  ticker,
}: {
  cik: string;
  companyName: string;
  downloadMode: EdgarDownloadMode;
  endDate: string;
  formTypes: string[];
  includeExhibits: boolean;
  lookupMode: EdgarLookupMode;
  outputDir: string;
  resume: boolean;
  startDate: string;
  ticker: string;
}): EdgarDownloadRequest {
  const request: EdgarDownloadRequest = {
    downloadMode,
    includeExhibits,
    resume,
  };

  if (lookupMode === "ticker" && ticker) {
    request.ticker = ticker;
  }
  if (lookupMode === "companyName" && companyName) {
    request.companyName = companyName;
  }
  if (lookupMode === "cik" && cik) {
    request.cik = cik;
  }
  if (formTypes.length > 0) {
    request.formTypes = formTypes;
  }
  if (startDate) {
    request.startDate = startDate;
  }
  if (endDate) {
    request.endDate = endDate;
  }
  if (outputDir) {
    request.outputDir = outputDir;
  }
  return request;
}

function formatMode(mode: EdgarDownloadMode) {
  return mode.replace(/-/g, " ");
}

function summarizeFilters(formTypes: string[], startDate: string, endDate: string) {
  const details: string[] = [];
  if (formTypes.length > 0) {
    details.push(`forms ${formTypes.join(", ")}`);
  }
  if (startDate || endDate) {
    details.push(`window ${startDate || "open"} to ${endDate || "open"}`);
  }
  return details.length > 0 ? details.join(" · ") : "No form or date filtering.";
}

function describeDownloadMode(downloadMode: EdgarDownloadMode) {
  if (downloadMode === "all-attachments") {
    return "This saves every SEC filing file in each matched filing folder, preserving EDGAR's original file formats.";
  }
  if (downloadMode === "full-filing-bundle") {
    return "This saves every SEC filing file plus the SEC index and submission artifacts.";
  }
  if (downloadMode === "primary-document") {
    return "This saves one primary EDGAR document per matched filing.";
  }
  return "This saves only matched metadata exports in .edgar. No filing documents are downloaded.";
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function matchesCurrentIssuer(
  syncResult: EdgarDownloadResponse | undefined,
  issuer: { cik: string; companyName: string; lookupMode: EdgarLookupMode; ticker: string },
) {
  if (!syncResult) {
    return false;
  }
  if (issuer.lookupMode === "ticker") {
    return !issuer.ticker || syncResult.ticker === issuer.ticker;
  }
  if (issuer.lookupMode === "cik") {
    const normalizedSyncCik = syncResult.cik.replace(/^0+/, "");
    const normalizedInputCik = issuer.cik.replace(/^0+/, "");
    return !normalizedInputCik || normalizedSyncCik === normalizedInputCik;
  }
  if (!issuer.companyName) {
    return true;
  }
  return normalizeIssuerName(syncResult.companyName) === normalizeIssuerName(issuer.companyName);
}

function normalizeIssuerName(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function StatItem({ hint, label, value }: { hint: string; label: string; value: string }) {
  return (
    <div className="border-b border-line/70 pb-3 last:border-b-0 md:last:border-b md:last:pb-3 xl:border-b-0 xl:border-r xl:pr-4 xl:last:border-r-0 xl:last:pr-0">
      <div className="text-xs uppercase tracking-[0.16em] text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-text">{value}</div>
      <div className="mt-2 text-sm leading-6 text-muted">{hint}</div>
    </div>
  );
}
