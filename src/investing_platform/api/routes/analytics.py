"""Analytics routes."""

from __future__ import annotations

from fastapi import APIRouter, Query

from investing_platform.models import (
    CollateralSummary,
    ExposureByExpiryResponse,
    ExposureByTickerResponse,
    OptionIntelligenceRequest,
    OptionIntelligenceResponse,
    PremiumSummary,
    ScenarioResponse,
)
from investing_platform.services.analytics import (
    build_collateral_summary,
    build_exposure_by_expiry,
    build_exposure_by_ticker,
    build_premium_summary,
    build_scenario,
)
from investing_platform.services.base import BrokerUnavailableError
from investing_platform.services.options_intelligence import analyze_option_contract

from ._helpers import bad_request, broker_service, market_data_service, not_found, portfolio_snapshot, service_unavailable, settings


router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/collateral", response_model=CollateralSummary)
def collateral(accountId: str | None = Query(default=None)) -> CollateralSummary:
    snapshot = portfolio_snapshot(accountId)
    return build_collateral_summary(snapshot, settings().safety_buffer)


@router.get("/exposure-by-ticker", response_model=ExposureByTickerResponse)
def exposure_by_ticker(accountId: str | None = Query(default=None)) -> ExposureByTickerResponse:
    snapshot = portfolio_snapshot(accountId)
    return ExposureByTickerResponse(
        rows=build_exposure_by_ticker(snapshot),
        generatedAt=snapshot.generated_at,
        isStale=snapshot.is_stale,
    )


@router.get("/exposure-by-expiry", response_model=ExposureByExpiryResponse)
def exposure_by_expiry(accountId: str | None = Query(default=None)) -> ExposureByExpiryResponse:
    snapshot = portfolio_snapshot(accountId)
    return ExposureByExpiryResponse(
        rows=build_exposure_by_expiry(snapshot),
        generatedAt=snapshot.generated_at,
        isStale=snapshot.is_stale,
    )


@router.get("/premium-summary", response_model=PremiumSummary)
def premium_summary(accountId: str | None = Query(default=None)) -> PremiumSummary:
    snapshot = portfolio_snapshot(accountId)
    return build_premium_summary(snapshot)


@router.get("/scenario", response_model=ScenarioResponse)
def scenario(
    movePct: float = Query(default=-10.0, ge=-80.0, le=80.0),
    daysForward: int = Query(default=7, ge=0, le=90),
    ivShockPct: float = Query(default=0.0, ge=-80.0, le=200.0),
    accountId: str | None = Query(default=None),
) -> ScenarioResponse:
    snapshot = portfolio_snapshot(accountId)
    return build_scenario(snapshot, movePct, daysForward, ivShockPct)


@router.post("/options-intelligence", response_model=OptionIntelligenceResponse)
def options_intelligence(request: OptionIntelligenceRequest) -> OptionIntelligenceResponse:
    try:
        snapshot = portfolio_snapshot(request.accountId)
        ticker_overview = None
        try:
            ticker_overview = market_data_service().get_ticker_overview(request.symbol)
        except Exception:
            ticker_overview = None
        return analyze_option_contract(request, broker_service(), snapshot, ticker_overview=ticker_overview)
    except BrokerUnavailableError as exc:
        service_unavailable(exc)
    except ValueError as exc:
        not_found(exc)
    except Exception as exc:
        bad_request(exc)
