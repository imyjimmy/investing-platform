"""Application-scoped dashboard service factory."""

from __future__ import annotations

from functools import lru_cache

from options_dashboard.config import DashboardSettings
from options_dashboard.services.base import BrokerService
from options_dashboard.services.ib_gateway import IBGatewayBrokerService
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
