"""Shared EDGAR constants, dataclasses, and transport helpers."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import threading
import time
from typing import Any


COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL_TEMPLATE = "https://data.sec.gov/submissions/CIK{cik10}.json"
OLDER_SUBMISSIONS_URL_TEMPLATE = "https://data.sec.gov/submissions/{name}"
ARCHIVE_BASE_URL_TEMPLATE = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession}"
SUBMISSIONS_BULK_URL = "https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip"
COMPANYFACTS_BULK_URL = "https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip"
RETRYABLE_STATUS_CODES = {403, 429, 500, 502, 503, 504}
FILING_EXPORT_FIELDS = [
    "ticker",
    "companyName",
    "cik",
    "cik10",
    "form",
    "filingDate",
    "reportDate",
    "acceptanceDateTime",
    "accessionNumber",
    "accessionNumberNoDashes",
    "primaryDocument",
    "primaryDocDescription",
    "items",
    "act",
    "fileNumber",
    "filmNumber",
    "size",
    "isXBRL",
    "isInlineXBRL",
    "archiveBaseUrl",
    "primaryDocumentUrl",
]
EXHIBIT_NAME_RE = re.compile(r"(?i)(?:^|[/_-])(?:ex(?:hibit)?|xex)\d")
BODY_COVERAGE_POLICY_VERSION = "phase1-default-v1"
INDEX_SCHEMA_VERSION = "edgar-intelligence-index-v1"
CHUNKING_VERSION = "chunk-v1"
EMBEDDING_MODEL_VERSION = "nomicai-modernbert-embed-base-4bit-v1"


@dataclass(slots=True)
class EdgarRuntimeOptions:
    user_agent: str
    max_requests_per_second: float
    timeout_seconds: float
    retry_limit: int


@dataclass(slots=True)
class ResolvedCompany:
    cik: str
    cik10: str
    ticker: str
    company_name: str
    submissions_payload: dict[str, Any]


@dataclass(slots=True)
class DownloadCounters:
    metadata_files_synced: int = 0
    downloaded_files: int = 0
    skipped_files: int = 0
    failed_files: int = 0


@dataclass(slots=True)
class WorkspacePaths:
    output_root: Path
    stock_root: Path
    edgar_root: Path
    metadata_dir: Path
    submissions_dir: Path
    exports_dir: Path
    manifests_dir: Path
    intelligence_dir: Path
    manifest_path: Path
    last_sync_path: Path
    workspace_path: Path
    accession_state_path: Path


class SecRateLimiter:
    """Conservative per-process SEC request limiter."""

    def __init__(self, max_requests_per_second: float) -> None:
        self._interval = 1.0 / max(max_requests_per_second, 0.1)
        self._lock = threading.Lock()
        self._last_request_at = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            sleep_for = self._interval - (now - self._last_request_at)
            if sleep_for > 0:
                time.sleep(sleep_for)
                now = time.monotonic()
            self._last_request_at = now
