"""System and connectivity routes."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter

from investing_platform import __version__
from investing_platform.models import ConnectionStatus, HealthResponse

from ._helpers import broker_service, service_unavailable


router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    service = broker_service()
    return HealthResponse(
        ok=True,
        service="investing-platform",
        version=__version__,
        timestamp=datetime.now(UTC),
        connection=service.connection_status(),
    )


@router.get("/connection-status", response_model=ConnectionStatus)
def connection_status() -> ConnectionStatus:
    return broker_service().connection_status()


@router.post("/connect", response_model=ConnectionStatus)
def connect() -> ConnectionStatus:
    try:
        return broker_service().connect(force=False)
    except Exception as exc:
        service_unavailable(exc)


@router.post("/reconnect", response_model=ConnectionStatus)
def reconnect() -> ConnectionStatus:
    try:
        return broker_service().reconnect()
    except Exception as exc:
        service_unavailable(exc)
