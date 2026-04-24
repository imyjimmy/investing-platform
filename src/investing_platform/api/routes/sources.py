"""Connector and source routes."""

from __future__ import annotations

from fastapi import APIRouter, Query

from investing_platform.models import (
    CoinbasePortfolioResponse,
    CoinbaseSourceStatus,
    FilesystemConnectorConfigRequest,
    FilesystemConnectorPortfolioResponse,
    FilesystemConnectorStatus,
    FilesystemDocumentFolderResponse,
    FinnhubConnectorConfigRequest,
    FinnhubSourceStatus,
    OkxSourceStatus,
)

from ._helpers import (
    bad_request,
    coinbase_service,
    filesystem_connector_service,
    finnhub_service,
    not_found,
    okx_service,
    service_unavailable,
    upstream_error,
)


router = APIRouter(prefix="/sources", tags=["sources"])


@router.get("/coinbase/status", response_model=CoinbaseSourceStatus)
def coinbase_status() -> CoinbaseSourceStatus:
    return coinbase_service().source_status()


@router.get("/coinbase/portfolio", response_model=CoinbasePortfolioResponse)
def coinbase_portfolio() -> CoinbasePortfolioResponse:
    try:
        return coinbase_service().get_portfolio()
    except Exception as exc:
        service_unavailable(exc)


@router.get("/finnhub/status", response_model=FinnhubSourceStatus)
def finnhub_status() -> FinnhubSourceStatus:
    return finnhub_service().source_status()


@router.post("/finnhub/configure", response_model=FinnhubSourceStatus)
def finnhub_configure(request: FinnhubConnectorConfigRequest) -> FinnhubSourceStatus:
    try:
        return finnhub_service().configure(request)
    except ValueError as exc:
        bad_request(exc)
    except Exception as exc:
        service_unavailable(exc)


@router.get("/okx/status", response_model=OkxSourceStatus)
def okx_status() -> OkxSourceStatus:
    return okx_service().source_status()


@router.get("/filesystem/connectors", response_model=list[FilesystemConnectorStatus])
def filesystem_connectors(accountKey: str = Query(...)) -> list[FilesystemConnectorStatus]:
    try:
        return filesystem_connector_service().list_connectors(accountKey)
    except Exception as exc:
        service_unavailable(exc)


@router.post("/filesystem/connectors/{connector_id}/configure", response_model=FilesystemConnectorStatus)
def filesystem_connector_configure(
    connector_id: str,
    request: FilesystemConnectorConfigRequest,
    accountKey: str = Query(...),
    sourceId: str | None = Query(default=None),
) -> FilesystemConnectorStatus:
    try:
        return filesystem_connector_service().configure_connector(accountKey, connector_id, request, sourceId)
    except ValueError as exc:
        bad_request(exc)


@router.get("/filesystem/sources/{source_id}/status", response_model=FilesystemConnectorStatus)
def filesystem_connector_status(source_id: str, accountKey: str = Query(...)) -> FilesystemConnectorStatus:
    try:
        return filesystem_connector_service().connector_status(accountKey, source_id)
    except ValueError as exc:
        not_found(exc)
    except Exception as exc:
        service_unavailable(exc)


@router.get("/filesystem/sources/{source_id}/portfolio", response_model=FilesystemConnectorPortfolioResponse)
def filesystem_connector_portfolio(source_id: str, accountKey: str = Query(...)) -> FilesystemConnectorPortfolioResponse:
    try:
        return filesystem_connector_service().get_portfolio(accountKey, source_id)
    except ValueError as exc:
        bad_request(exc)
    except RuntimeError as exc:
        upstream_error(exc)


@router.get("/filesystem/sources/{source_id}/documents", response_model=FilesystemDocumentFolderResponse)
def filesystem_connector_documents(source_id: str, accountKey: str = Query(...)) -> FilesystemDocumentFolderResponse:
    try:
        return filesystem_connector_service().get_document_library(accountKey, source_id)
    except ValueError as exc:
        bad_request(exc)
    except RuntimeError as exc:
        upstream_error(exc)
