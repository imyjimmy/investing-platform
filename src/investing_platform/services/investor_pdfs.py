"""Best-effort public PDF discovery for stock research folders."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
import csv
import hashlib
import heapq
import json
from pathlib import Path
import random
import re
import threading
import time
from typing import Any
from urllib.parse import parse_qs, unquote, urljoin, urlparse

from bs4 import BeautifulSoup
import requests

from investing_platform.config import DashboardSettings
from investing_platform.models import (
    InvestorPdfArtifact,
    InvestorPdfCategory,
    InvestorPdfDownloadRequest,
    InvestorPdfDownloadResponse,
    InvestorPdfSourceStatus,
)


COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL_TEMPLATE = "https://data.sec.gov/submissions/CIK{cik10}.json"
OLDER_SUBMISSIONS_URL_TEMPLATE = "https://data.sec.gov/submissions/{name}"
ARCHIVE_BASE_URL_TEMPLATE = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession}"
DUCKDUCKGO_HTML_URL = "https://html.duckduckgo.com/html/"
SEC_RETRYABLE_STATUS_CODES = {403, 429, 500, 502, 503, 504}
WEB_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
PDF_EXPORT_FIELDS = [
    "title",
    "category",
    "sourceLabel",
    "sourceUrl",
    "host",
    "publishedAt",
    "year",
    "savedPath",
]
BLOCKED_RESULT_HOST_SUFFIXES = (
    "seekingalpha.com",
    "scribd.com",
    "slideshare.net",
    "finance.yahoo.com",
    "yahoo.com",
    "marketbeat.com",
    "stocktitan.net",
    "financecharts.com",
    "analystlens.com",
    "companiesmarketcap.com",
    "marketwatch.com",
    "bloomberg.com",
    "cnbc.com",
    "wsj.com",
    "fool.com",
    "zacks.com",
    "quartr.com",
    "google.com",
    "youtube.com",
    "archive.org",
    "wikipedia.org",
)
KNOWN_PUBLIC_PDF_HOST_SUFFIXES = (
    "annualreports.com",
    "stocklight.com",
    "q4cdn.com",
    "gcs-web.com",
    "cdn-website.com",
    "cision.com",
    "sec.gov",
)
COMPANY_SITE_SEARCH_QUERIES: tuple[str, ...] = (
    "{company} investor relations",
    "{ticker} investor relations",
    "{company} annual reports investor",
    "{company} quarterly results investor",
)
RESULT_LIMIT_PER_QUERY = 8
MAX_CRAWL_PAGES = 8
MAX_COMPANY_SITE_ENTRYPOINTS = 12
MAX_COMPANY_SITE_PAGES = 16
MAX_COMPANY_SITE_DEPTH = 3
MAX_INTERNAL_LINKS_PER_PAGE = 12
DISCOVERY_CACHE_SCHEMA_VERSION = 1
DISCOVERY_CACHE_POSITIVE_TTL_DAYS = 90
DISCOVERY_CACHE_EMPTY_TTL_DAYS = 7
YEAR_RE = re.compile(r"(20\d{2})")
SHORT_FY_RE = re.compile(r"(?:FY|F|Q\d)(\d{2})", re.IGNORECASE)
NON_COMPANY_WORD_RE = re.compile(r"[^A-Z0-9]+")
SEC_PDF_PRIORITY_FORMS = {"8-K", "10-K", "10-Q", "DEF 14A", "6-K", "20-F"}
SEC_PDF_INSPECTION_LIMIT = 40
COMPANY_SITE_PRIORITY_FORMS = {"8-K", "10-K", "10-Q", "6-K", "20-F"}
COMPANY_SITE_FILING_INSPECTION_LIMIT = 18
COMPANY_SITE_HINT_PATHS = (
    "",
    "/investor",
    "/investors",
    "/investor-relations",
    "/ir",
    "/financials",
    "/financial-results",
    "/results",
    "/reports",
    "/presentations",
)
NAVIGATION_HINT_WEIGHTS: tuple[tuple[str, int], ...] = (
    ("investor relations", 10),
    ("investor", 7),
    ("annual report", 10),
    ("annual reports", 10),
    ("quarterly report", 9),
    ("quarterly results", 9),
    ("financial report", 8),
    ("financial results", 8),
    ("reports", 6),
    ("report", 4),
    ("results", 4),
    ("presentation", 4),
    ("presentations", 4),
    ("earnings", 4),
    ("sec filings", 6),
    ("filings", 3),
    ("downloads", 2),
    ("documents", 2),
)
NAVIGATION_SKIP_TERMS = (
    "privacy",
    "cookie",
    "terms of use",
    "terms and conditions",
    "legal notice",
    "mailto:",
    "tel:",
    "javascript:",
    "login",
    "sign in",
    "support",
    "careers",
    "jobs",
    "contact us",
    "shopping cart",
)
DROP_COMPANY_TOKENS = {
    "INC",
    "CORP",
    "CORPORATION",
    "COMPANY",
    "CO",
    "HOLDINGS",
    "HOLDING",
    "GROUP",
    "PLC",
    "LTD",
    "LIMITED",
    "INCORPORATED",
    "THE",
}
DIRECTORY_HINT_RE = re.compile(r"[^A-Za-z0-9._-]+")
ALPHA_PATH_RE = re.compile(r"[A-Za-z]")


@dataclass(slots=True)
class GenericRateLimiter:
    interval_seconds: float
    lock: threading.Lock
    last_request_at: float = 0.0

    @classmethod
    def from_rate(cls, max_requests_per_second: float) -> "GenericRateLimiter":
        return cls(interval_seconds=1.0 / max(max_requests_per_second, 0.1), lock=threading.Lock())

    def wait(self) -> None:
        with self.lock:
            now = time.monotonic()
            sleep_for = self.interval_seconds - (now - self.last_request_at)
            if sleep_for > 0:
                time.sleep(sleep_for)
                now = time.monotonic()
            self.last_request_at = now


@dataclass(slots=True)
class InvestorPdfRuntimeOptions:
    sec_user_agent: str
    web_user_agent: str
    sec_max_requests_per_second: float
    web_max_requests_per_second: float
    timeout_seconds: float
    retry_limit: int


@dataclass(slots=True)
class ResolvedIssuer:
    cik: str
    cik10: str
    ticker: str
    company_name: str
    submissions_payload: dict[str, Any]


@dataclass(slots=True)
class SearchResult:
    title: str
    url: str
    host: str


@dataclass(slots=True)
class PdfCandidate:
    title: str
    category: InvestorPdfCategory
    source_label: str
    source_url: str
    host: str
    published_at: str | None = None
    year: int | None = None
    saved_path: str | None = None


class InvestorPdfDownloader:
    """Discover and download public PDFs into visible stock folders."""

    def __init__(self, settings: DashboardSettings) -> None:
        self._settings = settings
        self._company_lookup_cache: list[dict[str, Any]] | None = None
        self._company_lookup_lock = threading.Lock()
        self._limiters: dict[str, GenericRateLimiter] = {}
        self._limiters_lock = threading.Lock()

    def source_status(self) -> InvestorPdfSourceStatus:
        return InvestorPdfSourceStatus(
            available=True,
            status="ready",
            researchRootPath=str(self._settings.research_root),
            stocksRootPath=str(self._settings.stocks_root),
            pdfFolderName="pdfs",
            timeoutSeconds=self._settings.edgar_timeout_seconds,
        )

    def download(self, request: InvestorPdfDownloadRequest) -> InvestorPdfDownloadResponse:
        options = InvestorPdfRuntimeOptions(
            sec_user_agent=(request.userAgent or self._settings.edgar_user_agent).strip(),
            web_user_agent=self._browser_user_agent(),
            sec_max_requests_per_second=request.maxRequestsPerSecond or self._settings.edgar_max_requests_per_second,
            web_max_requests_per_second=min(2.0, request.maxRequestsPerSecond or self._settings.edgar_max_requests_per_second),
            timeout_seconds=min(self._settings.edgar_timeout_seconds, 12.0),
            retry_limit=self._settings.edgar_retry_limit,
        )
        if not options.sec_user_agent:
            raise ValueError("A descriptive SEC User-Agent is required.")

        output_root = Path(request.outputDir).expanduser() if request.outputDir else self._settings.research_root
        output_root.mkdir(parents=True, exist_ok=True)
        start_date, end_date = self._effective_date_window(request)

        if request.ticker and not request.forceRefresh:
            cached_response = self._fresh_cached_response(
                output_root=output_root,
                ticker=request.ticker,
                request=request,
                start_date=start_date,
                end_date=end_date,
            )
            if cached_response is not None:
                return cached_response

        resolved = self._resolve_issuer(request, options)

        stock_root = output_root / "stocks" / resolved.ticker
        pdfs_dir = stock_root / "pdfs"
        workspace_root = stock_root / ".investor-pdfs"
        exports_dir = workspace_root / "exports"
        manifests_dir = workspace_root / "manifests"
        for directory in (stock_root, pdfs_dir, workspace_root, exports_dir, manifests_dir):
            directory.mkdir(parents=True, exist_ok=True)

        manifest_path = manifests_dir / "download-manifest.json"
        discovery_cache_path = manifests_dir / "discovery-cache.json"
        manifest = self._load_manifest(manifest_path)

        if not request.forceRefresh:
            cached_response = self._fresh_cached_response(
                output_root=output_root,
                ticker=resolved.ticker,
                request=request,
                start_date=start_date,
                end_date=end_date,
            )
            if cached_response is not None:
                return cached_response

        candidates = self._discover_candidates(
            resolved=resolved,
            request=request,
            options=options,
            start_date=start_date,
            end_date=end_date,
        )
        export_rows = [self._artifact_row(candidate) for candidate in candidates]
        self._write_json(exports_dir / "matched-pdfs.json", export_rows)
        self._write_csv(exports_dir / "matched-pdfs.csv", export_rows)

        downloaded_files = 0
        skipped_files = 0
        failed_files = 0
        artifacts: list[InvestorPdfArtifact] = []
        for candidate in candidates:
            try:
                saved_path, skipped = self._download_candidate(
                    candidate=candidate,
                    destination_root=pdfs_dir,
                    manifest=manifest,
                    workspace_root=workspace_root,
                    options=options,
                    resume=request.resume,
                )
                if saved_path is None:
                    failed_files += 1
                elif skipped:
                    skipped_files += 1
                    candidate.saved_path = str(saved_path)
                else:
                    downloaded_files += 1
                    candidate.saved_path = str(saved_path)
            except RuntimeError:
                failed_files += 1
            artifacts.append(
                InvestorPdfArtifact(
                    title=candidate.title,
                    category=candidate.category,
                    sourceLabel=candidate.source_label,
                    sourceUrl=candidate.source_url,
                    host=candidate.host,
                    publishedAt=candidate.published_at,
                    year=candidate.year,
                    savedPath=candidate.saved_path,
                )
            )

        response = InvestorPdfDownloadResponse(
            companyName=resolved.company_name,
            ticker=resolved.ticker,
            cik=resolved.cik10,
            lookbackYears=request.lookbackYears,
            startDate=start_date,
            endDate=end_date,
            discoveredCandidates=len(candidates),
            matchedPdfs=len(candidates),
            downloadedFiles=downloaded_files,
            skippedFiles=skipped_files,
            failedFiles=failed_files,
            resume=request.resume,
            researchRootPath=str(output_root),
            stockPath=str(stock_root),
            pdfsPath=str(pdfs_dir),
            workspacePath=str(workspace_root),
            exportsJsonPath=str(exports_dir / "matched-pdfs.json"),
            exportsCsvPath=str(exports_dir / "matched-pdfs.csv"),
            manifestPath=str(manifest_path),
            artifacts=artifacts,
            syncedAt=datetime.now(UTC),
            cacheHit=False,
        )
        response.cacheExpiresAt = self._discovery_cache_expires_at(response)

        self._write_json(manifests_dir / "last-sync.json", response.model_dump(mode="json"))
        self._write_discovery_cache(
            path=discovery_cache_path,
            response=response,
            request=request,
            start_date=start_date,
            end_date=end_date,
        )
        manifest["lastRun"] = response.model_dump(mode="json")
        self._save_manifest(manifest_path, manifest)
        return response

    def last_sync(self, request: InvestorPdfDownloadRequest) -> InvestorPdfDownloadResponse | None:
        output_root = Path(request.outputDir).expanduser() if request.outputDir else self._settings.research_root
        if request.ticker:
            ticker = request.ticker.strip().upper()
        else:
            options = InvestorPdfRuntimeOptions(
                sec_user_agent=(request.userAgent or self._settings.edgar_user_agent).strip(),
                web_user_agent=self._browser_user_agent(),
                sec_max_requests_per_second=request.maxRequestsPerSecond or self._settings.edgar_max_requests_per_second,
                web_max_requests_per_second=min(2.0, request.maxRequestsPerSecond or self._settings.edgar_max_requests_per_second),
                timeout_seconds=min(self._settings.edgar_timeout_seconds, 12.0),
                retry_limit=self._settings.edgar_retry_limit,
            )
            if not options.sec_user_agent:
                return None
            ticker = self._resolve_issuer(request, options).ticker

        last_sync_path = output_root / "stocks" / ticker / ".investor-pdfs" / "manifests" / "last-sync.json"
        if not last_sync_path.exists():
            return None
        payload = json.loads(last_sync_path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            return None
        return InvestorPdfDownloadResponse.model_validate(payload)

    def _fresh_cached_response(
        self,
        *,
        output_root: Path,
        ticker: str,
        request: InvestorPdfDownloadRequest,
        start_date: date,
        end_date: date,
    ) -> InvestorPdfDownloadResponse | None:
        cache_path = output_root / "stocks" / ticker.strip().upper() / ".investor-pdfs" / "manifests" / "discovery-cache.json"
        if not cache_path.exists():
            return None
        try:
            payload = json.loads(cache_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        if not isinstance(payload, dict):
            return None
        if payload.get("schemaVersion") != DISCOVERY_CACHE_SCHEMA_VERSION:
            return None

        expires_at = self._parse_datetime(str(payload.get("expiresAt") or ""))
        if expires_at is None or expires_at <= datetime.now(UTC):
            return None
        scope = payload.get("scope")
        if not isinstance(scope, dict) or not self._cache_scope_covers(scope, request, start_date, end_date):
            return None

        response_payload = payload.get("response")
        if not isinstance(response_payload, dict):
            return None
        try:
            cached_response = InvestorPdfDownloadResponse.model_validate(response_payload)
        except ValueError:
            return None

        enabled_categories = self._enabled_categories(request)
        artifacts = [
            artifact
            for artifact in cached_response.artifacts
            if artifact.category in enabled_categories and self._artifact_matches_window(artifact, start_date, end_date)
        ]
        cache_generated_at = self._parse_datetime(str(payload.get("generatedAt") or "")) or cached_response.syncedAt
        return cached_response.model_copy(
            update={
                "lookbackYears": request.lookbackYears,
                "startDate": start_date,
                "endDate": end_date,
                "discoveredCandidates": len(artifacts),
                "matchedPdfs": len(artifacts),
                "downloadedFiles": 0,
                "skippedFiles": len(artifacts),
                "failedFiles": 0,
                "resume": request.resume,
                "artifacts": artifacts,
                "cacheHit": True,
                "cacheExpiresAt": expires_at,
                "cacheMessage": f"Using cached discovery from {cache_generated_at.isoformat()} until {expires_at.isoformat()}.",
            }
        )

    def _write_discovery_cache(
        self,
        *,
        path: Path,
        response: InvestorPdfDownloadResponse,
        request: InvestorPdfDownloadRequest,
        start_date: date,
        end_date: date,
    ) -> None:
        expires_at = response.cacheExpiresAt or self._discovery_cache_expires_at(response)
        payload = {
            "schemaVersion": DISCOVERY_CACHE_SCHEMA_VERSION,
            "generatedAt": response.syncedAt.isoformat(),
            "expiresAt": expires_at.isoformat(),
            "ticker": response.ticker,
            "cik": response.cik,
            "companyName": response.companyName,
            "scope": self._cache_scope_for_request(request, start_date, end_date),
            "response": response.model_dump(mode="json"),
        }
        self._write_json(path, payload)

    def _discovery_cache_expires_at(self, response: InvestorPdfDownloadResponse) -> datetime:
        ttl_days = DISCOVERY_CACHE_POSITIVE_TTL_DAYS if response.matchedPdfs > 0 else DISCOVERY_CACHE_EMPTY_TTL_DAYS
        return response.syncedAt + timedelta(days=ttl_days)

    def _cache_scope_for_request(
        self,
        request: InvestorPdfDownloadRequest,
        start_date: date,
        end_date: date,
    ) -> dict[str, Any]:
        return {
            "categories": sorted(self._enabled_categories(request)),
            "startDate": start_date.isoformat(),
            "endDate": end_date.isoformat(),
        }

    def _cache_scope_covers(
        self,
        cached_scope: dict[str, Any],
        request: InvestorPdfDownloadRequest,
        start_date: date,
        end_date: date,
    ) -> bool:
        cached_categories = set(cached_scope.get("categories") or [])
        if not self._enabled_categories(request).issubset(cached_categories):
            return False
        try:
            cached_start_date = date.fromisoformat(str(cached_scope.get("startDate") or ""))
            cached_end_date = date.fromisoformat(str(cached_scope.get("endDate") or ""))
        except ValueError:
            return False
        return cached_start_date <= start_date and cached_end_date >= end_date

    def _enabled_categories(self, request: InvestorPdfDownloadRequest) -> set[InvestorPdfCategory]:
        categories = self._enabled_public_categories(request)
        if request.includeSecExhibits:
            categories.add("sec-exhibit")
        return categories

    def _artifact_matches_window(
        self,
        artifact: InvestorPdfArtifact,
        start_date: date,
        end_date: date,
    ) -> bool:
        if artifact.publishedAt:
            marker = artifact.publishedAt
            if len(marker) == 10:
                try:
                    published_date = date.fromisoformat(marker)
                except ValueError:
                    return True
                return start_date <= published_date <= end_date
            if len(marker) == 4 and marker.isdigit():
                year = int(marker)
                return start_date.year <= year <= end_date.year
        if artifact.year is not None:
            return start_date.year <= artifact.year <= end_date.year
        return True

    def _parse_datetime(self, value: str) -> datetime | None:
        if not value:
            return None
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)

    def _discover_candidates(
        self,
        *,
        resolved: ResolvedIssuer,
        request: InvestorPdfDownloadRequest,
        options: InvestorPdfRuntimeOptions,
        start_date: date,
        end_date: date,
    ) -> list[PdfCandidate]:
        deduped: dict[str, PdfCandidate] = {}

        if self._enabled_public_categories(request):
            for candidate in self._discover_public_pdf_candidates(resolved, request, options, start_date, end_date):
                deduped.setdefault(candidate.source_url, candidate)

        if request.includeSecExhibits:
            for candidate in self._discover_edgar_pdf_exhibits(resolved, options, start_date, end_date):
                deduped.setdefault(candidate.source_url, candidate)

        return sorted(
            deduped.values(),
            key=lambda candidate: (
                candidate.published_at or "",
                candidate.year or 0,
                candidate.title.lower(),
            ),
            reverse=True,
        )

    def _discover_public_pdf_candidates(
        self,
        resolved: ResolvedIssuer,
        request: InvestorPdfDownloadRequest,
        options: InvestorPdfRuntimeOptions,
        start_date: date,
        end_date: date,
    ) -> list[PdfCandidate]:
        if not self._enabled_public_categories(request):
            return []
        candidates: dict[str, PdfCandidate] = {}
        for candidate in self._discover_company_site_pdf_candidates(resolved, request, options, start_date, end_date):
            key = f"{candidate.category}:{candidate.year}" if candidate.category == "annual-report" and candidate.year else candidate.source_url
            candidates.setdefault(key, candidate)
        return list(candidates.values())

    def _discover_stocklight_annual_reports(
        self,
        resolved: ResolvedIssuer,
        slug: str,
        options: InvestorPdfRuntimeOptions,
    ) -> list[PdfCandidate]:
        candidates: dict[str, PdfCandidate] = {}
        for exchange in ("nasdaq", "nyse", "amex", "otc"):
            url = f"https://stocklight.com/stocks/us/{exchange}-{resolved.ticker.lower()}/{slug}/annual-reports"
            try:
                response = self._web_request("GET", url, options)
            except RuntimeError:
                continue
            try:
                soup = BeautifulSoup(response.text, "html.parser")
            finally:
                response.close()
            for anchor in soup.select("a[href$='.pdf']"):
                href = str(anchor.get("href") or "").strip()
                if not href:
                    continue
                pdf_url = urljoin(url, href)
                candidate = self._candidate_from_url(
                    category="annual-report",
                    source_label=f"Stocklight {exchange.upper()} annual reports",
                    url=pdf_url,
                    title=anchor.get_text(" ", strip=True) or Path(urlparse(pdf_url).path).name,
                )
                candidates.setdefault(candidate.source_url, candidate)
            if candidates:
                break
        return list(candidates.values())

    def _discover_annualreports_archive(self, slug: str, options: InvestorPdfRuntimeOptions) -> list[PdfCandidate]:
        url = f"https://www.annualreports.com/Company/{slug}"
        try:
            response = self._web_request("GET", url, options)
        except RuntimeError:
            return []
        try:
            soup = BeautifulSoup(response.text, "html.parser")
        finally:
            response.close()

        candidates: dict[str, PdfCandidate] = {}
        for anchor in soup.select("a[href$='.pdf']"):
            href = str(anchor.get("href") or "").strip()
            if not href:
                continue
            pdf_url = urljoin(url, href)
            candidate = self._candidate_from_url(
                category="annual-report",
                source_label="AnnualReports archive",
                url=pdf_url,
                title=anchor.get_text(" ", strip=True) or Path(urlparse(pdf_url).path).name,
            )
            candidates.setdefault(candidate.source_url, candidate)
        return list(candidates.values())

    def _discover_search_candidates(
        self,
        resolved: ResolvedIssuer,
        request: InvestorPdfDownloadRequest,
        options: InvestorPdfRuntimeOptions,
        start_date: date,
        end_date: date,
    ) -> list[PdfCandidate]:
        return []

    def _discover_edgar_pdf_exhibits(
        self,
        resolved: ResolvedIssuer,
        options: InvestorPdfRuntimeOptions,
        start_date: date,
        end_date: date,
    ) -> list[PdfCandidate]:
        payloads = [resolved.submissions_payload]
        for older_reference in resolved.submissions_payload.get("filings", {}).get("files", []):
            name = str(older_reference.get("name") or "").strip()
            if not name:
                continue
            payloads.append(self._get_sec_json(OLDER_SUBMISSIONS_URL_TEMPLATE.format(name=name), options))

        filings = self._build_filing_rows(payloads, resolved)
        candidates: list[PdfCandidate] = []
        inspected_filings = 0
        for filing in filings:
            filing_date = date.fromisoformat(str(filing.get("filingDate") or "1900-01-01"))
            if filing_date < start_date or filing_date > end_date:
                continue
            if str(filing.get("form") or "").upper() not in SEC_PDF_PRIORITY_FORMS:
                continue
            if inspected_filings >= SEC_PDF_INSPECTION_LIMIT:
                break
            inspected_filings += 1
            archive_base_url = str(filing.get("archiveBaseUrl") or "")
            if not archive_base_url:
                continue
            index_url = f"{archive_base_url}/index.json"
            try:
                payload = self._get_sec_json(index_url, options)
            except RuntimeError:
                continue
            for item in payload.get("directory", {}).get("item", []):
                name = str(item.get("name") or "").strip()
                if not name.lower().endswith(".pdf"):
                    continue
                source_url = f"{archive_base_url}/{name}"
                title = f"{filing.get('form') or 'Filing'} {name}"
                candidates.append(
                    PdfCandidate(
                        title=title,
                        category="sec-exhibit",
                        source_label=f"SEC {filing.get('form') or 'filing'}",
                        source_url=source_url,
                        host="sec.gov",
                        published_at=str(filing.get("filingDate") or ""),
                        year=filing_date.year,
                    )
                )
        return candidates

    def _discover_company_site_pdf_candidates(
        self,
        resolved: ResolvedIssuer,
        request: InvestorPdfDownloadRequest,
        options: InvestorPdfRuntimeOptions,
        start_date: date,
        end_date: date,
    ) -> list[PdfCandidate]:
        enabled_categories = self._enabled_public_categories(request)
        if not enabled_categories:
            return []

        entrypoints = self._discover_company_site_entrypoints(resolved, options)
        if not entrypoints:
            return []

        site_keys = {
            self._site_key(self._hostname(url))
            for url in entrypoints
            if self._hostname(url)
        }
        queue: list[tuple[int, int, int, str, str]] = []
        queued_keys: set[str] = set()
        visited_keys: set[str] = set()
        sequence = 0
        for page_url, source_label in entrypoints.items():
            page_key = self._page_visit_key(page_url)
            if not page_key or page_key in queued_keys:
                continue
            queued_keys.add(page_key)
            priority = max(1, self._page_relevance_score(page_url, source_label))
            heapq.heappush(queue, (-priority, 0, sequence, page_url, source_label))
            sequence += 1

        candidates: dict[str, PdfCandidate] = {}
        pages_crawled = 0
        while queue and pages_crawled < MAX_COMPANY_SITE_PAGES:
            _, depth, _, page_url, source_label = heapq.heappop(queue)
            page_key = self._page_visit_key(page_url)
            if not page_key or page_key in visited_keys:
                continue
            try:
                response = self._web_request("GET", page_url, options)
            except RuntimeError:
                continue
            try:
                canonical_url = self._normalize_page_url(response.url or page_url) or page_url
                canonical_key = self._page_visit_key(canonical_url)
                if canonical_key and canonical_key in visited_keys:
                    continue
                content_type = response.headers.get("content-type", "")
                if "html" not in content_type and not response.text.lstrip().startswith("<"):
                    continue
                soup = BeautifulSoup(response.text, "html.parser")
            finally:
                response.close()

            visited_keys.add(page_key)
            if canonical_key:
                visited_keys.add(canonical_key)
                queued_keys.add(canonical_key)
            pages_crawled += 1

            page_heading = self._page_heading_text(soup)
            if depth == 0 and not self._page_matches_issuer(canonical_url, page_heading, soup, resolved):
                continue
            page_context = " ".join(
                part for part in (page_url, canonical_url, page_heading, source_label) if part
            ).strip()
            discovered_links: list[tuple[int, str, str]] = []

            for anchor in soup.select("a[href]"):
                href = str(anchor.get("href") or "").strip()
                if not href:
                    continue
                absolute_url = urljoin(canonical_url, href)
                if self._is_direct_pdf_like_url(absolute_url):
                    link_text = anchor.get_text(" ", strip=True)
                    category = self._classify_company_site_pdf(
                        page_context=page_context,
                        page_url=canonical_url,
                        pdf_url=absolute_url,
                        link_text=link_text,
                        enabled_categories=enabled_categories,
                    )
                    if not category:
                        continue
                    candidate = self._candidate_from_url(
                        category=category,
                        source_label=f"Company site: {canonical_url}",
                        url=absolute_url,
                        title=link_text or Path(urlparse(absolute_url).path).name,
                    )
                    if self._candidate_matches_window(candidate, start_date, end_date):
                        key = (
                            f"{candidate.category}:{candidate.year}"
                            if candidate.category == "annual-report" and candidate.year
                            else candidate.source_url
                        )
                        candidates.setdefault(key, candidate)
                    continue

                if depth >= MAX_COMPANY_SITE_DEPTH:
                    continue
                next_url = self._normalize_page_url(absolute_url)
                next_key = self._page_visit_key(next_url)
                if not next_url or not next_key:
                    continue
                if next_key in queued_keys or next_key in visited_keys:
                    continue
                if not self._is_company_site_page(next_url, site_keys):
                    continue
                link_text = anchor.get_text(" ", strip=True)
                region_text = self._anchor_region_text(anchor)
                score = self._link_relevance_score(
                    current_url=canonical_url,
                    next_url=next_url,
                    link_text=link_text,
                    page_context=page_context,
                    region_text=region_text,
                )
                if score <= 0:
                    continue
                discovered_links.append((score, next_url, link_text))

            for score, next_url, link_text in sorted(discovered_links, key=lambda item: (-item[0], item[1]))[
                :MAX_INTERNAL_LINKS_PER_PAGE
            ]:
                next_key = self._page_visit_key(next_url)
                if not next_key or next_key in queued_keys:
                    continue
                queued_keys.add(next_key)
                heapq.heappush(queue, (-score, depth + 1, sequence, next_url, link_text or next_url))
                sequence += 1

        return list(candidates.values())

    def _discover_company_site_entrypoints(
        self,
        resolved: ResolvedIssuer,
        options: InvestorPdfRuntimeOptions,
    ) -> dict[str, str]:
        payloads = [resolved.submissions_payload]
        for older_reference in resolved.submissions_payload.get("filings", {}).get("files", []):
            name = str(older_reference.get("name") or "").strip()
            if not name:
                continue
            payloads.append(self._get_sec_json(OLDER_SUBMISSIONS_URL_TEMPLATE.format(name=name), options))

        filings = self._build_filing_rows(payloads, resolved)
        entrypoints: dict[str, str] = {}
        inspected_filings = 0
        for filing in filings:
            if str(filing.get("form") or "").upper() not in COMPANY_SITE_PRIORITY_FORMS:
                continue
            if inspected_filings >= COMPANY_SITE_FILING_INSPECTION_LIMIT:
                break
            primary_doc_url = str(filing.get("primaryDocUrl") or "")
            if not primary_doc_url:
                continue
            inspected_filings += 1
            try:
                response = self._sec_request("GET", primary_doc_url, options, stream=False)
            except RuntimeError:
                continue
            try:
                filing_text = response.text
            finally:
                response.close()

            for url in self._extract_company_site_urls(filing_text, resolved):
                for expanded, is_exact in self._expand_company_site_urls(url):
                    label = "SEC filing exact company page" if is_exact else "SEC filing company website"
                    entrypoints.setdefault(expanded, label)

        query_values = {"ticker": resolved.ticker, "company": resolved.company_name}
        for template in COMPANY_SITE_SEARCH_QUERIES:
            query = template.format(**query_values)
            try:
                results = self._search(query, options)
            except RuntimeError:
                continue
            for result in results:
                if not self._looks_like_company_site_seed(result, resolved):
                    continue
                normalized_url = self._normalize_page_url(result.url)
                if not normalized_url:
                    continue
                entrypoints.setdefault(normalized_url, f"Search result: {result.title}")
        return self._prune_company_site_entrypoints(entrypoints, resolved)

    def _enabled_public_categories(self, request: InvestorPdfDownloadRequest) -> set[InvestorPdfCategory]:
        categories: set[InvestorPdfCategory] = set()
        if request.includeAnnualReports:
            categories.add("annual-report")
        if request.includeEarningsDecks:
            categories.add("earnings-deck")
        if request.includeInvestorPresentations:
            categories.add("investor-presentation")
        if request.includeCompanyReports:
            categories.add("company-report")
        return categories

    def _looks_like_company_site_seed(self, result: SearchResult, resolved: ResolvedIssuer) -> bool:
        if self._is_direct_pdf_like_url(result.url):
            return False
        host = result.host.lower()
        if not host or self._is_blocked_result_host(host):
            return False
        haystack = f"{result.title} {result.url}".lower()
        company_tokens = self._company_tokens(resolved.company_name)
        mentions_company = resolved.ticker.lower() in haystack or any(token in haystack for token in company_tokens)
        if not mentions_company and not self._allow_public_pdf_host(host, resolved):
            return False
        parsed = urlparse(result.url)
        if (parsed.path or "").strip("/") == "":
            return True
        return self._page_relevance_score(result.url, result.title) > 0

    def _page_heading_text(self, soup: BeautifulSoup) -> str:
        parts: list[str] = []
        title = soup.title.get_text(" ", strip=True) if soup.title else ""
        if title:
            parts.append(title)
        for heading in soup.select("h1, h2, h3"):
            text = heading.get_text(" ", strip=True)
            if not text or text in parts:
                continue
            parts.append(text)
            if len(parts) >= 8:
                break
        return " ".join(parts)

    def _classify_company_site_pdf(
        self,
        *,
        page_context: str,
        page_url: str,
        pdf_url: str,
        link_text: str,
        enabled_categories: set[InvestorPdfCategory],
    ) -> InvestorPdfCategory | None:
        haystack = " ".join((page_context, page_url, pdf_url, link_text)).lower()
        if any(term in haystack for term in NAVIGATION_SKIP_TERMS):
            return None

        scores: dict[InvestorPdfCategory, int] = {category: 0 for category in enabled_categories}

        def add(category: InvestorPdfCategory, value: int) -> None:
            if category in scores:
                scores[category] += value

        if "annual report" in haystack or "annual reports" in haystack:
            add("annual-report", 12)
        if re.search(r"\bar[-_ ]?(?:20)?\d{2}\b", haystack):
            add("annual-report", 5)
        if re.search(r"\b(10-k|20-f|integrated report)\b", haystack):
            add("annual-report", 6)

        if "earnings presentation" in haystack or "results presentation" in haystack or "earnings deck" in haystack:
            add("earnings-deck", 12)
        if "quarterly presentation" in haystack:
            add("earnings-deck", 10)
        if re.search(r"\bq[1-4]\b", haystack) and "presentation" in haystack:
            add("earnings-deck", 8)

        if "investor presentation" in haystack or "capital markets day" in haystack or "analyst day" in haystack:
            add("investor-presentation", 10)
        if "presentation" in haystack:
            add("investor-presentation", 4)

        if "quarterly report" in haystack or "quarterly results" in haystack:
            add("company-report", 10)
        if "interim report" in haystack or "half year report" in haystack or "half-year report" in haystack:
            add("company-report", 10)
        if "financial report" in haystack or "financial results" in haystack or "trading update" in haystack:
            add("company-report", 8)
        if "sustainability report" in haystack or "esg report" in haystack:
            add("company-report", 6)
        if re.search(r"\bq[1-4]\b", haystack):
            add("company-report", 4)
        if "report" in haystack or "reports" in haystack or "results" in haystack:
            add("company-report", 3)

        if not scores:
            return None
        category, score = max(scores.items(), key=lambda item: (item[1], item[0]))
        if score >= 4:
            return category
        if "company-report" in scores and self._page_relevance_score(page_url, page_context) >= 10:
            return "company-report"
        return None

    def _page_relevance_score(self, url: str, text: str) -> int:
        haystack = f"{url} {text}".lower()
        if any(term in haystack for term in NAVIGATION_SKIP_TERMS):
            return -1
        score = 0
        for hint, weight in NAVIGATION_HINT_WEIGHTS:
            if hint in haystack:
                score += weight
        if re.search(r"\bq[1-4]\b", haystack):
            score += 2
        if "/category/" in haystack or "/tag/" in haystack:
            score += 2
        return score

    def _link_relevance_score(
        self,
        *,
        current_url: str,
        next_url: str,
        link_text: str,
        page_context: str,
        region_text: str,
    ) -> int:
        if next_url == current_url:
            return 0
        score = self._page_relevance_score(next_url, f"{link_text} {page_context} {region_text}")
        if score <= 0:
            return 0
        lowered_region = region_text.lower()
        if any(term in lowered_region for term in ("header", "nav", "navigation", "menu", "drawer", "mega-menu")):
            score += 3
        if "footer" in lowered_region:
            score += 1
        parsed = urlparse(next_url)
        if (parsed.path or "").strip("/") == "":
            score += 1
        return score

    def _is_company_site_page(self, url: str, site_keys: set[str]) -> bool:
        if not url or self._is_direct_pdf_like_url(url):
            return False
        host = self._hostname(url)
        if not host:
            return False
        return self._site_key(host) in site_keys

    def _normalize_page_url(self, url: str) -> str:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return ""
        path = parsed.path or "/"
        if path != "/":
            path = path.rstrip("/") or "/"
        normalized = parsed._replace(path=path, query="", fragment="")
        return normalized.geturl()

    def _page_visit_key(self, url: str) -> str:
        parsed = urlparse(url)
        if not parsed.netloc:
            return ""
        path = parsed.path or "/"
        if path != "/":
            path = path.rstrip("/") or "/"
        return f"{parsed.netloc.lower()}{path}"

    def _site_key(self, host: str) -> str:
        parts = [part for part in host.lower().split(".") if part]
        if len(parts) <= 2:
            return ".".join(parts)
        if len(parts[-1]) == 2 and parts[-2] in {"co", "com", "org", "net"}:
            return ".".join(parts[-3:])
        return ".".join(parts[-2:])

    def _prune_company_site_entrypoints(
        self,
        entrypoints: dict[str, str],
        resolved: ResolvedIssuer,
    ) -> dict[str, str]:
        ranked: list[tuple[int, str, str]] = []
        best_by_key: dict[str, tuple[int, str, str]] = {}
        company_tokens = self._company_tokens(resolved.company_name)
        for url, source_label in entrypoints.items():
            normalized_url = self._normalize_page_url(url)
            if not normalized_url:
                continue
            page_key = self._page_visit_key(normalized_url)
            if not page_key:
                continue
            host = self._hostname(normalized_url).lower()
            score = self._page_relevance_score(normalized_url, source_label)
            if host.startswith(("investor.", "investors.", "ir.")):
                score += 8
            if "https://" in normalized_url:
                score += 1
            path = urlparse(normalized_url).path or "/"
            if source_label.lower().startswith("search result:"):
                score += 8
            if "exact company page" in source_label.lower():
                score += 12
            if path.strip("/") == "":
                score -= 2
            else:
                score += 3
                if self._page_relevance_score(normalized_url, normalized_url) > 0:
                    score += 4
            if any(token in host for token in company_tokens):
                score += 2
            if any(term in host for term in ("blog.", "blogs.", "developer.", "support.")):
                score -= 8
            ranked_entry = (score, normalized_url, source_label)
            existing = best_by_key.get(page_key)
            if existing is None or ranked_entry > existing:
                best_by_key[page_key] = ranked_entry

        ranked.extend(best_by_key.values())
        ranked.sort(key=lambda item: (-item[0], item[1]))
        ordered: dict[str, str] = {}
        for _, url, source_label in ranked[:MAX_COMPANY_SITE_ENTRYPOINTS]:
            ordered[url] = source_label
        return ordered

    def _page_matches_issuer(
        self,
        url: str,
        page_heading: str,
        soup: BeautifulSoup,
        resolved: ResolvedIssuer,
    ) -> bool:
        body_text = soup.get_text(" ", strip=True)
        haystack = " ".join((url, page_heading, body_text[:2000])).lower()
        company_tokens = self._company_tokens(resolved.company_name)
        token_hits = sum(1 for token in company_tokens if token in haystack)
        ticker_hit = resolved.ticker.lower() in haystack
        if token_hits >= min(2, len(company_tokens)):
            return True
        return token_hits >= 1 and ticker_hit

    def _anchor_region_text(self, anchor: Any) -> str:
        parts: list[str] = []
        current = anchor
        for _ in range(6):
            current = getattr(current, "parent", None)
            if current is None:
                break
            name = getattr(current, "name", None)
            if name:
                parts.append(str(name))
            if hasattr(current, "get"):
                identifier = str(current.get("id") or "").strip()
                if identifier:
                    parts.append(identifier)
                classes = current.get("class") or []
                if classes:
                    parts.append(" ".join(str(value) for value in classes))
        return " ".join(parts)

    def _crawl_for_pdf_links(
        self,
        *,
        url: str,
        category: InvestorPdfCategory,
        resolved: ResolvedIssuer,
        options: InvestorPdfRuntimeOptions,
        start_date: date,
        end_date: date,
    ) -> list[PdfCandidate]:
        response = self._web_request("GET", url, options)
        try:
            content_type = response.headers.get("content-type", "")
            if "html" not in content_type and not response.text.lstrip().startswith("<"):
                return []
            soup = BeautifulSoup(response.text, "html.parser")
        finally:
            response.close()

        candidates: dict[str, PdfCandidate] = {}
        for anchor in soup.select("a[href]"):
            href = str(anchor.get("href") or "").strip()
            if not href:
                continue
            absolute_url = urljoin(url, href)
            host = self._hostname(absolute_url)
            if not self._allow_public_pdf_host(host, resolved):
                continue
            if not self._is_direct_pdf_like_url(absolute_url):
                continue
            title = anchor.get_text(" ", strip=True) or Path(urlparse(absolute_url).path).name
            candidate = self._candidate_from_url(
                category=category,
                source_label=f"Crawled: {url}",
                url=absolute_url,
                title=title,
            )
            if self._candidate_matches_window(candidate, start_date, end_date):
                candidates.setdefault(candidate.source_url, candidate)
        return list(candidates.values())

    def _download_candidate(
        self,
        *,
        candidate: PdfCandidate,
        destination_root: Path,
        manifest: dict[str, Any],
        workspace_root: Path,
        options: InvestorPdfRuntimeOptions,
        resume: bool,
    ) -> tuple[Path | None, bool]:
        destination = self._candidate_destination(destination_root, candidate)
        if resume and self._should_skip_download(destination, manifest, workspace_root):
            return destination, True

        response = self._download_request(candidate.source_url, options)
        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            temp_path = destination.with_suffix(f"{destination.suffix}.part")
            with temp_path.open("wb") as handle:
                first_chunk = b""
                for chunk in response.iter_content(chunk_size=64 * 1024):
                    if not chunk:
                        continue
                    if not first_chunk:
                        first_chunk = chunk
                    handle.write(chunk)
            if not self._looks_like_pdf(temp_path, response.headers.get("content-type")):
                temp_path.unlink(missing_ok=True)
                raise RuntimeError(f"URL did not return a PDF: {candidate.source_url}")
            temp_path.replace(destination)
        finally:
            response.close()

        checksum = self._sha256_file(destination)
        self._update_manifest_entry(
            manifest=manifest,
            workspace_root=workspace_root,
            file_path=destination,
            checksum=checksum,
            size_bytes=destination.stat().st_size,
            source_url=candidate.source_url,
        )
        return destination, False

    def _candidate_destination(self, destination_root: Path, candidate: PdfCandidate) -> Path:
        stem_date = candidate.published_at or (str(candidate.year) if candidate.year else "undated")
        file_name = Path(unquote(urlparse(candidate.source_url).path)).name or "document.pdf"
        if "." not in file_name:
            file_name = f"{file_name}.pdf"
        normalized_name = DIRECTORY_HINT_RE.sub("-", file_name).strip("-")
        if not normalized_name.lower().endswith(".pdf"):
            normalized_name = f"{normalized_name}.pdf"
        prefix = f"{self._slugify(stem_date)}_{candidate.category}"
        return destination_root / f"{prefix}_{normalized_name}"

    def _candidate_from_url(
        self,
        *,
        category: InvestorPdfCategory,
        source_label: str,
        url: str,
        title: str,
    ) -> PdfCandidate:
        published_at, year = self._infer_published_markers(url, title)
        return PdfCandidate(
            title=title.strip() or Path(urlparse(url).path).name,
            category=category,
            source_label=source_label,
            source_url=url,
            host=self._hostname(url),
            published_at=published_at,
            year=year,
        )

    def _artifact_row(self, candidate: PdfCandidate) -> dict[str, Any]:
        return {
            "title": candidate.title,
            "category": candidate.category,
            "sourceLabel": candidate.source_label,
            "sourceUrl": candidate.source_url,
            "host": candidate.host,
            "publishedAt": candidate.published_at,
            "year": candidate.year,
            "savedPath": candidate.saved_path,
        }

    def _candidate_matches_window(self, candidate: PdfCandidate, start_date: date, end_date: date) -> bool:
        if candidate.published_at and len(candidate.published_at) == 10:
            published_date = date.fromisoformat(candidate.published_at)
            return start_date <= published_date <= end_date
        if candidate.year is not None:
            return start_date.year <= candidate.year <= end_date.year
        return True

    def _infer_published_markers(self, url: str, title: str) -> tuple[str | None, int | None]:
        haystack = f"{url} {title}"
        max_reasonable_year = date.today().year + 1
        years = [int(match) for match in YEAR_RE.findall(haystack) if 1990 <= int(match) <= max_reasonable_year]
        if years:
            year = max(years)
            return f"{year}", year
        short_year_match = SHORT_FY_RE.search(haystack)
        if short_year_match:
            year = 2000 + int(short_year_match.group(1))
            if year > max_reasonable_year:
                return None, None
            return f"{year}", year
        return None, None

    def _effective_date_window(self, request: InvestorPdfDownloadRequest) -> tuple[date, date]:
        end_date = request.endDate or date.today()
        if request.startDate:
            return request.startDate, end_date
        return self._subtract_years(end_date, request.lookbackYears), end_date

    def _subtract_years(self, target: date, years: int) -> date:
        try:
            return target.replace(year=target.year - years)
        except ValueError:
            return target.replace(month=2, day=28, year=target.year - years)

    def _resolve_issuer(self, request: InvestorPdfDownloadRequest, options: InvestorPdfRuntimeOptions) -> ResolvedIssuer:
        if request.cik:
            cik10 = request.cik.zfill(10)
            submissions_payload = self._get_sec_json(SUBMISSIONS_URL_TEMPLATE.format(cik10=cik10), options)
            return self._resolved_issuer_from_payload(submissions_payload, fallback_ticker=request.ticker)

        company_lookup = self._load_company_lookup(options)
        if request.ticker:
            matches = [item for item in company_lookup if str(item.get("ticker", "")).upper() == request.ticker]
            if not matches:
                raise ValueError(f"Unable to resolve ticker '{request.ticker}' through SEC company_tickers.json.")
            cik10 = str(matches[0]["cik_str"]).zfill(10)
            submissions_payload = self._get_sec_json(SUBMISSIONS_URL_TEMPLATE.format(cik10=cik10), options)
            return self._resolved_issuer_from_payload(submissions_payload, fallback_ticker=request.ticker)

        normalized_target = self._normalize_company_name(str(request.companyName))
        exact_matches = [
            item for item in company_lookup if self._normalize_company_name(str(item.get("title", ""))) == normalized_target
        ]
        if len(exact_matches) == 1:
            cik10 = str(exact_matches[0]["cik_str"]).zfill(10)
            submissions_payload = self._get_sec_json(SUBMISSIONS_URL_TEMPLATE.format(cik10=cik10), options)
            return self._resolved_issuer_from_payload(submissions_payload, fallback_ticker=str(exact_matches[0]["ticker"]))

        partial_matches = [
            item for item in company_lookup if normalized_target in self._normalize_company_name(str(item.get("title", "")))
        ]
        if len(partial_matches) == 1:
            cik10 = str(partial_matches[0]["cik_str"]).zfill(10)
            submissions_payload = self._get_sec_json(SUBMISSIONS_URL_TEMPLATE.format(cik10=cik10), options)
            return self._resolved_issuer_from_payload(submissions_payload, fallback_ticker=str(partial_matches[0]["ticker"]))

        if partial_matches:
            sample = ", ".join(f"{item['ticker']} ({item['title']})" for item in partial_matches[:5])
            raise ValueError(
                f"Company name '{request.companyName}' matched multiple SEC issuers. Narrow it with a ticker or CIK. Candidates: {sample}"
            )
        raise ValueError(f"Unable to resolve company name '{request.companyName}' through SEC company_tickers.json.")

    def _resolved_issuer_from_payload(self, payload: dict[str, Any], fallback_ticker: str | None = None) -> ResolvedIssuer:
        cik10 = str(payload.get("cik") or "").zfill(10)
        if not cik10.strip("0"):
            raise ValueError("SEC submissions payload did not include a valid CIK.")
        tickers = payload.get("tickers") or []
        ticker = str(tickers[0]).upper() if tickers else (fallback_ticker or cik10).upper()
        company_name = str(payload.get("name") or ticker).strip()
        return ResolvedIssuer(
            cik=cik10.lstrip("0") or "0",
            cik10=cik10,
            ticker=ticker,
            company_name=company_name,
            submissions_payload=payload,
        )

    def _load_company_lookup(self, options: InvestorPdfRuntimeOptions) -> list[dict[str, Any]]:
        with self._company_lookup_lock:
            if self._company_lookup_cache is None:
                payload = self._get_sec_json(COMPANY_TICKERS_URL, options)
                if not isinstance(payload, dict):
                    raise ValueError("Unexpected SEC company_tickers.json payload.")
                self._company_lookup_cache = list(payload.values())
            return self._company_lookup_cache

    def _build_filing_rows(self, payloads: list[dict[str, Any]], resolved: ResolvedIssuer) -> list[dict[str, Any]]:
        deduped: dict[str, dict[str, Any]] = {}
        for payload in payloads:
            recent = payload.get("filings", {}).get("recent")
            if not isinstance(recent, dict) and isinstance(payload.get("accessionNumber"), list):
                recent = payload
            if not isinstance(recent, dict):
                continue

            columnar_fields = {key: value for key, value in recent.items() if isinstance(value, list)}
            if not columnar_fields:
                continue
            row_length = max(len(values) for values in columnar_fields.values())
            for index in range(row_length):
                row = {key: (values[index] if index < len(values) else None) for key, values in columnar_fields.items()}
                accession_number = str(row.get("accessionNumber") or "").strip()
                if not accession_number or accession_number in deduped:
                    continue
                accession_no_dashes = accession_number.replace("-", "")
                primary_document = str(row.get("primaryDocument") or "").strip()
                archive_base_url = ARCHIVE_BASE_URL_TEMPLATE.format(cik=resolved.cik, accession=accession_no_dashes)
                deduped[accession_number] = {
                    "form": str(row.get("form") or "").strip().upper(),
                    "filingDate": str(row.get("filingDate") or "").strip(),
                    "primaryDocument": primary_document,
                    "primaryDocUrl": f"{archive_base_url}/{primary_document}" if primary_document else "",
                    "accessionNumberNoDashes": accession_no_dashes,
                    "archiveBaseUrl": archive_base_url,
                }
        return sorted(
            deduped.values(),
            key=lambda filing: (str(filing.get("filingDate") or ""), str(filing.get("accessionNumberNoDashes") or "")),
            reverse=True,
        )

    def _search(self, query: str, options: InvestorPdfRuntimeOptions) -> list[SearchResult]:
        limiter = self._limiter_for("search", options.web_max_requests_per_second)
        last_error: Exception | None = None
        response: requests.Response | None = None
        for attempt in range(options.retry_limit + 1):
            limiter.wait()
            try:
                response = requests.get(
                    DUCKDUCKGO_HTML_URL,
                    params={"q": query},
                    headers={"User-Agent": "Mozilla/5.0"},
                    timeout=options.timeout_seconds,
                    allow_redirects=True,
                )
            except requests.RequestException as exc:
                last_error = exc
                if attempt >= options.retry_limit:
                    break
                self._sleep_backoff(attempt)
                continue
            if response.status_code in WEB_RETRYABLE_STATUS_CODES:
                if attempt >= options.retry_limit:
                    detail = response.text[:240]
                    response.close()
                    raise RuntimeError(f"Search request failed with {response.status_code} for {query}. {detail}".strip())
                response.close()
                self._sleep_backoff(attempt)
                continue
            if response.status_code >= 400:
                detail = response.text[:240]
                response.close()
                raise RuntimeError(f"Search request failed with {response.status_code} for {query}. {detail}".strip())
            break

        if response is None:
            raise RuntimeError(f"Search request failed for {query}: {last_error}") from last_error
        try:
            soup = BeautifulSoup(response.text, "html.parser")
        finally:
            response.close()
        results: list[SearchResult] = []
        for anchor in soup.select("a.result__a"):
            title = anchor.get_text(" ", strip=True)
            raw_href = str(anchor.get("href") or "").strip()
            if not raw_href:
                continue
            url = self._decode_search_href(raw_href)
            host = self._hostname(url)
            if not host or self._is_blocked_result_host(host):
                continue
            results.append(SearchResult(title=title, url=url, host=host))
            if len(results) >= RESULT_LIMIT_PER_QUERY:
                break
        return results

    def _decode_search_href(self, raw_href: str) -> str:
        if "uddg=" in raw_href:
            parsed = urlparse(raw_href)
            uddg = parse_qs(parsed.query).get("uddg", [""])[0]
            return unquote(uddg) if uddg else raw_href
        if raw_href.startswith("//"):
            return f"https:{raw_href}"
        return raw_href

    def _should_crawl_result(self, result: SearchResult, resolved: ResolvedIssuer) -> bool:
        if self._is_direct_pdf_like_url(result.url):
            return False
        return self._allow_public_pdf_host(result.host, resolved)

    def _allow_public_pdf_host(self, host: str, resolved: ResolvedIssuer) -> bool:
        lowered_host = host.lower()
        if self._is_blocked_result_host(lowered_host):
            return False
        if any(lowered_host.endswith(suffix) for suffix in KNOWN_PUBLIC_PDF_HOST_SUFFIXES):
            return True
        company_tokens = self._company_tokens(resolved.company_name)
        if resolved.ticker.lower() in lowered_host:
            return True
        return any(token in lowered_host for token in company_tokens)

    def _is_blocked_result_host(self, host: str) -> bool:
        return any(host.endswith(suffix) for suffix in BLOCKED_RESULT_HOST_SUFFIXES)

    def _company_tokens(self, company_name: str) -> list[str]:
        normalized = NON_COMPANY_WORD_RE.sub(" ", company_name.upper()).split()
        tokens = [token.lower() for token in normalized if len(token) > 2 and token not in DROP_COMPANY_TOKENS]
        return tokens[:4]

    def _slug_variants(self, company_name: str) -> list[str]:
        raw_tokens = [token.lower() for token in NON_COMPANY_WORD_RE.sub(" ", company_name.upper()).split() if token]
        if not raw_tokens:
            return ["company"]

        variants: list[list[str]] = [raw_tokens]
        token_aliases = {
            "corp": "corporation",
            "co": "company",
            "inc": "incorporated",
            "ltd": "limited",
        }
        expanded = [token_aliases.get(token, token) for token in raw_tokens]
        if expanded != raw_tokens:
            variants.append(expanded)
        trimmed = [token for token in expanded if token not in {"corporation", "company", "incorporated", "limited", "holdings", "group"}]
        if trimmed and trimmed != expanded:
            variants.append(trimmed)

        slugs: list[str] = []
        for tokens in variants:
            slug = "-".join(tokens).strip("-")
            if slug and slug not in slugs:
                slugs.append(slug)
        return slugs

    def _normalize_company_name(self, value: str) -> str:
        return re.sub(r"[^A-Z0-9]+", "", value.upper())

    def _hostname(self, url: str) -> str:
        return urlparse(url).hostname or ""

    def _extract_company_site_urls(self, filing_text: str, resolved: ResolvedIssuer) -> list[str]:
        urls = sorted(set(re.findall(r"https?://[^\s\"'<>]+", filing_text)))
        company_urls: list[str] = []
        for url in urls:
            host = self._hostname(url).lower()
            if not host or host.endswith("sec.gov"):
                continue
            if not self._allow_public_pdf_host(host, resolved):
                continue
            company_urls.append(url.rstrip(".,);"))
        return company_urls

    def _expand_company_site_urls(self, url: str) -> list[tuple[str, bool]]:
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return []
        base_root = f"{parsed.scheme}://{parsed.netloc}"
        expanded: list[tuple[str, bool]] = []
        discovered_path = parsed.path or ""
        if discovered_path and ALPHA_PATH_RE.search(discovered_path):
            candidate = self._normalize_page_url(f"{base_root}{discovered_path}")
            if candidate and self._page_relevance_score(candidate, candidate) > 0:
                expanded.append((candidate, True))
        for path in COMPANY_SITE_HINT_PATHS:
            normalized_path = path if path.startswith("/") else f"/{path}" if path else ""
            candidate = self._normalize_page_url(f"{base_root}{normalized_path}")
            if candidate and candidate not in {value for value, _ in expanded}:
                expanded.append((candidate, False))
        return expanded

    def _is_direct_pdf_like_url(self, url: str) -> bool:
        parsed = urlparse(url)
        path = parsed.path.lower()
        if path.endswith(".pdf"):
            return True
        return "/static-files/" in path

    def _looks_like_pdf(self, file_path: Path, content_type: str | None) -> bool:
        if content_type and "pdf" in content_type.lower():
            return True
        with file_path.open("rb") as handle:
            return handle.read(5) == b"%PDF-"

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

    def _should_skip_download(self, destination: Path, manifest: dict[str, Any], workspace_root: Path) -> bool:
        if not destination.exists():
            return False
        relative_name = self._manifest_relative_name(destination, workspace_root)
        manifest_entry = manifest.get("files", {}).get(relative_name)
        if not manifest_entry:
            return False
        expected_checksum = str(manifest_entry.get("checksum") or "").strip()
        if not expected_checksum:
            return False
        return self._sha256_file(destination) == expected_checksum

    def _update_manifest_entry(
        self,
        *,
        manifest: dict[str, Any],
        workspace_root: Path,
        file_path: Path,
        checksum: str,
        size_bytes: int,
        source_url: str,
    ) -> None:
        files = manifest.setdefault("files", {})
        files[self._manifest_relative_name(file_path, workspace_root)] = {
            "checksum": checksum,
            "sizeBytes": size_bytes,
            "sourceUrl": source_url,
            "updatedAt": datetime.now(UTC).isoformat(),
        }

    def _manifest_relative_name(self, file_path: Path, workspace_root: Path) -> str:
        try:
            return file_path.relative_to(workspace_root).as_posix()
        except ValueError:
            return file_path.relative_to(workspace_root.parent).as_posix()

    def _write_json(self, path: Path, payload: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    def _write_csv(self, path: Path, rows: list[dict[str, Any]]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=PDF_EXPORT_FIELDS)
            writer.writeheader()
            for row in rows:
                writer.writerow({field: row.get(field) for field in PDF_EXPORT_FIELDS})

    def _sha256_file(self, file_path: Path) -> str:
        hasher = hashlib.sha256()
        with file_path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(64 * 1024), b""):
                hasher.update(chunk)
        return hasher.hexdigest()

    def _browser_user_agent(self) -> str:
        return (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )

    def _slugify(self, value: str) -> str:
        return DIRECTORY_HINT_RE.sub("-", value.strip()).strip("-").lower() or "undated"

    def _sleep_backoff(self, attempt: int) -> None:
        time.sleep(min(20.0, (0.75 * (2**attempt)) + random.uniform(0.05, 0.4)))

    def _limiter_for(self, scope: str, rate: float) -> GenericRateLimiter:
        key = f"{scope}:{round(max(rate, 0.1), 4)}"
        with self._limiters_lock:
            limiter = self._limiters.get(key)
            if limiter is None:
                limiter = GenericRateLimiter.from_rate(rate)
                self._limiters[key] = limiter
            return limiter

    def _sec_request(
        self,
        method: str,
        url: str,
        options: InvestorPdfRuntimeOptions,
        *,
        params: dict[str, Any] | None = None,
        stream: bool = False,
    ) -> requests.Response:
        return self._request(
            method=method,
            url=url,
            options=options,
            headers={
                "Accept": "application/json, text/html, */*",
                "Accept-Encoding": "gzip, deflate",
                "User-Agent": options.sec_user_agent,
            },
            limiter=self._limiter_for("sec", options.sec_max_requests_per_second),
            params=params,
            stream=stream,
            retryable_status_codes=SEC_RETRYABLE_STATUS_CODES,
        )

    def _web_request(
        self,
        method: str,
        url: str,
        options: InvestorPdfRuntimeOptions,
        *,
        params: dict[str, Any] | None = None,
    ) -> requests.Response:
        return self._request(
            method=method,
            url=url,
            options=options,
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate",
                "User-Agent": options.web_user_agent,
            },
            limiter=self._limiter_for("web", options.web_max_requests_per_second),
            params=params,
            stream=False,
            retryable_status_codes=WEB_RETRYABLE_STATUS_CODES,
        )

    def _download_request(self, url: str, options: InvestorPdfRuntimeOptions) -> requests.Response:
        host = self._hostname(url)
        user_agent = options.sec_user_agent if host.endswith("sec.gov") else options.web_user_agent
        return self._request(
            method="GET",
            url=url,
            options=options,
            headers={
                "Accept": "application/pdf,application/octet-stream,*/*",
                "Accept-Encoding": "gzip, deflate",
                "User-Agent": user_agent,
            },
            limiter=self._limiter_for("download", options.web_max_requests_per_second),
            params=None,
            stream=True,
            retryable_status_codes=WEB_RETRYABLE_STATUS_CODES if not host.endswith("sec.gov") else SEC_RETRYABLE_STATUS_CODES,
        )

    def _request(
        self,
        *,
        method: str,
        url: str,
        options: InvestorPdfRuntimeOptions,
        headers: dict[str, str],
        limiter: GenericRateLimiter,
        params: dict[str, Any] | None,
        stream: bool,
        retryable_status_codes: set[int],
    ) -> requests.Response:
        last_error: Exception | None = None
        for attempt in range(options.retry_limit + 1):
            limiter.wait()
            try:
                response = requests.request(
                    method,
                    url,
                    timeout=options.timeout_seconds,
                    stream=stream,
                    headers=headers,
                    params=params,
                    allow_redirects=True,
                )
            except requests.RequestException as exc:
                last_error = exc
                if attempt >= options.retry_limit:
                    break
                self._sleep_backoff(attempt)
                continue

            if response.status_code in retryable_status_codes:
                if attempt >= options.retry_limit:
                    detail = response.text[:240] if not stream else ""
                    response.close()
                    raise RuntimeError(f"Request failed with {response.status_code} for {url}. {detail}".strip())
                response.close()
                self._sleep_backoff(attempt)
                continue

            if response.status_code >= 400:
                detail = response.text[:240] if not stream else ""
                response.close()
                raise RuntimeError(f"Request failed with {response.status_code} for {url}. {detail}".strip())
            return response

        raise RuntimeError(f"Request failed for {url}: {last_error}") from last_error

    def _get_sec_json(self, url: str, options: InvestorPdfRuntimeOptions) -> dict[str, Any]:
        response = self._sec_request("GET", url, options, stream=False)
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
