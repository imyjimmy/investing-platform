from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient

import investing_platform.api.routes.research as research_routes
from investing_platform.main import app
from investing_platform.models import (
    EdgarBodyCacheState,
    EdgarFreshnessState,
    EdgarIndexState,
    EdgarIntelligenceIndexRequest,
    EdgarIntelligenceIndexResponse,
    EdgarIntelligenceJob,
    EdgarIntelligenceModelState,
    EdgarIntelligenceState,
    EdgarIntelligenceStatus,
    EdgarMetadataState,
    EdgarPollSelector,
    EdgarSourceStatus,
    EdgarSyncResponse,
    EdgarWorkspaceResponse,
    EdgarWorkspaceSelector,
)
from investing_platform.services.edgar_intelligence import EdgarIntelligenceApiError


NOW = datetime(2026, 4, 27, 20, 0, tzinfo=UTC)


def _build_source_status() -> EdgarSourceStatus:
    return EdgarSourceStatus(
        available=True,
        status="ready",
        researchRootPath="/tmp/research-root",
        stocksRootPath="/tmp/research-root/stocks",
        edgarUserAgent="Investing Platform tests@example.com",
        maxRequestsPerSecond=5.0,
        timeoutSeconds=30.0,
    )


def _build_sync_response(output_dir: str | None = None) -> EdgarSyncResponse:
    return EdgarSyncResponse(
        issuerQuery="AAPL",
        resolvedTicker="AAPL",
        resolvedCompanyName="Apple Inc.",
        resolvedCik="0000320193",
        workspace=EdgarWorkspaceSelector(ticker="AAPL", outputDir=output_dir),
        metadataState=EdgarMetadataState(
            status="fresh",
            lastRefreshedAt=NOW,
            lastLiveCheckedAt=NOW,
            newAccessions=2,
        ),
        bodyCacheState=EdgarBodyCacheState(
            status="updated",
            lastRefreshedAt=NOW,
            matchedFilings=3,
            cachedFilings=3,
            downloadedFilings=2,
            skippedFilings=1,
            failedFilings=0,
        ),
        intelligenceState=EdgarIntelligenceState(
            status="unavailable",
            questionAnsweringEnabled=False,
            detail="Local filing Q&A will be enabled after the EDGAR intelligence layer is implemented.",
        ),
    )


def _build_workspace_response(output_dir: str | None = None) -> EdgarWorkspaceResponse:
    return EdgarWorkspaceResponse(
        ticker="AAPL",
        companyName="Apple Inc.",
        cik="0000320193",
        workspace=EdgarWorkspaceSelector(ticker="AAPL", outputDir=output_dir),
        stockPath=f"{output_dir or '/tmp/research-root'}/stocks/AAPL",
        edgarPath=f"{output_dir or '/tmp/research-root'}/stocks/AAPL/.edgar",
        exportsJsonPath=f"{output_dir or '/tmp/research-root'}/stocks/AAPL/.edgar/exports/matched-filings.json",
        exportsCsvPath=f"{output_dir or '/tmp/research-root'}/stocks/AAPL/.edgar/exports/matched-filings.csv",
        manifestPath=f"{output_dir or '/tmp/research-root'}/stocks/AAPL/.edgar/manifests/download-manifest.json",
        lastSyncedAt=NOW,
        metadataState=EdgarMetadataState(
            status="fresh",
            lastRefreshedAt=NOW,
            lastLiveCheckedAt=NOW,
            newAccessions=0,
        ),
        bodyCacheState=EdgarBodyCacheState(
            status="ready",
            lastRefreshedAt=NOW,
            matchedFilings=3,
            cachedFilings=3,
            downloadedFilings=0,
            skippedFilings=3,
            failedFilings=0,
        ),
        intelligenceState=EdgarIntelligenceState(
            status="unavailable",
            questionAnsweringEnabled=False,
            detail="Local filing Q&A will be enabled after the EDGAR intelligence layer is implemented.",
        ),
    )


class FakeEdgarService:
    def __init__(self) -> None:
        self.sync_requests: list[tuple[str, str | None, bool]] = []
        self.workspace_requests: list[tuple[str, str | None]] = []

    def source_status(self) -> EdgarSourceStatus:
        return _build_source_status()

    def sync(self, request) -> EdgarSyncResponse:
        self.sync_requests.append((request.issuerQuery, request.outputDir, request.forceRefresh))
        return _build_sync_response(output_dir=request.outputDir)

    def workspace(self, request) -> EdgarWorkspaceResponse:
        self.workspace_requests.append((request.ticker, request.outputDir))
        return _build_workspace_response(output_dir=request.outputDir)

    def intelligence_status(self, ticker: str, output_dir: str | None = None, job_id: str | None = None) -> EdgarIntelligenceState:
        return EdgarIntelligenceState(
            status="unavailable",
            questionAnsweringEnabled=False,
            detail=f"No EDGAR intelligence state for {ticker}.",
            jobId=job_id,
        )

    def intelligence_api_status(self, ticker: str, output_dir: str | None = None, job_id: str | None = None) -> EdgarIntelligenceStatus:
        return EdgarIntelligenceStatus(
            ticker=ticker,
            outputDir=output_dir,
            workspaceRoot=output_dir or "/tmp/research-root",
            generatedAt=NOW,
            readyForAsk=False,
            modelState=EdgarIntelligenceModelState(
                status="unavailable",
                provider="omlx",
                baseUrl="http://127.0.0.1:8001/v1",
                chatModel="Qwen3.6-35B-A3B-4bit",
                embeddingModel="nomicai-modernbert-embed-base-4bit",
                rerankerModel="mxbai-rerank-large-v2",
                lastCheckedAt=NOW,
                message="Local model server is unavailable.",
            ),
            freshnessState=EdgarFreshnessState(
                status="fresh",
                liveCheckStatus="succeeded",
                lastMetadataRefreshAt=NOW,
                lastLiveCheckAt=NOW,
            ),
            indexState=EdgarIndexState(
                status="missing",
                indexVersion="pending-v1",
                corpusVersion="primary-documents-v1",
                chunkingVersion="pending-v1",
                embeddingModel="nomicai-modernbert-embed-base-4bit",
                limitations=["No EDGAR intelligence index has been built for this workspace."],
            ),
            job=EdgarIntelligenceJob(jobId=job_id, kind="none", status="idle", updatedAt=NOW),
            limitations=["No EDGAR intelligence index has been built for this workspace."],
        )

    def intelligence_index(self, request: EdgarIntelligenceIndexRequest) -> EdgarIntelligenceIndexResponse:
        if request.includeExhibits:
            raise EdgarIntelligenceApiError(
                status_code=400,
                code="exhibits_not_supported",
                message="Curated exhibit indexing is deferred beyond phase 1.",
                ticker=request.ticker,
            )
        index_state = EdgarIndexState(
            status="missing",
            indexVersion="pending-v1",
            corpusVersion="primary-documents-v1",
            chunkingVersion="pending-v1",
            embeddingModel="nomicai-modernbert-embed-base-4bit",
        )
        job = EdgarIntelligenceJob(kind="index", status="completed", updatedAt=NOW, completedAt=NOW)
        return EdgarIntelligenceIndexResponse(
            ticker=request.ticker,
            outputDir=request.outputDir,
            status="completed",
            mode="inline",
            pollSelector=EdgarPollSelector(ticker=request.ticker, outputDir=request.outputDir),
            indexState=index_state,
            job=job,
            message="Index request completed.",
        )


def test_edgar_sync_route_returns_simplified_contract(monkeypatch) -> None:
    fake_service = FakeEdgarService()
    monkeypatch.setattr(research_routes, "edgar_service", lambda: fake_service)

    with TestClient(app) as client:
        response = client.post(
            "/api/sources/edgar/sync",
            json={
                "issuerQuery": "AAPL",
                "outputDir": "/tmp/custom-root",
                "forceRefresh": True,
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["resolvedTicker"] == "AAPL"
    assert payload["workspace"]["outputDir"] == "/tmp/custom-root"
    assert payload["metadataState"]["status"] == "fresh"
    assert payload["bodyCacheState"]["status"] == "updated"
    assert fake_service.sync_requests == [("AAPL", "/tmp/custom-root", True)]


def test_edgar_workspace_route_accepts_ticker_and_output_dir(monkeypatch) -> None:
    fake_service = FakeEdgarService()
    monkeypatch.setattr(research_routes, "edgar_service", lambda: fake_service)

    with TestClient(app) as client:
        response = client.post(
            "/api/sources/edgar/workspace",
            json={
                "ticker": "aapl",
                "outputDir": "/tmp/custom-root",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ticker"] == "AAPL"
    assert payload["workspace"]["outputDir"] == "/tmp/custom-root"
    assert payload["stockPath"] == "/tmp/custom-root/stocks/AAPL"
    assert fake_service.workspace_requests == [("AAPL", "/tmp/custom-root")]


def test_edgar_intelligence_status_route_returns_contract_shape(monkeypatch) -> None:
    fake_service = FakeEdgarService()
    monkeypatch.setattr(research_routes, "edgar_service", lambda: fake_service)

    with TestClient(app) as client:
        response = client.get(
            "/api/sources/edgar/intelligence/status",
            params={
                "ticker": "AAPL",
                "outputDir": "/tmp/custom-root",
                "jobId": "job-123",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ticker"] == "AAPL"
    assert payload["outputDir"] == "/tmp/custom-root"
    assert payload["modelState"]["provider"] == "omlx"
    assert payload["modelState"]["baseUrl"] == "http://127.0.0.1:8001/v1"
    assert payload["freshnessState"]["liveCheckStatus"] == "succeeded"
    assert payload["indexState"]["status"] == "missing"
    assert payload["job"]["jobId"] == "job-123"
    assert payload["readyForAsk"] is False


def test_edgar_intelligence_index_route_returns_structured_exhibit_error(monkeypatch) -> None:
    fake_service = FakeEdgarService()
    monkeypatch.setattr(research_routes, "edgar_service", lambda: fake_service)

    with TestClient(app) as client:
        response = client.post(
            "/api/sources/edgar/intelligence/index",
            json={
                "ticker": "AAPL",
                "outputDir": "/tmp/custom-root",
                "includeExhibits": True,
            },
        )

    assert response.status_code == 400
    payload = response.json()
    assert payload["detail"]["code"] == "exhibits_not_supported"
    assert payload["detail"]["ticker"] == "AAPL"
