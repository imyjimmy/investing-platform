from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
import sqlite3
import zipfile

from investing_platform.config import DashboardSettings
from investing_platform.services.edgar_common import EdgarRuntimeOptions
from investing_platform.services.edgar_common import ResolvedCompany
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
    archive_bytes = _zip_bytes(
        {
            "CIK0000320193.json": {
                "cik": "320193",
                "name": "Apple Inc.",
                "tickers": ["AAPL"],
                "filings": {
                    "recent": {
                        "accessionNumber": ["0000320193-26-000001"],
                        "filingDate": ["2026-01-30"],
                        "reportDate": ["2025-09-27"],
                        "acceptanceDateTime": ["2026-01-30T21:15:00Z"],
                        "form": ["10-K"],
                        "primaryDocument": ["a10-k2025.htm"],
                        "primaryDocDescription": ["Annual report"],
                        "items": [""],
                        "act": ["34"],
                        "fileNumber": ["001-36743"],
                        "filmNumber": ["26543210"],
                        "size": [1234],
                        "isXBRL": [1],
                        "isInlineXBRL": [1],
                    }
                },
            }
        }
    )

    def fake_request(method: str, url: str, options: EdgarRuntimeOptions, stream: bool):
        requested.append((method, url))
        assert options.user_agent == "Investing Platform tests@example.com"
        if method == "HEAD":
            return _FakeResponse(headers={"Last-Modified": "Mon, 27 Apr 2026 20:00:00 GMT", "Content-Length": str(len(archive_bytes))})
        assert method == "GET"
        assert stream is True
        return _FakeResponse(chunks=[archive_bytes])

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
    submissions_sqlite_path = metadata_root / "submissions.sqlite3"
    companyfacts_path = metadata_root / "companyfacts.zip"
    companyfacts_sqlite_path = metadata_root / "companyfacts.sqlite3"
    state_path = metadata_root / "bulk-state.json"

    assert submissions_path.exists()
    assert companyfacts_path.exists()
    assert submissions_path.read_bytes() == archive_bytes
    assert companyfacts_path.read_bytes() == archive_bytes
    assert submissions_sqlite_path.exists()
    assert companyfacts_sqlite_path.exists()
    assert state["status"] == "ready"

    persisted_state = json.loads(state_path.read_text(encoding="utf-8"))
    assert persisted_state["artifacts"]["submissions.zip"]["status"] == "ready"
    assert persisted_state["artifacts"]["companyfacts.zip"]["status"] == "ready"
    assert persisted_state["normalizedStores"]["submissions.sqlite3"]["status"] == "ready"
    assert persisted_state["normalizedStores"]["submissions.sqlite3"]["issuersImported"] == 1
    assert persisted_state["normalizedStores"]["submissions.sqlite3"]["filingsImported"] == 1
    assert persisted_state["normalizedStores"]["companyfacts.sqlite3"]["status"] == "deferred"
    with sqlite3.connect(submissions_sqlite_path) as connection:
        issuer_count = connection.execute("SELECT COUNT(*) FROM issuer_submissions").fetchone()[0]
        filing = connection.execute(
            "SELECT ticker, form, filing_date, primary_document, discovered_via FROM filing_metadata WHERE accession_number = ?",
            ("0000320193-26-000001",),
        ).fetchone()
    assert issuer_count == 1
    assert filing == ("AAPL", "10-K", "2026-01-30", "a10-k2025.htm", "bulk")

    rows = cache.load_filing_rows(
        ResolvedCompany(
            cik="320193",
            cik10="0000320193",
            ticker="AAPL",
            company_name="Apple Inc.",
            submissions_payload={},
        )
    )
    assert rows[0]["accessionNumber"] == "0000320193-26-000001"
    assert rows[0]["primaryDocumentUrl"] == "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/a10-k2025.htm"
    assert requested == [
        ("HEAD", "https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip"),
        ("GET", "https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip"),
        ("HEAD", "https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip"),
        ("GET", "https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip"),
    ]


def test_live_overlay_is_merged_into_normalized_metadata_store(tmp_path: Path) -> None:
    research_root = tmp_path / "research-root"
    settings = DashboardSettings(
        research_root=research_root,
        edgar_user_agent="Investing Platform tests@example.com",
    )
    cache = EdgarMetadataCacheService(
        settings,
        request=lambda method, url, options, stream: _FakeResponse(),
    )
    resolved = ResolvedCompany(
        cik="320193",
        cik10="0000320193",
        ticker="AAPL",
        company_name="Apple Inc.",
        submissions_payload={},
    )

    cache.persist_snapshot(
        resolved,
        [
            {
                "ticker": "AAPL",
                "companyName": "Apple Inc.",
                "cik": "320193",
                "cik10": "0000320193",
                "form": "8-K",
                "filingDate": "2026-04-27",
                "reportDate": "2026-04-27",
                "acceptanceDateTime": "2026-04-27T20:00:00Z",
                "accessionNumber": "0000320193-26-000777",
                "accessionNumberNoDashes": "000032019326000777",
                "primaryDocument": "a8-k.htm",
                "primaryDocDescription": "Current report",
                "items": "2.02",
                "act": "34",
                "fileNumber": "001-36743",
                "filmNumber": "26543210",
                "size": 321,
                "isXBRL": 1,
                "isInlineXBRL": 1,
                "archiveBaseUrl": "https://www.sec.gov/Archives/edgar/data/320193/000032019326000777",
                "primaryDocumentUrl": "https://www.sec.gov/Archives/edgar/data/320193/000032019326000777/a8-k.htm",
            }
        ],
    )

    sqlite_path = research_root / ".sec" / "filing-metadata" / "submissions.sqlite3"
    with sqlite3.connect(sqlite_path) as connection:
        row = connection.execute(
            "SELECT form, discovered_via, source_file FROM filing_metadata WHERE accession_number = ?",
            ("0000320193-26-000777",),
        ).fetchone()

    assert row == ("8-K", "live", "live-overlay")


def _zip_bytes(payloads: dict[str, dict]) -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, payload in payloads.items():
            archive.writestr(name, json.dumps(payload))
    return buffer.getvalue()
