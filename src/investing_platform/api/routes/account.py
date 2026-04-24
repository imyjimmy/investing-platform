"""Account routes."""

from __future__ import annotations

from fastapi import APIRouter, Query

from investing_platform.models import (
    AccountSnapshot,
    OpenOrdersResponse,
    OptionPositionsResponse,
    OptionStrategyPermissionsResponse,
    PositionsResponse,
    RiskSummaryResponse,
)
from investing_platform.services.analytics import build_risk_summary
from investing_platform.services.base import BrokerUnavailableError

from ._helpers import broker_service, portfolio_snapshot, service_unavailable, settings


router = APIRouter(prefix="/account", tags=["account"])


@router.get("/summary", response_model=AccountSnapshot)
def account_summary(accountId: str | None = Query(default=None)) -> AccountSnapshot:
    snapshot = portfolio_snapshot(accountId)
    return snapshot.account


@router.get("/positions", response_model=PositionsResponse)
def account_positions(accountId: str | None = Query(default=None)) -> PositionsResponse:
    snapshot = portfolio_snapshot(accountId)
    return PositionsResponse(
        positions=snapshot.positions,
        generatedAt=snapshot.generated_at,
        isStale=snapshot.is_stale,
    )


@router.get("/options-positions", response_model=OptionPositionsResponse)
def account_option_positions(accountId: str | None = Query(default=None)) -> OptionPositionsResponse:
    snapshot = portfolio_snapshot(accountId)
    return OptionPositionsResponse(
        positions=snapshot.option_positions,
        generatedAt=snapshot.generated_at,
        isStale=snapshot.is_stale,
    )


@router.get("/options-strategy-permissions", response_model=OptionStrategyPermissionsResponse)
def account_option_strategy_permissions(
    accountId: str,
    symbol: str,
    expiry: str | None = Query(default=None),
) -> OptionStrategyPermissionsResponse:
    try:
        return broker_service().get_option_strategy_permissions(accountId, symbol, expiry)
    except BrokerUnavailableError as exc:
        service_unavailable(exc)
    except Exception as exc:
        service_unavailable(exc)


@router.get("/open-orders", response_model=OpenOrdersResponse)
def open_orders(accountId: str | None = Query(default=None)) -> OpenOrdersResponse:
    snapshot = portfolio_snapshot(accountId)
    total_committed = sum(
        order.estimatedCapitalImpact for order in snapshot.open_orders if order.openingOrClosing != "closing"
    )
    put_selling = sum(
        order.estimatedCapitalImpact
        for order in snapshot.open_orders
        if order.strategyTag == "cash-secured-put" and order.openingOrClosing != "closing"
    )
    stock_orders = sum(
        order.estimatedCapitalImpact
        for order in snapshot.open_orders
        if order.secType == "STK" and order.openingOrClosing != "closing"
    )
    return OpenOrdersResponse(
        orders=snapshot.open_orders,
        totalCommittedCapital=round(total_committed, 2),
        putSellingCapital=round(put_selling, 2),
        stockOrderCapital=round(stock_orders, 2),
        generatedAt=snapshot.generated_at,
        isStale=snapshot.is_stale,
    )


@router.get("/risk-summary", response_model=RiskSummaryResponse)
def risk_summary(accountId: str | None = Query(default=None)) -> RiskSummaryResponse:
    snapshot = portfolio_snapshot(accountId)
    return build_risk_summary(snapshot, settings().safety_buffer, settings().public_watchlist())
