from __future__ import annotations

from datetime import UTC, date, datetime

from fastapi.testclient import TestClient

import investing_platform.api.routes.intelligence as intelligence_routes
from investing_platform.main import app
from investing_platform.models import (
    FinancialMetricRow,
    FinancialPeriodColumn,
    FinancialStatementTable,
    FundamentalReportStatus,
    MarketDataSourcesResponse,
    MarketDataSourceStatus,
    StockIntelligenceEvidence,
    StockIntelligenceRequest,
    StockIntelligenceResponse,
    TickerFinancialsResponse,
    TickerOverviewResponse,
    UnderlyingQuote,
)
from investing_platform.services.stock_intelligence import StockIntelligenceService


NOW = datetime(2026, 5, 20, 12, 0, tzinfo=UTC)


class FakeMarketDataService:
    def __init__(self) -> None:
        self.overview_calls: list[str] = []
        self.financial_calls: list[str] = []

    def get_ticker_overview(self, symbol: str) -> TickerOverviewResponse:
        self.overview_calls.append(symbol)
        return TickerOverviewResponse(
            symbol=symbol,
            quote=UnderlyingQuote(symbol=symbol, price=12.34, currency="USD", marketDataStatus="DELAYED", generatedAt=NOW),
            marketCap=1_234_000_000,
            revenueTtm=144_800_000,
            epsTtm=-0.30,
            earningsDate=date(2026, 5, 7),
            sourceNotice="fake market data",
            generatedAt=NOW,
        )

    def get_ticker_financials(self, symbol: str) -> TickerFinancialsResponse:
        self.financial_calls.append(symbol)
        if symbol.upper() == "NVDA":
            return _financials_response(
                symbol=symbol,
                revenue_actual=60_500,
                revenue_prior=35_100,
                revenue_estimate=58_000,
                eps_actual=1.09,
                eps_prior=0.61,
                eps_estimate=1.02,
                period="Q1 FY27",
            )
        return TickerFinancialsResponse(
            symbol=symbol,
            reports=[
                FundamentalReportStatus(reportType="statements", available=True),
                FundamentalReportStatus(reportType="estimates", available=True),
            ],
            statements=[
                FinancialStatementTable(
                    statementType="income_statement",
                    periodType="quarterly",
                    title="Quarterly Income Statement",
                    currency="USD",
                    unit="millions",
                    columns=[
                        FinancialPeriodColumn(label="Q3 FY26", fiscalPeriod="Q3 FY26", periodEnding=date(2026, 3, 31)),
                        FinancialPeriodColumn(label="Q2 FY26", fiscalPeriod="Q2 FY26", periodEnding=date(2025, 12, 31)),
                    ],
                    rows=[
                        FinancialMetricRow(label="Revenue", values=[144.8, 184.7]),
                        FinancialMetricRow(label="EPS", values=[-0.16, -0.30]),
                    ],
                )
            ],
            estimates=[
                FinancialStatementTable(
                    statementType="estimates",
                    periodType="quarterly",
                    title="Analyst Estimates",
                    currency="USD",
                    unit="millions",
                    columns=[FinancialPeriodColumn(label="Q3 FY26", fiscalPeriod="Q3 FY26", periodEnding=date(2026, 3, 31))],
                    rows=[
                        FinancialMetricRow(label="Consensus Revenue", values=[219.87]),
                        FinancialMetricRow(label="Consensus EPS", values=[-0.22]),
                    ],
                )
            ],
            generatedAt=NOW,
            sourceNotices=["fake financials"],
        )


class FakeEdgarService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str | None]] = []

    def intelligence_api_status(self, ticker: str, output_dir: str | None = None):
        self.calls.append((ticker, output_dir))
        return FakeEdgarStatus()

    def stock_intelligence_evidence(self, request: StockIntelligenceRequest, *, start: int):
        self.calls.append((request.ticker, request.outputDir))
        if request.ticker == "IREN":
            return [
                StockIntelligenceEvidence(
                    evidenceId=f"E{start}",
                    source="edgar",
                    evidenceType="strategic_event",
                    title="IREN NVIDIA strategic financing and cloud agreement",
                    summary="NVIDIA-linked transaction and investment rights disclosed in filing evidence.",
                    sourceLabel="Local EDGAR filing excerpts",
                    asOf=NOW,
                    payload={
                        "facts": [
                            {
                                "kind": "strategic_event",
                                "label": "NVIDIA deal",
                                "summary": "IREN disclosed NVIDIA-related AI cloud commitments and investment rights.",
                                "terms": [{"label": "stock option", "value": "about $70.00"}],
                                "assessment": "bullish validation for demand, but not a complete investment thesis by itself.",
                                "caveats": ["execution risk", "financing needs", "capacity delivery risk"],
                            }
                        ]
                    },
                )
            ]
        if request.ticker == "NVDA":
            return [
                StockIntelligenceEvidence(
                    evidenceId=f"E{start}",
                    source="edgar",
                    evidenceType="guidance",
                    title="NVDA demand commentary",
                    summary="Management described continued AI infrastructure demand.",
                    sourceLabel="Local EDGAR filing excerpts",
                    asOf=NOW,
                    payload={"facts": [{"kind": "guidance", "label": "AI demand", "summary": "Management pointed to continued AI infrastructure demand."}]},
                )
            ]
        return []


class FakeEdgarStatus:
    readyForAsk = True
    generatedAt = NOW

    class indexState:
        status = "ready"
        indexedChunks = 42
        indexedXbrlFacts = 7

    class freshnessState:
        status = "fresh"

    def model_dump(self, mode: str = "python"):
        return {
            "readyForAsk": True,
            "generatedAt": NOW.isoformat() if mode == "json" else NOW,
            "indexState": {"status": "ready", "indexedChunks": 42, "indexedXbrlFacts": 7},
            "freshnessState": {"status": "fresh"},
        }


class FakeMarketDataSourceService:
    def __init__(self, *, available: bool = False) -> None:
        self.available = available
        self.calls = 0

    def source_status(self) -> MarketDataSourcesResponse:
        self.calls += 1
        return MarketDataSourcesResponse(
            sources=[
                MarketDataSourceStatus(
                    providerId="polygon",
                    displayName="Polygon.io",
                    category="Market data API",
                    status="ready" if self.available else "not_configured",
                    available=self.available,
                    configured=self.available,
                    enabled=self.available,
                    configurable=True,
                    requiresApiKey=True,
                    apiBaseUrl="https://api.polygon.io",
                    maskedApiKey="po...on" if self.available else None,
                    capabilities=["prices", "earnings events"],
                    detail="fake provider",
                )
            ],
            statePath="/tmp/market-data-sources.json",
            generatedAt=NOW,
        )


def test_stock_intelligence_builds_broad_default_evidence_without_keyword_routing() -> None:
    market_data = FakeMarketDataService()
    edgar = FakeEdgarService()
    market_sources = FakeMarketDataSourceService(available=True)
    service = StockIntelligenceService(market_data=market_data, edgar=edgar, market_data_sources=market_sources)

    response = service.ask(
        StockIntelligenceRequest(
            ticker="iren",
            question="Did IREN miss their latest earnings numbers?",
        )
    )

    assert response.ticker == "IREN"
    assert response.plan.strategy == "broad_default"
    assert response.plan.selectedSources == ["market_snapshot", "financials", "edgar", "market_data_sources"]
    assert [item.source for item in response.evidence] == ["market_snapshot", "financials", "edgar", "market_data_sources"]
    assert market_data.overview_calls == ["IREN"]
    assert market_data.financial_calls == ["IREN"]
    assert edgar.calls == [("IREN", None)]
    assert market_sources.calls == 1
    assert "keyword" in " ".join(response.plan.notes).lower()
    assert "Revenue missed" in response.answer
    assert "$144.8M" in response.answer
    assert "$219.9M" in response.answer
    assert "$184.7M" in response.answer
    assert "EPS beat" in response.answer
    assert "[E2]" in response.answer


def test_stock_intelligence_honors_explicit_source_list() -> None:
    market_data = FakeMarketDataService()
    edgar = FakeEdgarService()
    market_sources = FakeMarketDataSourceService(available=True)
    service = StockIntelligenceService(market_data=market_data, edgar=edgar, market_data_sources=market_sources)

    response = service.ask(
        StockIntelligenceRequest(
            ticker="NVDA",
            question="Give me a source-aware snapshot.",
            sources=["market_snapshot"],
        )
    )

    assert response.plan.strategy == "explicit_sources"
    assert response.plan.selectedSources == ["market_snapshot"]
    assert [item.source for item in response.evidence] == ["market_snapshot"]
    assert market_data.overview_calls == ["NVDA"]
    assert market_data.financial_calls == []
    assert edgar.calls == []
    assert market_sources.calls == 0


def test_stock_intelligence_answers_open_ended_iren_nvidia_deal_question() -> None:
    service = StockIntelligenceService(
        market_data=FakeMarketDataService(),
        edgar=FakeEdgarService(),
        market_data_sources=FakeMarketDataSourceService(available=True),
    )

    response = service.ask(
        StockIntelligenceRequest(
            ticker="IREN",
            question="Summarize IREN's deal with NVIDIA. Is it bullish for IREN?",
        )
    )

    assert response.confidence == "high"
    assert "NVIDIA deal" in response.answer
    assert "$70.00" in response.answer
    assert "bullish validation" in response.answer
    assert "execution risk" in response.answer
    assert "[E3]" in response.answer


def test_stock_intelligence_answers_open_ended_nvda_quarter_question() -> None:
    service = StockIntelligenceService(
        market_data=FakeMarketDataService(),
        edgar=FakeEdgarService(),
        market_data_sources=FakeMarketDataSourceService(available=True),
    )

    response = service.ask(
        StockIntelligenceRequest(
            ticker="NVDA",
            question="What are the main things to watch after NVDA's latest quarter?",
        )
    )

    assert "Revenue beat" in response.answer
    assert "$60,500.0M" in response.answer
    assert "$58,000.0M" in response.answer
    assert "prior period was $35,100.0M" in response.answer
    assert "AI demand" in response.answer
    assert "[E2]" in response.answer
    assert "[E3]" in response.answer


def test_general_stock_intelligence_endpoint_returns_synthesized_answer(monkeypatch) -> None:
    service = StockIntelligenceService(
        market_data=FakeMarketDataService(),
        edgar=FakeEdgarService(),
        market_data_sources=FakeMarketDataSourceService(available=True),
    )
    monkeypatch.setattr(intelligence_routes, "stock_intelligence_service", lambda: service)

    with TestClient(app) as client:
        response = client.post(
            "/api/intelligence/stock/ask",
            json={"ticker": "IREN", "question": "Did IREN miss their latest quarterly earnings numbers?"},
        )

    assert response.status_code == 200
    payload = StockIntelligenceResponse.model_validate(response.json())
    assert payload.ticker == "IREN"
    assert "Revenue missed" in payload.answer
    assert "EPS beat" in payload.answer
    assert payload.evidence


def _financials_response(
    *,
    symbol: str,
    revenue_actual: float,
    revenue_prior: float,
    revenue_estimate: float,
    eps_actual: float,
    eps_prior: float,
    eps_estimate: float,
    period: str,
) -> TickerFinancialsResponse:
    return TickerFinancialsResponse(
        symbol=symbol,
        reports=[
            FundamentalReportStatus(reportType="statements", available=True),
            FundamentalReportStatus(reportType="estimates", available=True),
        ],
        statements=[
            FinancialStatementTable(
                statementType="income_statement",
                periodType="quarterly",
                title="Quarterly Income Statement",
                currency="USD",
                unit="millions",
                columns=[
                    FinancialPeriodColumn(label=period, fiscalPeriod=period),
                    FinancialPeriodColumn(label="Prior quarter", fiscalPeriod="Prior quarter"),
                ],
                rows=[
                    FinancialMetricRow(label="Revenue", values=[revenue_actual, revenue_prior]),
                    FinancialMetricRow(label="EPS", values=[eps_actual, eps_prior]),
                ],
            )
        ],
        estimates=[
            FinancialStatementTable(
                statementType="estimates",
                periodType="quarterly",
                title="Analyst Estimates",
                currency="USD",
                unit="millions",
                columns=[FinancialPeriodColumn(label=period, fiscalPeriod=period)],
                rows=[
                    FinancialMetricRow(label="Consensus Revenue", values=[revenue_estimate]),
                    FinancialMetricRow(label="Consensus EPS", values=[eps_estimate]),
                ],
            )
        ],
        generatedAt=NOW,
        sourceNotices=["fake financials"],
    )
