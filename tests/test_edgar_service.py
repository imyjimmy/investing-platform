from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from investing_platform.config import DashboardSettings
from investing_platform.models import (
    EdgarAnswerModelInfo,
    EdgarBodyCacheState,
    EdgarFreshnessState,
    EdgarIndexState,
    EdgarIntelligenceIndexResponse,
    EdgarIntelligenceJob,
    EdgarIntelligenceState,
    EdgarMaintenanceState,
    EdgarMetadataState,
    EdgarPollSelector,
    EdgarQuestionRequest,
    EdgarQuestionResponse,
    EdgarRetrievalState,
    EdgarDownloadResponse,
    EdgarSyncRequest,
    EdgarSyncResponse,
    EdgarWorkspaceRequest,
    EdgarWorkspaceResponse,
    EdgarWorkspaceSelector,
)
from investing_platform.services.edgar import EdgarDownloader, DownloadCounters, ResolvedCompany


NOW = datetime(2026, 4, 27, 20, 15, tzinfo=UTC)


def _build_service(tmp_path: Path) -> tuple[EdgarDownloader, DashboardSettings]:
    research_root = tmp_path / "research-root"
    settings = DashboardSettings(
        research_root=research_root,
        edgar_user_agent="Investing Platform tests@example.com",
    )
    return EdgarDownloader(settings), settings


def _sample_resolved_company() -> ResolvedCompany:
    return ResolvedCompany(
        cik="320193",
        cik10="0000320193",
        ticker="AAPL",
        company_name="Apple Inc.",
        submissions_payload={"name": "Apple Inc.", "cik": "0000320193", "tickers": ["AAPL"]},
    )


def _sample_filings() -> list[dict[str, str | None]]:
    return [
        {
            "ticker": "AAPL",
            "companyName": "Apple Inc.",
            "cik": "320193",
            "cik10": "0000320193",
            "form": "10-K",
            "filingDate": "2026-01-30",
            "reportDate": "2025-09-27",
            "acceptanceDateTime": "2026-01-30T21:15:00Z",
            "accessionNumber": "0000320193-26-000001",
            "accessionNumberNoDashes": "000032019326000001",
            "primaryDocument": "a10-k2025.htm",
            "primaryDocDescription": "Annual report",
            "items": None,
            "act": "34",
            "fileNumber": "001-36743",
            "filmNumber": "26543210",
            "size": None,
            "isXBRL": None,
            "isInlineXBRL": None,
            "archiveBaseUrl": "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001",
            "primaryDocumentUrl": "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/a10-k2025.htm",
        },
        {
            "ticker": "AAPL",
            "companyName": "Apple Inc.",
            "cik": "320193",
            "cik10": "0000320193",
            "form": "10-Q/A",
            "filingDate": "2025-11-01",
            "reportDate": "2025-09-27",
            "acceptanceDateTime": "2025-11-01T22:00:00Z",
            "accessionNumber": "0000320193-25-000210",
            "accessionNumberNoDashes": "000032019325000210",
            "primaryDocument": "a10-qa2025q4.htm",
            "primaryDocDescription": "Quarterly report amendment",
            "items": None,
            "act": "34",
            "fileNumber": "001-36743",
            "filmNumber": "25543210",
            "size": None,
            "isXBRL": None,
            "isInlineXBRL": None,
            "archiveBaseUrl": "https://www.sec.gov/Archives/edgar/data/320193/000032019325000210",
            "primaryDocumentUrl": "https://www.sec.gov/Archives/edgar/data/320193/000032019325000210/a10-qa2025q4.htm",
        },
        {
            "ticker": "AAPL",
            "companyName": "Apple Inc.",
            "cik": "320193",
            "cik10": "0000320193",
            "form": "8-K/A",
            "filingDate": "2025-10-15",
            "reportDate": "2025-10-14",
            "acceptanceDateTime": "2025-10-15T12:30:00Z",
            "accessionNumber": "0000320193-25-000198",
            "accessionNumberNoDashes": "000032019325000198",
            "primaryDocument": "a8-ka10142025.htm",
            "primaryDocDescription": "Current report amendment",
            "items": "2.02",
            "act": "34",
            "fileNumber": "001-36743",
            "filmNumber": "25540001",
            "size": None,
            "isXBRL": None,
            "isInlineXBRL": None,
            "archiveBaseUrl": "https://www.sec.gov/Archives/edgar/data/320193/000032019325000198",
            "primaryDocumentUrl": "https://www.sec.gov/Archives/edgar/data/320193/000032019325000198/a8-ka10142025.htm",
        },
    ]


def test_sync_writes_workspace_state_and_uses_app_global_cache_for_non_default_output_dir(tmp_path, monkeypatch) -> None:
    service, settings = _build_service(tmp_path)
    custom_output_root = tmp_path / "custom-output-root"
    resolved = _sample_resolved_company()
    filings = _sample_filings()

    monkeypatch.setattr(service._resolver_service, "resolve_issuer_query", lambda issuer_query, options, force_refresh=False: resolved)
    monkeypatch.setattr(service._metadata_cache_service, "ensure_bulk_baseline", lambda options, force_refresh=False: {"status": "ready", "artifacts": {}})
    monkeypatch.setattr(
        service,
        "_fetch_submission_payloads",
        lambda **kwargs: [{"stub": "payload"}],
    )
    monkeypatch.setattr(service, "_build_filing_rows", lambda payloads, resolved_company: filings)

    def fake_download_filing_assets(*, filing, request, options, filings_dir, edgar_root, manifest, counters) -> None:
        destination = filings_dir / service._filing_folder_name(filing) / "primary" / str(filing["primaryDocument"])
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text("<html>filing body</html>", encoding="utf-8")
        counters.downloaded_files += 1

    monkeypatch.setattr(service, "_download_filing_assets", fake_download_filing_assets)

    response = service.sync(EdgarSyncRequest(issuerQuery="AAPL", outputDir=str(custom_output_root)))

    workspace_path = custom_output_root / "stocks" / "AAPL" / ".edgar" / "manifests" / "workspace.json"
    accession_state_path = custom_output_root / "stocks" / "AAPL" / ".edgar" / "metadata" / "accession-state.json"
    global_metadata_path = settings.research_root / ".sec" / "filing-metadata" / "issuers" / "CIK0000320193.json"

    assert response.workspace.outputDir == str(custom_output_root)
    assert workspace_path.exists()
    assert accession_state_path.exists()
    assert global_metadata_path.exists()

    accession_state = json.loads(accession_state_path.read_text(encoding="utf-8"))
    assert accession_state["processingVersions"]["bodyCoveragePolicyVersion"] == "phase1-default-v1"
    assert accession_state["latestKnownAccession"] == "0000320193-26-000001"
    assert accession_state["accessions"]["0000320193-25-000198"]["isAmendment"] is True


def test_workspace_falls_back_to_legacy_last_sync_when_simplified_snapshot_is_missing(tmp_path) -> None:
    service, _settings = _build_service(tmp_path)
    legacy_output_root = tmp_path / "legacy-output-root"
    manifests_dir = legacy_output_root / "stocks" / "AAPL" / ".edgar" / "manifests"
    manifests_dir.mkdir(parents=True, exist_ok=True)

    legacy_response = EdgarDownloadResponse(
        companyName="Apple Inc.",
        ticker="AAPL",
        cik="0000320193",
        totalFilingsConsidered=12,
        matchedFilings=3,
        metadataFilesSynced=1,
        downloadedFiles=3,
        skippedFiles=0,
        failedFiles=0,
        downloadMode="primary-document",
        includeExhibits=False,
        resume=True,
        researchRootPath=str(legacy_output_root),
        stockPath=str(legacy_output_root / "stocks" / "AAPL"),
        filingsPath=str(legacy_output_root / "stocks" / "AAPL"),
        edgarPath=str(legacy_output_root / "stocks" / "AAPL" / ".edgar"),
        exportsJsonPath=str(legacy_output_root / "stocks" / "AAPL" / ".edgar" / "exports" / "matched-filings.json"),
        exportsCsvPath=str(legacy_output_root / "stocks" / "AAPL" / ".edgar" / "exports" / "matched-filings.csv"),
        manifestPath=str(manifests_dir / "download-manifest.json"),
        syncedAt=NOW,
    )
    (manifests_dir / "last-sync.json").write_text(
        json.dumps(legacy_response.model_dump(mode="json"), indent=2, sort_keys=True),
        encoding="utf-8",
    )

    workspace = service.workspace(EdgarWorkspaceRequest(ticker="AAPL", outputDir=str(legacy_output_root)))

    assert workspace is not None
    assert workspace.ticker == "AAPL"
    assert workspace.workspace.outputDir == str(legacy_output_root)
    assert workspace.metadataState.status == "stale"
    assert "before the simplified EDGAR sync state" in str(workspace.metadataState.message)


def test_ask_time_sync_limits_new_filing_body_downloads(tmp_path, monkeypatch) -> None:
    service, _settings = _build_service(tmp_path)
    resolved = _sample_resolved_company()
    filings = []
    for index in range(7):
        filings.append(
            {
                "ticker": "AAPL",
                "companyName": "Apple Inc.",
                "cik": "320193",
                "cik10": "0000320193",
                "form": "8-K",
                "filingDate": f"2026-01-{30 - index:02d}",
                "reportDate": f"2026-01-{30 - index:02d}",
                "acceptanceDateTime": f"2026-01-{30 - index:02d}T12:00:00Z",
                "accessionNumber": f"0000320193-26-00000{index}",
                "accessionNumberNoDashes": f"00003201932600000{index}",
                "primaryDocument": f"a8-k-{index}.htm",
                "primaryDocDescription": "Current report",
                "items": "2.02",
                "act": "34",
                "fileNumber": "001-36743",
                "filmNumber": f"2654321{index}",
                "size": None,
                "isXBRL": None,
                "isInlineXBRL": None,
                "archiveBaseUrl": f"https://www.sec.gov/Archives/edgar/data/320193/00003201932600000{index}",
                "primaryDocumentUrl": f"https://www.sec.gov/Archives/edgar/data/320193/00003201932600000{index}/a8-k-{index}.htm",
            }
        )

    monkeypatch.setattr(service._resolver_service, "resolve_issuer_query", lambda issuer_query, options, force_refresh=False: resolved)
    monkeypatch.setattr(service._metadata_cache_service, "ensure_bulk_baseline", lambda options, force_refresh=False: {"status": "ready", "artifacts": {}})
    monkeypatch.setattr(service, "_fetch_submission_payloads", lambda **kwargs: [{"stub": "payload"}])
    monkeypatch.setattr(service, "_build_filing_rows", lambda payloads, resolved_company: filings)
    monkeypatch.setattr(service, "_select_smart_working_set", lambda all_filings: all_filings)
    downloaded_accessions: list[str] = []

    def fake_download_filing_assets(*, filing, request, options, filings_dir, edgar_root, manifest, counters) -> None:
        downloaded_accessions.append(str(filing["accessionNumber"]))
        destination = filings_dir / service._filing_folder_name(filing) / "primary" / str(filing["primaryDocument"])
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text("<html>filing body</html>", encoding="utf-8")
        counters.downloaded_files += 1

    monkeypatch.setattr(service, "_download_filing_assets", fake_download_filing_assets)

    response = service._sync_service._sync(
        EdgarSyncRequest(issuerQuery="AAPL"),
        max_uncached_filing_bodies=5,
    )

    assert downloaded_accessions == [str(filing["accessionNumber"]) for filing in filings[:5]]
    assert response.bodyCacheState.status == "partial"
    assert response.bodyCacheState.matchedFilings == 7
    assert response.bodyCacheState.cachedFilings == 5
    assert response.bodyCacheState.downloadedFilings == 5
    assert response.bodyCacheState.skippedFilings == 2
    assert "deferred the remaining filing bodies" in str(response.bodyCacheState.message)


def test_ask_runs_bounded_maintenance_before_answer(tmp_path, monkeypatch) -> None:
    service, settings = _build_service(tmp_path)
    sync_service = service._sync_service
    stale_workspace = _workspace_response(settings, metadata_status="stale", body_status="missing")
    fresh_workspace = _workspace_response(settings, metadata_status="fresh", body_status="ready")
    workspace_calls = 0
    sync_calls: list[tuple[str, str | None, int | None]] = []
    fake_intelligence = _AskMaintenanceFakeIntelligence(settings)
    sync_service._intelligence = fake_intelligence

    def fake_workspace(request: EdgarWorkspaceRequest) -> EdgarWorkspaceResponse:
        nonlocal workspace_calls
        workspace_calls += 1
        return stale_workspace if workspace_calls == 1 else fresh_workspace

    def fake_sync(request: EdgarSyncRequest, *, max_uncached_filing_bodies: int | None = None) -> EdgarSyncResponse:
        sync_calls.append((request.issuerQuery, request.outputDir, max_uncached_filing_bodies))
        return EdgarSyncResponse(
            issuerQuery=request.issuerQuery,
            resolvedTicker="AAPL",
            resolvedCompanyName="Apple Inc.",
            resolvedCik="0000320193",
            workspace=EdgarWorkspaceSelector(ticker="AAPL", outputDir=request.outputDir),
            metadataState=EdgarMetadataState(status="fresh", lastRefreshedAt=NOW, lastLiveCheckedAt=NOW, newAccessions=2),
            bodyCacheState=EdgarBodyCacheState(
                status="updated",
                lastRefreshedAt=NOW,
                matchedFilings=2,
                cachedFilings=2,
                downloadedFilings=2,
                skippedFilings=0,
                failedFilings=0,
            ),
            intelligenceState=EdgarIntelligenceState(status="unavailable"),
        )

    monkeypatch.setattr(sync_service, "workspace", fake_workspace)
    monkeypatch.setattr(sync_service, "_sync", fake_sync)

    response = sync_service.intelligence_ask(
        EdgarQuestionRequest(ticker="AAPL", question="What changed in revenue?")
    )

    assert sync_calls == [("AAPL", None, 5)]
    assert fake_intelligence.index_limits == {
        "max_documents": 5,
        "max_chunks": 250,
        "max_index_seconds": 20.0,
        "job_kind": "ask_maintenance",
    }
    assert fake_intelligence.answer_calls == 1
    assert response.maintenanceState.status == "completed"
    assert response.maintenanceState.newAccessionsDiscovered == 2
    assert response.maintenanceState.filingBodiesDownloaded == 2
    assert response.maintenanceState.documentsIndexed == 1
    assert response.maintenanceState.chunksEmbedded == 1
    assert response.maintenanceState.jobId == "job-ask-maintenance"


def _workspace_response(
    settings: DashboardSettings,
    *,
    metadata_status: str,
    body_status: str,
) -> EdgarWorkspaceResponse:
    return EdgarWorkspaceResponse(
        ticker="AAPL",
        companyName="Apple Inc.",
        cik="0000320193",
        workspace=EdgarWorkspaceSelector(ticker="AAPL"),
        stockPath=str(settings.research_root / "stocks" / "AAPL"),
        edgarPath=str(settings.research_root / "stocks" / "AAPL" / ".edgar"),
        exportsJsonPath=str(settings.research_root / "stocks" / "AAPL" / ".edgar" / "exports" / "matched-filings.json"),
        exportsCsvPath=str(settings.research_root / "stocks" / "AAPL" / ".edgar" / "exports" / "matched-filings.csv"),
        manifestPath=str(settings.research_root / "stocks" / "AAPL" / ".edgar" / "manifests" / "download-manifest.json"),
        lastSyncedAt=NOW,
        metadataState=EdgarMetadataState(
            status=metadata_status,  # type: ignore[arg-type]
            lastRefreshedAt=NOW,
            lastLiveCheckedAt=NOW,
            newAccessions=0,
        ),
        bodyCacheState=EdgarBodyCacheState(
            status=body_status,  # type: ignore[arg-type]
            lastRefreshedAt=NOW,
            matchedFilings=0,
            cachedFilings=0,
            downloadedFilings=0,
            skippedFilings=0,
            failedFilings=0,
        ),
        intelligenceState=EdgarIntelligenceState(status="unavailable"),
    )


class _AskMaintenanceFakeIntelligence:
    def __init__(self, settings: DashboardSettings) -> None:
        self._settings = settings
        self.indexed = False
        self.index_limits: dict[str, object] = {}
        self.answer_calls = 0

    def _index_state(self, paths) -> EdgarIndexState:
        return EdgarIndexState(
            status="ready" if self.indexed else "missing",
            indexVersion="edgar-intelligence-index-v1",
            corpusVersion="primary-documents-v1",
            chunkingVersion="edgar-chunking-v1",
            embeddingModel=self._settings.llm_embed_model,
            eligibleAccessions=1 if self.indexed else 0,
            indexedAccessions=1 if self.indexed else 0,
            indexedChunks=1 if self.indexed else 0,
            limitations=[] if self.indexed else ["No EDGAR intelligence index has been built for this workspace."],
        )

    def index_workspace(self, *, workspace, request, paths, max_documents, max_chunks, max_index_seconds, job_kind):
        self.indexed = True
        self.index_limits = {
            "max_documents": max_documents,
            "max_chunks": max_chunks,
            "max_index_seconds": max_index_seconds,
            "job_kind": job_kind,
        }
        index_state = self._index_state(paths)
        job = EdgarIntelligenceJob(jobId="job-ask-maintenance", kind="ask_maintenance", status="completed", updatedAt=NOW, completedAt=NOW)
        return EdgarIntelligenceIndexResponse(
            ticker=request.ticker,
            outputDir=request.outputDir,
            status="completed",
            mode="inline",
            jobId="job-ask-maintenance",
            pollSelector=EdgarPollSelector(ticker=request.ticker, outputDir=request.outputDir, jobId="job-ask-maintenance"),
            indexState=index_state,
            job=job,
            message="Index request completed.",
        )

    def answer_question(self, *, workspace, request, paths) -> EdgarQuestionResponse:
        self.answer_calls += 1
        return EdgarQuestionResponse(
            ticker=request.ticker,
            outputDir=request.outputDir,
            question=request.question,
            answer="Revenue changed according to the filing [C1].",
            confidence="medium",
            generatedAt=NOW,
            model=EdgarAnswerModelInfo(
                provider="omlx",
                chatModel=self._settings.llm_chat_model,
                embeddingModel=self._settings.llm_embed_model,
                rerankerModel=self._settings.llm_rerank_model,
            ),
            freshnessState=EdgarFreshnessState(status="fresh", liveCheckStatus="succeeded", lastMetadataRefreshAt=NOW, lastLiveCheckAt=NOW),
            maintenanceState=EdgarMaintenanceState(status="none"),
            retrievalState=EdgarRetrievalState(chunksRetrieved=1, chunksUsed=1, eligibleAccessionsSearched=1, indexVersion="edgar-intelligence-index-v1"),
            citations=[],
            limitations=[],
        )
