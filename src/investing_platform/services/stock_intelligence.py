"""General stock intelligence orchestration.

This module is intentionally source-agnostic. It gathers normalized evidence
from existing app services first; model synthesis can sit on top of this
evidence contract without turning any one source, including EDGAR, into the
whole intelligence layer.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Mapping

from investing_platform.models import (
    MarketDataSourceStatus,
    StockIntelligenceConfidence,
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
        self._synthesizer = EvidenceGroundedStockSynthesizer()

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
        evidence_limitations = self._evidence_limitations(evidence)
        synthesis = self._synthesizer.synthesize(request=request, evidence=evidence, limitations=[*limitations, *evidence_limitations])
        return StockIntelligenceResponse(
            ticker=request.ticker,
            question=request.question,
            answer=synthesis.answer,
            confidence=synthesis.confidence,
            generatedAt=generated_at,
            plan=plan,
            evidence=evidence,
            limitations=self._dedupe(synthesis.limitations),
            nextActions=synthesis.next_actions,
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
        payload = financials.model_dump(mode="json")
        facts = _financial_facts(financials)
        if facts:
            payload["facts"] = facts
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
                payload=payload,
            )
        ]

    def _collect_edgar_readiness(self, request: StockIntelligenceRequest, *, start: int) -> list[StockIntelligenceEvidence]:
        evidence_adapter = getattr(self._edgar, "stock_intelligence_evidence", None)
        if callable(evidence_adapter):
            adapted = evidence_adapter(request, start=start)
            evidence = [StockIntelligenceEvidence.model_validate(item) for item in adapted]
            if evidence:
                return evidence

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

    def _evidence_limitations(self, evidence: list[StockIntelligenceEvidence]) -> list[str]:
        limitations: list[str] = []
        financial_payloads = [item.payload for item in evidence if item.evidenceType == "financials"]
        for payload in financial_payloads:
            if not payload.get("estimates") and not _payload_facts(payload, kind="earnings_result"):
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


@dataclass(frozen=True)
class StockIntelligenceSynthesis:
    answer: str
    confidence: StockIntelligenceConfidence
    limitations: list[str]
    next_actions: list[str]


class EvidenceGroundedStockSynthesizer:
    """Draft a compact answer from typed evidence facts and cite evidence ids."""

    def synthesize(
        self,
        *,
        request: StockIntelligenceRequest,
        evidence: list[StockIntelligenceEvidence],
        limitations: list[str],
    ) -> StockIntelligenceSynthesis:
        fact_items = _evidence_fact_items(evidence)
        if not fact_items:
            source_labels = StockIntelligenceService._dedupe([item.sourceLabel for item in evidence])
            source_phrase = ", ".join(source_labels) if source_labels else "the configured sources"
            return StockIntelligenceSynthesis(
                answer=(
                    f"I gathered a general evidence bundle for {request.ticker} from {source_phrase}, "
                    "but it did not contain enough typed facts to answer the question directly yet."
                ),
                confidence="low",
                limitations=[
                    *limitations,
                    "The gathered evidence did not include structured earnings, event, guidance, or market-reaction facts.",
                ],
                next_actions=[
                    "Add source adapters that return typed facts for earnings actuals, consensus estimates, transcripts, news, and price reactions.",
                    "Use local Qwen as a synthesis layer after evidence-id citation validation is in place.",
                ],
            )

        lines: list[str] = [f"Here is the source-grounded read for {request.ticker}:"]
        for evidence_item, fact in fact_items:
            rendered = _render_fact(evidence_item, fact)
            if rendered:
                lines.append(rendered)

        confidence: StockIntelligenceConfidence = "high" if len(fact_items) >= 2 and not limitations else "medium"
        return StockIntelligenceSynthesis(
            answer="\n".join(lines),
            confidence=confidence,
            limitations=[*limitations],
            next_actions=[
                "Add local Qwen synthesis over the same typed evidence contract for better narrative flow.",
                "Add external earnings, transcript, news, and price-reaction adapters to broaden evidence coverage.",
                "Keep citation validation anchored to evidence ids before returning generated claims.",
            ],
        )


def _financial_facts(financials: TickerFinancialsResponse) -> list[dict[str, Any]]:
    facts: list[dict[str, Any]] = []
    income_table = _latest_table(financials.statements, statement_type="income_statement", period_type="quarterly")
    estimates_table = _latest_table(financials.estimates, statement_type="estimates")
    if income_table is None or estimates_table is None:
        return facts

    revenue_actual = _row_value(income_table, ("revenue", "total revenue", "revenues"))
    revenue_estimate = _row_value(estimates_table, ("revenue estimate", "revenue consensus", "estimated revenue", "consensus revenue"))
    revenue_prior = _row_value(income_table, ("revenue", "total revenue", "revenues"), column=1)
    if revenue_actual is not None and revenue_estimate is not None:
        facts.append(
            _earnings_result_fact(
                metric="Revenue",
                actual=revenue_actual,
                estimate=revenue_estimate,
                prior=revenue_prior,
                period=_period_label(income_table),
                unit=_metric_unit(income_table),
            )
        )

    eps_actual = _row_value(income_table, ("eps", "diluted eps", "earnings per share"))
    eps_estimate = _row_value(estimates_table, ("eps estimate", "eps consensus", "estimated eps", "consensus eps"))
    eps_prior = _row_value(income_table, ("eps", "diluted eps", "earnings per share"), column=1)
    if eps_actual is not None and eps_estimate is not None:
        facts.append(
            _earnings_result_fact(
                metric="EPS",
                actual=eps_actual,
                estimate=eps_estimate,
                prior=eps_prior,
                period=_period_label(income_table),
                unit="USD per share",
            )
        )
    return facts


def _latest_table(tables: list[Any], *, statement_type: str, period_type: str | None = None) -> Any | None:
    for table in tables:
        if table.statementType != statement_type:
            continue
        if period_type is not None and table.periodType != period_type:
            continue
        if table.columns and table.rows:
            return table
    return None


def _row_value(table: Any, aliases: tuple[str, ...], *, column: int = 0) -> float | None:
    normalized_aliases = {_normalize_metric_label(alias) for alias in aliases}
    for row in table.rows:
        label = _normalize_metric_label(row.label)
        if not any(alias in label for alias in normalized_aliases):
            continue
        if column >= len(row.values):
            return None
        return _coerce_float(row.values[column])
    return None


def _period_label(table: Any) -> str | None:
    if not table.columns:
        return None
    column = table.columns[0]
    return column.fiscalPeriod or column.label or (column.periodEnding.isoformat() if column.periodEnding else None)


def _metric_unit(table: Any) -> str | None:
    if table.currency and table.unit:
        return f"{table.currency} {table.unit}"
    return table.currency or table.unit


def _earnings_result_fact(
    *,
    metric: str,
    actual: float,
    estimate: float,
    prior: float | None,
    period: str | None,
    unit: str | None,
) -> dict[str, Any]:
    difference = actual - estimate
    difference_pct = difference / abs(estimate) * 100.0 if estimate else None
    return {
        "kind": "earnings_result",
        "metric": metric,
        "period": period,
        "actual": actual,
        "estimate": estimate,
        "prior": prior,
        "unit": unit,
        "outcome": "beat" if difference >= 0 else "miss",
        "difference": difference,
        "differencePct": difference_pct,
    }


def _evidence_fact_items(evidence: list[StockIntelligenceEvidence]) -> list[tuple[StockIntelligenceEvidence, dict[str, Any]]]:
    items: list[tuple[StockIntelligenceEvidence, dict[str, Any]]] = []
    for evidence_item in evidence:
        for fact in _payload_facts(evidence_item.payload):
            items.append((evidence_item, fact))
    return items


def _payload_facts(payload: Mapping[str, Any], *, kind: str | None = None) -> list[dict[str, Any]]:
    raw_facts = payload.get("facts")
    if not isinstance(raw_facts, list):
        return []
    facts = [fact for fact in raw_facts if isinstance(fact, dict)]
    if kind is not None:
        facts = [fact for fact in facts if fact.get("kind") == kind]
    return facts


def _render_fact(evidence: StockIntelligenceEvidence, fact: Mapping[str, Any]) -> str | None:
    kind = str(fact.get("kind") or "").strip()
    if kind == "earnings_result":
        return _render_earnings_result(evidence, fact)
    if kind == "strategic_event":
        return _render_strategic_event(evidence, fact)
    if kind == "guidance":
        return _render_guidance(evidence, fact)
    if kind == "market_reaction":
        return _render_market_reaction(evidence, fact)
    return _render_generic_fact(evidence, fact)


def _render_earnings_result(evidence: StockIntelligenceEvidence, fact: Mapping[str, Any]) -> str:
    metric = str(fact.get("metric") or "Metric")
    period = str(fact.get("period") or "the latest reported period")
    actual = _fmt_metric_value(_coerce_float(fact.get("actual")), str(fact.get("unit") or ""))
    estimate = _fmt_metric_value(_coerce_float(fact.get("estimate")), str(fact.get("unit") or ""))
    prior = _coerce_float(fact.get("prior"))
    outcome = str(fact.get("outcome") or "").lower()
    outcome_word = "beat" if outcome == "beat" else "missed" if outcome == "miss" else "compared with"
    difference = _fmt_metric_value(_coerce_float(fact.get("difference")), str(fact.get("unit") or ""), signed=True)
    difference_pct = _coerce_float(fact.get("differencePct"))
    detail = f"{metric} {outcome_word} in {period}: actual {actual} vs estimate {estimate}"
    if difference != "n/a":
        detail += f", a {difference} difference"
        if difference_pct is not None:
            detail += f" ({difference_pct:+.1f}%)"
    if prior is not None:
        detail += f"; prior period was {_fmt_metric_value(prior, str(fact.get('unit') or ''))}"
    return f"- {detail}. [{evidence.evidenceId}]"


def _render_strategic_event(evidence: StockIntelligenceEvidence, fact: Mapping[str, Any]) -> str:
    label = str(fact.get("label") or "Strategic event")
    summary = str(fact.get("summary") or "").strip()
    assessment = str(fact.get("assessment") or "").strip()
    caveats = [str(item).strip() for item in fact.get("caveats", []) if str(item).strip()] if isinstance(fact.get("caveats"), list) else []
    terms = _format_terms(fact.get("terms"))
    parts = [f"{label}: {summary}" if summary else label]
    if terms:
        parts.append(f"Terms: {terms}")
    if assessment:
        parts.append(f"Read-through: {assessment}")
    if caveats:
        parts.append(f"Caveats: {'; '.join(caveats)}")
    return f"- {' '.join(parts)} [{evidence.evidenceId}]"


def _render_guidance(evidence: StockIntelligenceEvidence, fact: Mapping[str, Any]) -> str:
    label = str(fact.get("label") or "Guidance")
    summary = str(fact.get("summary") or "").strip()
    return f"- {label}: {summary}. [{evidence.evidenceId}]"


def _render_market_reaction(evidence: StockIntelligenceEvidence, fact: Mapping[str, Any]) -> str:
    summary = str(fact.get("summary") or "").strip()
    return f"- Market reaction: {summary}. [{evidence.evidenceId}]"


def _render_generic_fact(evidence: StockIntelligenceEvidence, fact: Mapping[str, Any]) -> str | None:
    label = str(fact.get("label") or fact.get("metric") or "").strip()
    summary = str(fact.get("summary") or "").strip()
    if not label and not summary:
        return None
    return f"- {label + ': ' if label else ''}{summary}. [{evidence.evidenceId}]"


def _format_terms(value: Any) -> str:
    if isinstance(value, list):
        terms: list[str] = []
        for item in value:
            if isinstance(item, dict):
                label = str(item.get("label") or "").strip()
                term_value = str(item.get("value") or "").strip()
                if label and term_value:
                    terms.append(f"{label} {term_value}")
                elif term_value:
                    terms.append(term_value)
            elif str(item).strip():
                terms.append(str(item).strip())
        return "; ".join(terms)
    if isinstance(value, str):
        return value.strip()
    return ""


def _normalize_metric_label(value: str) -> str:
    return "".join(character.lower() for character in value if character.isalnum())


def _coerce_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _fmt_metric_value(value: float | None, unit: str, *, signed: bool = False) -> str:
    if value is None:
        return "n/a"
    normalized_unit = unit.lower()
    prefix = ""
    suffix = ""
    if "usd" in normalized_unit:
        prefix = "$"
    if "million" in normalized_unit or normalized_unit.endswith("m"):
        suffix = "M"
    elif "billion" in normalized_unit or normalized_unit.endswith("b"):
        suffix = "B"
    elif "per share" in normalized_unit:
        suffix = ""
    sign = "+" if signed and value > 0 else ""
    if abs(value) >= 100:
        formatted = f"{sign}{value:,.1f}"
    else:
        formatted = f"{sign}{value:,.2f}".rstrip("0").rstrip(".")
    if prefix and formatted.startswith("-"):
        return f"-{prefix}{formatted[1:]}{suffix}"
    return f"{sign}{prefix}{formatted.lstrip('+')}{suffix}" if sign else f"{prefix}{formatted}{suffix}"


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
