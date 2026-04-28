"""App-global EDGAR metadata cache and bulk baseline helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
from typing import Any, Callable

import requests

from investing_platform.config import DashboardSettings
from investing_platform.services.edgar_common import (
    COMPANYFACTS_BULK_URL,
    EdgarRuntimeOptions,
    ResolvedCompany,
    SUBMISSIONS_BULK_URL,
)


class EdgarMetadataCacheService:
    """Manage the app-global EDGAR metadata cache and bulk baseline artifacts."""

    def __init__(
        self,
        settings: DashboardSettings,
        *,
        request: Callable[[str, str, EdgarRuntimeOptions, bool], requests.Response],
    ) -> None:
        self._settings = settings
        self._request = request

    def ensure_bulk_baseline(self, options: EdgarRuntimeOptions, *, force_refresh: bool = False) -> dict[str, Any]:
        state_path = self._bulk_state_path()
        state = self._load_json_document(state_path) or {"schemaVersion": 1, "artifacts": {}}
        artifacts = state.setdefault("artifacts", {})

        artifact_results = {
            "submissions.zip": self._refresh_bulk_artifact(
                name="submissions.zip",
                url=SUBMISSIONS_BULK_URL,
                options=options,
                current_state=artifacts.get("submissions.zip"),
                force_refresh=force_refresh,
            ),
            "companyfacts.zip": self._refresh_bulk_artifact(
                name="companyfacts.zip",
                url=COMPANYFACTS_BULK_URL,
                options=options,
                current_state=artifacts.get("companyfacts.zip"),
                force_refresh=force_refresh,
            ),
        }
        state["artifacts"] = artifact_results
        state["lastCheckedAt"] = datetime.now(UTC).isoformat()
        state["status"] = "ready" if all(result.get("status") == "ready" for result in artifact_results.values()) else "degraded"
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")
        return state

    def load_snapshot(self, cik10: str) -> dict[str, Any] | None:
        return self._load_json_document(self._global_metadata_snapshot_path(cik10))

    def persist_snapshot(self, resolved: ResolvedCompany, filings: list[dict[str, Any]]) -> dict[str, Any]:
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

    def merge_cached_filing_rows(
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

    def snapshot_accessions(self, snapshot: dict[str, Any] | None) -> set[str]:
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

    def _app_global_cache_root(self) -> Path:
        return self._settings.research_root

    def _filing_metadata_root(self) -> Path:
        return self._app_global_cache_root() / ".sec" / "filing-metadata"

    def _bulk_state_path(self) -> Path:
        return self._filing_metadata_root() / "bulk-state.json"

    def _bulk_artifact_path(self, name: str) -> Path:
        return self._filing_metadata_root() / name

    def _global_metadata_snapshot_path(self, cik10: str) -> Path:
        return self._filing_metadata_root() / "issuers" / f"CIK{cik10}.json"

    def _refresh_bulk_artifact(
        self,
        *,
        name: str,
        url: str,
        options: EdgarRuntimeOptions,
        current_state: Any,
        force_refresh: bool,
    ) -> dict[str, Any]:
        artifact_path = self._bulk_artifact_path(name)
        now = datetime.now(UTC)
        previous = current_state if isinstance(current_state, dict) else {}
        if artifact_path.exists() and not force_refresh and self._recently_checked(previous, now):
            return {
                **previous,
                "status": previous.get("status") or "ready",
                "path": str(artifact_path),
            }

        result = {
            **previous,
            "status": "ready",
            "path": str(artifact_path),
            "sourceUrl": url,
            "lastCheckedAt": now.isoformat(),
        }

        try:
            head_response = self._request("HEAD", url, options, False)
            try:
                remote_last_modified = head_response.headers.get("Last-Modified")
                remote_etag = head_response.headers.get("ETag")
                remote_content_length = head_response.headers.get("Content-Length")
            finally:
                head_response.close()

            local_matches = (
                artifact_path.exists()
                and not force_refresh
                and remote_last_modified
                and str(previous.get("lastModified") or "") == remote_last_modified
                and (not remote_content_length or str(previous.get("contentLength") or "") == remote_content_length)
            )
            if local_matches:
                result["lastModified"] = remote_last_modified
                result["etag"] = remote_etag
                result["contentLength"] = remote_content_length
                result["lastRefreshedAt"] = previous.get("lastRefreshedAt")
                result["lastError"] = None
                return result

            artifact_path.parent.mkdir(parents=True, exist_ok=True)
            temp_path = artifact_path.with_name(f"{artifact_path.name}.part")
            response = self._request("GET", url, options, True)
            try:
                with temp_path.open("wb") as handle:
                    for chunk in response.iter_content(chunk_size=64 * 1024):
                        if chunk:
                            handle.write(chunk)
            finally:
                response.close()
            temp_path.replace(artifact_path)
            result["lastModified"] = remote_last_modified
            result["etag"] = remote_etag
            result["contentLength"] = remote_content_length or str(artifact_path.stat().st_size)
            result["lastRefreshedAt"] = datetime.now(UTC).isoformat()
            result["lastError"] = None
            return result
        except Exception as exc:
            return {
                **result,
                "status": "degraded",
                "lastError": str(exc),
            }

    def _recently_checked(self, state: dict[str, Any], now: datetime) -> bool:
        checked_at = self._parse_datetime(state.get("lastCheckedAt"))
        if checked_at is None:
            return False
        return now - checked_at <= timedelta(hours=24)

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
