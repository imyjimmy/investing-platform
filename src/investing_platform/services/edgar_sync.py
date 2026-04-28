"""Ticker-scoped EDGAR sync orchestration."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from investing_platform.config import DashboardSettings
from investing_platform.models import (
    EdgarDownloadRequest,
    EdgarDownloadResponse,
    EdgarIntelligenceState,
    EdgarMetadataState,
    EdgarSyncRequest,
    EdgarSyncResponse,
    EdgarWorkspaceRequest,
    EdgarWorkspaceResponse,
    EdgarWorkspaceSelector,
)
from investing_platform.services.edgar_common import DownloadCounters, SUBMISSIONS_URL_TEMPLATE


class EdgarSyncService:
    """Coordinate the simplified ticker-scoped EDGAR sync workflow."""

    def __init__(
        self,
        settings: DashboardSettings,
        *,
        resolver: Any,
        metadata_cache: Any,
        artifact_store: Any,
        intelligence: Any,
    ) -> None:
        self._settings = settings
        self._resolver = resolver
        self._metadata_cache = metadata_cache
        self._artifact_store = artifact_store
        self._intelligence = intelligence

    def sync(self, request: EdgarSyncRequest) -> EdgarSyncResponse:
        options = self._artifact_store._default_runtime_options()
        if not options.user_agent:
            raise ValueError("A descriptive SEC User-Agent is required.")

        output_root = Path(request.outputDir).expanduser() if request.outputDir else self._settings.research_root
        output_root.mkdir(parents=True, exist_ok=True)

        resolved = self._resolver.resolve_issuer_query(request.issuerQuery, options, force_refresh=request.forceRefresh)
        paths = self._artifact_store._workspace_paths(output_root, resolved.ticker)
        self._artifact_store._ensure_workspace_dirs(paths)

        manifest = self._artifact_store._load_manifest(paths.manifest_path)
        counters = DownloadCounters()
        baseline_state = self._metadata_cache.ensure_bulk_baseline(options, force_refresh=request.forceRefresh)
        previous_metadata_snapshot = self._metadata_cache.load_snapshot(resolved.cik10)
        previous_accessions = self._metadata_cache.snapshot_accessions(previous_metadata_snapshot)
        previous_accession_state = self._artifact_store._load_accession_state(paths.accession_state_path)
        metadata_status = "fresh"
        metadata_message: str | None = None
        metadata_refreshed_at: datetime | None = None
        metadata_live_checked_at: datetime | None = None

        try:
            payloads = self._artifact_store._fetch_submission_payloads(
                resolved=resolved,
                options=options,
                submissions_dir=paths.submissions_dir,
                manifest=manifest,
                edgar_root=paths.edgar_root,
                counters=counters,
                previous_metadata_snapshot=previous_metadata_snapshot,
                force_refresh=request.forceRefresh,
            )
            current_filings = self._artifact_store._build_filing_rows(payloads, resolved)
            all_filings = self._metadata_cache.merge_cached_filing_rows(current_filings, previous_metadata_snapshot)
            metadata_snapshot = self._metadata_cache.persist_snapshot(resolved, all_filings)
            metadata_refreshed_at = self._artifact_store._parse_datetime(metadata_snapshot.get("lastRefreshedAt"))
            metadata_live_checked_at = self._artifact_store._parse_datetime(metadata_snapshot.get("lastLiveCheckedAt"))
        except RuntimeError as exc:
            cached_filings = previous_metadata_snapshot.get("filings") if previous_metadata_snapshot else None
            if isinstance(cached_filings, list) and cached_filings:
                all_filings = [filing for filing in cached_filings if isinstance(filing, dict)]
                metadata_status = "degraded"
                metadata_message = f"Live SEC metadata refresh failed. Using cached issuer metadata. {exc}"
                metadata_refreshed_at = self._artifact_store._parse_datetime(previous_metadata_snapshot.get("lastRefreshedAt")) if previous_metadata_snapshot else None
                metadata_live_checked_at = self._artifact_store._parse_datetime(previous_metadata_snapshot.get("lastLiveCheckedAt")) if previous_metadata_snapshot else None
            else:
                raise

        if baseline_state.get("status") == "degraded" and metadata_status != "fresh":
            baseline_message = "The app-global EDGAR bulk baseline could not be fully refreshed."
            metadata_message = f"{metadata_message} {baseline_message}".strip() if metadata_message else baseline_message

        latest_submission_url = SUBMISSIONS_URL_TEMPLATE.format(cik10=resolved.cik10)
        self._artifact_store._write_json_artifact(paths.exports_dir / "all-filings.json", all_filings, latest_submission_url, manifest, paths.edgar_root)
        self._artifact_store._write_csv_artifact(paths.exports_dir / "all-filings.csv", all_filings, manifest, paths.edgar_root)

        selected_filings = self._artifact_store._select_smart_working_set(all_filings)
        self._artifact_store._write_json_artifact(paths.exports_dir / "matched-filings.json", selected_filings, latest_submission_url, manifest, paths.edgar_root)
        self._artifact_store._write_csv_artifact(paths.exports_dir / "matched-filings.csv", selected_filings, manifest, paths.edgar_root)

        download_request = EdgarDownloadRequest(
            ticker=resolved.ticker,
            outputDir=str(output_root),
            downloadMode="primary-document",
            includeExhibits=False,
            resume=not request.forceRefresh,
        )
        cached_accessions: set[str] = set()
        downloaded_accessions: set[str] = set()
        skipped_accessions: set[str] = set()
        failed_accessions: set[str] = set()
        for filing in selected_filings:
            accession = str(filing.get("accessionNumber") or "")
            before_downloaded = counters.downloaded_files
            before_skipped = counters.skipped_files
            try:
                self._artifact_store._download_filing_assets(
                    filing=filing,
                    request=download_request,
                    options=options,
                    filings_dir=paths.stock_root,
                    edgar_root=paths.edgar_root,
                    manifest=manifest,
                    counters=counters,
                )
            except RuntimeError:
                counters.failed_files += 1
                if accession:
                    failed_accessions.add(accession)
            else:
                if accession:
                    if counters.downloaded_files > before_downloaded:
                        downloaded_accessions.add(accession)
                    elif counters.skipped_files > before_skipped:
                        skipped_accessions.add(accession)
            if self._artifact_store._filing_is_cached(paths.stock_root, filing) and accession:
                cached_accessions.add(accession)

        synced_at = datetime.now(UTC)
        metadata_state = EdgarMetadataState(
            status=metadata_status,
            lastRefreshedAt=metadata_refreshed_at or synced_at,
            lastLiveCheckedAt=metadata_live_checked_at or synced_at,
            newAccessions=len({str(filing.get("accessionNumber") or "") for filing in all_filings} - previous_accessions),
            message=metadata_message,
        )
        body_cache_state = self._artifact_store._build_body_cache_state(
            counters=counters,
            matched_filings=len(selected_filings),
            cached_filings=len({accession for accession in cached_accessions if accession}),
            last_refreshed_at=synced_at,
        )
        self._artifact_store._persist_accession_state(
            path=paths.accession_state_path,
            ticker=resolved.ticker,
            cik10=resolved.cik10,
            stock_root=paths.stock_root,
            all_filings=all_filings,
            selected_filings=selected_filings,
            cached_accessions=cached_accessions,
            downloaded_accessions=downloaded_accessions,
            skipped_accessions=skipped_accessions,
            failed_accessions=failed_accessions,
            previous_state=previous_accession_state,
            refreshed_at=synced_at,
        )
        intelligence_state = self._intelligence.status_for_paths(paths)

        legacy_response = EdgarDownloadResponse(
            companyName=resolved.company_name,
            ticker=resolved.ticker,
            cik=resolved.cik10,
            totalFilingsConsidered=len(all_filings),
            matchedFilings=len(selected_filings),
            metadataFilesSynced=counters.metadata_files_synced,
            downloadedFiles=counters.downloaded_files,
            skippedFiles=counters.skipped_files,
            failedFiles=counters.failed_files,
            downloadMode=download_request.downloadMode,
            includeExhibits=download_request.includeExhibits,
            resume=download_request.resume,
            researchRootPath=str(output_root),
            stockPath=str(paths.stock_root),
            filingsPath=str(paths.stock_root),
            edgarPath=str(paths.edgar_root),
            exportsJsonPath=str(paths.exports_dir / "matched-filings.json"),
            exportsCsvPath=str(paths.exports_dir / "matched-filings.csv"),
            manifestPath=str(paths.manifest_path),
            syncedAt=synced_at,
        )
        self._artifact_store._write_json_artifact(paths.last_sync_path, legacy_response.model_dump(mode="json"), "generated://edgar-last-sync", manifest, paths.edgar_root)
        manifest["lastRun"] = legacy_response.model_dump(mode="json")
        self._artifact_store._save_manifest(paths.manifest_path, manifest)
        self._artifact_store._persist_workspace_snapshot_from_download_response(legacy_response, metadata_state=metadata_state, intelligence_state=intelligence_state)

        return EdgarSyncResponse(
            issuerQuery=request.issuerQuery,
            resolvedTicker=resolved.ticker,
            resolvedCompanyName=resolved.company_name,
            resolvedCik=resolved.cik10,
            workspace=EdgarWorkspaceSelector(
                ticker=resolved.ticker,
                outputDir=str(output_root) if request.outputDir else None,
            ),
            metadataState=metadata_state,
            bodyCacheState=body_cache_state,
            intelligenceState=intelligence_state,
        )

    def workspace(self, request: EdgarWorkspaceRequest) -> EdgarWorkspaceResponse | None:
        output_root = Path(request.outputDir).expanduser() if request.outputDir else self._settings.research_root
        paths = self._artifact_store._workspace_paths(output_root, request.ticker)
        if paths.workspace_path.exists():
            payload = self._artifact_store._load_json_document(paths.workspace_path)
            if payload:
                return EdgarWorkspaceResponse.model_validate(payload)

        legacy_request = EdgarDownloadRequest(ticker=request.ticker, outputDir=str(output_root))
        legacy_response = self._artifact_store.last_sync(legacy_request, resolver=self._resolver)
        if legacy_response is None:
            return None
        return self._artifact_store._build_workspace_snapshot_from_download_response(
            legacy_response,
            metadata_state=EdgarMetadataState(
                status="stale",
                lastRefreshedAt=legacy_response.syncedAt,
                lastLiveCheckedAt=legacy_response.syncedAt,
                newAccessions=0,
                message="This workspace was created before the simplified EDGAR sync state was available.",
            ),
            intelligence_state=self._intelligence.status_for_paths(paths),
        )

    def intelligence_status(self, ticker: str, output_dir: str | None = None, job_id: str | None = None) -> EdgarIntelligenceState:
        request = EdgarWorkspaceRequest(ticker=ticker, outputDir=output_dir)
        output_root = Path(output_dir).expanduser() if output_dir else self._settings.research_root
        paths = self._artifact_store._workspace_paths(output_root, request.ticker)
        workspace = self.workspace(request)
        return self._intelligence.status_for_workspace(workspace=workspace, request=request, paths=paths, job_id=job_id)
