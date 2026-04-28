from __future__ import annotations

import json
from pathlib import Path

from investing_platform.config import DashboardSettings
from investing_platform.services.edgar_common import EdgarRuntimeOptions
from investing_platform.services.edgar_metadata_cache import EdgarMetadataCacheService


class _FakeResponse:
    def __init__(self, *, headers: dict[str, str] | None = None, chunks: list[bytes] | None = None) -> None:
        self.headers = headers or {}
        self._chunks = chunks or []

    def close(self) -> None:
        return None

    def iter_content(self, chunk_size: int = 64 * 1024):
        del chunk_size
        yield from self._chunks


def test_bulk_baseline_refresh_writes_app_global_archives(tmp_path: Path) -> None:
    research_root = tmp_path / "research-root"
    settings = DashboardSettings(
        research_root=research_root,
        edgar_user_agent="Investing Platform tests@example.com",
    )
    requested: list[tuple[str, str]] = []

    def fake_request(method: str, url: str, options: EdgarRuntimeOptions, stream: bool):
        requested.append((method, url))
        assert options.user_agent == "Investing Platform tests@example.com"
        if method == "HEAD":
            return _FakeResponse(headers={"Last-Modified": "Mon, 27 Apr 2026 20:00:00 GMT", "Content-Length": "12"})
        assert method == "GET"
        assert stream is True
        return _FakeResponse(chunks=[b"archive-bytes"])

    cache = EdgarMetadataCacheService(settings, request=fake_request)
    options = EdgarRuntimeOptions(
        user_agent="Investing Platform tests@example.com",
        max_requests_per_second=5.0,
        timeout_seconds=30.0,
        retry_limit=1,
    )

    state = cache.ensure_bulk_baseline(options)

    metadata_root = research_root / ".sec" / "filing-metadata"
    submissions_path = metadata_root / "submissions.zip"
    companyfacts_path = metadata_root / "companyfacts.zip"
    state_path = metadata_root / "bulk-state.json"

    assert submissions_path.exists()
    assert companyfacts_path.exists()
    assert submissions_path.read_bytes() == b"archive-bytes"
    assert companyfacts_path.read_bytes() == b"archive-bytes"
    assert state["status"] == "ready"

    persisted_state = json.loads(state_path.read_text(encoding="utf-8"))
    assert persisted_state["artifacts"]["submissions.zip"]["status"] == "ready"
    assert persisted_state["artifacts"]["companyfacts.zip"]["status"] == "ready"
    assert requested == [
        ("HEAD", "https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip"),
        ("GET", "https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip"),
        ("HEAD", "https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip"),
        ("GET", "https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip"),
    ]
