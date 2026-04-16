import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "../lib/api";
import type { EdgarDownloadRequest, EdgarDownloadResponse, EdgarSourceStatus } from "../lib/types";

type EdgarLookupMode = "ticker" | "companyName" | "cik";
type EdgarDownloadMode = NonNullable<EdgarDownloadRequest["downloadMode"]>;
type EdgarPdfLayout = NonNullable<EdgarDownloadRequest["pdfLayout"]>;

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

const DEFAULT_PDF_FOLDER_FORMAT = "pdfs/[date]_[filing-type]_[sequence]";
const PDF_FORMAT_TOKENS = [
  { token: "[date]", sample: "2026-01-28", meaning: "filing date" },
  { token: "[filing-type]", sample: "10-Q", meaning: "SEC form type" },
  { token: "[sequence]", sample: "000119312526027207", meaning: "stable filing accession id" },
  { token: "[accession]", sample: "000119312526027207", meaning: "same value as sequence" },
  { token: "[ticker]", sample: "MSFT", meaning: "resolved ticker" },
  { token: "[filename]", sample: "primary-document", meaning: "source file stem" },
  { token: "[filing]", sample: "2026-01-28_10-Q_000119312526027207", meaning: "whole filing folder name" },
] as const;

const lookupOptions: Array<{ label: string; value: EdgarLookupMode }> = [
  { value: "ticker", label: "Ticker" },
  { value: "companyName", label: "Company" },
  { value: "cik", label: "CIK" },
];

const modeOptions: Array<{ label: string; summary: string; value: EdgarDownloadMode }> = [
  {
    value: "all-attachments",
    label: "All filing files + readable PDFs",
    summary: "Every filing file is saved. HTML or TXT filing files are also rendered into readable PDFs.",
  },
  {
    value: "full-filing-bundle",
    label: "All filing files + SEC internals + readable PDFs",
    summary: "Every filing file is saved, SEC index artifacts are included, and HTML or TXT filing files are rendered into readable PDFs.",
  },
  {
    value: "primary-document",
    label: "Primary filing file + readable PDF",
    summary: "One main filing file is saved for each match. HTML or TXT filings also get a readable PDF copy.",
  },
  {
    value: "metadata-only",
    label: "Metadata only",
    summary: "Only the SEC metadata exports are saved. No filing files or PDFs are created.",
  },
];

const pdfLayoutOptions: Array<{ description: string; label: string; value: EdgarPdfLayout }> = [
  {
    value: "both",
    label: "Both",
    description: "Keep readable PDFs beside the filing files and also mirror them into a PDF library.",
  },
  {
    value: "by-filing",
    label: "PDF library only",
    description: "Write readable PDFs only into your configured PDF library path.",
  },
  {
    value: "nested",
    label: "Beside filings only",
    description: "Keep readable PDFs only beside the original filing files.",
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
  const [showFormatHelp, setShowFormatHelp] = useState(false);
  const [formTypesInput, setFormTypesInput] = useState("8-K, 10-K, 10-Q");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [downloadMode, setDownloadMode] = useState<EdgarDownloadMode>("all-attachments");
  const [pdfLayout, setPdfLayout] = useState<EdgarPdfLayout>("both");
  const [pdfFolderFormat, setPdfFolderFormat] = useState(DEFAULT_PDF_FOLDER_FORMAT);
  const [pdfFolderFormatTouched, setPdfFolderFormatTouched] = useState(false);
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
    pdfFolderFormat,
    pdfLayout,
    resume,
    startDate,
    ticker: normalizedTicker,
  });

  const lastSyncQuery = useQuery({
    queryKey: ["edgar-last-sync", request],
    queryFn: () => api.edgarLastSync(request),
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

  useEffect(() => {
    if (pdfFolderFormatTouched || !activeSyncResult?.pdfFolderFormat) {
      return;
    }
    setPdfFolderFormat(activeSyncResult.pdfFolderFormat);
  }, [activeSyncResult?.pdfFolderFormat, pdfFolderFormatTouched]);

  const sameDayRange = Boolean(startDate) && Boolean(endDate) && startDate === endDate;
  const selectedMode = modeOptions.find((option) => option.value === downloadMode) ?? modeOptions[0];
  const selectedPdfLayout = pdfLayoutOptions.find((option) => option.value === pdfLayout) ?? pdfLayoutOptions[0];
  const canRun = Boolean(status?.available) && Boolean(identifierValue) && !syncing;
  const pdfControlsDisabled = downloadMode === "metadata-only";

  const effectiveOutputRoot = outputDir.trim() || status?.researchRootPath || "[research-root]";
  const resolvedTicker = normalizedTicker || activeSyncResult?.ticker || "[resolved-ticker]";
  const stockRoot = `${effectiveOutputRoot}/stocks/${resolvedTicker}`;
  const effectivePdfFolderFormat = pdfFolderFormat.trim() || DEFAULT_PDF_FOLDER_FORMAT;
  const predictedEdgarPath =
    lookupMode === "ticker" ? `${stockRoot}/.edgar` : activeSyncResult?.edgarPath || `${effectiveOutputRoot}/stocks/[resolved-ticker]/.edgar`;
  const predictedPdfsTemplate =
    pdfLayout === "nested" ? stockRoot : `${stockRoot}/${effectivePdfFolderFormat}`;
  const visiblePdfsPath = activeSyncResult?.pdfsPath || predictedPdfsTemplate;
  const formatterExamplePath = `${stockRoot}/${renderPdfFolderFormatExample(effectivePdfFolderFormat, resolvedTicker)}`;

  function appendPdfToken(token: string) {
    setPdfFolderFormat((current) => `${current}${token}`);
    setPdfFolderFormatTouched(true);
  }

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
              <div className="mb-2 text-[11px] uppercase tracking-[0.32em] text-accent">Filings tool</div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-tight text-text">Filings</h1>
                <div className="inline-flex items-center rounded-full border border-line bg-panelSoft px-4 py-1 text-sm font-medium text-text">
                  {status?.available ? "Ready" : statusLoading ? "Checking" : "Needs config"}
                </div>
              </div>
              <p className="mt-2 max-w-3xl text-sm text-muted">
                Search EDGAR by ticker, company, or CIK. Filing folders stay in the stock directory. Metadata and manifests stay hidden in <span className="mono text-text">.edgar</span>.
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
        </header>

        <section className="px-10 py-8 lg:px-12">
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

                <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
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
                  <label className="grid gap-2">
                    <span className="text-xs uppercase tracking-[0.18em] text-muted">PDF destination</span>
                    <select
                      className={inputClassName}
                      disabled={pdfControlsDisabled}
                      onChange={(event) => setPdfLayout(event.target.value as EdgarPdfLayout)}
                      value={pdfLayout}
                    >
                      {pdfLayoutOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="mt-4 text-sm leading-6 text-muted">
                  {selectedMode.summary} {selectedPdfLayout.description}
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
            <section className="relative border-b border-line/70 pb-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-muted">PDF formatter</div>
                  <h3 className="mt-1 text-base font-semibold text-text">Define where readable PDFs land.</h3>
                </div>
                <button
                  aria-expanded={showFormatHelp}
                  aria-label="PDF formatter help"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line bg-[rgba(255,255,255,0.02)] text-muted transition hover:border-accent/25 hover:text-text"
                  onClick={() => setShowFormatHelp((value) => !value)}
                  type="button"
                >
                  <InfoIcon />
                </button>
              </div>
              {showFormatHelp ? (
                <div className="absolute right-0 top-0 z-20 mt-10 w-[340px] rounded-[14px] border border-line bg-[#091214] px-4 py-4 text-sm text-muted shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
                  <div className="text-sm font-medium text-text">PDF formatter help</div>
                  <div className="mt-3 grid gap-2 leading-6">
                    {pdfControlsDisabled ? (
                      <div>Metadata-only mode does not create readable PDFs.</div>
                    ) : pdfLayout === "nested" ? (
                      <div>Beside filings only ignores the library format because PDFs stay next to the original filing files.</div>
                    ) : (
                      <>
                        <div>Click any token to append it to the format field.</div>
                        <div><span className="mono text-text">[sequence]</span> and <span className="mono text-text">[accession]</span> both use the filing accession id, so the folder name stays stable across reruns.</div>
                        <div>The example path updates live with your current ticker and format string.</div>
                      </>
                    )}
                  </div>
                </div>
              ) : null}
              <div className="mt-4 grid gap-3">
                <label className="grid gap-2">
                  <span className="text-xs uppercase tracking-[0.18em] text-muted">PDF folder format</span>
                  <input
                    className={inputClassName}
                    disabled={pdfControlsDisabled || pdfLayout === "nested"}
                    onChange={(event) => {
                      setPdfFolderFormat(event.target.value);
                      setPdfFolderFormatTouched(true);
                    }}
                    placeholder={DEFAULT_PDF_FOLDER_FORMAT}
                    type="text"
                    value={pdfFolderFormat}
                  />
                </label>
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-muted">Example path</div>
                  <div className="mono mt-2 break-all text-sm text-[#9cead8]">{formatterExamplePath}</div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {PDF_FORMAT_TOKENS.map((item) => (
                    <button
                      key={item.token}
                      className="flex items-start justify-between gap-4 rounded-[10px] border border-line px-3 py-3 text-left transition hover:border-accent/25"
                      disabled={pdfControlsDisabled || pdfLayout === "nested"}
                      onClick={() => appendPdfToken(item.token)}
                      type="button"
                    >
                      <span>
                        <span className="mono block text-sm text-text">{item.token}</span>
                        <span className="mt-1 block text-xs leading-5 text-muted">{item.meaning}</span>
                      </span>
                      <span className="mono text-xs text-[#9cead8]">{item.sample === "MSFT" ? resolvedTicker : item.sample}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>

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
                    <div>Readable PDFs land either beside the filing files, in the PDF library, or both, depending on your current PDF destination setting.</div>
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
                  detail={describePdfLayoutDetail(downloadMode, pdfLayout, effectivePdfFolderFormat)}
                  label="Readable PDFs"
                  value={visiblePdfsPath}
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

        <section className="border-t border-line/70 px-10 py-8 lg:px-12">
          <div className="mb-4">
            <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Saved state</div>
            <h2 className="mt-1 text-xl font-semibold text-text">Last Sync</h2>
          </div>
          {activeSyncResult ? (
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <StatItem hint="Issuer resolved and filings matched." label="Matched filings" value={String(activeSyncResult.matchedFilings)} />
                <StatItem hint="Fresh files saved during the run." label="Downloaded files" value={String(activeSyncResult.downloadedFiles)} />
                <StatItem hint="Readable PDFs generated from HTML or TXT filing files." label="PDFs generated" value={String(activeSyncResult.generatedPdfs)} />
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
                      PDF destination <span className="text-text">{formatPdfLayout(activeSyncResult.pdfLayout)}</span>
                    </div>
                    {activeSyncResult.pdfLayout !== "nested" && activeSyncResult.pdfFolderFormat ? (
                      <div>
                        PDF folder format <span className="mono text-text">{activeSyncResult.pdfFolderFormat}</span>
                      </div>
                    ) : null}
                    <div>
                      Failures <span className="text-text">{activeSyncResult.failedFiles}</span>
                    </div>
                  </div>
                </div>

                <div className="border-t border-line/70 pt-4 xl:border-t-0 xl:pl-8 xl:pt-0">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Saved to</div>
                  <div className="mt-4 grid gap-3 text-sm text-muted">
                    <PathField label="Stock folder" value={activeSyncResult.stockPath} />
                    <PathField label="Readable PDFs" value={activeSyncResult.pdfsPath} />
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
      </div>
    </div>
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
  pdfFolderFormat,
  pdfLayout,
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
  pdfFolderFormat: string;
  pdfLayout: EdgarPdfLayout;
  resume: boolean;
  startDate: string;
  ticker: string;
}): EdgarDownloadRequest {
  const request: EdgarDownloadRequest = {
    downloadMode,
    includeExhibits,
    pdfLayout,
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
  if (pdfFolderFormat.trim()) {
    request.pdfFolderFormat = pdfFolderFormat.trim();
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
    return "This saves every SEC filing file in each matched filing folder. If a filing file is HTML or TXT, the workspace also creates a readable PDF version for it.";
  }
  if (downloadMode === "full-filing-bundle") {
    return "This saves every SEC filing file plus the SEC index and submission artifacts. Readable PDFs are still generated only from HTML or TXT filing files.";
  }
  if (downloadMode === "primary-document") {
    return "This saves one primary filing file per match. If that file is HTML or TXT, the workspace also creates a readable PDF copy.";
  }
  return "This saves only matched metadata exports in .edgar. No filing files or PDFs are created.";
}

function formatPdfLayout(pdfLayout: EdgarPdfLayout) {
  if (pdfLayout === "both") {
    return "both";
  }
  if (pdfLayout === "by-filing") {
    return "pdf library only";
  }
  return "beside filings only";
}

function describePdfLayoutDetail(downloadMode: EdgarDownloadMode, pdfLayout: EdgarPdfLayout, pdfFolderFormat: string) {
  if (downloadMode === "metadata-only") {
    return "No readable PDFs are created in metadata-only mode.";
  }
  if (pdfLayout === "both") {
    return `Readable PDFs stay beside the filing files and are also mirrored into ${pdfFolderFormat}.`;
  }
  if (pdfLayout === "by-filing") {
    return `Readable PDFs are written only into ${pdfFolderFormat}.`;
  }
  return "Readable PDFs stay beside the original filing files only.";
}

function renderPdfFolderFormatExample(format: string, ticker: string) {
  const replacements: Record<string, string> = {
    "[date]": "2026-01-28",
    "[filing-type]": "10-Q",
    "[sequence]": "000119312526027207",
    "[accession]": "000119312526027207",
    "[ticker]": ticker || "MSFT",
    "[filename]": "primary-document",
    "[filing]": "2026-01-28_10-Q_000119312526027207",
  };

  return Object.entries(replacements).reduce((result, [token, value]) => result.split(token).join(value), format);
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
