import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useEdgarIndex } from "../features/stock-intel/useEdgarIndex";
import { useEdgarIntelligenceStatus } from "../features/stock-intel/useEdgarIntelligenceStatus";
import { useEdgarQuestion } from "../features/stock-intel/useEdgarQuestion";
import { sourceApi } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import type {
  EdgarIntelligenceStatus,
  EdgarQuestionCitation,
  EdgarQuestionResponse,
  EdgarSourceStatus,
  EdgarSyncResponse,
  EdgarWorkspaceRequest,
} from "../lib/types";
import {
  workspaceBodyClassName,
  workspaceEyebrowClassName,
  workspaceTitleClassName,
} from "./shell/WorkspaceStage";
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
  const [issuerQuery, setIssuerQuery] = useState(defaultTicker);
  const [question, setQuestion] = useState("");
  const [allowStale, setAllowStale] = useState(false);

  useEffect(() => {
    if (!issuerQuery.trim() && defaultTicker) {
      setIssuerQuery(defaultTicker);
    }
  }, [defaultTicker, issuerQuery]);

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

  const activeWorkspace = workspaceQuery.data ?? undefined;
  const selectedWorkspaceRequest: EdgarWorkspaceRequest | null =
    activeWorkspace?.workspace.ticker
      ? { ticker: activeWorkspace.workspace.ticker, outputDir: activeWorkspace.workspace.outputDir ?? undefined }
      : syncResult?.workspace.ticker
        ? { ticker: syncResult.workspace.ticker, outputDir: syncResult.workspace.outputDir ?? undefined }
        : null;
  const intelligenceRequest = selectedWorkspaceRequest ?? workspaceRequest;
  const intelligenceState = activeWorkspace?.intelligenceState ?? syncResult?.intelligenceState;
  const effectiveTicker = activeWorkspace?.ticker ?? syncResult?.resolvedTicker ?? likelyTicker ?? defaultTicker.trim().toUpperCase();
  const effectiveCompany = activeWorkspace?.companyName ?? syncResult?.resolvedCompanyName ?? normalizedQuery ?? "No company selected";
  const workspaceError = workspaceQuery.error instanceof Error ? workspaceQuery.error.message : null;

  const {
    edgarIntelligenceStatus: intelligenceStatus,
    edgarIntelligenceStatusError: intelligenceStatusError,
    edgarIntelligenceStatusQuery: intelligenceStatusQuery,
  } = useEdgarIntelligenceStatus({
    enabled: Boolean(status?.available) && !syncing,
    jobId: intelligenceState?.jobId,
    request: intelligenceRequest,
  });
  const { edgarIndexError, edgarIndexResult, edgarIndexing, runEdgarIndex } = useEdgarIndex();
  const { edgarQuestionError, edgarQuestionResult, edgarQuestioning, runEdgarQuestion } = useEdgarQuestion();
  const activeIndexResult = sameWorkspaceSelector(edgarIndexResult, selectedWorkspaceRequest) ? edgarIndexResult : undefined;
  const activeQuestionResult = sameWorkspaceSelector(edgarQuestionResult, intelligenceRequest) ? edgarQuestionResult : undefined;
  const canAskQwen = Boolean(intelligenceRequest) && Boolean(question.trim()) && !edgarQuestioning;
  const canBuildIndex = Boolean(selectedWorkspaceRequest) && !edgarIndexing;

  async function handleBuildIndex() {
    if (!selectedWorkspaceRequest || edgarIndexing) {
      return;
    }
    try {
      await runEdgarIndex({
        ...selectedWorkspaceRequest,
        rebuild: false,
        includeExhibits: false,
      });
    } catch {
      // Displayed by useEdgarIndex.
    }
  }

  async function handleAskQwen() {
    const trimmedQuestion = question.trim();
    if (!intelligenceRequest || !trimmedQuestion || edgarQuestioning) {
      return;
    }
    try {
      await runEdgarQuestion({
        ...intelligenceRequest,
        question: trimmedQuestion,
        allowStale,
      });
    } catch {
      // Displayed by useEdgarQuestion.
    }
  }

  const header = (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between" data-testid="edgar-qwen-workspace-header">
      <div>
        <div className={workspaceEyebrowClassName}>Stocks</div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className={workspaceTitleClassName}>Qwen Intelligence</h1>
          <div className="inline-flex items-center rounded-full border border-line bg-panelSoft px-4 py-1 text-sm font-medium text-text" data-testid="edgar-qwen-source-status">
            {status?.available ? "Ready" : statusLoading ? "Checking" : "Needs config"}
          </div>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Ask local Qwen grounded questions against the ticker’s SEC filing library, with retrieval, citations, and evidence validation handled by the backend.
        </p>
      </div>
    </div>
  );

  return (
    <WorkspaceFrame bodyClassName={null} header={header}>
      <section className={workspaceBodyClassName} data-testid="edgar-qwen-workspace">
        <div className="grid gap-6 xl:grid-cols-[0.92fr,1.08fr]">
          <section className="grid content-start gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Qwen Intelligence</div>
              <h2 className="mt-1 text-xl font-semibold text-text">Ask your SEC filing library</h2>
              <p className="mt-3 text-sm leading-6 text-muted">
                Qwen only sees retrieved filing excerpts. The backend builds the local index, retrieves evidence, validates citations, and refuses answers that are not grounded enough.
              </p>
            </div>

            <label className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.18em] text-muted">Company</span>
              <input
                className={inputClassName}
                data-testid="edgar-qwen-company-input"
                onChange={(event) => setIssuerQuery(event.target.value)}
                placeholder="Ticker, company name, or CIK"
                type="text"
                value={issuerQuery}
              />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <InfoCard
                eyebrow="Ticker"
                title={effectiveTicker || "Pending"}
                detail={selectedWorkspaceRequest ? "Using the synced local EDGAR workspace." : "Ask-time setup can start from a ticker symbol."}
              />
              <InfoCard eyebrow="Company" title={effectiveCompany} detail="Use the SEC Tool tab for full filing sync and refresh controls." />
            </div>

            <IntelligenceStatusCard status={intelligenceStatus} loading={intelligenceStatusQuery.isLoading} />

            <div className="rounded-[18px] border border-line bg-panelSoft/55 px-4 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-medium text-text">Filing index</div>
                  <div className="mt-1 text-sm leading-6 text-muted">
                    Build or refresh the local corpus/embedding index before deeper questions, or let ask-time maintenance do bounded setup automatically.
                  </div>
                </div>
                <button
                  className="rounded-full border border-accent/35 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:border-accent/50 hover:text-white disabled:cursor-default disabled:opacity-45"
                  data-testid="edgar-qwen-index-button"
                  disabled={!canBuildIndex}
                  onClick={() => void handleBuildIndex()}
                  type="button"
                >
                  {edgarIndexing ? "Indexing..." : "Build Qwen index"}
                </button>
              </div>
              {activeIndexResult?.message ? <InlineMessage tone="neutral" message={activeIndexResult.message} /> : null}
              {edgarIndexError ? <InlineMessage tone="danger" message={edgarIndexError} /> : null}
              {intelligenceStatusError ? <InlineMessage tone="danger" message={intelligenceStatusError} /> : null}
              {workspaceError ? <InlineMessage tone="danger" message={workspaceError} /> : null}
              {statusError ? <InlineMessage tone="danger" message={statusError} /> : null}
              {!selectedWorkspaceRequest ? (
                <InlineMessage
                  tone="neutral"
                  message="Manual indexing needs a synced workspace first. You can still ask a ticker question; the backend will run bounded sync and indexing setup when possible."
                />
              ) : null}
            </div>
          </section>

          <section className="grid content-start gap-4">
            <label className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.18em] text-muted">Question</span>
              <textarea
                className={`${inputClassName} min-h-[128px] resize-y leading-6`}
                data-testid="edgar-qwen-question-input"
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Example: What changed in revenue, margins, risk factors, or guidance in the latest filing?"
                value={question}
              />
            </label>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="inline-flex items-center gap-2 text-sm text-muted">
                <input
                  checked={allowStale}
                  className="h-4 w-4 rounded border-line bg-panelSoft"
                  data-testid="edgar-qwen-allow-stale"
                  onChange={(event) => setAllowStale(event.target.checked)}
                  type="checkbox"
                />
                Allow stale answers when live freshness is degraded
              </label>
              <button
                className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-[#061512] shadow-[0_12px_32px_rgba(103,232,199,0.18)] transition hover:bg-[#8cf5dc] disabled:cursor-default disabled:opacity-45"
                data-testid="edgar-qwen-ask-button"
                disabled={!canAskQwen}
                onClick={() => void handleAskQwen()}
                type="button"
              >
                {edgarQuestioning ? "Asking Qwen..." : "Ask Qwen"}
              </button>
            </div>
            {!intelligenceRequest ? (
              <InlineMessage tone="neutral" message="Enter a ticker symbol, or sync by company/CIK first, before asking Qwen." />
            ) : !selectedWorkspaceRequest ? (
              <InlineMessage tone="neutral" message="No local EDGAR workspace exists yet for this ticker. Asking Qwen will trigger bounded setup before answering." />
            ) : null}
            {edgarQuestionError ? <InlineMessage tone="danger" message={edgarQuestionError} /> : null}
            <AnswerPanel answer={activeQuestionResult} pending={edgarQuestioning} />
          </section>
        </div>
      </section>
    </WorkspaceFrame>
  );
}

function IntelligenceStatusCard({ status, loading }: { status?: EdgarIntelligenceStatus; loading: boolean }) {
  if (!status) {
    return (
      <div className="rounded-[18px] border border-line bg-panelSoft/55 px-4 py-4" data-testid="edgar-qwen-status">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium text-text">Model and index readiness</div>
          <StatusPill status={loading ? "checking" : "unknown"} />
        </div>
        <div className="mt-3 text-sm leading-6 text-muted">
          {loading ? "Checking local oMLX and filing index readiness..." : "Sync a ticker workspace to check local Qwen readiness."}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[18px] border border-line bg-panelSoft/55 px-4 py-4" data-testid="edgar-qwen-status">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-text">Model and index readiness</div>
        <StatusPill status={status.readyForAsk ? "ready" : status.indexState.status} />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <MiniState label="oMLX" status={status.modelState.status} detail={status.modelState.chatModel} />
        <MiniState label="Index" status={status.indexState.status} detail={`${status.indexState.indexedChunks} chunks`} />
        <MiniState label="Freshness" status={status.freshnessState.status} detail={status.freshnessState.liveCheckStatus.replaceAll("_", " ")} />
      </div>
      {status.limitations.length ? (
        <ul className="mt-4 grid gap-2 text-sm leading-6 text-muted">
          {status.limitations.map((limitation) => (
            <li key={limitation}>• {limitation}</li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 text-sm leading-6 text-muted">Ready for grounded filing questions with citations.</div>
      )}
    </div>
  );
}

function MiniState({ label, status, detail }: { label: string; status: string; detail: string }) {
  return (
    <div className="rounded-[14px] border border-line/80 bg-black/10 px-3 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted">{label}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusPill status={status} />
      </div>
      <div className="mt-2 truncate text-xs text-muted" title={detail}>
        {detail}
      </div>
    </div>
  );
}

function AnswerPanel({ answer, pending }: { answer?: EdgarQuestionResponse; pending: boolean }) {
  if (pending) {
    return (
      <div className="rounded-[22px] border border-accent/25 bg-accent/10 px-5 py-5 text-sm leading-6 text-accent" data-testid="edgar-qwen-answer">
        Retrieving filing excerpts, asking Qwen, and validating the answer against citations...
      </div>
    );
  }
  if (!answer) {
    return (
      <div className="rounded-[22px] border border-dashed border-line px-5 py-7 text-center text-sm leading-6 text-muted" data-testid="edgar-qwen-answer-empty">
        Ask a filing question to get a grounded answer. If the evidence is weak, the backend should refuse instead of freewheeling.
      </div>
    );
  }
  return (
    <div className="grid gap-4" data-testid="edgar-qwen-answer">
      <div className="rounded-[22px] border border-line bg-panelSoft/70 px-5 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={answer.confidence} />
          <span className="text-xs uppercase tracking-[0.16em] text-muted">Confidence</span>
        </div>
        <div className="mt-4 whitespace-pre-wrap text-base leading-7 text-text">
          <AnswerText value={answer.answer} />
        </div>
        <div className="mt-4 grid gap-2 text-xs text-muted sm:grid-cols-3">
          <div>Retrieved {answer.retrievalState.chunksRetrieved} chunks</div>
          <div>Used {answer.retrievalState.chunksUsed} chunks</div>
          <div>Maintenance {answer.maintenanceState.status}</div>
        </div>
      </div>

      {answer.limitations.length ? (
        <div className="rounded-[18px] border border-caution/25 bg-caution/10 px-4 py-3 text-sm leading-6 text-caution" data-testid="edgar-qwen-limitations">
          {answer.limitations.map((limitation) => (
            <div key={limitation}>{limitation}</div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3" data-testid="edgar-qwen-citations">
        <div className="text-xs uppercase tracking-[0.18em] text-muted">Citations</div>
        {answer.citations.length ? (
          answer.citations.map((citation) => <CitationCard citation={citation} key={citation.citationId} />)
        ) : (
          <div className="rounded-[18px] border border-line bg-panelSoft/55 px-4 py-4 text-sm text-muted">
            No citations were returned. Treat this as a refusal or unsupported answer.
          </div>
        )}
      </div>
    </div>
  );
}

function AnswerText({ value }: { value: string }) {
  const parts = value.split(/(\[C\d+\])/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) =>
        /^\[C\d+\]$/.test(part) ? (
          <span className="mx-1 rounded-full border border-accent/35 bg-accent/10 px-2 py-0.5 text-sm font-semibold text-accent" key={`${part}-${index}`}>
            {part}
          </span>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </>
  );
}

function CitationCard({ citation }: { citation: EdgarQuestionCitation }) {
  const filingDate = citation.filingDate ? formatFilingDate(citation.filingDate) : "Unknown filing date";
  return (
    <article className="rounded-[18px] border border-line bg-panelSoft/55 px-4 py-4" data-testid={`edgar-qwen-citation-${citation.citationId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-accent/35 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">{citation.citationId}</span>
        <span className="text-sm font-medium text-text">
          {citation.form} · {filingDate}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted">{citation.snippet}</p>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
        <span className="mono break-all">{citation.accessionNumber}</span>
        {citation.secUrl ? (
          <a className="text-accent hover:text-white" href={citation.secUrl} rel="noreferrer" target="_blank">
            Open SEC source
          </a>
        ) : null}
      </div>
    </article>
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
