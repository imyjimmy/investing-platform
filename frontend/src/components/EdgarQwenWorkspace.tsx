import { useState } from "react";

import { useEdgarIndex } from "../features/stock-intel/useEdgarIndex";
import { useEdgarIntelligenceStatus } from "../features/stock-intel/useEdgarIntelligenceStatus";
import { useStockIntelSession } from "../features/stock-intel/StockIntelSession";
import { sourceApi } from "../lib/api/sources";
import type {
  EdgarCitation,
  EdgarQuestionResponse,
  EdgarSourceStatus,
  EdgarSyncResponse,
  EdgarWorkspaceRequest,
} from "../lib/types";
import { workspaceTitleClassName } from "./shell/WorkspaceStage";
import { WorkspaceFrame } from "./shell/WorkspaceFrame";

type EdgarQwenWorkspaceProps = {
  defaultTicker: string;
  status?: EdgarSourceStatus;
  statusError: string | null;
  statusLoading: boolean;
  syncResult?: EdgarSyncResponse;
  syncing: boolean;
};

const inputClassName =
  "w-full rounded-[10px] border border-line bg-[rgba(255,255,255,0.03)] px-4 py-3 text-sm text-text outline-none transition placeholder:text-muted/60 focus:border-accent/45 focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-55";

export function EdgarQwenWorkspace({
  defaultTicker,
  status,
  statusError,
  statusLoading,
  syncResult,
  syncing,
}: EdgarQwenWorkspaceProps) {
  const { draft: savedDraft, setDraft, filingQuestion } = useStockIntelSession();
  const draft = savedDraft ?? { issuerQuery: defaultTicker, question: "", allowStale: false };
  const { issuerQuery, question, allowStale } = draft;

  const ticker = normalizeTickerCandidate(issuerQuery.trim());
  const matchedSync = syncResult?.resolvedTicker === ticker ? syncResult : undefined;
  const request = ticker ? { ticker, outputDir: matchedSync?.workspace.outputDir ?? undefined } : null;
  const { edgarIntelligenceStatus: health, edgarIntelligenceStatusQuery: healthQuery } =
    useEdgarIntelligenceStatus({ enabled: Boolean(status?.available), request });
  const { edgarIndexing, runEdgarIndex } = useEdgarIndex();
  const { edgarQuestionError, edgarQuestionResult, edgarQuestioning, submittedRequest, runEdgarQuestion } = filingQuestion;
  const showingSubmission = sameWorkspaceSelector(submittedRequest, request);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState(false);
  const busy = preparing || edgarIndexing || syncing || health?.job.status === "indexing" || health?.job.status === "queued";
  const modelOnline = health?.modelState.status === "ready";
  const needsFresh = health?.freshnessState.liveCheckStatus === "failed" && !allowStale;
  const ready = Boolean(status?.available && !statusError && !healthQuery.isError && modelOnline && health?.readyForAsk && !needsFresh && !busy);
  const checking = statusLoading || (request && healthQuery.isLoading);
  const state = busy ? "Preparing filings" : checking ? "Checking" : ready ? "Ready" : !request ? "Choose a ticker"
    : statusError || healthQuery.isError ? "Connection unavailable" : !status?.available ? "SEC access unavailable"
    : !modelOnline ? "Local AI offline" : needsFresh ? "SEC refresh needed" : "Prepare filings";
  const canAsk = ready && Boolean(question.trim()) && !edgarQuestioning;
  const answer = sameWorkspaceSelector(edgarQuestionResult, request) && !edgarQuestionError ? edgarQuestionResult : undefined;

  function changeTicker(value: string) {
    setDraft({ ...draft, issuerQuery: value, allowStale: false });
    setPrepareError(false);
  }

  async function prepare() {
    if (!request || busy) return;
    setPreparing(true);
    setPrepareError(false);
    try {
      await sourceApi.edgarSync({ issuerQuery: request.ticker, outputDir: request.outputDir });
      const result = await runEdgarIndex(request);
      setPrepareError(result.status === "failed");
    } catch {
      setPrepareError(true);
    } finally {
      await healthQuery.refetch();
      setPreparing(false);
    }
  }

  async function ask() {
    if (!request || !canAsk) return;
    try {
      await runEdgarQuestion({ ...request, question: question.trim(), allowStale });
    } catch {
      await healthQuery.refetch();
    }
  }

  return (
    <WorkspaceFrame header={<div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-4">
      <h1 className={workspaceTitleClassName}>Ask your filings</h1>
      <span role="status" data-testid="edgar-qwen-source-status" className={ready ? "text-sm text-accent" : "text-sm text-muted"}>{state}</span>
    </div>}>
      <section className="mx-auto grid w-full max-w-3xl gap-6" data-testid="edgar-qwen-workspace">
        <p className="text-sm text-muted">Ask about a company’s locally saved SEC filings. Each answer links to the evidence.</p>
        <label className="grid max-w-56 gap-2 text-sm font-medium">Company ticker
          <input className={inputClassName} data-testid="edgar-qwen-company-input" value={issuerQuery} onChange={e => changeTicker(e.target.value)} placeholder="e.g. NVDA" />
        </label>
        <label className="grid gap-2 text-sm font-medium">Question
          <textarea className={inputClassName} rows={3} data-testid="edgar-qwen-question-input" value={question}
            onChange={e => setDraft({ ...draft, question: e.target.value })} placeholder="Did the company raise its revenue guidance?" />
        </label>
        {health?.freshnessState.liveCheckStatus === "failed" && <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allowStale} onChange={e => setDraft({ ...draft, allowStale: e.target.checked })} /> Use saved filings while the SEC is unavailable
        </label>}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm text-muted" data-testid="edgar-qwen-status">
            {!checking && !busy && !ready && request && (modelOnline && status?.available && !healthQuery.isError
              ? <button className="text-accent underline" data-testid="edgar-qwen-index-button" onClick={() => void prepare()}>Refresh and prepare filings</button>
              : <button className="text-accent underline" onClick={() => void healthQuery.refetch()}>Check connection again</button>)}
            {busy && "Preparing your local filing library…"}
          </div>
          <button type="button" className="rounded-full bg-accent px-6 py-2.5 font-semibold text-[#061512] disabled:opacity-45"
            data-testid="edgar-qwen-ask-button" disabled={!canAsk} onClick={() => void ask()}>{edgarQuestioning ? "Asking…" : "Ask question"}</button>
        </div>
        {prepareError && <InlineMessage tone="danger" message="The filings could not be prepared. Check the SEC connection and retry." />}
        {showingSubmission && edgarQuestionError && <InlineMessage tone="danger" message={edgarQuestionError.includes("model_unavailable")
          ? "The local AI disconnected. Check the connection and retry." : "The question could not be completed. Refresh the filings and try again."} />}
        <AnswerPanel answer={answer} pending={showingSubmission && edgarQuestioning} />
      </section>
    </WorkspaceFrame>
  );
}

function AnswerPanel({ answer, pending }: { answer?: EdgarQuestionResponse; pending: boolean }) {
  if (pending) {
    return (
      <div className="rounded-[22px] border border-accent/25 bg-accent/10 px-5 py-5 text-sm leading-6 text-accent" data-testid="edgar-qwen-answer">
        Reading the filings and checking citations…
      </div>
    );
  }
  if (!answer) return null;
  return (
    <div className="grid gap-4 border-t border-line pt-5" data-testid="edgar-qwen-answer" aria-live="polite">
      <div>
        <h2 className="text-lg font-semibold">
          {answer.limitations.includes("Some parts of the question could not be verified.") ? "Partial answer" : "Answer"}
        </h2>
        <div className="mt-4 whitespace-pre-wrap text-base leading-7 text-text">
          <AnswerText value={answer.answer} />
        </div>
      </div>
      {answer.freshnessState.status !== "fresh" && <p className="text-sm text-caution">Based on previously saved filings.</p>}
      {answer.citations.length > 0 && <div className="grid gap-3" data-testid="edgar-qwen-citations">
        <h3 className="text-sm font-semibold">SEC sources</h3>
        {answer.citations.map(citation => <CitationCard citation={citation} key={citation.citationId} />)}
      </div>}
    </div>
  );
}

function AnswerText({ value }: { value: string }) {
  const parts = value.split(/(\[C\d+\])/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) =>
        /^\[C\d+\]$/.test(part) ? (
          <a className="mx-1 text-sm font-semibold text-accent underline" href={`#filing-source-${part.slice(1, -1)}`} aria-label={`Read source ${part.slice(1, -1)}`} key={`${part}-${index}`}>
            {part}
          </a>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </>
  );
}

function CitationCard({ citation }: { citation: EdgarCitation }) {
  if (citation.evidenceType === "xbrl_fact") {
    return <XbrlCitationCard citation={citation} />;
  }
  return <TextCitationCard citation={citation} />;
}

function TextCitationCard({ citation }: { citation: Extract<EdgarCitation, { evidenceType: "text" }> }) {
  const filingDate = citation.filingDate ? formatFilingDate(citation.filingDate) : "Unknown filing date";
  const sectionLabel =
    citation.section ??
    (citation.sectionTitle ? [citation.sectionCode, citation.sectionTitle].filter(Boolean).join(" ") : null);
  return (
    <article id={`filing-source-${citation.citationId}`} className="rounded-[18px] border border-line bg-panelSoft/55 px-4 py-4" data-testid={`edgar-qwen-citation-${citation.citationId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-accent/35 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">{citation.citationId}</span>
        <span className="text-sm font-medium text-text">
          {citation.form} · {filingDate}
        </span>
        {sectionLabel ? <span className="text-xs font-medium text-muted">{sectionLabel}</span> : null}
      </div>
      <p className="mt-3 text-sm leading-6 text-muted">{citation.snippet}</p>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
        {citation.secUrl ? (
          <a className="text-accent hover:text-white" href={citation.secUrl} rel="noreferrer" target="_blank">
            Open SEC source
          </a>
        ) : null}
      </div>
    </article>
  );
}

function XbrlCitationCard({ citation }: { citation: Extract<EdgarCitation, { evidenceType: "xbrl_fact" }> }) {
  const filingDate = citation.filingDate ? formatFilingDate(citation.filingDate) : "Unknown filing date";
  const factLabel = citation.xbrlLabel || citation.xbrlConcept;
  const periodLabel = [citation.fiscalPeriod, citation.fiscalYear, citation.xbrlPeriod].filter(Boolean).join(" · ");
  return (
    <article id={`filing-source-${citation.citationId}`} className="rounded-[18px] border border-line bg-panelSoft/55 px-4 py-4" data-testid={`edgar-qwen-citation-${citation.citationId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-accent/35 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">{citation.citationId}</span>
        <span className="text-sm font-medium text-text">
          {citation.form || "XBRL"} · {filingDate}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted">
        {factLabel}: {citation.xbrlValue}
        {citation.xbrlUnit ? ` ${citation.xbrlUnit}` : ""}
      </p>
      {periodLabel ? <div className="mt-2 text-xs text-muted">{periodLabel}</div> : null}
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
        {citation.secUrl ? (
          <a className="text-accent hover:text-white" href={citation.secUrl} rel="noreferrer" target="_blank">
            Open SEC source
          </a>
        ) : null}
      </div>
    </article>
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

function normalizeTickerCandidate(value: string) {
  if (!value || !/^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(value)) {
    return null;
  }
  return value.toUpperCase();
}

function sameWorkspaceSelector(result: { ticker: string; outputDir?: string | null } | undefined, request: EdgarWorkspaceRequest | null) {
  if (!result || !request) {
    return false;
  }
  return result.ticker === request.ticker && (result.outputDir ?? undefined) === (request.outputDir ?? undefined);
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatFilingDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
      new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    );
  }
  return formatTimestamp(value);
}
