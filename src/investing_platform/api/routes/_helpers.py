"""Shared service access and HTTP error mapping for API routers."""

from __future__ import annotations

from typing import NoReturn

from fastapi import HTTPException

from investing_platform.services.app_state import (
    get_broker_service,
    get_coinbase_service,
    get_edgar_service,
    get_filesystem_connector_service,
    get_finnhub_service,
    get_investor_pdf_service,
    get_market_data_service,
    get_okx_service,
    get_settings,
    get_universe_screener_service,
)
from investing_platform.services.base import BrokerUnavailableError


def broker_service():
    return get_broker_service()


def settings():
    return get_settings()


def edgar_service():
    return get_edgar_service()


def investor_pdf_service():
    return get_investor_pdf_service()


def coinbase_service():
    return get_coinbase_service()


def filesystem_connector_service():
    return get_filesystem_connector_service()


def finnhub_service():
    return get_finnhub_service()


def okx_service():
    return get_okx_service()


def market_data_service():
    return get_market_data_service()


def universe_service():
    return get_universe_screener_service()


def portfolio_snapshot(account_id: str | None = None):
    try:
        return broker_service().get_portfolio_snapshot(account_id)
    except BrokerUnavailableError as exc:
        service_unavailable(exc)


def bad_request(exc: Exception) -> NoReturn:
    raise HTTPException(status_code=400, detail=str(exc)) from exc


def not_found(exc: Exception) -> NoReturn:
    raise HTTPException(status_code=404, detail=str(exc)) from exc


def upstream_error(exc: Exception) -> NoReturn:
    raise HTTPException(status_code=502, detail=str(exc)) from exc


def service_unavailable(exc: Exception) -> NoReturn:
    raise HTTPException(status_code=503, detail=str(exc)) from exc
