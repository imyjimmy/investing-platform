"""FastAPI routes for the investing platform."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query

from investing_platform import __version__
from investing_platform.models import (
    EdgarDownloadRequest,
    InvestorPdfDownloadRequest,
    OptionOrderRequest,
    PlaidPublicTokenExchangeRequest,
)
from investing_platform.services.analytics import (
    build_collateral_summary,
    build_exposure_by_expiry,
    build_exposure_by_ticker,
    build_premium_summary,
    build_risk_summary,
    build_scenario,
)
from investing_platform.services.app_state import (
    get_broker_service,
    get_coinbase_service,
    get_edgar_service,
    get_investor_pdf_service,
    get_plaid_service,
    get_settings,
    get_universe_screener_service,
)
from investing_platform.services.base import BrokerUnavailableError


router = APIRouter(prefix="/api")


def _service():
    return get_broker_service()


def _settings():
    return get_settings()


def _edgar():
    return get_edgar_service()


def _investor_pdfs():
    return get_investor_pdf_service()


def _coinbase():
    return get_coinbase_service()


def _plaid():
    return get_plaid_service()


def _universe():
    return get_universe_screener_service()


@router.get("/health")
def health() -> dict:
    service = _service()
    return {
        "ok": True,
        "service": "investing-platform",
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
def account_summary(accountId: str | None = Query(default=None)) -> dict:
    snapshot = _portfolio_snapshot(accountId)
    return snapshot.account.model_dump()


@router.get("/account/positions")
def account_positions(accountId: str | None = Query(default=None)) -> dict:
    snapshot = _portfolio_snapshot(accountId)
    return {
        "positions": [position.model_dump() for position in snapshot.positions],
        "generatedAt": snapshot.generated_at,
        "isStale": snapshot.is_stale,
    }


@router.get("/account/options-positions")
def account_option_positions(accountId: str | None = Query(default=None)) -> dict:
    snapshot = _portfolio_snapshot(accountId)
    return {
        "positions": [position.model_dump() for position in snapshot.option_positions],
        "generatedAt": snapshot.generated_at,
        "isStale": snapshot.is_stale,
    }


@router.get("/account/open-orders")
def open_orders(accountId: str | None = Query(default=None)) -> dict:
    snapshot = _portfolio_snapshot(accountId)
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
def risk_summary(accountId: str | None = Query(default=None)) -> dict:
    snapshot = _portfolio_snapshot(accountId)
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


@router.get("/market/universe")
def market_universe() -> dict:
    try:
        return _universe().get_latest_snapshot().model_dump()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/market/crypto-majors")
def crypto_majors() -> dict:
    try:
        return _coinbase().get_major_market().model_dump()
    except Exception as exc:
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
def collateral(accountId: str | None = Query(default=None)) -> dict:
    snapshot = _portfolio_snapshot(accountId)
    return build_collateral_summary(snapshot, _settings().safety_buffer).model_dump()


@router.get("/analytics/exposure-by-ticker")
def exposure_by_ticker(accountId: str | None = Query(default=None)) -> dict:
    snapshot = _portfolio_snapshot(accountId)
    return {
        "rows": [row.model_dump() for row in build_exposure_by_ticker(snapshot)],
        "generatedAt": snapshot.generated_at,
        "isStale": snapshot.is_stale,
    }


@router.get("/analytics/exposure-by-expiry")
def exposure_by_expiry(accountId: str | None = Query(default=None)) -> dict:
    snapshot = _portfolio_snapshot(accountId)
    return {
        "rows": [row.model_dump() for row in build_exposure_by_expiry(snapshot)],
        "generatedAt": snapshot.generated_at,
        "isStale": snapshot.is_stale,
    }


@router.get("/analytics/premium-summary")
def premium_summary(accountId: str | None = Query(default=None)) -> dict:
    snapshot = _portfolio_snapshot(accountId)
    return build_premium_summary(snapshot).model_dump()


@router.get("/analytics/scenario")
def scenario(
    movePct: float = Query(default=-10.0, ge=-80.0, le=80.0),
    daysForward: int = Query(default=7, ge=0, le=90),
    ivShockPct: float = Query(default=0.0, ge=-80.0, le=200.0),
    accountId: str | None = Query(default=None),
) -> dict:
    snapshot = _portfolio_snapshot(accountId)
    return build_scenario(snapshot, movePct, daysForward, ivShockPct).model_dump()


def _portfolio_snapshot(account_id: str | None = None):
    try:
        return _service().get_portfolio_snapshot(account_id)
    except BrokerUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/execution/options/preview")
def preview_option_order(request: OptionOrderRequest) -> dict:
    try:
        return _service().preview_option_order(request).model_dump()
    except BrokerUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/execution/options/submit", status_code=201)
def submit_option_order(request: OptionOrderRequest) -> dict:
    try:
        return _service().submit_option_order(request).model_dump()
    except BrokerUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/execution/orders/{order_id}/cancel")
def cancel_order(order_id: int, accountId: str = Query(...)) -> dict:
    try:
        return _service().cancel_order(accountId, order_id).model_dump()
    except BrokerUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/sources/edgar/status")
def edgar_status() -> dict:
    return _edgar().source_status().model_dump()


@router.get("/sources/coinbase/status")
def coinbase_status() -> dict:
    return _coinbase().source_status().model_dump()


@router.get("/sources/coinbase/portfolio")
def coinbase_portfolio() -> dict:
    try:
        return _coinbase().get_portfolio().model_dump()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/sources/plaid/connectors/{connector_id}/status")
def plaid_connector_status(connector_id: str) -> dict:
    try:
        return _plaid().connector_status(connector_id).model_dump()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/sources/plaid/connectors/{connector_id}/link-token")
def plaid_connector_link_token(connector_id: str) -> dict:
    try:
        return _plaid().create_link_token(connector_id).model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/sources/plaid/connectors/{connector_id}/exchange")
def plaid_connector_exchange(connector_id: str, request: PlaidPublicTokenExchangeRequest) -> dict:
    try:
        return _plaid().exchange_public_token(connector_id, request).model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/sources/plaid/connectors/{connector_id}/portfolio")
def plaid_connector_portfolio(connector_id: str) -> dict:
    try:
        return _plaid().get_portfolio(connector_id).model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/sources/edgar/download")
def edgar_download(request: EdgarDownloadRequest) -> dict:
    try:
        return _edgar().download(request).model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/sources/edgar/last-sync")
def edgar_last_sync(request: EdgarDownloadRequest) -> dict | None:
    try:
        result = _edgar().last_sync(request)
        return result.model_dump() if result else None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/sources/investor-pdfs/status")
def investor_pdf_status() -> dict:
    return _investor_pdfs().source_status().model_dump()


@router.post("/sources/investor-pdfs/download")
def investor_pdf_download(request: InvestorPdfDownloadRequest) -> dict:
    try:
        return _investor_pdfs().download(request).model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/sources/investor-pdfs/last-sync")
def investor_pdf_last_sync(request: InvestorPdfDownloadRequest) -> dict | None:
    try:
        result = _investor_pdfs().last_sync(request)
        return result.model_dump() if result else None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
