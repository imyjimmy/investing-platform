"""General intelligence routes."""

from __future__ import annotations

from fastapi import APIRouter

from investing_platform.models import StockIntelligenceRequest, StockIntelligenceResponse
from investing_platform.services.base import BrokerUnavailableError

from ._helpers import bad_request, service_unavailable, stock_intelligence_service


router = APIRouter(prefix="/intelligence", tags=["intelligence"])


@router.post("/stock/ask", response_model=StockIntelligenceResponse)
def stock_intelligence_ask(request: StockIntelligenceRequest) -> StockIntelligenceResponse:
    try:
        return stock_intelligence_service().ask(request)
    except ValueError as exc:
        bad_request(exc)
    except BrokerUnavailableError as exc:
        service_unavailable(exc)
    except RuntimeError as exc:
        service_unavailable(exc)
