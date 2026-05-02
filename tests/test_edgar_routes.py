from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient

import investing_platform.api.routes.research as research_routes
from investing_platform.main import app
from investing_platform.models import (
    EdgarAnswerModelInfo,
    EdgarBodyCacheState,
    EdgarComparisonResponse,
    EdgarFreshnessState,
    EdgarIndexState,
    EdgarIntelligenceIndexRequest,
    EdgarIntelligenceIndexResponse,
    EdgarIntelligenceJob,
    EdgarIntelligenceModelState,
    EdgarIntelligenceState,
    EdgarIntelligenceStatus,
    EdgarMaintenanceState,
    EdgarMetadataState,
    EdgarPollSelector,
    EdgarQuestionCitation,
    EdgarQuestionResponse,
    EdgarQuestionTextRange,
    EdgarRetrievalState,
    EdgarSourceStatus,
    EdgarSyncResponse,
    EdgarWarmIssuerResult,
    EdgarWarmResponse,
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
        self.warm_requests: list[tuple[list[str], str, int]] = []
        self.workspace_requests: list[tuple[str, str | None]] = []

    def source_status(self) -> EdgarSourceStatus:
        return _build_source_status()

    def sync(self, request) -> EdgarSyncResponse:
        self.sync_requests.append((request.issuerQuery, request.outputDir, request.forceRefresh))
        return _build_sync_response(output_dir=request.outputDir)

    def warm(self, request) -> EdgarWarmResponse:
        self.warm_requests.append((request.issuerQueries, request.mode, request.maxFilingBodiesPerIssuer))
        return EdgarWarmResponse(
            mode=request.mode,
            requestedIssuers=len(request.issuerQueries),
            warmedIssuers=len(request.issuerQueries),
            failedIssuers=0,
            results=[
                EdgarWarmIssuerResult(
                    issuerQuery=issuer_query,
                    ticker=issuer_query.upper(),
                    status="warmed",
                    metadataStatus="fresh",
                    message="Metadata warmed.",
                )
                for issuer_query in request.issuerQueries
            ],
            generatedAt=NOW,
        )

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
                rerankerModel="Qwen3-Reranker-0.6B-mxfp8",
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

    def intelligence_ask(self, request) -> EdgarQuestionResponse:
        if "risk factors" in request.question.lower():
            citations = [
                EdgarQuestionCitation(
                    citationId="C1",
                    ticker=request.ticker,
                    accessionNumber="0000320193-26-000001",
                    form="10-K",
                    filingDate=NOW.date(),
                    documentName="a10-k2025.htm",
                    section="Item 1A. Risk Factors",
                    sectionCode="1A",
                    sectionTitle="Risk Factors",
                    sectionType="risk_factors",
                    chunkId="0000320193-26-000001:risk-factors:0001",
                    textRange=EdgarQuestionTextRange(startChar=120, endChar=260),
                    snippet="Item 1A. Risk Factors. Supply constraints may affect margins.",
                    sourcePath="/tmp/research-root/stocks/AAPL/filing/primary/a10-k2025.htm",
                    secUrl="https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/a10-k2025.htm",
                )
            ]
            return EdgarQuestionResponse(
                ticker=request.ticker,
                outputDir=request.outputDir,
                question=request.question,
                answer="Supply constraints are listed as a risk [C1].",
                confidence="medium",
                generatedAt=NOW,
                model=EdgarAnswerModelInfo(
                    provider="omlx",
                    chatModel="Qwen3.6-35B-A3B-4bit",
                    embeddingModel="nomicai-modernbert-embed-base-4bit",
                    rerankerModel="Qwen3-Reranker-0.6B-mxfp8",
                ),
                freshnessState=EdgarFreshnessState(status="fresh", liveCheckStatus="succeeded", lastMetadataRefreshAt=NOW, lastLiveCheckAt=NOW),
                maintenanceState=EdgarMaintenanceState(status="none", elapsedMs=12),
                retrievalState=EdgarRetrievalState(chunksRetrieved=1, chunksUsed=1, eligibleAccessionsSearched=1, indexVersion="edgar-intelligence-index-v1"),
                citations=citations,
                limitations=[],
            )
        return EdgarQuestionResponse(
            ticker=request.ticker,
            outputDir=request.outputDir,
            question=request.question,
            answer="I cannot answer this from the retrieved SEC filing excerpts.",
            confidence="low",
            generatedAt=NOW,
            model=EdgarAnswerModelInfo(
                provider="omlx",
                chatModel="Qwen3.6-35B-A3B-4bit",
                embeddingModel="nomicai-modernbert-embed-base-4bit",
                rerankerModel="Qwen3-Reranker-0.6B-mxfp8",
            ),
            freshnessState=EdgarFreshnessState(status="fresh", liveCheckStatus="succeeded", lastMetadataRefreshAt=NOW, lastLiveCheckAt=NOW),
            maintenanceState=EdgarMaintenanceState(status="none", elapsedMs=12),
            retrievalState=EdgarRetrievalState(chunksRetrieved=0, chunksUsed=0, eligibleAccessionsSearched=0, indexVersion="edgar-intelligence-index-v1"),
            citations=[],
            limitations=["No retrieved filing evidence was strong enough to answer safely."],
        )

    def intelligence_compare(self, request) -> EdgarComparisonResponse:
        return EdgarComparisonResponse(
            ticker=request.ticker,
            outputDir=request.outputDir,
            comparisonMode=request.comparisonMode,
            resolvedQuestion=f"Compare 000-new, 000-prior for {request.ticker}. User question: {request.question}",
            targetAccessions=["000-new", "000-prior"],
            answer="Compared target filings [C1].",
            confidence="medium",
            generatedAt=NOW,
            freshnessState=EdgarFreshnessState(status="fresh", liveCheckStatus="succeeded", lastMetadataRefreshAt=NOW, lastLiveCheckAt=NOW),
            maintenanceState=EdgarMaintenanceState(status="none", elapsedMs=12),
            retrievalState=EdgarRetrievalState(chunksRetrieved=2, chunksUsed=2, eligibleAccessionsSearched=2, indexVersion="edgar-intelligence-index-v1"),
            citations=[],
            limitations=[],
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


def test_edgar_warm_route_returns_bounded_warming_contract(monkeypatch) -> None:
    fake_service = FakeEdgarService()
    monkeypatch.setattr(research_routes, "edgar_service", lambda: fake_service)

    with TestClient(app) as client:
        response = client.post(
            "/api/sources/edgar/warm",
            json={
                "issuerQueries": ["aapl", "nvda"],
                "mode": "metadata-only",
                "maxFilingBodiesPerIssuer": 0,
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "metadata-only"
    assert payload["warmedIssuers"] == 2
    assert payload["results"][0]["metadataStatus"] == "fresh"
    assert fake_service.warm_requests == [(["aapl", "nvda"], "metadata-only", 0)]


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


def test_edgar_intelligence_ask_route_returns_guarded_response_shape(monkeypatch) -> None:
    fake_service = FakeEdgarService()
    monkeypatch.setattr(research_routes, "edgar_service", lambda: fake_service)

    with TestClient(app) as client:
        response = client.post(
            "/api/sources/edgar/intelligence/ask",
            json={
                "ticker": "AAPL",
                "question": "What does the filing say about lithium exposure?",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ticker"] == "AAPL"
    assert payload["answer"] == "I cannot answer this from the retrieved SEC filing excerpts."
    assert payload["confidence"] == "low"
    assert payload["citations"] == []
    assert payload["retrievalState"]["chunksRetrieved"] == 0


def test_edgar_intelligence_ask_route_serializes_section_citation_fields(monkeypatch) -> None:
    fake_service = FakeEdgarService()
    monkeypatch.setattr(research_routes, "edgar_service", lambda: fake_service)

    with TestClient(app) as client:
        response = client.post(
            "/api/sources/edgar/intelligence/ask",
            json={
                "ticker": "AAPL",
                "question": "What changed in risk factors?",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["answer"] == "Supply constraints are listed as a risk [C1]."
    assert payload["citations"][0]["section"] == "Item 1A. Risk Factors"
    assert payload["citations"][0]["sectionCode"] == "1A"
    assert payload["citations"][0]["sectionTitle"] == "Risk Factors"
    assert payload["citations"][0]["sectionType"] == "risk_factors"


def test_edgar_intelligence_compare_route_returns_targeted_response_shape(monkeypatch) -> None:
    fake_service = FakeEdgarService()
    monkeypatch.setattr(research_routes, "edgar_service", lambda: fake_service)

    with TestClient(app) as client:
        response = client.post(
            "/api/sources/edgar/intelligence/compare",
            json={
                "ticker": "AAPL",
                "comparisonMode": "latest-annual-vs-prior-annual",
                "question": "What changed in risk factors?",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ticker"] == "AAPL"
    assert payload["comparisonMode"] == "latest-annual-vs-prior-annual"
    assert payload["targetAccessions"] == ["000-new", "000-prior"]
    assert payload["answer"] == "Compared target filings [C1]."
    assert payload["retrievalState"]["eligibleAccessionsSearched"] == 2
