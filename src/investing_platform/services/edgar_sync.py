"""Ticker-scoped EDGAR sync orchestration."""

from __future__ import annotations

from datetime import UTC, date, datetime
import json
from pathlib import Path
import re
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
    EdgarWarmIssuerResult,
    EdgarWarmRequest,
    EdgarWarmResponse,
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
ASK_DEEP_HISTORY_MAX_NEW_BODIES = 3
DEEP_HISTORY_TERMS_RE = re.compile(r"\b(older|history|historical|trend|since|last\s+\d+\s+years?|past\s+\d+\s+years?)\b", re.IGNORECASE)
CURRENT_REPORT_TERMS_RE = re.compile(r"\b(8-k|6-k|current\s+report|latest\s+filing|recent\s+filing)\b", re.IGNORECASE)
CURRENT_REPORT_FORMS = {"8-K", "8-K/A", "6-K", "6-K/A"}


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

    def warm(self, request: EdgarWarmRequest) -> EdgarWarmResponse:
        options = self._artifact_store._default_runtime_options()
        if not options.user_agent:
            raise ValueError("A descriptive SEC User-Agent is required.")

        issuer_queries = self._warm_targets(request)
        results: list[EdgarWarmIssuerResult] = []
        for issuer_query in issuer_queries:
            try:
                if request.mode == "metadata-only":
                    result = self._warm_metadata_only(issuer_query, request=request, options=options)
                else:
                    sync_response = self._sync(
                        EdgarSyncRequest(
                            issuerQuery=issuer_query,
                            outputDir=request.outputDir,
                            forceRefresh=request.forceRefresh,
                        ),
                        max_uncached_filing_bodies=request.maxFilingBodiesPerIssuer,
                    )
                    intelligence_status = sync_response.intelligenceState.status
                    if request.mode == "index":
                        index_response = self.intelligence_index(
                            EdgarIntelligenceIndexRequest(
                                ticker=sync_response.resolvedTicker,
                                outputDir=request.outputDir,
                                includeExhibits=False,
                            )
                        )
                        intelligence_status = "ready" if index_response.indexState.status == "ready" else "not-ready"
                    result = EdgarWarmIssuerResult(
                        issuerQuery=issuer_query,
                        ticker=sync_response.resolvedTicker,
                        status="partial" if sync_response.bodyCacheState.status == "partial" else "warmed",
                        metadataStatus=sync_response.metadataState.status,
                        bodyCacheStatus=sync_response.bodyCacheState.status,
                        intelligenceStatus=intelligence_status,
                        message=sync_response.bodyCacheState.message,
                    )
            except Exception as exc:
                result = EdgarWarmIssuerResult(
                    issuerQuery=issuer_query,
                    status="failed",
                    message=str(exc),
                )
            results.append(result)
            if result.ticker and result.status in {"warmed", "partial"}:
                self._record_usage_event(ticker=result.ticker, event="warm")

        return EdgarWarmResponse(
            mode=request.mode,
            requestedIssuers=len(issuer_queries),
            warmedIssuers=sum(1 for result in results if result.status in {"warmed", "partial"}),
            failedIssuers=sum(1 for result in results if result.status == "failed"),
            results=results,
            generatedAt=datetime.now(UTC),
        )

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
        baseline_filings = self._metadata_cache.load_filing_rows(resolved)
        history_seed_snapshot = previous_metadata_snapshot
        if history_seed_snapshot is None and baseline_filings:
            history_seed_snapshot = {"filings": baseline_filings}
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
                previous_metadata_snapshot=history_seed_snapshot,
                force_refresh=request.forceRefresh,
            )
            current_filings = self._artifact_store._build_filing_rows(payloads, resolved)
            all_filings = self._metadata_cache.merge_cached_filing_rows([*baseline_filings, *current_filings], previous_metadata_snapshot)
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

        usage_profile = self._usage_profile_for_ticker(resolved.ticker)
        selected_filings = self._artifact_store._select_smart_working_set(all_filings, usage_profile=usage_profile)
        selected_filings = self._apply_sync_overrides(request=request, all_filings=all_filings, selected_filings=selected_filings)
        self._artifact_store._write_json_artifact(paths.exports_dir / "matched-filings.json", selected_filings, latest_submission_url, manifest, paths.edgar_root)
        self._artifact_store._write_csv_artifact(paths.exports_dir / "matched-filings.csv", selected_filings, manifest, paths.edgar_root)

        download_request = EdgarDownloadRequest(
            ticker=resolved.ticker,
            outputDir=str(output_root),
            downloadMode="primary-document",
            includeExhibits=False,
            resume=not request.forceRefresh,
        )
        exhibit_request = (
            EdgarDownloadRequest(
                ticker=resolved.ticker,
                outputDir=str(output_root),
                downloadMode="all-attachments",
                includeExhibits=True,
                resume=not request.forceRefresh,
            )
            if request.includeExhibits
            else None
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
                if exhibit_request is not None:
                    self._artifact_store._download_filing_assets(
                        filing=filing,
                        request=exhibit_request,
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
            downloadMode=exhibit_request.downloadMode if exhibit_request is not None else download_request.downloadMode,
            includeExhibits=request.includeExhibits,
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
        self._record_usage_event(ticker=resolved.ticker, company_name=resolved.company_name, event="sync")

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
                workspace = EdgarWorkspaceResponse.model_validate(payload)
                self._record_usage_event(ticker=workspace.ticker, company_name=workspace.companyName, event="view")
                return workspace

        legacy_request = EdgarDownloadRequest(ticker=request.ticker, outputDir=str(output_root))
        legacy_response = self._artifact_store.last_sync(legacy_request, resolver=self._resolver)
        if legacy_response is None:
            return None
        workspace = self._artifact_store._build_workspace_snapshot_from_download_response(
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
        self._record_usage_event(ticker=workspace.ticker, company_name=workspace.companyName, event="view")
        return workspace

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
        self._record_usage_event(
            ticker=request.ticker,
            company_name=workspace.companyName if workspace is not None else None,
            event="ask",
            question=request.question,
            forms=request.forms,
        )
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
        self._record_usage_event(
            ticker=request.ticker,
            company_name=workspace.companyName if workspace is not None else None,
            event="ask",
            question=request.question,
            forms=request.forms,
        )
        if maintenance_state.status == "none":
            return response
        return response.model_copy(update={"maintenanceState": maintenance_state})

    def _warm_metadata_only(self, issuer_query: str, *, request: EdgarWarmRequest, options: Any) -> EdgarWarmIssuerResult:
        resolved = self._resolver.resolve_issuer_query(issuer_query, options, force_refresh=request.forceRefresh)
        baseline_state = self._metadata_cache.ensure_bulk_baseline(options, force_refresh=request.forceRefresh)
        previous_snapshot = self._metadata_cache.load_snapshot(resolved.cik10)
        baseline_filings = self._metadata_cache.load_filing_rows(resolved)
        current_filings = self._artifact_store._build_filing_rows([resolved.submissions_payload], resolved)
        all_filings = self._metadata_cache.merge_cached_filing_rows([*baseline_filings, *current_filings], previous_snapshot)
        snapshot = self._metadata_cache.persist_snapshot(resolved, all_filings)
        metadata_status = "fresh" if baseline_state.get("status") == "ready" else "degraded"
        return EdgarWarmIssuerResult(
            issuerQuery=issuer_query,
            ticker=resolved.ticker,
            status="warmed" if metadata_status == "fresh" else "partial",
            metadataStatus=metadata_status,
            message=(
                f"Metadata warmed with {len(all_filings)} known filings. "
                f"Last live check {snapshot.get('lastLiveCheckedAt') or 'unknown'}."
            ),
        )

    def _warm_targets(self, request: EdgarWarmRequest) -> list[str]:
        targets: list[str] = []
        self._append_unique_targets(targets, request.issuerQueries)
        if targets:
            return targets[: request.maxIssuers]

        if request.includeWatchlist:
            self._append_unique_targets(targets, self._settings.public_watchlist())

        usage_state = self._load_usage_state()
        usage_issuers = usage_state.get("issuers")
        if not isinstance(usage_issuers, dict):
            usage_issuers = {}

        if request.includeAskedIssuers:
            asked_targets = self._usage_ranked_tickers(usage_issuers, keys=("lastAskedAt",))
            self._append_unique_targets(targets, asked_targets)

        if request.includeRecentIssuers:
            recent_targets = self._usage_ranked_tickers(
                usage_issuers,
                keys=("lastViewedAt", "lastSyncedAt", "lastWarmedAt", "lastDeepHydratedAt"),
            )
            self._append_unique_targets(targets, recent_targets)

        return targets[: request.maxIssuers]

    def _append_unique_targets(self, targets: list[str], values: list[str]) -> None:
        seen = {target.upper() for target in targets}
        for value in values:
            normalized = value.strip()
            if not normalized:
                continue
            upper = normalized.upper()
            if upper in seen:
                continue
            targets.append(normalized)
            seen.add(upper)

    def _usage_ranked_tickers(self, issuers: dict[str, Any], *, keys: tuple[str, ...]) -> list[str]:
        scored: list[tuple[str, str]] = []
        for ticker, payload in issuers.items():
            if not isinstance(payload, dict):
                continue
            timestamps = [str(payload.get(key) or "") for key in keys]
            latest = max(timestamps) if timestamps else ""
            if latest:
                scored.append((latest, str(ticker).upper()))
        scored.sort(reverse=True)
        return [ticker for _timestamp, ticker in scored]

    def _usage_state_path(self) -> Path:
        return self._settings.research_root / ".sec" / "usage" / "edgar-usage.json"

    def _load_usage_state(self) -> dict[str, Any]:
        path = self._usage_state_path()
        if not path.exists():
            return {"schemaVersion": 1, "issuers": {}}
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"schemaVersion": 1, "issuers": {}}
        if not isinstance(payload, dict):
            return {"schemaVersion": 1, "issuers": {}}
        if not isinstance(payload.get("issuers"), dict):
            payload["issuers"] = {}
        payload.setdefault("schemaVersion", 1)
        return payload

    def _save_usage_state(self, state: dict[str, Any]) -> None:
        path = self._usage_state_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")

    def _usage_profile_for_ticker(self, ticker: str) -> dict[str, Any]:
        usage_state = self._load_usage_state()
        issuers = usage_state.get("issuers")
        if not isinstance(issuers, dict):
            return {}
        payload = issuers.get(ticker.strip().upper())
        return payload if isinstance(payload, dict) else {}

    def _record_usage_event(
        self,
        *,
        ticker: str,
        event: str,
        company_name: str | None = None,
        question: str | None = None,
        forms: list[str] | None = None,
    ) -> None:
        normalized_ticker = ticker.strip().upper()
        if not normalized_ticker:
            return

        state = self._load_usage_state()
        issuers = state.setdefault("issuers", {})
        if not isinstance(issuers, dict):
            issuers = {}
            state["issuers"] = issuers

        issuer = issuers.setdefault(normalized_ticker, {"ticker": normalized_ticker})
        if not isinstance(issuer, dict):
            issuer = {"ticker": normalized_ticker}
            issuers[normalized_ticker] = issuer

        now = datetime.now(UTC).isoformat()
        issuer["ticker"] = normalized_ticker
        issuer["lastUsedAt"] = now
        if company_name:
            issuer["companyName"] = company_name

        event_fields = {
            "view": ("viewCount", "lastViewedAt"),
            "sync": ("syncCount", "lastSyncedAt"),
            "warm": ("warmCount", "lastWarmedAt"),
            "ask": ("askCount", "lastAskedAt"),
            "deep_hydration": ("deepHydrationCount", "lastDeepHydratedAt"),
        }
        counter_key, timestamp_key = event_fields.get(event, ("eventCount", "lastEventAt"))
        issuer[counter_key] = self._usage_int(issuer.get(counter_key)) + 1
        issuer[timestamp_key] = now

        normalized_forms = self._normalize_forms(forms or [])
        if normalized_forms:
            form_counts = issuer.setdefault("formQuestionCounts", {})
            if not isinstance(form_counts, dict):
                form_counts = {}
                issuer["formQuestionCounts"] = form_counts
            for form in normalized_forms:
                form_counts[form] = self._usage_int(form_counts.get(form)) + 1

        if event in {"ask", "deep_hydration"} and self._question_requests_deep_history(question):
            issuer["historicalQuestionCount"] = self._usage_int(issuer.get("historicalQuestionCount")) + 1
        if event in {"ask", "deep_hydration"} and self._question_mentions_current_reports(question, normalized_forms):
            issuer["currentReportQuestionCount"] = self._usage_int(issuer.get("currentReportQuestionCount")) + 1

        self._save_usage_state(state)

    def _usage_int(self, value: Any) -> int:
        try:
            return int(value or 0)
        except (TypeError, ValueError):
            return 0

    def _normalize_forms(self, forms: list[str]) -> list[str]:
        deduped: list[str] = []
        for form in forms:
            normalized = form.strip().upper()
            if normalized and normalized not in deduped:
                deduped.append(normalized)
        return deduped

    def _question_requests_deep_history(self, question: str | None) -> bool:
        return bool(question and DEEP_HISTORY_TERMS_RE.search(question))

    def _question_mentions_current_reports(self, question: str | None, forms: list[str]) -> bool:
        return bool(CURRENT_REPORT_FORMS.intersection(forms)) or bool(question and CURRENT_REPORT_TERMS_RE.search(question))

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
        hydration_changed_local_inputs = False

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

        hydration_state = self._hydrate_question_required_filings(request=request, paths=paths)
        if hydration_state["status"] != "none":
            filing_bodies_downloaded += int(hydration_state.get("downloaded", 0))
            hydration_changed_local_inputs = bool(hydration_state.get("changed"))
            if hydration_changed_local_inputs:
                self._record_usage_event(
                    ticker=request.ticker,
                    event="deep_hydration",
                    question=request.question,
                    forms=request.forms,
                )
            if hydration_state.get("message"):
                limitations.append(str(hydration_state["message"]))
            if hydration_state["status"] == "partial":
                status = "partial"
            elif status == "none":
                status = "completed"
            workspace = self.workspace(EdgarWorkspaceRequest(ticker=request.ticker, outputDir=request.outputDir)) or workspace

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
        needs_index = index_state.status != "ready" or sync_changed_local_inputs or hydration_changed_local_inputs
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

    def _hydrate_question_required_filings(self, *, request: EdgarQuestionRequest, paths: Any) -> dict[str, Any]:
        all_filings = self._load_json_list(paths.exports_dir / "all-filings.json")
        if not all_filings:
            return {"status": "none", "downloaded": 0, "changed": False}
        selected_filings = self._load_json_list(paths.exports_dir / "matched-filings.json")
        selected_accessions = {
            str(filing.get("accessionNumber") or "")
            for filing in selected_filings
            if isinstance(filing, dict) and str(filing.get("accessionNumber") or "")
        }
        candidates = self._question_required_filings(
            request=request,
            all_filings=[filing for filing in all_filings if isinstance(filing, dict)],
            selected_accessions=selected_accessions,
        )
        if not candidates:
            return {"status": "none", "downloaded": 0, "changed": False}

        options = self._artifact_store._default_runtime_options()
        manifest = self._artifact_store._load_manifest(paths.manifest_path)
        counters = DownloadCounters()
        downloaded_accessions: set[str] = set()
        failed_accessions: set[str] = set()
        skipped_accessions: set[str] = set()
        added_to_selection = False
        uncached_touched = 0
        download_request = EdgarDownloadRequest(
            ticker=request.ticker,
            outputDir=str(paths.output_root),
            downloadMode="primary-document",
            includeExhibits=False,
            resume=True,
        )

        for filing in candidates:
            accession = str(filing.get("accessionNumber") or "")
            if not self._artifact_store._filing_is_cached(paths.stock_root, filing):
                if uncached_touched >= ASK_DEEP_HISTORY_MAX_NEW_BODIES:
                    if accession:
                        skipped_accessions.add(accession)
                    counters.skipped_files += 1
                    continue
                uncached_touched += 1
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

            if self._artifact_store._filing_is_cached(paths.stock_root, filing) and accession not in selected_accessions:
                selected_filings.append(filing)
                selected_accessions.add(accession)
                added_to_selection = True

        if downloaded_accessions or added_to_selection:
            sorted_selection = self._sort_filings([filing for filing in selected_filings if isinstance(filing, dict)])
            self._artifact_store._write_json_artifact(
                paths.exports_dir / "matched-filings.json",
                sorted_selection,
                "generated://edgar-question-required-filings",
                manifest,
                paths.edgar_root,
            )
            self._artifact_store._write_csv_artifact(paths.exports_dir / "matched-filings.csv", sorted_selection, manifest, paths.edgar_root)
            previous_state = self._artifact_store._load_accession_state(paths.accession_state_path)
            self._artifact_store._persist_accession_state(
                path=paths.accession_state_path,
                ticker=request.ticker,
                cik10=self._cik10_for_filings([filing for filing in all_filings if isinstance(filing, dict)], previous_state),
                stock_root=paths.stock_root,
                all_filings=[filing for filing in all_filings if isinstance(filing, dict)],
                selected_filings=sorted_selection,
                cached_accessions={
                    str(filing.get("accessionNumber") or "")
                    for filing in sorted_selection
                    if self._artifact_store._filing_is_cached(paths.stock_root, filing)
                },
                downloaded_accessions=downloaded_accessions,
                skipped_accessions=skipped_accessions,
                failed_accessions=failed_accessions,
                previous_state=previous_state,
                refreshed_at=datetime.now(UTC),
            )
            self._artifact_store._save_manifest(paths.manifest_path, manifest)

        status = "partial" if skipped_accessions or failed_accessions else "completed" if downloaded_accessions or added_to_selection else "none"
        message = None
        if status != "none":
            touched_count = len(downloaded_accessions) if downloaded_accessions else 1 if added_to_selection else 0
            message = f"Ask-time deep-history hydration added {touched_count} question-required filing(s) to the local working set."
            if skipped_accessions:
                message += f" Deferred {len(skipped_accessions)} additional filing(s) because the ask-time hydration budget is bounded."
        return {
            "status": status,
            "downloaded": len(downloaded_accessions),
            "changed": bool(downloaded_accessions or added_to_selection),
            "message": message,
        }

    def _cik10_for_filings(self, filings: list[dict[str, Any]], previous_state: dict[str, Any] | None) -> str:
        for filing in filings:
            cik10 = str(filing.get("cik10") or "").strip()
            if cik10:
                return cik10.zfill(10)
        return str((previous_state or {}).get("cik") or "")

    def _question_required_filings(
        self,
        *,
        request: EdgarQuestionRequest,
        all_filings: list[dict[str, Any]],
        selected_accessions: set[str],
    ) -> list[dict[str, Any]]:
        allowed_accessions = {accession.strip() for accession in request.accessionNumbers if accession.strip()}
        allowed_forms = {form.strip().upper() for form in request.forms if form.strip()}
        explicit_scope = bool(allowed_accessions or allowed_forms or request.startDate or request.endDate)
        inferred_history_scope = bool(DEEP_HISTORY_TERMS_RE.search(request.question))
        if not explicit_scope and not inferred_history_scope:
            return []

        candidates: list[dict[str, Any]] = []
        for filing in self._sort_filings(all_filings):
            accession = str(filing.get("accessionNumber") or "")
            if not accession or accession in selected_accessions:
                continue
            if allowed_accessions:
                if accession in allowed_accessions:
                    candidates.append(filing)
                continue
            form = str(filing.get("form") or "").upper()
            if allowed_forms and form not in allowed_forms:
                continue
            if not self._filing_date_matches_question(filing, request):
                continue
            if inferred_history_scope and not allowed_forms and form not in {"10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A", "10-Q", "10-Q/A"}:
                continue
            candidates.append(filing)
        return candidates

    def _filing_date_matches_question(self, filing: dict[str, Any], request: EdgarQuestionRequest) -> bool:
        filing_date = self._parse_date(str(filing.get("filingDate") or ""))
        if filing_date is None:
            return not request.startDate and not request.endDate
        if request.startDate and filing_date < request.startDate:
            return False
        if request.endDate and filing_date > request.endDate:
            return False
        return True

    def _apply_sync_overrides(
        self,
        *,
        request: EdgarSyncRequest,
        all_filings: list[dict[str, Any]],
        selected_filings: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        if not request.formTypes and request.startDate is None and request.endDate is None:
            return selected_filings

        allowed_forms = set(request.formTypes)
        matched: list[dict[str, Any]] = []
        for filing in all_filings:
            if allowed_forms and str(filing.get("form") or "").upper() not in allowed_forms:
                continue
            filing_date = self._parse_date(str(filing.get("filingDate") or ""))
            if filing_date is None:
                if request.startDate or request.endDate:
                    continue
            elif request.startDate and filing_date < request.startDate:
                continue
            elif request.endDate and filing_date > request.endDate:
                continue
            matched.append(filing)
        return self._sort_filings(matched)

    def _parse_date(self, value: str) -> date | None:
        if not value:
            return None
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None

    def _sort_filings(self, filings: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return sorted(
            [filing for filing in filings if isinstance(filing, dict)],
            key=lambda filing: (str(filing.get("filingDate") or ""), str(filing.get("accessionNumber") or "")),
            reverse=True,
        )

    def _load_json_list(self, path: Path) -> list[Any]:
        if not path.exists():
            return []
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
        return payload if isinstance(payload, list) else []
