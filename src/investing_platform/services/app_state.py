"""Application-scoped dashboard service factory."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from investing_platform.config import DashboardSettings
from investing_platform.services.base import BrokerService
from investing_platform.services.coinbase import CoinbaseService
from investing_platform.services.edgar import EdgarDownloader
from investing_platform.services.filesystem_connectors import FilesystemConnectorService
from investing_platform.services.ib_gateway import IBGatewayBrokerService
from investing_platform.services.investor_pdfs import InvestorPdfDownloader
from investing_platform.services.mock_broker import MockBrokerService
from investing_platform.services.universe_screener import UniverseScreenerService


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
    return EdgarDownloader(get_settings())


@lru_cache(maxsize=1)
def get_investor_pdf_service() -> InvestorPdfDownloader:
    return InvestorPdfDownloader(get_settings())


@lru_cache(maxsize=1)
def get_coinbase_service() -> CoinbaseService:
    return CoinbaseService(get_settings())


@lru_cache(maxsize=1)
def get_filesystem_connector_service() -> FilesystemConnectorService:
    return FilesystemConnectorService(get_settings())


@lru_cache(maxsize=1)
def get_universe_screener_service() -> UniverseScreenerService:
    return UniverseScreenerService(Path(__file__).resolve().parents[3])
