"""Execution routes."""

from __future__ import annotations

from fastapi import APIRouter, Query

from investing_platform.models import (
    OptionOrderPreview,
    OptionOrderRequest,
    OrderCancelResponse,
    StockOrderPreview,
    StockOrderRequest,
    SubmittedOrder,
)
from investing_platform.services.base import BrokerUnavailableError

from ._helpers import bad_request, broker_service, service_unavailable


router = APIRouter(prefix="/execution", tags=["execution"])


@router.post("/options/preview", response_model=OptionOrderPreview)
def preview_option_order(request: OptionOrderRequest) -> OptionOrderPreview:
    try:
        return broker_service().preview_option_order(request)
    except BrokerUnavailableError as exc:
        service_unavailable(exc)
    except Exception as exc:
        bad_request(exc)


@router.post("/options/submit", response_model=SubmittedOrder, status_code=201)
def submit_option_order(request: OptionOrderRequest) -> SubmittedOrder:
    try:
        return broker_service().submit_option_order(request)
    except BrokerUnavailableError as exc:
        service_unavailable(exc)
    except Exception as exc:
        bad_request(exc)


@router.post("/stocks/preview", response_model=StockOrderPreview)
def preview_stock_order(request: StockOrderRequest) -> StockOrderPreview:
    try:
        return broker_service().preview_stock_order(request)
    except BrokerUnavailableError as exc:
        service_unavailable(exc)
    except Exception as exc:
        bad_request(exc)


@router.post("/stocks/submit", response_model=SubmittedOrder, status_code=201)
def submit_stock_order(request: StockOrderRequest) -> SubmittedOrder:
    try:
        return broker_service().submit_stock_order(request)
    except BrokerUnavailableError as exc:
        service_unavailable(exc)
    except Exception as exc:
        bad_request(exc)


@router.post("/orders/{order_id}/cancel", response_model=OrderCancelResponse)
def cancel_order(order_id: int, accountId: str = Query(...)) -> OrderCancelResponse:
    try:
        return broker_service().cancel_order(accountId, order_id)
    except BrokerUnavailableError as exc:
        service_unavailable(exc)
    except Exception as exc:
        bad_request(exc)
