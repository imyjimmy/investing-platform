from __future__ import annotations

from datetime import UTC, date, datetime

from investing_platform.models import (
    FundamentalReportStatus,
    MarketDataSourcesResponse,
    MarketDataSourceStatus,
    StockIntelligenceRequest,
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
        return TickerFinancialsResponse(
            symbol=symbol,
            reports=[
                FundamentalReportStatus(reportType="statements", available=True),
                FundamentalReportStatus(reportType="estimates", available=False, message="No estimates in fake source."),
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
    market_sources = FakeMarketDataSourceService()
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
    assert "Current financial data sources did not return analyst estimate tables." in response.limitations
    assert "No external consensus/news provider is ready yet." in response.limitations
    assert "keyword" in " ".join(response.plan.notes).lower()


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
