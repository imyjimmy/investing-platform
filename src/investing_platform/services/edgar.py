"""SEC EDGAR raw artifact helpers and service facade."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
import csv
import hashlib
import json
from pathlib import Path
import random
import re
import threading
import time
from typing import Any

import requests

from investing_platform.config import DashboardSettings
from investing_platform.models import (
    EdgarBodyCacheState,
    EdgarDownloadRequest,
    EdgarDownloadResponse,
    EdgarComparisonRequest,
    EdgarComparisonResponse,
    EdgarIntelligenceIndexRequest,
    EdgarIntelligenceIndexResponse,
    EdgarIntelligenceStatus,
    EdgarIntelligenceState,
    EdgarMetadataState,
    EdgarQuestionRequest,
    EdgarQuestionResponse,
    EdgarSourceStatus,
    EdgarSyncRequest,
    EdgarSyncResponse,
    EdgarWorkspaceRequest,
    EdgarWorkspaceResponse,
    EdgarWorkspaceSelector,
)
from investing_platform.services.edgar_common import (
    ARCHIVE_BASE_URL_TEMPLATE,
    BODY_COVERAGE_POLICY_VERSION,
    CHUNKING_VERSION,
    COMPANY_TICKERS_URL,
    DownloadCounters,
    EMBEDDING_MODEL_VERSION,
    EXHIBIT_NAME_RE,
    FILING_EXPORT_FIELDS,
    INDEX_SCHEMA_VERSION,
    OLDER_SUBMISSIONS_URL_TEMPLATE,
    RETRYABLE_STATUS_CODES,
    ResolvedCompany,
    SecRateLimiter,
    SUBMISSIONS_URL_TEMPLATE,
    WorkspacePaths,
    EdgarRuntimeOptions,
)
from investing_platform.services.edgar_intelligence import EdgarIntelligenceService
from investing_platform.services.edgar_metadata_cache import EdgarMetadataCacheService
from investing_platform.services.edgar_resolver import EdgarResolverService
from investing_platform.services.edgar_sync import EdgarSyncService


class EdgarDownloader:
    """Reusable SEC EDGAR downloader for the dashboard and CLI."""

    def __init__(self, settings: DashboardSettings) -> None:
        self._settings = settings
        self._company_lookup_cache: list[dict[str, Any]] | None = None
        self._company_lookup_lock = threading.Lock()
        self._limiters: dict[float, SecRateLimiter] = {}
        self._limiters_lock = threading.Lock()
        self._resolver_service = EdgarResolverService(settings, get_json=self._get_json)
        self._metadata_cache_service = EdgarMetadataCacheService(settings, request=self._request)
        self._intelligence_service = EdgarIntelligenceService(settings)
        self._sync_service = EdgarSyncService(
            settings,
            resolver=self._resolver_service,
            metadata_cache=self._metadata_cache_service,
            artifact_store=self,
            intelligence=self._intelligence_service,
        )

    def source_status(self) -> EdgarSourceStatus:
        user_agent = self._settings.edgar_user_agent.strip()
        available = bool(user_agent)
        return EdgarSourceStatus(
            available=available,
            status="ready" if available else "degraded",
            researchRootPath=str(self._settings.research_root),
            stocksRootPath=str(self._settings.stocks_root),
            edgarUserAgent=user_agent,
            maxRequestsPerSecond=self._settings.edgar_max_requests_per_second,
            timeoutSeconds=self._settings.edgar_timeout_seconds,
        )

    def download(
        self,
        request: EdgarDownloadRequest,
        *,
        resolver: EdgarResolverService | None = None,
    ) -> EdgarDownloadResponse:
        options = EdgarRuntimeOptions(
            user_agent=(request.userAgent or self._settings.edgar_user_agent).strip(),
            max_requests_per_second=request.maxRequestsPerSecond or self._settings.edgar_max_requests_per_second,
            timeout_seconds=self._settings.edgar_timeout_seconds,
            retry_limit=self._settings.edgar_retry_limit,
        )
        if not options.user_agent:
            raise ValueError("A descriptive SEC User-Agent is required.")

        output_root = Path(request.outputDir).expanduser() if request.outputDir else self._settings.research_root
        output_root.mkdir(parents=True, exist_ok=True)

        resolved = (resolver or self._resolver_service).resolve_download_request(request, options)
        stock_root = output_root / "stocks" / resolved.ticker
        edgar_root = stock_root / ".edgar"
        filings_dir = stock_root
        metadata_dir = edgar_root / "metadata"
        submissions_dir = metadata_dir / "submissions"
        exports_dir = edgar_root / "exports"
        manifests_dir = edgar_root / "manifests"
        for directory in (filings_dir, metadata_dir, submissions_dir, exports_dir, manifests_dir):
            directory.mkdir(parents=True, exist_ok=True)

        manifest_path = manifests_dir / "download-manifest.json"
        manifest = self._load_manifest(manifest_path)
        counters = DownloadCounters()

        recent_submission_url = SUBMISSIONS_URL_TEMPLATE.format(cik10=resolved.cik10)
        self._write_json_artifact(
            submissions_dir / f"CIK{resolved.cik10}.json",
            resolved.submissions_payload,
            recent_submission_url,
            manifest,
            edgar_root,
        )
        counters.metadata_files_synced += 1

        payloads: list[dict[str, Any]] = [resolved.submissions_payload]
        for older_reference in resolved.submissions_payload.get("filings", {}).get("files", []):
            name = str(older_reference.get("name") or "").strip()
            if not name:
                continue
            older_url = OLDER_SUBMISSIONS_URL_TEMPLATE.format(name=name)
            older_payload = self._get_json(older_url, options)
            payloads.append(older_payload)
            self._write_json_artifact(submissions_dir / name, older_payload, older_url, manifest, edgar_root)
            counters.metadata_files_synced += 1

        all_filings = self._build_filing_rows(payloads, resolved)
        matched_filings = [filing for filing in all_filings if self._matches_filters(filing, request)]

        self._write_json_artifact(exports_dir / "all-filings.json", all_filings, recent_submission_url, manifest, edgar_root)
        self._write_csv_artifact(exports_dir / "all-filings.csv", all_filings, manifest, edgar_root)
        self._write_json_artifact(exports_dir / "matched-filings.json", matched_filings, recent_submission_url, manifest, edgar_root)
        self._write_csv_artifact(exports_dir / "matched-filings.csv", matched_filings, manifest, edgar_root)

        if request.downloadMode != "metadata-only":
            for filing in matched_filings:
                try:
                    self._download_filing_assets(
                        filing=filing,
                        request=request,
                        options=options,
                        filings_dir=filings_dir,
                        edgar_root=edgar_root,
                        manifest=manifest,
                        counters=counters,
                    )
                except RuntimeError:
                    counters.failed_files += 1

        response = EdgarDownloadResponse(
            companyName=resolved.company_name,
            ticker=resolved.ticker,
            cik=resolved.cik10,
            totalFilingsConsidered=len(all_filings),
            matchedFilings=len(matched_filings),
            metadataFilesSynced=counters.metadata_files_synced,
            downloadedFiles=counters.downloaded_files,
            skippedFiles=counters.skipped_files,
            failedFiles=counters.failed_files,
            downloadMode=request.downloadMode,
            includeExhibits=request.includeExhibits,
            resume=request.resume,
            researchRootPath=str(output_root),
            stockPath=str(stock_root),
            filingsPath=str(filings_dir),
            edgarPath=str(edgar_root),
            exportsJsonPath=str(exports_dir / "matched-filings.json"),
            exportsCsvPath=str(exports_dir / "matched-filings.csv"),
            manifestPath=str(manifest_path),
            syncedAt=datetime.now(UTC),
        )

        self._write_json_artifact(
            manifests_dir / "last-sync.json",
            response.model_dump(mode="json"),
            "generated://edgar-last-sync",
            manifest,
            edgar_root,
        )
        manifest["lastRun"] = response.model_dump(mode="json")
        self._save_manifest(manifest_path, manifest)
        self._persist_workspace_snapshot_from_download_response(response)
        return response

    def last_sync(
        self,
        request: EdgarDownloadRequest,
        *,
        resolver: EdgarResolverService | None = None,
    ) -> EdgarDownloadResponse | None:
        output_root = Path(request.outputDir).expanduser() if request.outputDir else self._settings.research_root
        if request.ticker:
            ticker = request.ticker.strip().upper()
        else:
            options = EdgarRuntimeOptions(
                user_agent=(request.userAgent or self._settings.edgar_user_agent).strip(),
                max_requests_per_second=request.maxRequestsPerSecond or self._settings.edgar_max_requests_per_second,
                timeout_seconds=self._settings.edgar_timeout_seconds,
                retry_limit=self._settings.edgar_retry_limit,
            )
            if not options.user_agent:
                return None
            ticker = (resolver or self._resolver_service).resolve_download_request(request, options).ticker

        last_sync_path = output_root / "stocks" / ticker / ".edgar" / "manifests" / "last-sync.json"
        if not last_sync_path.exists():
            return None
        payload = json.loads(last_sync_path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            return None
        return EdgarDownloadResponse.model_validate(payload)

    def sync(self, request: EdgarSyncRequest) -> EdgarSyncResponse:
        return self._sync_service.sync(request)

    def workspace(self, request: EdgarWorkspaceRequest) -> EdgarWorkspaceResponse | None:
        return self._sync_service.workspace(request)

    def intelligence_status(self, ticker: str, output_dir: str | None = None, job_id: str | None = None) -> EdgarIntelligenceState:
        return self._sync_service.intelligence_status(ticker=ticker, output_dir=output_dir, job_id=job_id)

    def intelligence_api_status(self, ticker: str, output_dir: str | None = None, job_id: str | None = None) -> EdgarIntelligenceStatus:
        return self._sync_service.intelligence_api_status(ticker=ticker, output_dir=output_dir, job_id=job_id)

    def intelligence_index(self, request: EdgarIntelligenceIndexRequest) -> EdgarIntelligenceIndexResponse:
        return self._sync_service.intelligence_index(request)

    def intelligence_ask(self, request: EdgarQuestionRequest) -> EdgarQuestionResponse:
        return self._sync_service.intelligence_ask(request)

    def intelligence_compare(self, request: EdgarComparisonRequest) -> EdgarComparisonResponse:
        return self._sync_service.intelligence_compare(request)

    def _default_runtime_options(self) -> EdgarRuntimeOptions:
        return EdgarRuntimeOptions(
            user_agent=self._settings.edgar_user_agent.strip(),
            max_requests_per_second=self._settings.edgar_max_requests_per_second,
            timeout_seconds=self._settings.edgar_timeout_seconds,
            retry_limit=self._settings.edgar_retry_limit,
        )

    def _resolve_issuer_query(
        self,
        issuer_query: str,
        options: EdgarRuntimeOptions,
        *,
        force_refresh: bool = False,
    ) -> ResolvedCompany:
        normalized = issuer_query.strip()
        if normalized.isdigit():
            return self._resolve_company(EdgarDownloadRequest(cik=normalized), options, force_refresh=force_refresh)

        if re.fullmatch(r"[A-Za-z][A-Za-z0-9.\-]{0,9}", normalized):
            try:
                return self._resolve_company(
                    EdgarDownloadRequest(ticker=normalized.upper()),
                    options,
                    force_refresh=force_refresh,
                )
            except ValueError:
                pass

        return self._resolve_company(
            EdgarDownloadRequest(companyName=normalized),
            options,
            force_refresh=force_refresh,
        )

    def _workspace_paths(self, output_root: Path, ticker: str) -> WorkspacePaths:
        stock_root = output_root / "stocks" / ticker
        edgar_root = stock_root / ".edgar"
        metadata_dir = edgar_root / "metadata"
        submissions_dir = metadata_dir / "submissions"
        exports_dir = edgar_root / "exports"
        manifests_dir = edgar_root / "manifests"
        intelligence_dir = edgar_root / "intelligence"
        return WorkspacePaths(
            output_root=output_root,
            stock_root=stock_root,
            edgar_root=edgar_root,
            metadata_dir=metadata_dir,
            submissions_dir=submissions_dir,
            exports_dir=exports_dir,
            manifests_dir=manifests_dir,
            intelligence_dir=intelligence_dir,
            manifest_path=manifests_dir / "download-manifest.json",
            last_sync_path=manifests_dir / "last-sync.json",
            workspace_path=manifests_dir / "workspace.json",
            accession_state_path=metadata_dir / "accession-state.json",
        )

    def _ensure_workspace_dirs(self, paths: WorkspacePaths) -> None:
        for directory in (
            paths.stock_root,
            paths.metadata_dir,
            paths.submissions_dir,
            paths.exports_dir,
            paths.manifests_dir,
            paths.intelligence_dir,
        ):
            directory.mkdir(parents=True, exist_ok=True)

    def _fetch_submission_payloads(
        self,
        *,
        resolved: ResolvedCompany,
        options: EdgarRuntimeOptions,
        submissions_dir: Path,
        manifest: dict[str, Any],
        edgar_root: Path,
        counters: DownloadCounters,
        previous_metadata_snapshot: dict[str, Any] | None = None,
        force_refresh: bool = False,
    ) -> list[dict[str, Any]]:
        recent_submission_url = SUBMISSIONS_URL_TEMPLATE.format(cik10=resolved.cik10)
        self._write_json_artifact(
            submissions_dir / f"CIK{resolved.cik10}.json",
            resolved.submissions_payload,
            recent_submission_url,
            manifest,
            edgar_root,
        )
        counters.metadata_files_synced += 1

        payloads: list[dict[str, Any]] = [resolved.submissions_payload]
        cached_filings = previous_metadata_snapshot.get("filings") if previous_metadata_snapshot else None
        should_fetch_full_history = force_refresh or not isinstance(cached_filings, list) or not cached_filings
        if not should_fetch_full_history:
            return payloads

        for older_reference in resolved.submissions_payload.get("filings", {}).get("files", []):
            name = str(older_reference.get("name") or "").strip()
            if not name:
                continue
            older_url = OLDER_SUBMISSIONS_URL_TEMPLATE.format(name=name)
            older_payload = self._get_json(older_url, options)
            payloads.append(older_payload)
            self._write_json_artifact(submissions_dir / name, older_payload, older_url, manifest, edgar_root)
            counters.metadata_files_synced += 1
        return payloads

    def _merge_cached_filing_rows(
        self,
        current_filings: list[dict[str, Any]],
        previous_metadata_snapshot: dict[str, Any] | None,
    ) -> list[dict[str, Any]]:
        merged: dict[str, dict[str, Any]] = {}

        cached_filings = previous_metadata_snapshot.get("filings") if previous_metadata_snapshot else None
        if isinstance(cached_filings, list):
            for filing in cached_filings:
                if not isinstance(filing, dict):
                    continue
                accession = str(filing.get("accessionNumber") or "")
                if accession:
                    merged[accession] = filing

        for filing in current_filings:
            accession = str(filing.get("accessionNumber") or "")
            if accession:
                merged[accession] = filing

        return sorted(
            merged.values(),
            key=lambda filing: (str(filing.get("filingDate") or ""), str(filing.get("accessionNumber") or "")),
            reverse=True,
        )

    def _select_smart_working_set(self, filings: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not filings:
            return []

        selected: dict[str, dict[str, Any]] = {}
        annual_forms = self._annual_form_family(filings)
        quarterly_forms = {"10-Q", "10-Q/A"} if any(str(filing.get("form") or "").upper() in {"10-Q", "10-Q/A"} for filing in filings) else set()
        if annual_forms:
            self._select_distinct_period_filings(filings, annual_forms, limit=3, selected=selected)
        if quarterly_forms:
            self._select_distinct_period_filings(filings, quarterly_forms, limit=12, selected=selected)

        if any(str(filing.get("form") or "").upper() in {"6-K", "6-K/A"} for filing in filings):
            current_forms = {"6-K", "6-K/A"}
        elif any(str(filing.get("form") or "").upper() in {"8-K", "8-K/A"} for filing in filings):
            current_forms = {"8-K", "8-K/A"}
        else:
            current_forms = set()
        if current_forms:
            self._select_recent_filings(filings, current_forms, max_age=timedelta(days=730), selected=selected)

        if not selected:
            for filing in filings[:12]:
                accession = str(filing.get("accessionNumber") or "")
                if accession:
                    selected[accession] = filing

        return sorted(
            selected.values(),
            key=lambda filing: (str(filing.get("filingDate") or ""), str(filing.get("accessionNumber") or "")),
            reverse=True,
        )

    def _annual_form_family(self, filings: list[dict[str, Any]]) -> set[str]:
        forms = {str(filing.get("form") or "").upper() for filing in filings}
        if {"20-F", "20-F/A"} & forms:
            return {"20-F", "20-F/A"}
        if {"40-F", "40-F/A"} & forms:
            return {"40-F", "40-F/A"}
        if {"10-K", "10-K/A"} & forms:
            return {"10-K", "10-K/A"}
        return set()

    def _select_distinct_period_filings(
        self,
        filings: list[dict[str, Any]],
        forms: set[str],
        *,
        limit: int,
        selected: dict[str, dict[str, Any]],
    ) -> None:
        selected_periods: set[str] = set()
        for filing in filings:
            form = str(filing.get("form") or "").upper()
            if form not in forms:
                continue
            period_key = str(filing.get("reportDate") or filing.get("filingDate") or filing.get("accessionNumber") or "")
            if period_key not in selected_periods and len(selected_periods) >= limit:
                continue
            selected_periods.add(period_key)
            accession = str(filing.get("accessionNumber") or "")
            if accession:
                selected[accession] = filing

    def _select_recent_filings(
        self,
        filings: list[dict[str, Any]],
        forms: set[str],
        *,
        max_age: timedelta,
        selected: dict[str, dict[str, Any]],
    ) -> None:
        cutoff = datetime.now(UTC).date() - max_age
        for filing in filings:
            form = str(filing.get("form") or "").upper()
            if form not in forms:
                continue
            filing_date = str(filing.get("filingDate") or "").strip()
            if not filing_date:
                continue
            try:
                parsed = date.fromisoformat(filing_date)
            except ValueError:
                continue
            if parsed < cutoff:
                continue
            accession = str(filing.get("accessionNumber") or "")
            if accession:
                selected[accession] = filing

    def _app_global_cache_root(self) -> Path:
        return self._settings.research_root

    def _issuer_registry_json_path(self) -> Path:
        return self._app_global_cache_root() / ".sec" / "issuer-registry" / "company_tickers.json"

    def _issuer_registry_freshness_path(self) -> Path:
        return self._app_global_cache_root() / ".sec" / "issuer-registry" / "freshness.json"

    def _global_metadata_snapshot_path(self, cik10: str) -> Path:
        return self._app_global_cache_root() / ".sec" / "filing-metadata" / "issuers" / f"CIK{cik10}.json"

    def _load_global_metadata_snapshot(self, cik10: str) -> dict[str, Any] | None:
        return self._load_json_document(self._global_metadata_snapshot_path(cik10))

    def _persist_global_metadata_snapshot(self, resolved: ResolvedCompany, filings: list[dict[str, Any]]) -> dict[str, Any]:
        captured_at = datetime.now(UTC)
        payload = {
            "schemaVersion": 1,
            "ticker": resolved.ticker,
            "companyName": resolved.company_name,
            "cik": resolved.cik10,
            "lastRefreshedAt": captured_at.isoformat(),
            "lastLiveCheckedAt": captured_at.isoformat(),
            "latestKnownAccession": str(filings[0].get("accessionNumber") or "") if filings else None,
            "filings": filings,
        }
        path = self._global_metadata_snapshot_path(resolved.cik10)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        return payload

    def _snapshot_accessions(self, snapshot: dict[str, Any] | None) -> set[str]:
        if snapshot is None:
            return set()
        filings = snapshot.get("filings")
        if not isinstance(filings, list):
            return set()
        return {
            str(filing.get("accessionNumber") or "")
            for filing in filings
            if isinstance(filing, dict) and str(filing.get("accessionNumber") or "")
        }

    def _load_accession_state(self, path: Path) -> dict[str, Any] | None:
        return self._load_json_document(path)

    def _persist_accession_state(
        self,
        *,
        path: Path,
        ticker: str,
        cik10: str,
        stock_root: Path,
        all_filings: list[dict[str, Any]],
        selected_filings: list[dict[str, Any]],
        cached_accessions: set[str],
        downloaded_accessions: set[str],
        skipped_accessions: set[str],
        failed_accessions: set[str],
        previous_state: dict[str, Any] | None,
        refreshed_at: datetime,
    ) -> None:
        previous_records = previous_state.get("accessions") if previous_state else None
        if not isinstance(previous_records, dict):
            previous_records = {}

        previous_versions = previous_state.get("processingVersions") if previous_state else None
        if not isinstance(previous_versions, dict):
            previous_versions = {}

        selected_accessions = {
            str(filing.get("accessionNumber") or "")
            for filing in selected_filings
            if str(filing.get("accessionNumber") or "")
        }
        live_accessions = {
            str(filing.get("accessionNumber") or "")
            for filing in all_filings[: min(len(all_filings), 256)]
            if str(filing.get("accessionNumber") or "")
        }

        reconciled: dict[str, dict[str, Any]] = {}
        for filing in all_filings:
            accession = str(filing.get("accessionNumber") or "")
            if not accession:
                continue

            previous_record = previous_records.get(accession)
            if not isinstance(previous_record, dict):
                previous_record = {}

            selected_by_policy = accession in selected_accessions
            cached_now = accession in cached_accessions
            downloaded_now = accession in downloaded_accessions
            failed_now = accession in failed_accessions
            skipped_now = accession in skipped_accessions
            previous_body_status = str(previous_record.get("bodyStatus") or "")
            previous_index_status = str(previous_record.get("indexStatus") or "")

            if selected_by_policy:
                if failed_now and not cached_now:
                    body_status = "failed"
                elif downloaded_now or cached_now:
                    body_status = "cached"
                elif previous_body_status in {"cached", "failed", "invalidated"}:
                    body_status = previous_body_status
                elif skipped_now:
                    body_status = "skipped"
                else:
                    body_status = "pending"
            else:
                body_status = previous_body_status if previous_body_status in {"cached", "failed", "skipped", "invalidated"} else "skipped"

            content_hash = previous_record.get("contentHash")
            if cached_now:
                content_hash = self._filing_artifact_fingerprint(stock_root, filing)

            if selected_by_policy and cached_now:
                if previous_index_status == "indexed" and self._processing_versions_match(previous_versions):
                    index_status = "indexed"
                elif previous_index_status == "failed":
                    index_status = "failed"
                elif previous_index_status == "invalidated":
                    index_status = "invalidated"
                else:
                    index_status = "pending"
            elif selected_by_policy:
                index_status = "invalidated" if previous_index_status == "indexed" else "pending"
            else:
                index_status = previous_index_status if previous_index_status in {"indexed", "failed", "invalidated"} else "pending"

            reconciled[accession] = {
                "accessionNumber": accession,
                "form": str(filing.get("form") or "").upper(),
                "filingDate": str(filing.get("filingDate") or ""),
                "isAmendment": str(filing.get("form") or "").upper().endswith("/A"),
                "discoveredVia": "live" if accession in live_accessions else str(previous_record.get("discoveredVia") or "bulk"),
                "bodyStatus": body_status,
                "indexStatus": index_status,
                "contentHash": content_hash,
                "selectedByPolicyVersion": BODY_COVERAGE_POLICY_VERSION if selected_by_policy else None,
            }

        payload = {
            "schemaVersion": 1,
            "ticker": ticker,
            "cik": cik10,
            "lastMetadataRefreshAt": refreshed_at.isoformat(),
            "lastLiveOverlayCheckAt": refreshed_at.isoformat(),
            "lastBodyRefreshAt": refreshed_at.isoformat(),
            "lastIndexRefreshAt": previous_state.get("lastIndexRefreshAt") if previous_state else None,
            "processingVersions": {
                "bodyCoveragePolicyVersion": BODY_COVERAGE_POLICY_VERSION,
                "indexSchemaVersion": previous_versions.get("indexSchemaVersion") or INDEX_SCHEMA_VERSION,
                "chunkingVersion": previous_versions.get("chunkingVersion") or CHUNKING_VERSION,
                "embeddingModelVersion": previous_versions.get("embeddingModelVersion") or EMBEDDING_MODEL_VERSION,
            },
            "latestKnownAccession": next(
                (str(filing.get("accessionNumber") or "") for filing in all_filings if str(filing.get("accessionNumber") or "")),
                None,
            ),
            "latestBodyCachedAccession": next(
                (
                    str(filing.get("accessionNumber") or "")
                    for filing in all_filings
                    if str(filing.get("accessionNumber") or "") in cached_accessions
                ),
                None,
            ),
            "latestIndexedAccession": next(
                (
                    str(filing.get("accessionNumber") or "")
                    for filing in all_filings
                    if reconciled.get(str(filing.get("accessionNumber") or ""), {}).get("indexStatus") == "indexed"
                ),
                None,
            ),
            "accessions": reconciled,
        }
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    def _processing_versions_match(self, versions: dict[str, Any]) -> bool:
        return (
            str(versions.get("indexSchemaVersion") or "") == INDEX_SCHEMA_VERSION
            and str(versions.get("chunkingVersion") or "") == CHUNKING_VERSION
            and str(versions.get("embeddingModelVersion") or "") == EMBEDDING_MODEL_VERSION
        )

    def _filing_artifact_fingerprint(self, stock_root: Path, filing: dict[str, Any]) -> str | None:
        filing_dir = stock_root / self._filing_folder_name(filing)
        if not filing_dir.exists():
            return None

        digest = hashlib.sha256()
        file_found = False
        for artifact_path in sorted(path for path in filing_dir.rglob("*") if path.is_file()):
            file_found = True
            relative_name = artifact_path.relative_to(filing_dir).as_posix()
            digest.update(relative_name.encode("utf-8"))
            digest.update(str(artifact_path.stat().st_size).encode("utf-8"))
            with artifact_path.open("rb") as handle:
                digest.update(handle.read())
        return digest.hexdigest() if file_found else None

    def _build_body_cache_state(
        self,
        *,
        counters: DownloadCounters,
        matched_filings: int,
        cached_filings: int,
        last_refreshed_at: datetime,
    ) -> EdgarBodyCacheState:
        if matched_filings == 0:
            status = "missing"
            message = "No filings matched the current default EDGAR coverage policy."
        elif counters.failed_files and cached_filings:
            status = "partial"
            message = "Some filing bodies were updated, but one or more downloads failed."
        elif counters.failed_files and not cached_filings:
            status = "degraded"
            message = "Filing-body download failed for the current working set."
        elif counters.downloaded_files:
            status = "updated"
            message = "Recent filing bodies were refreshed locally."
        else:
            status = "ready" if cached_filings else "missing"
            message = "Local filing bodies are already current for the default working set." if cached_filings else "No filing bodies are cached locally yet."

        return EdgarBodyCacheState(
            status=status,
            lastRefreshedAt=last_refreshed_at,
            matchedFilings=matched_filings,
            cachedFilings=cached_filings,
            downloadedFilings=counters.downloaded_files,
            skippedFilings=counters.skipped_files,
            failedFilings=counters.failed_files,
            message=message,
        )

    def _build_intelligence_state(self, paths: WorkspacePaths) -> EdgarIntelligenceState:
        last_index_path = paths.intelligence_dir / "jobs" / "last-index.json"
        last_index_payload = self._load_json_document(last_index_path)
        last_indexed_at = self._parse_datetime(last_index_payload.get("lastIndexedAt")) if last_index_payload else None
        indexed_filings = int(last_index_payload.get("indexedFilings") or 0) if last_index_payload else 0
        if indexed_filings > 0:
            return EdgarIntelligenceState(
                status="not-ready",
                questionAnsweringEnabled=False,
                detail="Indexed filing artifacts are present, but local filing Q&A is not enabled in this build yet.",
                lastIndexedAt=last_indexed_at,
                indexedFilings=indexed_filings,
            )
        return EdgarIntelligenceState(
            status="unavailable",
            questionAnsweringEnabled=False,
            detail="Local filing Q&A will be enabled after the EDGAR intelligence layer is implemented.",
            lastIndexedAt=last_indexed_at,
            indexedFilings=indexed_filings,
        )

    def _persist_workspace_snapshot_from_download_response(
        self,
        response: EdgarDownloadResponse,
        *,
        metadata_state: EdgarMetadataState | None = None,
        intelligence_state: EdgarIntelligenceState | None = None,
    ) -> None:
        output_root = Path(response.researchRootPath).expanduser()
        paths = self._workspace_paths(output_root, response.ticker)
        workspace_response = self._build_workspace_snapshot_from_download_response(
            response,
            metadata_state=metadata_state
            or EdgarMetadataState(
                status="fresh",
                lastRefreshedAt=response.syncedAt,
                lastLiveCheckedAt=response.syncedAt,
                newAccessions=0,
                message="This workspace snapshot was produced by the legacy EDGAR downloader contract.",
            ),
            intelligence_state=intelligence_state or self._build_intelligence_state(paths),
        )
        paths.workspace_path.parent.mkdir(parents=True, exist_ok=True)
        paths.workspace_path.write_text(json.dumps(workspace_response.model_dump(mode="json"), indent=2, sort_keys=True), encoding="utf-8")

    def _build_workspace_snapshot_from_download_response(
        self,
        response: EdgarDownloadResponse,
        *,
        metadata_state: EdgarMetadataState,
        intelligence_state: EdgarIntelligenceState,
    ) -> EdgarWorkspaceResponse:
        body_cache_state = self._build_body_cache_state(
            counters=DownloadCounters(
                metadata_files_synced=response.metadataFilesSynced,
                downloaded_files=response.downloadedFiles,
                skipped_files=response.skippedFiles,
                failed_files=response.failedFiles,
            ),
            matched_filings=response.matchedFilings,
            cached_filings=max(response.matchedFilings - response.failedFiles, 0),
            last_refreshed_at=response.syncedAt,
        )
        return EdgarWorkspaceResponse(
            ticker=response.ticker,
            companyName=response.companyName,
            cik=response.cik,
            workspace=EdgarWorkspaceSelector(
                ticker=response.ticker,
                outputDir=response.researchRootPath if Path(response.researchRootPath) != self._settings.research_root else None,
            ),
            stockPath=response.stockPath,
            edgarPath=response.edgarPath,
            exportsJsonPath=response.exportsJsonPath,
            exportsCsvPath=response.exportsCsvPath,
            manifestPath=response.manifestPath,
            lastSyncedAt=response.syncedAt,
            metadataState=metadata_state,
            bodyCacheState=body_cache_state,
            intelligenceState=intelligence_state,
        )

    def _filing_is_cached(self, stock_root: Path, filing: dict[str, Any]) -> bool:
        filing_dir = stock_root / self._filing_folder_name(filing)
        primary_document = str(filing.get("primaryDocument") or "").strip()
        if primary_document and (filing_dir / "primary" / primary_document).exists():
            return True
        return filing_dir.exists() and any(filing_dir.rglob("*"))

    def _load_json_document(self, path: Path) -> dict[str, Any] | None:
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return payload if isinstance(payload, dict) else None

    def _parse_datetime(self, value: Any) -> datetime | None:
        if not isinstance(value, str) or not value.strip():
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None

    def _freshness_is_usable(self, freshness_path: Path, *, max_age: timedelta) -> bool:
        payload = self._load_json_document(freshness_path)
        if payload is None:
            return False
        refreshed_at = self._parse_datetime(payload.get("lastRefreshedAt"))
        if refreshed_at is None:
            return False
        return datetime.now(UTC) - refreshed_at <= max_age

    def _resolve_company(
        self,
        request: EdgarDownloadRequest,
        options: EdgarRuntimeOptions,
        *,
        force_refresh: bool = False,
    ) -> ResolvedCompany:
        if request.cik:
            cik10 = request.cik.zfill(10)
            submissions_payload = self._get_json(SUBMISSIONS_URL_TEMPLATE.format(cik10=cik10), options)
            return self._resolved_company_from_payload(submissions_payload, fallback_ticker=request.ticker)

        company_lookup = self._load_company_lookup(options, force_refresh=force_refresh)
        if request.ticker:
            matches = [item for item in company_lookup if str(item.get("ticker", "")).upper() == request.ticker]
            if not matches:
                raise ValueError(f"Unable to resolve ticker '{request.ticker}' through SEC company_tickers.json.")
            cik10 = str(matches[0]["cik_str"]).zfill(10)
            submissions_payload = self._get_json(SUBMISSIONS_URL_TEMPLATE.format(cik10=cik10), options)
            return self._resolved_company_from_payload(submissions_payload, fallback_ticker=request.ticker)

        normalized_target = self._normalize_company_name(str(request.companyName))
        exact_matches = [
            item for item in company_lookup if self._normalize_company_name(str(item.get("title", ""))) == normalized_target
        ]
        if len(exact_matches) == 1:
            cik10 = str(exact_matches[0]["cik_str"]).zfill(10)
            submissions_payload = self._get_json(SUBMISSIONS_URL_TEMPLATE.format(cik10=cik10), options)
            return self._resolved_company_from_payload(submissions_payload, fallback_ticker=str(exact_matches[0]["ticker"]))

        partial_matches = [
            item for item in company_lookup if normalized_target in self._normalize_company_name(str(item.get("title", "")))
        ]
        if len(partial_matches) == 1:
            cik10 = str(partial_matches[0]["cik_str"]).zfill(10)
            submissions_payload = self._get_json(SUBMISSIONS_URL_TEMPLATE.format(cik10=cik10), options)
            return self._resolved_company_from_payload(submissions_payload, fallback_ticker=str(partial_matches[0]["ticker"]))

        if partial_matches:
            sample = ", ".join(f"{item['ticker']} ({item['title']})" for item in partial_matches[:5])
            raise ValueError(
                f"Company name '{request.companyName}' matched multiple SEC issuers. Narrow it with a ticker or CIK. Candidates: {sample}"
            )
        raise ValueError(f"Unable to resolve company name '{request.companyName}' through SEC company_tickers.json.")

    def _resolved_company_from_payload(self, payload: dict[str, Any], fallback_ticker: str | None = None) -> ResolvedCompany:
        cik10 = str(payload.get("cik") or "").zfill(10)
        if not cik10.strip("0"):
            raise ValueError("SEC submissions payload did not include a valid CIK.")
        tickers = payload.get("tickers") or []
        ticker = str(tickers[0]).upper() if tickers else (fallback_ticker or cik10).upper()
        company_name = str(payload.get("name") or ticker).strip()
        return ResolvedCompany(
            cik=cik10.lstrip("0") or "0",
            cik10=cik10,
            ticker=ticker,
            company_name=company_name,
            submissions_payload=payload,
        )

    def _load_company_lookup(self, options: EdgarRuntimeOptions, *, force_refresh: bool = False) -> list[dict[str, Any]]:
        registry_json_path = self._issuer_registry_json_path()
        freshness_path = self._issuer_registry_freshness_path()
        with self._company_lookup_lock:
            if self._company_lookup_cache is not None and not force_refresh:
                return self._company_lookup_cache

            cached_payload = self._load_json_document(registry_json_path)
            cached_is_fresh = self._freshness_is_usable(freshness_path, max_age=timedelta(hours=24))
            if cached_payload and cached_is_fresh and not force_refresh:
                self._company_lookup_cache = list(cached_payload.values()) if isinstance(cached_payload, dict) else None
                if self._company_lookup_cache is not None:
                    return self._company_lookup_cache

            try:
                payload = self._get_json(COMPANY_TICKERS_URL, options)
            except RuntimeError:
                if cached_payload and isinstance(cached_payload, dict):
                    self._company_lookup_cache = list(cached_payload.values())
                    return self._company_lookup_cache
                raise
            if not isinstance(payload, dict):
                raise ValueError("Unexpected SEC company_tickers.json payload.")
            registry_json_path.parent.mkdir(parents=True, exist_ok=True)
            registry_json_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
            freshness_path.parent.mkdir(parents=True, exist_ok=True)
            freshness_path.write_text(
                json.dumps(
                    {
                        "lastRefreshedAt": datetime.now(UTC).isoformat(),
                        "sourceUrl": COMPANY_TICKERS_URL,
                    },
                    indent=2,
                    sort_keys=True,
                ),
                encoding="utf-8",
            )
            self._company_lookup_cache = list(payload.values())
            return self._company_lookup_cache

    def _build_filing_rows(self, payloads: list[dict[str, Any]], resolved: ResolvedCompany) -> list[dict[str, Any]]:
        deduped: dict[str, dict[str, Any]] = {}
        for payload in payloads:
            rows_source = self._extract_compact_rows(payload)
            for row in rows_source:
                accession_number = str(row.get("accessionNumber") or "").strip()
                if not accession_number or accession_number in deduped:
                    continue
                accession_number_no_dashes = accession_number.replace("-", "")
                primary_document = str(row.get("primaryDocument") or "").strip()
                archive_base_url = ARCHIVE_BASE_URL_TEMPLATE.format(cik=resolved.cik, accession=accession_number_no_dashes)
                filing_row = {
                    "ticker": resolved.ticker,
                    "companyName": resolved.company_name,
                    "cik": resolved.cik,
                    "cik10": resolved.cik10,
                    "form": str(row.get("form") or "").strip().upper(),
                    "filingDate": str(row.get("filingDate") or "").strip(),
                    "reportDate": str(row.get("reportDate") or "").strip() or None,
                    "acceptanceDateTime": str(row.get("acceptanceDateTime") or "").strip() or None,
                    "accessionNumber": accession_number,
                    "accessionNumberNoDashes": accession_number_no_dashes,
                    "primaryDocument": primary_document or None,
                    "primaryDocDescription": str(row.get("primaryDocDescription") or "").strip() or None,
                    "items": str(row.get("items") or "").strip() or None,
                    "act": str(row.get("act") or "").strip() or None,
                    "fileNumber": str(row.get("fileNumber") or "").strip() or None,
                    "filmNumber": str(row.get("filmNumber") or "").strip() or None,
                    "size": self._to_int(row.get("size")),
                    "isXBRL": self._to_int(row.get("isXBRL")),
                    "isInlineXBRL": self._to_int(row.get("isInlineXBRL")),
                    "archiveBaseUrl": archive_base_url,
                    "primaryDocumentUrl": f"{archive_base_url}/{primary_document}" if primary_document else None,
                }
                deduped[accession_number] = filing_row
        return sorted(
            deduped.values(),
            key=lambda filing: (str(filing.get("filingDate") or ""), str(filing.get("accessionNumber") or "")),
            reverse=True,
        )

    def _extract_compact_rows(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        recent = payload.get("filings", {}).get("recent")
        if not isinstance(recent, dict) and isinstance(payload.get("accessionNumber"), list):
            recent = payload
        if not isinstance(recent, dict):
            return []

        columnar_fields = {key: value for key, value in recent.items() if isinstance(value, list)}
        if not columnar_fields:
            return []
        length = max(len(values) for values in columnar_fields.values())
        rows: list[dict[str, Any]] = []
        for index in range(length):
            row = {key: (values[index] if index < len(values) else None) for key, values in columnar_fields.items()}
            rows.append(row)
        return rows

    def _matches_filters(self, filing: dict[str, Any], request: EdgarDownloadRequest) -> bool:
        form = str(filing.get("form") or "").upper()
        if request.formTypes and form not in request.formTypes:
            return False

        filing_date = str(filing.get("filingDate") or "").strip()
        if filing_date:
            parsed_date = date.fromisoformat(filing_date)
            if request.startDate and parsed_date < request.startDate:
                return False
            if request.endDate and parsed_date > request.endDate:
                return False
        return True

    def _download_filing_assets(
        self,
        *,
        filing: dict[str, Any],
        request: EdgarDownloadRequest,
        options: EdgarRuntimeOptions,
        filings_dir: Path,
        edgar_root: Path,
        manifest: dict[str, Any],
        counters: DownloadCounters,
    ) -> None:
        filing_dir = filings_dir / self._filing_folder_name(filing)
        primary_document = str(filing.get("primaryDocument") or "").strip()
        primary_document_url = str(filing.get("primaryDocumentUrl") or "").strip()

        if request.downloadMode == "primary-document":
            if not primary_document or not primary_document_url:
                counters.failed_files += 1
                return
            self._safe_download_one_file(
                url=primary_document_url,
                destination=filing_dir / "primary" / primary_document,
                request=request,
                options=options,
                manifest=manifest,
                edgar_root=edgar_root,
                counters=counters,
            )
            return

        try:
            archive_items = self._list_archive_items(str(filing["archiveBaseUrl"]), options)
        except RuntimeError:
            if primary_document and primary_document_url:
                self._safe_download_one_file(
                    url=primary_document_url,
                    destination=filing_dir / "primary" / primary_document,
                    request=request,
                    options=options,
                    manifest=manifest,
                    edgar_root=edgar_root,
                    counters=counters,
                )
                return
            counters.failed_files += 1
            return
        if request.downloadMode == "all-attachments":
            self._download_attachment_set(
                archive_items=archive_items,
                filing=filing,
                request=request,
                options=options,
                destination_root=filing_dir / "attachments",
                edgar_root=edgar_root,
                manifest=manifest,
                counters=counters,
            )
            return

        if request.downloadMode == "full-filing-bundle":
            self._download_attachment_set(
                archive_items=archive_items,
                filing=filing,
                request=request,
                options=options,
                destination_root=filing_dir / "attachments",
                edgar_root=edgar_root,
                manifest=manifest,
                counters=counters,
            )
            self._download_bundle_files(
                archive_items=archive_items,
                filing=filing,
                request=request,
                options=options,
                destination_root=filing_dir / "bundle",
                edgar_root=edgar_root,
                manifest=manifest,
                counters=counters,
            )

    def _download_attachment_set(
        self,
        *,
        archive_items: list[dict[str, Any]],
        filing: dict[str, Any],
        request: EdgarDownloadRequest,
        options: EdgarRuntimeOptions,
        destination_root: Path,
        edgar_root: Path,
        manifest: dict[str, Any],
        counters: DownloadCounters,
    ) -> None:
        bundle_names = self._bundle_file_names(archive_items, str(filing["accessionNumber"]))
        attachment_names: list[str] = []
        for item in archive_items:
            name = str(item.get("name") or "").strip()
            if not name or name in bundle_names:
                continue
            if not request.includeExhibits and self._looks_like_exhibit(name):
                continue
            attachment_names.append(name)

        if not attachment_names and filing.get("primaryDocumentUrl") and filing.get("primaryDocument"):
            attachment_names.append(str(filing["primaryDocument"]))

        for name in attachment_names:
            url = f"{filing['archiveBaseUrl']}/{name}"
            self._safe_download_one_file(
                url=url,
                destination=destination_root / name,
                request=request,
                options=options,
                manifest=manifest,
                edgar_root=edgar_root,
                counters=counters,
            )

    def _download_bundle_files(
        self,
        *,
        archive_items: list[dict[str, Any]],
        filing: dict[str, Any],
        request: EdgarDownloadRequest,
        options: EdgarRuntimeOptions,
        destination_root: Path,
        edgar_root: Path,
        manifest: dict[str, Any],
        counters: DownloadCounters,
    ) -> None:
        accession_number = str(filing["accessionNumber"])
        bundle_names = self._bundle_file_names(archive_items, accession_number)
        bundle_urls = [
            ("index.json", f"{filing['archiveBaseUrl']}/index.json"),
            ("index.html", f"{filing['archiveBaseUrl']}/index.html"),
        ]
        for name in sorted(bundle_names):
            bundle_urls.append((name, f"{filing['archiveBaseUrl']}/{name}"))

        for relative_name, url in bundle_urls:
            self._safe_download_one_file(
                url=url,
                destination=destination_root / relative_name,
                request=request,
                options=options,
                manifest=manifest,
                edgar_root=edgar_root,
                counters=counters,
            )

    def _download_one_file(
        self,
        *,
        url: str,
        destination: Path,
        request: EdgarDownloadRequest,
        options: EdgarRuntimeOptions,
        manifest: dict[str, Any],
        edgar_root: Path,
        counters: DownloadCounters,
    ) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        if request.resume and self._should_skip_download(destination, manifest, edgar_root):
            counters.skipped_files += 1
            return

        temp_path = destination.with_name(f"{destination.name}.part")
        try:
            response = self._request("GET", url, options, stream=True)
            hasher = hashlib.sha256()
            try:
                with temp_path.open("wb") as handle:
                    for chunk in response.iter_content(chunk_size=64 * 1024):
                        if not chunk:
                            continue
                        handle.write(chunk)
                        hasher.update(chunk)
            finally:
                response.close()
        except Exception:
            if temp_path.exists():
                temp_path.unlink()
            raise

        temp_path.replace(destination)
        self._update_manifest_entry(
            manifest=manifest,
            edgar_root=edgar_root,
            file_path=destination,
            checksum=hasher.hexdigest(),
            size_bytes=destination.stat().st_size,
            source_url=url,
        )
        counters.downloaded_files += 1

    def _safe_download_one_file(
        self,
        *,
        url: str,
        destination: Path,
        request: EdgarDownloadRequest,
        options: EdgarRuntimeOptions,
        manifest: dict[str, Any],
        edgar_root: Path,
        counters: DownloadCounters,
    ) -> None:
        try:
            self._download_one_file(
                url=url,
                destination=destination,
                request=request,
                options=options,
                manifest=manifest,
                edgar_root=edgar_root,
                counters=counters,
            )
        except Exception:
            counters.failed_files += 1

    def _list_archive_items(self, archive_base_url: str, options: EdgarRuntimeOptions) -> list[dict[str, Any]]:
        payload = self._get_json(f"{archive_base_url}/index.json", options)
        return list(payload.get("directory", {}).get("item", []))

    def _bundle_file_names(self, archive_items: list[dict[str, Any]], accession_number: str) -> set[str]:
        candidates = {
            f"{accession_number}.txt",
            f"{accession_number}-index.html",
            f"{accession_number}-index-headers.html",
            "filing.txt",
        }
        available_names = {str(item.get("name") or "").strip() for item in archive_items}
        return {name for name in candidates if name in available_names}

    def _should_skip_download(self, destination: Path, manifest: dict[str, Any], edgar_root: Path) -> bool:
        if not destination.exists():
            return False
        relative_name = self._manifest_relative_name(destination, edgar_root)
        manifest_entry = manifest.get("files", {}).get(relative_name)
        if not manifest_entry:
            return False
        expected_checksum = str(manifest_entry.get("checksum") or "").strip()
        if not expected_checksum:
            return False
        return self._sha256_file(destination) == expected_checksum

    def _write_json_artifact(
        self,
        destination: Path,
        payload: Any,
        source_url: str,
        manifest: dict[str, Any],
        edgar_root: Path,
    ) -> None:
        serialized = json.dumps(payload, indent=2, sort_keys=True).encode("utf-8")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(serialized)
        self._update_manifest_entry(
            manifest=manifest,
            edgar_root=edgar_root,
            file_path=destination,
            checksum=hashlib.sha256(serialized).hexdigest(),
            size_bytes=len(serialized),
            source_url=source_url,
        )

    def _write_csv_artifact(
        self,
        destination: Path,
        rows: list[dict[str, Any]],
        manifest: dict[str, Any],
        edgar_root: Path,
    ) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=FILING_EXPORT_FIELDS)
            writer.writeheader()
            for row in rows:
                writer.writerow({field: row.get(field) for field in FILING_EXPORT_FIELDS})
        self._update_manifest_entry(
            manifest=manifest,
            edgar_root=edgar_root,
            file_path=destination,
            checksum=self._sha256_file(destination),
            size_bytes=destination.stat().st_size,
            source_url="generated://edgar-csv-export",
        )

    def _load_manifest(self, manifest_path: Path) -> dict[str, Any]:
        if manifest_path.exists():
            with manifest_path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
                if isinstance(payload, dict):
                    payload.setdefault("schemaVersion", 1)
                    payload.setdefault("files", {})
                    return payload
        return {"schemaVersion": 1, "files": {}}

    def _save_manifest(self, manifest_path: Path, manifest: dict[str, Any]) -> None:
        manifest["updatedAt"] = datetime.now(UTC).isoformat()
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")

    def _update_manifest_entry(
        self,
        *,
        manifest: dict[str, Any],
        edgar_root: Path,
        file_path: Path,
        checksum: str,
        size_bytes: int,
        source_url: str,
    ) -> None:
        files = manifest.setdefault("files", {})
        relative_name = self._manifest_relative_name(file_path, edgar_root)
        files[relative_name] = {
            "checksum": checksum,
            "sizeBytes": size_bytes,
            "sourceUrl": source_url,
            "updatedAt": datetime.now(UTC).isoformat(),
        }

    def _manifest_relative_name(self, file_path: Path, edgar_root: Path) -> str:
        try:
            return file_path.relative_to(edgar_root).as_posix()
        except ValueError:
            return file_path.relative_to(edgar_root.parent).as_posix()

    def _request(self, method: str, url: str, options: EdgarRuntimeOptions, stream: bool = False) -> requests.Response:
        limiter = self._limiter_for(options.max_requests_per_second)
        headers = {
            "Accept": "application/json, text/html, */*",
            "Accept-Encoding": "gzip, deflate",
            "User-Agent": options.user_agent,
        }

        last_error: Exception | None = None
        for attempt in range(options.retry_limit + 1):
            limiter.wait()
            try:
                response = requests.request(method, url, timeout=options.timeout_seconds, stream=stream, headers=headers)
            except requests.RequestException as exc:
                last_error = exc
                if attempt >= options.retry_limit:
                    break
                self._sleep_backoff(attempt)
                continue

            if response.status_code in RETRYABLE_STATUS_CODES:
                if attempt >= options.retry_limit:
                    detail = response.text[:240] if not stream else ""
                    response.close()
                    raise RuntimeError(f"SEC request failed with {response.status_code} for {url}. {detail}".strip())
                response.close()
                self._sleep_backoff(attempt)
                continue

            if response.status_code >= 400:
                detail = response.text[:240] if not stream else ""
                response.close()
                raise RuntimeError(f"SEC request failed with {response.status_code} for {url}. {detail}".strip())
            return response

        raise RuntimeError(f"SEC request failed for {url}: {last_error}") from last_error

    def _limiter_for(self, max_requests_per_second: float) -> SecRateLimiter:
        rate = round(max(max_requests_per_second, 0.1), 4)
        with self._limiters_lock:
            limiter = self._limiters.get(rate)
            if limiter is None:
                limiter = SecRateLimiter(rate)
                self._limiters[rate] = limiter
            return limiter

    def _get_json(self, url: str, options: EdgarRuntimeOptions) -> dict[str, Any]:
        response = self._request("GET", url, options, stream=False)
        try:
            payload = response.json()
        except ValueError as exc:
            text = response.text[:240]
            raise RuntimeError(f"Expected JSON from {url}, received: {text}") from exc
        finally:
            response.close()
        if not isinstance(payload, dict):
            raise RuntimeError(f"Expected JSON object from {url}.")
        return payload

    def _normalize_company_name(self, value: str) -> str:
        return re.sub(r"[^A-Z0-9]+", "", value.upper())

    def _looks_like_exhibit(self, name: str) -> bool:
        lower_name = name.lower()
        return bool(EXHIBIT_NAME_RE.search(lower_name) or "exhibit" in lower_name or "xex" in lower_name)

    def _filing_folder_name(self, filing: dict[str, Any]) -> str:
        filing_date = str(filing.get("filingDate") or "undated")
        form = str(filing.get("form") or "filing").replace("/", "-").replace(" ", "-")
        accession = str(filing.get("accessionNumberNoDashes") or "")
        return f"{filing_date}_{form}_{accession}"

    def _sleep_backoff(self, attempt: int) -> None:
        time.sleep(min(20.0, (0.75 * (2**attempt)) + random.uniform(0.05, 0.4)))

    def _sha256_file(self, file_path: Path) -> str:
        hasher = hashlib.sha256()
        with file_path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(64 * 1024), b""):
                hasher.update(chunk)
        return hasher.hexdigest()

    def _to_int(self, value: Any) -> int | None:
        if value in {None, ""}:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None
