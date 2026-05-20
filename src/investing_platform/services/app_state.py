"""Application-scoped dashboard service factory."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from investing_platform.config import DashboardSettings
from investing_platform.services.base import BrokerService
from investing_platform.services.coinbase import CoinbaseService
from investing_platform.services.edgar import EdgarDownloader
from investing_platform.services.filesystem_connectors import FilesystemConnectorService
from investing_platform.services.finnhub import FinnhubService
from investing_platform.services.ib_gateway import IBGatewayBrokerService
from investing_platform.services.investor_pdfs import InvestorPdfDownloader
from investing_platform.services.market_data import MarketDataService
from investing_platform.services.market_data_sources import MarketDataSourceService
from investing_platform.services.mock_broker import MockBrokerService
from investing_platform.services.okx import OkxService
from investing_platform.services.stock_intelligence import StockIntelligenceService
from investing_platform.services.universe_screener import UniverseScreenerService
from investing_platform.services.watchlist import WatchlistService


@lru_cache(maxsize=1)
def get_settings() -> DashboardSettings:
    return DashboardSettings.load()


@lru_cache(maxsize=1)
def get_broker_service() -> BrokerService:
    settings = get_settings()
    if settings.data_mode == "ibkr":
        return IBGatewayBrokerService(settings)
    return MockBrokerService(settings)


@lru_cache(maxsize=1)
def get_edgar_service() -> EdgarDownloader:
    return EdgarDownloader(get_settings(), watchlist_provider=get_watchlist_service().symbols)


@lru_cache(maxsize=1)
def get_watchlist_service() -> WatchlistService:
    return WatchlistService(get_settings())


@lru_cache(maxsize=1)
def get_investor_pdf_service() -> InvestorPdfDownloader:
    return InvestorPdfDownloader(get_settings())


@lru_cache(maxsize=1)
def get_coinbase_service() -> CoinbaseService:
    return CoinbaseService(get_settings())


@lru_cache(maxsize=1)
def get_finnhub_service() -> FinnhubService:
    return FinnhubService(get_settings())


@lru_cache(maxsize=1)
def get_okx_service() -> OkxService:
    return OkxService(get_settings())


@lru_cache(maxsize=1)
def get_filesystem_connector_service() -> FilesystemConnectorService:
    return FilesystemConnectorService(get_settings())


@lru_cache(maxsize=1)
def get_market_data_service() -> MarketDataService:
    return MarketDataService(get_broker_service(), get_finnhub_service())


@lru_cache(maxsize=1)
def get_market_data_source_service() -> MarketDataSourceService:
    return MarketDataSourceService(get_settings())


@lru_cache(maxsize=1)
def get_stock_intelligence_service() -> StockIntelligenceService:
    return StockIntelligenceService(
        market_data=get_market_data_service(),
        edgar=get_edgar_service(),
        market_data_sources=get_market_data_source_service(),
    )


@lru_cache(maxsize=1)
def get_universe_screener_service() -> UniverseScreenerService:
    return UniverseScreenerService(Path(__file__).resolve().parents[3])
