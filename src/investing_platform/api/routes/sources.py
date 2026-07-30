"""Connector and source routes."""

from __future__ import annotations

from fastapi import APIRouter, Query, Response, status

from investing_platform.models import (
    CoinbasePortfolioResponse,
    CoinbaseSourceStatus,
    FilesystemConnectorConfigRequest,
    FilesystemConnectorPortfolioResponse,
    FilesystemConnectorStatus,
    FilesystemDocumentFolderResponse,
    FinnhubConnectorConfigRequest,
    FinnhubSourceStatus,
    IbkrConnectorConfigRequest,
    IbkrConnectorStatus,
    IbkrPortfolioResponse,
    MarketDataSourceConfigRequest,
    MarketDataSourceStatus,
    MarketDataSourcesResponse,
    OkxSourceStatus,
)

from ._helpers import (
    bad_request,
    coinbase_service,
    filesystem_connector_service,
    finnhub_service,
    ibkr_connector_service,
    market_data_source_service,
    not_found,
    okx_service,
    service_unavailable,
    upstream_error,
)


router = APIRouter(prefix="/sources", tags=["sources"])


@router.get("/ibkr/connector", response_model=IbkrConnectorStatus)
def ibkr_connector_status(accountKey: str = Query(...)) -> IbkrConnectorStatus:
    return ibkr_connector_service().status(accountKey)


@router.get("/ibkr/portfolio", response_model=IbkrPortfolioResponse)
def ibkr_connector_portfolio(accountKey: str = Query(...)) -> IbkrPortfolioResponse:
    try:
        return ibkr_connector_service().portfolio(accountKey)
    except ValueError as exc:
        bad_request(exc)
    except Exception as exc:
        service_unavailable(exc)


@router.post("/ibkr/connector", response_model=IbkrConnectorStatus)
def ibkr_connector_configure(request: IbkrConnectorConfigRequest, accountKey: str = Query(...)) -> IbkrConnectorStatus:
    try:
        return ibkr_connector_service().configure(accountKey, request)
    except ValueError as exc:
        bad_request(exc)


@router.post("/ibkr/connector/test", response_model=IbkrConnectorStatus)
def ibkr_connector_test(accountKey: str = Query(...)) -> IbkrConnectorStatus:
    try:
        return ibkr_connector_service().test(accountKey)
    except ValueError as exc:
        bad_request(exc)
    except Exception as exc:
        service_unavailable(exc)


@router.post("/ibkr/connector/flex/sync", response_model=IbkrConnectorStatus)
def ibkr_connector_flex_sync(accountKey: str = Query(...)) -> IbkrConnectorStatus:
    try:
        return ibkr_connector_service().sync_flex(accountKey)
    except ValueError as exc:
        bad_request(exc)
    except Exception as exc:
        service_unavailable(exc)


@router.delete("/ibkr/connector", status_code=status.HTTP_204_NO_CONTENT)
def ibkr_connector_remove(accountKey: str = Query(...)) -> Response:
    try:
        ibkr_connector_service().remove(accountKey)
    except ValueError as exc:
        not_found(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
def finnhub_status(probe: bool = Query(default=False)) -> FinnhubSourceStatus:
    return finnhub_service().source_status(probe=probe)


@router.post("/finnhub/configure", response_model=FinnhubSourceStatus)
def finnhub_configure(request: FinnhubConnectorConfigRequest) -> FinnhubSourceStatus:
    try:
        return finnhub_service().configure(request)
    except ValueError as exc:
        bad_request(exc)
    except Exception as exc:
        service_unavailable(exc)


@router.get("/market-data-sources/status", response_model=MarketDataSourcesResponse)
def market_data_sources_status() -> MarketDataSourcesResponse:
    return market_data_source_service().source_status()


@router.post("/market-data-sources/{provider_id}/configure", response_model=MarketDataSourceStatus)
def market_data_source_configure(provider_id: str, request: MarketDataSourceConfigRequest) -> MarketDataSourceStatus:
    try:
        return market_data_source_service().configure(provider_id, request)
    except ValueError as exc:
        bad_request(exc)
    except Exception as exc:
        service_unavailable(exc)


@router.get("/okx/status", response_model=OkxSourceStatus)
def okx_status(probe: bool = Query(default=False)) -> OkxSourceStatus:
    return okx_service().source_status(probe=probe)


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


@router.post("/filesystem/sources/{source_id}/enabled", response_model=FilesystemConnectorStatus)
def filesystem_connector_set_enabled(
    source_id: str,
    enabled: bool = Query(...),
    accountKey: str = Query(...),
) -> FilesystemConnectorStatus:
    try:
        return filesystem_connector_service().set_enabled(accountKey, source_id, enabled)
    except ValueError as exc:
        not_found(exc)


@router.post("/filesystem/sources/{source_id}/test", response_model=FilesystemConnectorStatus)
def filesystem_connector_test(source_id: str, accountKey: str = Query(...)) -> FilesystemConnectorStatus:
    try:
        return filesystem_connector_service().test_connector(accountKey, source_id)
    except ValueError as exc:
        bad_request(exc)


@router.delete("/filesystem/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
def filesystem_connector_remove(source_id: str, accountKey: str = Query(...)) -> Response:
    try:
        filesystem_connector_service().remove_connector(accountKey, source_id)
    except ValueError as exc:
        not_found(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
