"""FastAPI routes for the options dashboard."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query

from options_dashboard import __version__
from options_dashboard.services.analytics import (
    build_collateral_summary,
    build_exposure_by_expiry,
    build_exposure_by_ticker,
    build_premium_summary,
    build_risk_summary,
    build_scenario,
)
from options_dashboard.services.app_state import get_broker_service, get_settings
from options_dashboard.services.base import BrokerUnavailableError


router = APIRouter(prefix="/api")


def _service():
    return get_broker_service()


def _settings():
    return get_settings()


@router.get("/health")
def health() -> dict:
    service = _service()
    return {
        "ok": True,
        "service": "options-dashboard",
        "version": __version__,
        "timestamp": datetime.now(UTC),
        "connection": service.connection_status().model_dump(),
    }


@router.get("/connection-status")
def connection_status() -> dict:
    return _service().connection_status().model_dump()


@router.post("/connect")
def connect() -> dict:
    try:
        return _service().connect(force=False).model_dump()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/reconnect")
def reconnect() -> dict:
    try:
        return _service().reconnect().model_dump()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/account/summary")
def account_summary() -> dict:
    snapshot = _portfolio_snapshot()
    return snapshot.account.model_dump()


@router.get("/account/positions")
def account_positions() -> dict:
    snapshot = _portfolio_snapshot()
    return {
        "positions": [position.model_dump() for position in snapshot.positions],
        "generatedAt": snapshot.generated_at,
        "isStale": snapshot.is_stale,
    }


@router.get("/account/options-positions")
def account_option_positions() -> dict:
    snapshot = _portfolio_snapshot()
    return {
        "positions": [position.model_dump() for position in snapshot.option_positions],
        "generatedAt": snapshot.generated_at,
        "isStale": snapshot.is_stale,
    }


@router.get("/account/open-orders")
def open_orders() -> dict:
    snapshot = _portfolio_snapshot()
    total_committed = sum(order.estimatedCapitalImpact for order in snapshot.open_orders if order.openingOrClosing != "closing")
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
    return {
        "orders": [order.model_dump() for order in snapshot.open_orders],
        "totalCommittedCapital": round(total_committed, 2),
        "putSellingCapital": round(put_selling, 2),
        "stockOrderCapital": round(stock_orders, 2),
        "generatedAt": snapshot.generated_at,
        "isStale": snapshot.is_stale,
    }


@router.get("/account/risk-summary")
def risk_summary() -> dict:
    snapshot = _portfolio_snapshot()
    payload = build_risk_summary(snapshot, _settings().safety_buffer, _settings().public_watchlist())
    return payload.model_dump()


@router.get("/market/underlying/{symbol}")
def underlying(symbol: str) -> dict:
    try:
        return _service().get_underlying_quote(symbol).model_dump()
    except BrokerUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/market/chain/{symbol}")
def option_chain(symbol: str, expiry: str | None = Query(default=None)) -> dict:
    try:
        return _service().get_option_chain(symbol, expiry=expiry).model_dump()
    except BrokerUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/market/option-contract")
def option_contract(
    symbol: str = Query(...),
    expiry: str = Query(...),
    strike: float = Query(...),
    right: str = Query(..., pattern="^[CPcp]$"),
) -> dict:
    chain = option_chain(symbol, expiry)
    for row in chain["rows"]:
        if abs(float(row["strike"]) - float(strike)) > 1e-6:
            continue
        side_prefix = "call" if right.upper() == "C" else "put"
        return {
            "symbol": symbol.upper(),
            "expiry": expiry,
            "strike": strike,
            "right": right.upper(),
            "bid": row.get(f"{side_prefix}Bid"),
            "ask": row.get(f"{side_prefix}Ask"),
            "mid": row.get(f"{side_prefix}Mid"),
            "iv": row.get(f"{side_prefix}IV"),
            "delta": row.get(f"{side_prefix}Delta"),
            "theta": row.get(f"{side_prefix}Theta"),
            "generatedAt": chain["generatedAt"],
            "isStale": chain["isStale"],
        }
    raise HTTPException(status_code=404, detail="Requested option contract was not found in the selected chain snapshot.")


@router.get("/analytics/collateral")
def collateral() -> dict:
    snapshot = _portfolio_snapshot()
    return build_collateral_summary(snapshot, _settings().safety_buffer).model_dump()


@router.get("/analytics/exposure-by-ticker")
def exposure_by_ticker() -> dict:
    snapshot = _portfolio_snapshot()
    return {
        "rows": [row.model_dump() for row in build_exposure_by_ticker(snapshot)],
        "generatedAt": snapshot.generated_at,
        "isStale": snapshot.is_stale,
    }


@router.get("/analytics/exposure-by-expiry")
def exposure_by_expiry() -> dict:
    snapshot = _portfolio_snapshot()
    return {
        "rows": [row.model_dump() for row in build_exposure_by_expiry(snapshot)],
        "generatedAt": snapshot.generated_at,
        "isStale": snapshot.is_stale,
    }


@router.get("/analytics/premium-summary")
def premium_summary() -> dict:
    snapshot = _portfolio_snapshot()
    return build_premium_summary(snapshot).model_dump()


@router.get("/analytics/scenario")
def scenario(
    movePct: float = Query(default=-10.0, ge=-80.0, le=80.0),
    daysForward: int = Query(default=7, ge=0, le=90),
    ivShockPct: float = Query(default=0.0, ge=-80.0, le=200.0),
) -> dict:
    snapshot = _portfolio_snapshot()
    return build_scenario(snapshot, movePct, daysForward, ivShockPct).model_dump()


def _portfolio_snapshot():
    try:
        return _service().get_portfolio_snapshot()
    except BrokerUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
