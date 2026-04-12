"""SEC EDGAR downloader and source status helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
import csv
import hashlib
import html
import json
from pathlib import Path
import random
import re
import shutil
import threading
import time
from typing import Any

from bs4 import BeautifulSoup
import requests
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen import canvas

from investing_platform.config import DashboardSettings
from investing_platform.models import EdgarDownloadRequest, EdgarDownloadResponse, EdgarSourceStatus


COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL_TEMPLATE = "https://data.sec.gov/submissions/CIK{cik10}.json"
OLDER_SUBMISSIONS_URL_TEMPLATE = "https://data.sec.gov/submissions/{name}"
ARCHIVE_BASE_URL_TEMPLATE = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession}"
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
DEFAULT_PDF_FOLDER_FORMAT = "pdfs/[date]_[filing-type]_[sequence]"
PDF_FOLDER_TOKEN_ALIASES = {
    "date": "filing_date",
    "filing_date": "filing_date",
    "filing-date": "filing_date",
    "filing_type": "form",
    "filing-type": "form",
    "form": "form",
    "sequence": "accession",
    "accession": "accession",
    "filename": "filename",
    "file": "filename",
    "filing": "filing",
    "ticker": "ticker",
}


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
    generated_pdfs: int = 0
    skipped_files: int = 0
    failed_files: int = 0


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


class EdgarDownloader:
    """Reusable SEC EDGAR downloader for the dashboard and CLI."""

    def __init__(self, settings: DashboardSettings) -> None:
        self._settings = settings
        self._company_lookup_cache: list[dict[str, Any]] | None = None
        self._company_lookup_lock = threading.Lock()
        self._limiters: dict[float, SecRateLimiter] = {}
        self._limiters_lock = threading.Lock()

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

    def download(self, request: EdgarDownloadRequest) -> EdgarDownloadResponse:
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
        effective_pdf_folder_format = self._effective_pdf_folder_format(request.pdfFolderFormat)
        if request.pdfLayout != "nested":
            self._compile_pdf_folder_format(effective_pdf_folder_format)

        resolved = self._resolve_company(request, options)
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
            generatedPdfs=counters.generated_pdfs,
            skippedFiles=counters.skipped_files,
            failedFiles=counters.failed_files,
            downloadMode=request.downloadMode,
            pdfLayout=request.pdfLayout,
            pdfFolderFormat=effective_pdf_folder_format,
            includeExhibits=request.includeExhibits,
            resume=request.resume,
            researchRootPath=str(output_root),
            stockPath=str(stock_root),
            filingsPath=str(filings_dir),
            pdfsPath=str(
                stock_root
                if request.pdfLayout == "nested"
                else stock_root / self._pdf_library_root_relative(effective_pdf_folder_format)
            ),
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
        return response

    def last_sync(self, request: EdgarDownloadRequest) -> EdgarDownloadResponse | None:
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
            ticker = self._resolve_company(request, options).ticker

        last_sync_path = output_root / "stocks" / ticker / ".edgar" / "manifests" / "last-sync.json"
        if not last_sync_path.exists():
            return None
        payload = json.loads(last_sync_path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            return None
        return EdgarDownloadResponse.model_validate(payload)

    def _resolve_company(self, request: EdgarDownloadRequest, options: EdgarRuntimeOptions) -> ResolvedCompany:
        if request.cik:
            cik10 = request.cik.zfill(10)
            submissions_payload = self._get_json(SUBMISSIONS_URL_TEMPLATE.format(cik10=cik10), options)
            return self._resolved_company_from_payload(submissions_payload, fallback_ticker=request.ticker)

        company_lookup = self._load_company_lookup(options)
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

    def _load_company_lookup(self, options: EdgarRuntimeOptions) -> list[dict[str, Any]]:
        with self._company_lookup_lock:
            if self._company_lookup_cache is None:
                payload = self._get_json(COMPANY_TICKERS_URL, options)
                if not isinstance(payload, dict):
                    raise ValueError("Unexpected SEC company_tickers.json payload.")
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
            self._maybe_generate_pdf_copy(
                source_path=destination,
                request=request,
                manifest=manifest,
                edgar_root=edgar_root,
                counters=counters,
            )
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
        self._maybe_generate_pdf_copy(
            source_path=destination,
            request=request,
            manifest=manifest,
            edgar_root=edgar_root,
            counters=counters,
        )

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

    def _maybe_generate_pdf_copy(
        self,
        *,
        source_path: Path,
        request: EdgarDownloadRequest,
        manifest: dict[str, Any],
        edgar_root: Path,
        counters: DownloadCounters,
    ) -> None:
        if request.downloadMode == "metadata-only":
            return
        if not source_path.exists() or not self._is_pdf_source_candidate(source_path):
            return
        if "bundle" in source_path.parts:
            return

        source_checksum = self._sha256_file(source_path)
        pdf_targets = self._pdf_target_paths(
            source_path=source_path,
            edgar_root=edgar_root,
            pdf_layout=request.pdfLayout,
            pdf_folder_format=self._effective_pdf_folder_format(request.pdfFolderFormat),
        )
        if not pdf_targets:
            return

        stale_targets = [
            pdf_path
            for pdf_path in pdf_targets
            if not (
                request.resume
                and self._should_skip_generated_pdf(
                    source_path=source_path,
                    pdf_path=pdf_path,
                    source_checksum=source_checksum,
                    manifest=manifest,
                    edgar_root=edgar_root,
                )
            )
        ]
        if not stale_targets:
            return

        primary_target = stale_targets[0]

        try:
            self._render_readable_pdf(source_path=source_path, pdf_path=primary_target)
        except Exception:
            counters.failed_files += 1
            return

        self._record_generated_pdf(
            pdf_path=primary_target,
            source_path=source_path,
            source_checksum=source_checksum,
            manifest=manifest,
            edgar_root=edgar_root,
            source_url=f"generated://readable-pdf/{source_path.name}",
        )
        counters.generated_pdfs += 1

        for pdf_path in stale_targets[1:]:
            pdf_path.parent.mkdir(parents=True, exist_ok=True)
            temp_path = pdf_path.with_name(f"{pdf_path.name}.part")
            shutil.copy2(primary_target, temp_path)
            temp_path.replace(pdf_path)
            self._record_generated_pdf(
                pdf_path=pdf_path,
                source_path=source_path,
                source_checksum=source_checksum,
                manifest=manifest,
                edgar_root=edgar_root,
                source_url=f"generated://readable-pdf/{source_path.name}",
            )
            counters.generated_pdfs += 1

    def _is_pdf_source_candidate(self, source_path: Path) -> bool:
        return source_path.suffix.lower() in {".htm", ".html", ".txt"}

    def _should_skip_generated_pdf(
        self,
        *,
        source_path: Path,
        pdf_path: Path,
        source_checksum: str,
        manifest: dict[str, Any],
        edgar_root: Path,
    ) -> bool:
        if not pdf_path.exists():
            return False
        relative_name = self._manifest_relative_name(pdf_path, edgar_root)
        manifest_entry = manifest.get("files", {}).get(relative_name)
        if not manifest_entry:
            return False
        expected_checksum = str(manifest_entry.get("checksum") or "").strip()
        expected_source_checksum = str(manifest_entry.get("sourceChecksum") or "").strip()
        if not expected_checksum or expected_source_checksum != source_checksum:
            return False
        return self._sha256_file(pdf_path) == expected_checksum

    def _pdf_target_paths(self, *, source_path: Path, edgar_root: Path, pdf_layout: str, pdf_folder_format: str) -> list[Path]:
        stock_root = edgar_root.parent
        nested_path = source_path.with_name(f"{source_path.stem}-readable.pdf")
        library_directory = self._render_pdf_library_directory(
            source_path=source_path,
            edgar_root=edgar_root,
            pdf_folder_format=pdf_folder_format,
        )
        by_filing_path = stock_root / library_directory / nested_path.name

        if pdf_layout == "nested":
            return [nested_path]
        if pdf_layout == "by-filing":
            return [by_filing_path]
        return [nested_path, by_filing_path]

    def _effective_pdf_folder_format(self, pdf_folder_format: str | None) -> str:
        value = (pdf_folder_format or "").strip()
        return value or DEFAULT_PDF_FOLDER_FORMAT

    def _pdf_library_root_relative(self, pdf_folder_format: str) -> Path:
        compiled = self._compile_pdf_folder_format(pdf_folder_format)
        compiled_path = Path(compiled)
        stable_parts: list[str] = []
        for part in compiled_path.parts:
            if "{" in part or "}" in part:
                break
            stable_parts.append(part)
        if stable_parts:
            return Path(*stable_parts)
        return Path("pdfs")

    def _compile_pdf_folder_format(self, pdf_folder_format: str) -> str:
        def replace_square(match: re.Match[str]) -> str:
            token = match.group(1).strip().lower()
            canonical = PDF_FOLDER_TOKEN_ALIASES.get(token)
            if canonical is None:
                raise ValueError(
                    f"Unknown PDF folder token '[{match.group(1)}]'. Use [date], [filing-type], [sequence], [accession], [filename], [filing], or [ticker]."
                )
            return "{" + canonical + "}"

        compiled = re.sub(r"\[([^\]]+)\]", replace_square, pdf_folder_format)

        def replace_brace(match: re.Match[str]) -> str:
            token = match.group(1).strip().lower()
            canonical = PDF_FOLDER_TOKEN_ALIASES.get(token, token)
            if canonical not in {"filing_date", "form", "accession", "filename", "filing", "ticker"}:
                raise ValueError(
                    f"Unknown PDF folder token '{{{match.group(1)}}}'. Use date, filing-type, sequence, accession, filename, filing, or ticker."
                )
            return "{" + canonical + "}"

        compiled = re.sub(r"\{([^{}]+)\}", replace_brace, compiled)
        if Path(compiled).is_absolute():
            raise ValueError("PDF folder format must be relative to the stock folder, not an absolute path.")
        return compiled

    def _render_pdf_library_directory(
        self,
        *,
        source_path: Path,
        edgar_root: Path,
        pdf_folder_format: str,
    ) -> Path:
        stock_root = edgar_root.parent
        compiled = self._compile_pdf_folder_format(pdf_folder_format)
        relative_source = source_path.relative_to(stock_root)
        path_parts = relative_source.parts
        filing_folder = path_parts[1] if path_parts and path_parts[0] == "filings" and len(path_parts) > 1 else path_parts[0]
        filename = source_path.stem
        ticker = stock_root.name

        filing_date, form, accession = self._parse_filing_folder_name(filing_folder)
        rendered = compiled.format(
            filing_date=self._sanitize_pdf_token(filing_date),
            form=self._sanitize_pdf_token(form),
            accession=self._sanitize_pdf_token(accession),
            filename=self._sanitize_pdf_token(filename),
            filing=self._sanitize_pdf_token(filing_folder),
            ticker=self._sanitize_pdf_token(ticker),
        )
        relative_path = Path(rendered)
        if any(part in {"..", "."} for part in relative_path.parts):
            raise ValueError("PDF folder format cannot escape the stock folder.")
        return relative_path

    def _parse_filing_folder_name(self, filing_folder: str) -> tuple[str, str, str]:
        parts = filing_folder.split("_", 2)
        if len(parts) == 3:
            return parts[0], parts[1], parts[2]
        return "undated", "filing", filing_folder

    def _sanitize_pdf_token(self, value: str) -> str:
        sanitized = value.replace("/", "-").replace("\\", "-").strip()
        return re.sub(r"\s+", "-", sanitized) or "item"

    def _record_generated_pdf(
        self,
        *,
        pdf_path: Path,
        source_path: Path,
        source_checksum: str,
        manifest: dict[str, Any],
        edgar_root: Path,
        source_url: str,
    ) -> None:
        if not pdf_path.exists():
            return
        self._update_manifest_entry(
            manifest=manifest,
            edgar_root=edgar_root,
            file_path=pdf_path,
            checksum=self._sha256_file(pdf_path),
            size_bytes=pdf_path.stat().st_size,
            source_url=source_url,
            source_checksum=source_checksum,
        )

    def _render_readable_pdf(self, *, source_path: Path, pdf_path: Path) -> None:
        source_text = self._extract_human_text(source_path)
        title = self._readable_pdf_title(source_path, source_text)
        temp_path = pdf_path.with_name(f"{pdf_path.name}.part")
        pdf_path.parent.mkdir(parents=True, exist_ok=True)

        pdf = canvas.Canvas(str(temp_path), pagesize=letter)
        pdf.setAuthor("Investing Platform EDGAR")
        pdf.setTitle(title)
        page_width, page_height = letter
        margin = 54
        text_width = page_width - (margin * 2)
        body_font = "Helvetica"
        title_font = "Helvetica-Bold"
        meta_font = "Helvetica"
        body_size = 10
        body_leading = 14
        y = page_height - margin

        def new_page() -> None:
            nonlocal y
            pdf.showPage()
            y = page_height - margin

        def draw_wrapped(lines: list[str], *, font_name: str, font_size: int, leading: int) -> None:
            nonlocal y
            for line in lines:
                if y < margin:
                    new_page()
                pdf.setFont(font_name, font_size)
                pdf.drawString(margin, y, line)
                y -= leading

        title_lines = simpleSplit(title, title_font, 14, text_width)
        draw_wrapped(title_lines, font_name=title_font, font_size=14, leading=18)
        y -= 4

        meta_lines = [
            f"Generated from {source_path.name}",
            f"Saved beside the original filing file on {datetime.now(UTC).strftime('%Y-%m-%d %H:%M UTC')}",
        ]
        for meta_line in meta_lines:
            draw_wrapped(simpleSplit(meta_line, meta_font, 9, text_width), font_name=meta_font, font_size=9, leading=12)
        y -= 8

        for paragraph in self._split_pdf_paragraphs(source_text):
            wrapped_lines = simpleSplit(paragraph, body_font, body_size, text_width)
            draw_wrapped(wrapped_lines or [""], font_name=body_font, font_size=body_size, leading=body_leading)
            y -= 6

        pdf.save()
        temp_path.replace(pdf_path)

    def _extract_human_text(self, source_path: Path) -> str:
        raw_bytes = source_path.read_bytes()
        text = self._decode_text(raw_bytes)
        if source_path.suffix.lower() in {".htm", ".html"}:
            soup = BeautifulSoup(text, "html.parser")
            for tag in soup(["script", "style", "noscript"]):
                tag.decompose()
            extracted = soup.get_text("\n", strip=True)
            text = html.unescape(extracted)
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip() or source_path.name

    def _decode_text(self, raw_bytes: bytes) -> str:
        for encoding in ("utf-8", "utf-8-sig", "latin-1"):
            try:
                return raw_bytes.decode(encoding)
            except UnicodeDecodeError:
                continue
        return raw_bytes.decode("utf-8", errors="replace")

    def _readable_pdf_title(self, source_path: Path, source_text: str) -> str:
        first_line = next((line.strip() for line in source_text.splitlines() if line.strip()), source_path.stem)
        return first_line[:140]

    def _split_pdf_paragraphs(self, source_text: str) -> list[str]:
        paragraphs: list[str] = []
        for block in source_text.split("\n\n"):
            lines = [line.strip() for line in block.splitlines() if line.strip()]
            if not lines:
                continue
            paragraphs.append(" ".join(lines))
        return paragraphs or [source_text]

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
        source_checksum: str | None = None,
    ) -> None:
        files = manifest.setdefault("files", {})
        relative_name = self._manifest_relative_name(file_path, edgar_root)
        entry = {
            "checksum": checksum,
            "sizeBytes": size_bytes,
            "sourceUrl": source_url,
            "updatedAt": datetime.now(UTC).isoformat(),
        }
        if source_checksum:
            entry["sourceChecksum"] = source_checksum
        files[relative_name] = entry

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
