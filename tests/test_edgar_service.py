from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from investing_platform.config import DashboardSettings
from investing_platform.models import EdgarDownloadResponse, EdgarSyncRequest, EdgarWorkspaceRequest
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

    monkeypatch.setattr(service, "_resolve_issuer_query", lambda issuer_query, options, force_refresh=False: resolved)
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
