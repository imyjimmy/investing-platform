"""Research source routes."""

from __future__ import annotations

from fastapi import APIRouter

from investing_platform.models import (
    EdgarDownloadRequest,
    EdgarDownloadResponse,
    EdgarSourceStatus,
    InvestorPdfDownloadRequest,
    InvestorPdfDownloadResponse,
    InvestorPdfSourceStatus,
)

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
