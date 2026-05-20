"""General stock intelligence orchestration.

This module is intentionally source-agnostic. It gathers normalized evidence
from existing app services first; model synthesis can sit on top of this
evidence contract without turning any one source, including EDGAR, into the
whole intelligence layer.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from investing_platform.models import (
    MarketDataSourceStatus,
    StockIntelligenceEvidence,
    StockIntelligencePlan,
    StockIntelligenceRequest,
    StockIntelligenceResponse,
    StockIntelligenceSourceId,
    TickerFinancialsResponse,
    TickerOverviewResponse,
)


DEFAULT_STOCK_INTELLIGENCE_SOURCES: tuple[StockIntelligenceSourceId, ...] = (
    "market_snapshot",
    "financials",
    "edgar",
    "market_data_sources",
)


class StockIntelligenceService:
    """Build source-aware evidence bundles for broad stock questions."""

    def __init__(self, *, market_data: Any, edgar: Any, market_data_sources: Any) -> None:
        self._market_data = market_data
        self._edgar = edgar
        self._market_data_sources = market_data_sources

    def ask(self, request: StockIntelligenceRequest) -> StockIntelligenceResponse:
        generated_at = datetime.now(UTC)
        plan = self._plan(request)
        evidence: list[StockIntelligenceEvidence] = []
        limitations: list[str] = []

        collectors = {
            "market_snapshot": self._collect_market_snapshot,
            "financials": self._collect_financials,
            "edgar": self._collect_edgar_readiness,
            "market_data_sources": self._collect_market_data_source_status,
        }
        for source in plan.selectedSources:
            collector = collectors[source]
            try:
                evidence.extend(collector(request, start=len(evidence) + 1))
            except Exception as exc:  # pragma: no cover - source-specific failures are intentionally isolated.
                limitations.append(f"{source} evidence unavailable: {exc}")

        evidence = evidence[: request.maxEvidenceItems]
        answer, confidence = self._draft_answer(request, evidence, limitations)
        return StockIntelligenceResponse(
            ticker=request.ticker,
            question=request.question,
            answer=answer,
            confidence=confidence,
            generatedAt=generated_at,
            plan=plan,
            evidence=evidence,
            limitations=self._dedupe(
                [
                    *limitations,
                    "General Qwen synthesis over multi-source evidence is not enabled in this first slice.",
                    *self._evidence_limitations(evidence),
                ]
            ),
            nextActions=[
                "Wire Qwen synthesis to consume StockIntelligenceEvidence rather than EDGAR-only chunks.",
                "Implement source adapters that fetch actual earnings, consensus estimates, transcripts, news, and price reactions.",
                "Add source-specific citation validators before returning synthesized claims.",
            ],
        )

    def _plan(self, request: StockIntelligenceRequest) -> StockIntelligencePlan:
        selected = request.sources or list(DEFAULT_STOCK_INTELLIGENCE_SOURCES)
        strategy = "explicit_sources" if request.sources else "broad_default"
        notes = [
            "Phase 0 does not infer source selection from question keywords.",
            "When sources are omitted, the layer gathers a broad default evidence set.",
        ]
        if request.sources:
            notes.append("The caller explicitly selected the evidence sources.")
        return StockIntelligencePlan(
            strategy=strategy,  # type: ignore[arg-type]
            selectedSources=selected,
            availableSources=list(DEFAULT_STOCK_INTELLIGENCE_SOURCES),
            skippedSources=[],
            notes=notes,
        )

    def _collect_market_snapshot(self, request: StockIntelligenceRequest, *, start: int) -> list[StockIntelligenceEvidence]:
        overview: TickerOverviewResponse = self._market_data.get_ticker_overview(request.ticker)
        summary_parts = [
            f"last price {_fmt_number(overview.quote.price)} {overview.quote.currency}",
            f"market cap {_fmt_compact(overview.marketCap)}" if overview.marketCap is not None else "",
            f"revenue TTM {_fmt_compact(overview.revenueTtm)}" if overview.revenueTtm is not None else "",
            f"EPS TTM {_fmt_number(overview.epsTtm)}" if overview.epsTtm is not None else "",
            f"next earnings {overview.earningsDate.isoformat()}" if overview.earningsDate else "",
        ]
        summary = "; ".join(part for part in summary_parts if part)
        return [
            StockIntelligenceEvidence(
                evidenceId=f"E{start}",
                source="market_snapshot",
                evidenceType="ticker_overview",
                title=f"{request.ticker} market snapshot",
                summary=summary or "Market snapshot was returned without headline metrics.",
                sourceLabel=overview.sourceNotice or "Market data service",
                asOf=overview.generatedAt,
                payload=overview.model_dump(mode="json"),
            )
        ]

    def _collect_financials(self, request: StockIntelligenceRequest, *, start: int) -> list[StockIntelligenceEvidence]:
        financials: TickerFinancialsResponse = self._market_data.get_ticker_financials(request.ticker)
        report_status = ", ".join(
            f"{report.reportType}:{'available' if report.available else 'missing'}" for report in financials.reports
        )
        table_counts = (
            f"{len(financials.statements)} statement table(s), "
            f"{len(financials.ratios)} ratio table(s), "
            f"{len(financials.estimates)} estimate table(s)"
        )
        summaries = [table_counts]
        if report_status:
            summaries.append(report_status)
        if financials.sourceNotices:
            summaries.extend(financials.sourceNotices)
        return [
            StockIntelligenceEvidence(
                evidenceId=f"E{start}",
                source="financials",
                evidenceType="financials",
                title=f"{request.ticker} financial statements",
                summary=" ".join(summaries),
                sourceLabel="Market data financials",
                asOf=financials.generatedAt,
                payload=financials.model_dump(mode="json"),
            )
        ]

    def _collect_edgar_readiness(self, request: StockIntelligenceRequest, *, start: int) -> list[StockIntelligenceEvidence]:
        status = self._edgar.intelligence_api_status(ticker=request.ticker, output_dir=request.outputDir)
        summary = (
            f"readyForAsk={status.readyForAsk}; "
            f"index={status.indexState.status}; "
            f"chunks={status.indexState.indexedChunks}; "
            f"xbrlFacts={status.indexState.indexedXbrlFacts}; "
            f"freshness={status.freshnessState.status}"
        )
        return [
            StockIntelligenceEvidence(
                evidenceId=f"E{start}",
                source="edgar",
                evidenceType="edgar_readiness",
                title=f"{request.ticker} EDGAR/Qwen readiness",
                summary=summary,
                sourceLabel="Local EDGAR intelligence index",
                asOf=status.generatedAt,
                payload=status.model_dump(mode="json"),
            )
        ]

    def _collect_market_data_source_status(self, request: StockIntelligenceRequest, *, start: int) -> list[StockIntelligenceEvidence]:
        response = self._market_data_sources.source_status()
        configured = [source for source in response.sources if source.configured]
        available = [source for source in response.sources if source.available]
        planned = [source for source in response.sources if source.status == "planned"]
        summary = (
            f"{len(available)} ready, {len(configured)} configured, {len(planned)} planned external provider(s). "
            f"Ready providers: {', '.join(source.displayName for source in available) or 'none'}."
        )
        return [
            StockIntelligenceEvidence(
                evidenceId=f"E{start}",
                source="market_data_sources",
                evidenceType="provider_status",
                title="External market intelligence provider status",
                summary=summary,
                sourceLabel="Global Settings market data sources",
                asOf=response.generatedAt,
                payload=response.model_dump(mode="json"),
            )
        ]

    def _draft_answer(
        self,
        request: StockIntelligenceRequest,
        evidence: list[StockIntelligenceEvidence],
        limitations: list[str],
    ) -> tuple[str, str]:
        if not evidence:
            return (
                "I could not gather enough source evidence to answer this stock question yet.",
                "low",
            )
        source_labels = self._dedupe([item.sourceLabel for item in evidence])
        answer = (
            f"I gathered a general evidence bundle for {request.ticker} from "
            f"{', '.join(source_labels)}. This endpoint is now source-aware, but it is still in the evidence-gathering phase; "
            "it does not yet synthesize final cross-source investment conclusions."
        )
        confidence = "medium" if evidence and not limitations else "low"
        return answer, confidence

    def _evidence_limitations(self, evidence: list[StockIntelligenceEvidence]) -> list[str]:
        limitations: list[str] = []
        financial_payloads = [item.payload for item in evidence if item.evidenceType == "financials"]
        for payload in financial_payloads:
            if not payload.get("estimates"):
                limitations.append("Current financial data sources did not return analyst estimate tables.")
        provider_payloads = [item.payload for item in evidence if item.evidenceType == "provider_status"]
        for payload in provider_payloads:
            sources = [MarketDataSourceStatus.model_validate(source) for source in payload.get("sources", [])]
            if not any(source.available for source in sources):
                limitations.append("No external consensus/news provider is ready yet.")
        return limitations

    @staticmethod
    def _dedupe(values: list[str]) -> list[str]:
        deduped: list[str] = []
        for value in values:
            normalized = value.strip()
            if normalized and normalized not in deduped:
                deduped.append(normalized)
        return deduped


def _fmt_number(value: float | int | None) -> str:
    if value is None:
        return "n/a"
    return f"{float(value):,.2f}".rstrip("0").rstrip(".")


def _fmt_compact(value: float | int | None) -> str:
    if value is None:
        return "n/a"
    absolute = abs(float(value))
    if absolute >= 1_000_000_000_000:
        return f"${float(value) / 1_000_000_000_000:.2f}T"
    if absolute >= 1_000_000_000:
        return f"${float(value) / 1_000_000_000:.2f}B"
    if absolute >= 1_000_000:
        return f"${float(value) / 1_000_000:.2f}M"
    return f"${float(value):,.0f}"
