"""Research source routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from investing_platform.models import (
    EdgarDownloadRequest,
    EdgarDownloadResponse,
    EdgarComparisonRequest,
    EdgarComparisonResponse,
    EdgarIntelligenceIndexRequest,
    EdgarIntelligenceIndexResponse,
    EdgarIntelligenceStatus,
    EdgarSourceStatus,
    EdgarSyncRequest,
    EdgarSyncResponse,
    EdgarQuestionRequest,
    EdgarQuestionResponse,
    EdgarWorkspaceRequest,
    EdgarWorkspaceResponse,
    InvestorPdfDownloadRequest,
    InvestorPdfDownloadResponse,
    InvestorPdfSourceStatus,
)

from investing_platform.services.edgar_intelligence import EdgarIntelligenceApiError

from ._helpers import edgar_service, investor_pdf_service, bad_request, upstream_error


router = APIRouter(prefix="/sources", tags=["research"])


@router.get("/edgar/status", response_model=EdgarSourceStatus)
def edgar_status() -> EdgarSourceStatus:
    return edgar_service().source_status()


@router.post("/edgar/download", response_model=EdgarDownloadResponse)
def edgar_download(request: EdgarDownloadRequest) -> EdgarDownloadResponse:
    try:
        return edgar_service().download(request)
    except ValueError as exc:
        bad_request(exc)
    except RuntimeError as exc:
        upstream_error(exc)


@router.post("/edgar/last-sync", response_model=EdgarDownloadResponse | None)
def edgar_last_sync(request: EdgarDownloadRequest) -> EdgarDownloadResponse | None:
    try:
        return edgar_service().last_sync(request)
    except ValueError as exc:
        bad_request(exc)
    except RuntimeError as exc:
        upstream_error(exc)


@router.post("/edgar/sync", response_model=EdgarSyncResponse)
def edgar_sync(request: EdgarSyncRequest) -> EdgarSyncResponse:
    try:
        return edgar_service().sync(request)
    except ValueError as exc:
        bad_request(exc)
    except RuntimeError as exc:
        upstream_error(exc)


@router.post("/edgar/workspace", response_model=EdgarWorkspaceResponse | None)
def edgar_workspace(request: EdgarWorkspaceRequest) -> EdgarWorkspaceResponse | None:
    try:
        return edgar_service().workspace(request)
    except ValueError as exc:
        bad_request(exc)
    except RuntimeError as exc:
        upstream_error(exc)


@router.get("/edgar/intelligence/status", response_model=EdgarIntelligenceStatus)
def edgar_intelligence_status(ticker: str, outputDir: str | None = None, jobId: str | None = None) -> EdgarIntelligenceStatus:
    try:
        return edgar_service().intelligence_api_status(ticker=ticker, output_dir=outputDir, job_id=jobId)
    except ValueError as exc:
        bad_request(exc)
    except RuntimeError as exc:
        upstream_error(exc)


@router.post("/edgar/intelligence/index", response_model=EdgarIntelligenceIndexResponse)
def edgar_intelligence_index(request: EdgarIntelligenceIndexRequest) -> EdgarIntelligenceIndexResponse:
    try:
        return edgar_service().intelligence_index(request)
    except EdgarIntelligenceApiError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail.model_dump(mode="json")) from exc
    except ValueError as exc:
        bad_request(exc)
    except RuntimeError as exc:
        upstream_error(exc)


@router.post("/edgar/intelligence/ask", response_model=EdgarQuestionResponse)
def edgar_intelligence_ask(request: EdgarQuestionRequest) -> EdgarQuestionResponse:
    try:
        return edgar_service().intelligence_ask(request)
    except EdgarIntelligenceApiError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail.model_dump(mode="json")) from exc
    except ValueError as exc:
        bad_request(exc)
    except RuntimeError as exc:
        upstream_error(exc)


@router.post("/edgar/intelligence/compare", response_model=EdgarComparisonResponse)
def edgar_intelligence_compare(request: EdgarComparisonRequest) -> EdgarComparisonResponse:
    try:
        return edgar_service().intelligence_compare(request)
    except EdgarIntelligenceApiError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail.model_dump(mode="json")) from exc
    except ValueError as exc:
        bad_request(exc)
    except RuntimeError as exc:
        upstream_error(exc)


@router.get("/investor-pdfs/status", response_model=InvestorPdfSourceStatus)
def investor_pdf_status() -> InvestorPdfSourceStatus:
    return investor_pdf_service().source_status()


@router.post("/investor-pdfs/download", response_model=InvestorPdfDownloadResponse)
def investor_pdf_download(request: InvestorPdfDownloadRequest) -> InvestorPdfDownloadResponse:
    try:
        return investor_pdf_service().download(request)
    except ValueError as exc:
        bad_request(exc)
    except RuntimeError as exc:
        upstream_error(exc)


@router.post("/investor-pdfs/last-sync", response_model=InvestorPdfDownloadResponse | None)
def investor_pdf_last_sync(request: InvestorPdfDownloadRequest) -> InvestorPdfDownloadResponse | None:
    try:
        return investor_pdf_service().last_sync(request)
    except ValueError as exc:
        bad_request(exc)
    except RuntimeError as exc:
        upstream_error(exc)
