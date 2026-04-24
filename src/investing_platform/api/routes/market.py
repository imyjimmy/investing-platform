"""Market data routes."""

from __future__ import annotations

from fastapi import APIRouter, Query

from investing_platform.models import (
    CryptoMarketResponse,
    OptionChainResponse,
    OptionContractQuoteResponse,
    TickerFinancialsResponse,
    TickerOverviewResponse,
    UnderlyingQuote,
    UniverseSnapshotResponse,
)
from investing_platform.services.base import BrokerUnavailableError
from investing_platform.services.market_options import get_option_chain, get_option_contract_quote

from ._helpers import broker_service, market_data_service, okx_service, service_unavailable, universe_service, not_found


router = APIRouter(prefix="/market", tags=["market"])


@router.get("/underlying/{symbol}", response_model=UnderlyingQuote)
def underlying(symbol: str) -> UnderlyingQuote:
    try:
        return market_data_service().get_underlying_quote(symbol)
    except BrokerUnavailableError as exc:
        service_unavailable(exc)
    except Exception as exc:
        service_unavailable(exc)


@router.get("/ticker/{symbol}", response_model=TickerOverviewResponse)
def ticker_overview(symbol: str) -> TickerOverviewResponse:
    try:
        return market_data_service().get_ticker_overview(symbol)
    except BrokerUnavailableError as exc:
        service_unavailable(exc)
    except Exception as exc:
        service_unavailable(exc)


@router.get("/ticker/{symbol}/financials", response_model=TickerFinancialsResponse)
def ticker_financials(symbol: str) -> TickerFinancialsResponse:
    try:
        return market_data_service().get_ticker_financials(symbol)
    except BrokerUnavailableError as exc:
        service_unavailable(exc)
    except Exception as exc:
        service_unavailable(exc)


@router.get("/chain/{symbol}", response_model=OptionChainResponse)
def option_chain(
    symbol: str,
    expiry: str | None = Query(default=None),
    strikeLimit: int | None = Query(default=None, ge=4, le=96),
    lowerMoneynessPct: float | None = Query(default=None, ge=0, le=1),
    upperMoneynessPct: float | None = Query(default=None, ge=0, le=1),
    minMoneynessPct: float | None = Query(default=None, ge=-1, le=1),
    maxMoneynessPct: float | None = Query(default=None, ge=-1, le=1),
) -> OptionChainResponse:
    try:
        return get_option_chain(
            broker_service(),
            symbol,
            expiry=expiry,
            strike_limit=strikeLimit,
            lower_moneyness_pct=lowerMoneynessPct,
            upper_moneyness_pct=upperMoneynessPct,
            min_moneyness_pct=minMoneynessPct,
            max_moneyness_pct=maxMoneynessPct,
        )
    except BrokerUnavailableError as exc:
        service_unavailable(exc)


@router.get("/universe", response_model=UniverseSnapshotResponse)
def market_universe() -> UniverseSnapshotResponse:
    try:
        return universe_service().get_latest_snapshot()
    except Exception as exc:
        service_unavailable(exc)


@router.get("/crypto-majors", response_model=CryptoMarketResponse)
def crypto_majors() -> CryptoMarketResponse:
    try:
        return okx_service().get_major_market()
    except Exception as exc:
        service_unavailable(exc)


@router.get("/option-contract", response_model=OptionContractQuoteResponse)
def option_contract(
    symbol: str = Query(...),
    expiry: str = Query(...),
    strike: float = Query(...),
    right: str = Query(..., pattern="^[CPcp]$"),
) -> OptionContractQuoteResponse:
    try:
        return get_option_contract_quote(
            broker_service(),
            symbol,
            expiry=expiry,
            strike=strike,
            right=right,
        )
    except BrokerUnavailableError as exc:
        service_unavailable(exc)
    except ValueError as exc:
        not_found(exc)
