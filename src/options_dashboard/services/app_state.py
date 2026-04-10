"""Application-scoped dashboard service factory."""

from __future__ import annotations

from functools import lru_cache

from options_dashboard.config import DashboardSettings
from options_dashboard.services.base import BrokerService
from options_dashboard.services.edgar import EdgarDownloader
from options_dashboard.services.ib_gateway import IBGatewayBrokerService
from options_dashboard.services.investor_pdfs import InvestorPdfDownloader
from options_dashboard.services.mock_broker import MockBrokerService


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
