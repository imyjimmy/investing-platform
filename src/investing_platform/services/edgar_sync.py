"""Ticker-scoped EDGAR sync orchestration."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
import time
from typing import Any

from investing_platform.config import DashboardSettings
from investing_platform.models import (
    EdgarDownloadRequest,
    EdgarDownloadResponse,
    EdgarComparisonRequest,
    EdgarComparisonResponse,
    EdgarIntelligenceIndexRequest,
    EdgarIntelligenceIndexResponse,
    EdgarIntelligenceStatus,
    EdgarIntelligenceState,
    EdgarMaintenanceState,
    EdgarMetadataState,
    EdgarQuestionRequest,
    EdgarQuestionResponse,
    EdgarSyncRequest,
    EdgarSyncResponse,
    EdgarWorkspaceRequest,
    EdgarWorkspaceResponse,
    EdgarWorkspaceSelector,
)
from investing_platform.services.edgar_common import DownloadCounters, SUBMISSIONS_URL_TEMPLATE
from investing_platform.services.edgar_intelligence import EdgarIntelligenceApiError


ASK_MAINTENANCE_MAX_SECONDS = 30.0
ASK_MAINTENANCE_MAX_NEW_BODIES = 5
ASK_MAINTENANCE_MAX_DOCUMENTS = 5
ASK_MAINTENANCE_MAX_CHUNKS = 250
ASK_MAINTENANCE_MAX_INDEX_SECONDS = 20.0


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
        return self._sync(request)

    def _sync(self, request: EdgarSyncRequest, *, max_uncached_filing_bodies: int | None = None) -> EdgarSyncResponse:
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
        body_budget_exhausted = False
        uncached_bodies_touched = 0
        for filing in selected_filings:
            accession = str(filing.get("accessionNumber") or "")
            is_uncached = not self._artifact_store._filing_is_cached(paths.stock_root, filing)
            if (
                max_uncached_filing_bodies is not None
                and is_uncached
                and uncached_bodies_touched >= max_uncached_filing_bodies
            ):
                body_budget_exhausted = True
                counters.skipped_files += 1
                if accession:
                    skipped_accessions.add(accession)
                continue
            if is_uncached:
                uncached_bodies_touched += 1
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
        if body_budget_exhausted:
            body_cache_state = body_cache_state.model_copy(
                update={
                    "status": "partial",
                    "message": (
                        f"Ask-time maintenance processed at most {max_uncached_filing_bodies} uncached filing bodies "
                        "and deferred the remaining filing bodies."
                    ),
                }
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

    def intelligence_api_status(self, ticker: str, output_dir: str | None = None, job_id: str | None = None) -> EdgarIntelligenceStatus:
        request = EdgarWorkspaceRequest(ticker=ticker, outputDir=output_dir)
        output_root = Path(output_dir).expanduser() if output_dir else self._settings.research_root
        paths = self._artifact_store._workspace_paths(output_root, request.ticker)
        workspace = self.workspace(request)
        return self._intelligence.api_status_for_workspace(workspace=workspace, request=request, paths=paths, job_id=job_id)

    def intelligence_index(self, request: EdgarIntelligenceIndexRequest) -> EdgarIntelligenceIndexResponse:
        output_root = Path(request.outputDir).expanduser() if request.outputDir else self._settings.research_root
        paths = self._artifact_store._workspace_paths(output_root, request.ticker)
        workspace = self.workspace(EdgarWorkspaceRequest(ticker=request.ticker, outputDir=request.outputDir))
        return self._intelligence.index_workspace(workspace=workspace, request=request, paths=paths)

    def intelligence_ask(self, request: EdgarQuestionRequest) -> EdgarQuestionResponse:
        output_root = Path(request.outputDir).expanduser() if request.outputDir else self._settings.research_root
        paths = self._artifact_store._workspace_paths(output_root, request.ticker)
        workspace = self.workspace(EdgarWorkspaceRequest(ticker=request.ticker, outputDir=request.outputDir))
        maintenance_state = EdgarMaintenanceState(status="none")
        workspace, maintenance_state = self._run_ask_time_maintenance(request=request, workspace=workspace, paths=paths)
        if maintenance_state.status in {"deferred", "failed"} and self._intelligence._index_state(paths).status != "ready":
            raise EdgarIntelligenceApiError(
                status_code=409,
                code="index_not_ready",
                message="The EDGAR intelligence index is not ready after bounded ask-time maintenance.",
                ticker=request.ticker,
                job_id=maintenance_state.jobId,
                retry_after_seconds=10,
                limitations=maintenance_state.limitations,
            )
        response = self._intelligence.answer_question(workspace=workspace, request=request, paths=paths)
        if maintenance_state.status == "none":
            return response
        return response.model_copy(update={"maintenanceState": maintenance_state})

    def intelligence_compare(self, request: EdgarComparisonRequest) -> EdgarComparisonResponse:
        output_root = Path(request.outputDir).expanduser() if request.outputDir else self._settings.research_root
        paths = self._artifact_store._workspace_paths(output_root, request.ticker)
        workspace = self.workspace(EdgarWorkspaceRequest(ticker=request.ticker, outputDir=request.outputDir))
        workspace, maintenance_state = self._run_ask_time_maintenance(request=request, workspace=workspace, paths=paths)
        if maintenance_state.status in {"deferred", "failed"} and self._intelligence._index_state(paths).status != "ready":
            raise EdgarIntelligenceApiError(
                status_code=409,
                code="index_not_ready",
                message="The EDGAR intelligence index is not ready after bounded ask-time maintenance.",
                ticker=request.ticker,
                job_id=maintenance_state.jobId,
                retry_after_seconds=10,
                limitations=maintenance_state.limitations,
            )
        response = self._intelligence.compare_filings(workspace=workspace, request=request, paths=paths)
        if maintenance_state.status == "none":
            return response
        return response.model_copy(update={"maintenanceState": maintenance_state})

    def _run_ask_time_maintenance(
        self,
        *,
        request: EdgarQuestionRequest,
        workspace: EdgarWorkspaceResponse | None,
        paths: Any,
    ) -> tuple[EdgarWorkspaceResponse | None, EdgarMaintenanceState]:
        started = time.monotonic()
        limitations: list[str] = []
        new_accessions = 0
        filing_bodies_downloaded = 0
        documents_indexed = 0
        chunks_embedded = 0
        job_id: str | None = None
        status = "none"
        sync_response: EdgarSyncResponse | None = None

        needs_sync = workspace is None
        if workspace is not None:
            needs_sync = (
                workspace.metadataState.status != "fresh"
                or workspace.bodyCacheState.status in {"missing", "partial", "degraded"}
            )

        if needs_sync:
            try:
                sync_response = self._sync(
                    EdgarSyncRequest(
                        issuerQuery=request.ticker,
                        outputDir=request.outputDir,
                        forceRefresh=False,
                    ),
                    max_uncached_filing_bodies=ASK_MAINTENANCE_MAX_NEW_BODIES,
                )
                workspace = self.workspace(EdgarWorkspaceRequest(ticker=request.ticker, outputDir=request.outputDir))
            except RuntimeError as exc:
                limitations.append(f"Ask-time EDGAR sync failed: {exc}")
                return workspace, self._maintenance_state(
                    status="failed" if workspace is None else "deferred",
                    started=started,
                    new_accessions=new_accessions,
                    filing_bodies_downloaded=filing_bodies_downloaded,
                    documents_indexed=documents_indexed,
                    chunks_embedded=chunks_embedded,
                    job_id=job_id,
                    limitations=limitations,
                )

            new_accessions = sync_response.metadataState.newAccessions
            filing_bodies_downloaded = sync_response.bodyCacheState.downloadedFilings
            status = "completed"
            if sync_response.metadataState.message:
                limitations.append(sync_response.metadataState.message)
            if sync_response.bodyCacheState.status in {"partial", "degraded"} and sync_response.bodyCacheState.message:
                limitations.append(sync_response.bodyCacheState.message)
            if sync_response.bodyCacheState.status == "partial":
                status = "partial"
            elif sync_response.bodyCacheState.status == "degraded":
                status = "failed"

        if time.monotonic() - started > ASK_MAINTENANCE_MAX_SECONDS:
            limitations.append(
                f"Ask-time EDGAR maintenance exceeded the {int(ASK_MAINTENANCE_MAX_SECONDS)}s budget before indexing."
            )
            return workspace, self._maintenance_state(
                status="deferred",
                started=started,
                new_accessions=new_accessions,
                filing_bodies_downloaded=filing_bodies_downloaded,
                documents_indexed=documents_indexed,
                chunks_embedded=chunks_embedded,
                job_id=job_id,
                limitations=limitations,
            )

        index_state = self._intelligence._index_state(paths)
        sync_changed_local_inputs = sync_response is not None and (
            sync_response.metadataState.newAccessions > 0 or sync_response.bodyCacheState.downloadedFilings > 0
        )
        needs_index = index_state.status != "ready" or sync_changed_local_inputs
        if not needs_index:
            return workspace, self._maintenance_state(
                status=status,
                started=started,
                new_accessions=new_accessions,
                filing_bodies_downloaded=filing_bodies_downloaded,
                documents_indexed=documents_indexed,
                chunks_embedded=chunks_embedded,
                job_id=job_id,
                limitations=limitations,
            )

        try:
            index_response = self._intelligence.index_workspace(
                workspace=workspace,
                request=EdgarIntelligenceIndexRequest(
                    ticker=request.ticker,
                    outputDir=request.outputDir,
                    forms=request.forms,
                    includeExhibits=False,
                ),
                paths=paths,
                max_documents=ASK_MAINTENANCE_MAX_DOCUMENTS,
                max_chunks=ASK_MAINTENANCE_MAX_CHUNKS,
                max_index_seconds=ASK_MAINTENANCE_MAX_INDEX_SECONDS,
                job_kind="ask_maintenance",
            )
        except EdgarIntelligenceApiError:
            raise
        except RuntimeError as exc:
            limitations.append(f"Ask-time EDGAR indexing failed: {exc}")
            return workspace, self._maintenance_state(
                status="failed",
                started=started,
                new_accessions=new_accessions,
                filing_bodies_downloaded=filing_bodies_downloaded,
                documents_indexed=documents_indexed,
                chunks_embedded=chunks_embedded,
                job_id=job_id,
                limitations=limitations,
            )

        documents_indexed = index_response.indexState.indexedAccessions
        chunks_embedded = index_response.indexState.indexedChunks
        job_id = index_response.jobId
        limitations.extend(index_response.indexState.limitations)
        if index_response.job.status in {"partial", "deferred", "failed"}:
            status = index_response.job.status
        elif status == "none":
            status = "completed"

        return workspace, self._maintenance_state(
            status=status,
            started=started,
            new_accessions=new_accessions,
            filing_bodies_downloaded=filing_bodies_downloaded,
            documents_indexed=documents_indexed,
            chunks_embedded=chunks_embedded,
            job_id=job_id,
            limitations=limitations,
        )

    def _maintenance_state(
        self,
        *,
        status: str,
        started: float,
        new_accessions: int,
        filing_bodies_downloaded: int,
        documents_indexed: int,
        chunks_embedded: int,
        job_id: str | None,
        limitations: list[str],
    ) -> EdgarMaintenanceState:
        return EdgarMaintenanceState(
            status=status,  # type: ignore[arg-type]
            newAccessionsDiscovered=new_accessions,
            filingBodiesDownloaded=filing_bodies_downloaded,
            documentsIndexed=documents_indexed,
            chunksEmbedded=chunks_embedded,
            elapsedMs=int((time.monotonic() - started) * 1000),
            jobId=job_id,
            limitations=[limitation for limitation in limitations if limitation],
        )
