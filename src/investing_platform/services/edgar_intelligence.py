"""Ticker-scoped EDGAR intelligence readiness helpers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.parse import quote

from investing_platform.models import EdgarIntelligenceState, EdgarWorkspaceRequest
from investing_platform.services.edgar_common import WorkspacePaths


class EdgarIntelligenceService:
    """Manage ticker-scoped EDGAR intelligence readiness state."""

    def status_for_paths(self, paths: WorkspacePaths, *, job_id: str | None = None) -> EdgarIntelligenceState:
        last_index_path = paths.intelligence_dir / "jobs" / "last-index.json"
        last_index_payload = self._load_json_document(last_index_path)
        last_indexed_at = self._parse_datetime(last_index_payload.get("lastIndexedAt")) if last_index_payload else None
        indexed_filings = int(last_index_payload.get("indexedFilings") or 0) if last_index_payload else 0
        job_id = job_id or (str(last_index_payload.get("jobId")) if last_index_payload and last_index_payload.get("jobId") else None)
        if indexed_filings > 0:
            return EdgarIntelligenceState(
                status="not-ready",
                questionAnsweringEnabled=False,
                detail="Indexed filing artifacts are present, but local filing Q&A is not enabled in this build yet.",
                lastIndexedAt=last_indexed_at,
                indexedFilings=indexed_filings,
                jobId=job_id,
            )
        return EdgarIntelligenceState(
            status="unavailable",
            questionAnsweringEnabled=False,
            detail="Local filing Q&A will be enabled after the EDGAR intelligence layer is implemented.",
            lastIndexedAt=last_indexed_at,
            indexedFilings=indexed_filings,
            jobId=job_id,
        )

    def status_for_workspace(
        self,
        *,
        workspace: Any,
        request: EdgarWorkspaceRequest,
        paths: WorkspacePaths,
        job_id: str | None = None,
    ) -> EdgarIntelligenceState:
        if workspace is None:
            return EdgarIntelligenceState(
                status="unavailable",
                questionAnsweringEnabled=False,
                detail="No EDGAR workspace exists for this ticker yet.",
                jobId=job_id,
            )
        intelligence_state = workspace.intelligenceState.model_copy()
        if job_id and not intelligence_state.jobId:
            intelligence_state.jobId = job_id
        if not intelligence_state.polledVia and intelligence_state.jobId:
            output_dir = request.outputDir
            output_param = f"&outputDir={quote(output_dir, safe='')}" if output_dir else ""
            intelligence_state.polledVia = (
                f"/api/sources/edgar/intelligence/status?ticker={quote(request.ticker, safe='')}"
                f"{output_param}&jobId={quote(intelligence_state.jobId, safe='')}"
            )
        return intelligence_state

    def _load_json_document(self, path: Path) -> dict[str, Any] | None:
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return payload if isinstance(payload, dict) else None

    def _parse_datetime(self, value: Any):
        from datetime import datetime

        if not isinstance(value, str) or not value.strip():
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
