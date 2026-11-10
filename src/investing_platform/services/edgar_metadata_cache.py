"""App-global EDGAR metadata cache and bulk baseline helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3
from typing import Any, Callable
import zipfile

import requests

from investing_platform.config import DashboardSettings
from investing_platform.services.edgar_common import (
    ARCHIVE_BASE_URL_TEMPLATE,
    COMPANYFACTS_BULK_URL,
    EdgarRuntimeOptions,
    ResolvedCompany,
    SUBMISSIONS_BULK_URL,
)


SUBMISSIONS_SQLITE_SCHEMA_VERSION = 2
COMPANYFACTS_SQLITE_SCHEMA_VERSION = 1


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

    def refresh_issuer_facts(self, resolved: ResolvedCompany, options: EdgarRuntimeOptions, *, force_refresh: bool = False) -> dict[str, Any]:
        """Keep one compressed SEC source per CIK; never fetch the market-wide ZIP implicitly."""
        root = self._filing_metadata_root() / "companyfacts"
        root.mkdir(parents=True, exist_ok=True)
        path = root / f"CIK{resolved.cik10}.json.gz"
        state_path = root / f"CIK{resolved.cik10}.state.json"
        state = self._load_json_document(state_path) or {}
        url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{resolved.cik10}.json"
        recent = resolved.submissions_payload.get("filings", {}).get("recent", {}).get("accessionNumber", [])
        latest_accession = recent[0] if recent else None
        try:
            age = datetime.now(UTC) - datetime.fromisoformat(str(state.get("lastRefreshedAt")))
        except ValueError:
            age = timedelta(days=2)
        if not force_refresh and path.exists() and state.get("status") == "ready" and latest_accession and state.get("latestAccession") == latest_accession and age < timedelta(hours=24):
            return state
        try:
            response = self._request("GET", url, options, False)
            try:
                payload = response.json()
                if str(payload.get("cik", "")).zfill(10) != resolved.cik10 or not isinstance(payload.get("facts"), dict):
                    raise ValueError("SEC companyfacts response does not match the requested issuer.")
                raw = response.content
                digest = hashlib.sha256(raw).hexdigest()
                if not path.exists() or state.get("sha256") != digest:
                    temporary = path.with_suffix(".part")
                    temporary.write_bytes(gzip.compress(raw, mtime=0))
                    temporary.replace(path)
                state = {"status": "ready", "sourceUrl": url, "cik": resolved.cik10,
                         "sha256": digest, "latestAccession": latest_accession, "lastRefreshedAt": datetime.now(UTC).isoformat(),
                         "etag": response.headers.get("ETag"), "lastModified": response.headers.get("Last-Modified")}
            finally:
                response.close()
        except (RuntimeError, ValueError, OSError, requests.RequestException) as exc:
            state = {**state, "status": "stale" if path.exists() else "unavailable", "sourceUrl": url, "lastError": str(exc)}
        state["lastCheckedAt"] = datetime.now(UTC).isoformat()
        temporary_state = state_path.with_suffix(".part")
        temporary_state.write_text(json.dumps(state, indent=2), encoding="utf-8")
        temporary_state.replace(state_path)
        return state

    def ensure_bulk_baseline(self, options: EdgarRuntimeOptions, *, force_refresh: bool = False) -> dict[str, Any]:
        state_path = self._bulk_state_path()
        state = self._load_json_document(state_path) or {"schemaVersion": 1, "artifacts": {}}
        artifacts = state.setdefault("artifacts", {})
        normalized_stores = state.setdefault("normalizedStores", {})

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
        normalized_results = {
            "submissions.sqlite3": self._ensure_submissions_store(
                artifact_state=artifact_results["submissions.zip"],
                current_state=normalized_stores.get("submissions.sqlite3"),
                force_refresh=force_refresh,
            ),
            "companyfacts.sqlite3": self._ensure_companyfacts_store(
                artifact_state=artifact_results["companyfacts.zip"],
                current_state=normalized_stores.get("companyfacts.sqlite3"),
                force_refresh=force_refresh,
            ),
        }
        state["artifacts"] = artifact_results
        state["normalizedStores"] = normalized_results
        state["lastCheckedAt"] = datetime.now(UTC).isoformat()
        required_stores_ready = normalized_results["submissions.sqlite3"].get("status") == "ready"
        state["status"] = (
            "ready"
            if all(result.get("status") == "ready" for result in artifact_results.values()) and required_stores_ready
            else "degraded"
        )
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")
        return state

    def load_filing_rows(self, resolved: ResolvedCompany) -> list[dict[str, Any]]:
        sqlite_path = self._submissions_sqlite_path()
        if not sqlite_path.exists():
            return []
        try:
            with sqlite3.connect(sqlite_path) as connection:
                connection.row_factory = sqlite3.Row
                rows = connection.execute(
                    """
                    SELECT *
                    FROM filing_metadata
                    WHERE cik10 = ?
                    ORDER BY filing_date DESC, accession_number DESC
                    """,
                    (resolved.cik10,),
                ).fetchall()
        except sqlite3.Error:
            return []
        return [self._filing_row_from_sqlite(row, resolved=resolved) for row in rows]

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
        self.upsert_issuer_filings(resolved, filings, discovered_via="live")
        return payload

    def upsert_issuer_filings(self, resolved: ResolvedCompany, filings: list[dict[str, Any]], *, discovered_via: str) -> None:
        sqlite_path = self._submissions_sqlite_path()
        sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        imported_at = datetime.now(UTC).isoformat()
        with sqlite3.connect(sqlite_path) as connection:
            self._create_submissions_schema(connection)
            self._upsert_issuer_row(
                connection,
                cik10=resolved.cik10,
                ticker=resolved.ticker,
                company_name=resolved.company_name,
                tickers=[resolved.ticker],
                source_file="live-overlay",
                imported_at=imported_at,
            )
            self._upsert_filing_rows(
                connection,
                filings,
                source_file="live-overlay",
                imported_at=imported_at,
                discovered_via=discovered_via,
            )
            connection.commit()

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

    def _submissions_sqlite_path(self) -> Path:
        return self._filing_metadata_root() / "submissions.sqlite3"

    def _companyfacts_sqlite_path(self) -> Path:
        return self._filing_metadata_root() / "companyfacts.sqlite3"

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

    def _ensure_submissions_store(
        self,
        *,
        artifact_state: dict[str, Any],
        current_state: Any,
        force_refresh: bool,
    ) -> dict[str, Any]:
        sqlite_path = self._submissions_sqlite_path()
        previous = current_state if isinstance(current_state, dict) else {}
        result = {
            **previous,
            "path": str(sqlite_path),
            "schemaVersion": SUBMISSIONS_SQLITE_SCHEMA_VERSION,
            "sourceArtifact": artifact_state.get("path"),
            "sourceLastModified": artifact_state.get("lastModified"),
            "sourceEtag": artifact_state.get("etag"),
            "sourceContentLength": artifact_state.get("contentLength"),
            "lastCheckedAt": datetime.now(UTC).isoformat(),
        }
        if artifact_state.get("status") != "ready":
            return {
                **result,
                "status": "degraded",
                "lastError": artifact_state.get("lastError") or "Submissions bulk artifact is unavailable.",
            }
        if sqlite_path.exists() and not force_refresh and self._normalized_store_matches_source(previous, artifact_state):
            return {**result, "status": previous.get("status") or "ready", "lastError": None}

        try:
            import_result = self._import_submissions_zip(Path(str(artifact_state["path"])), sqlite_path)
            return {**result, **import_result, "status": "ready", "scope": "all-filers", "lastError": None}
        except Exception as exc:
            return {
                **result,
                "status": "degraded",
                "lastError": str(exc),
            }

    def _ensure_companyfacts_store(
        self,
        *,
        artifact_state: dict[str, Any],
        current_state: Any,
        force_refresh: bool,
    ) -> dict[str, Any]:
        sqlite_path = self._companyfacts_sqlite_path()
        previous = current_state if isinstance(current_state, dict) else {}
        del force_refresh
        sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(sqlite_path) as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS companyfacts_import_state (
                    key TEXT PRIMARY KEY,
                    value TEXT
                )
                """
            )
            connection.executemany(
                "INSERT OR REPLACE INTO companyfacts_import_state(key, value) VALUES (?, ?)",
                [
                    ("schemaVersion", str(COMPANYFACTS_SQLITE_SCHEMA_VERSION)),
                    ("sourceArtifact", str(artifact_state.get("path") or "")),
                    ("sourceLastModified", str(artifact_state.get("lastModified") or "")),
                    ("updatedAt", datetime.now(UTC).isoformat()),
                ],
            )
            connection.commit()
        return {
            **previous,
            "status": "deferred",
            "path": str(sqlite_path),
            "schemaVersion": COMPANYFACTS_SQLITE_SCHEMA_VERSION,
            "sourceArtifact": artifact_state.get("path"),
            "sourceLastModified": artifact_state.get("lastModified"),
            "sourceEtag": artifact_state.get("etag"),
            "sourceContentLength": artifact_state.get("contentLength"),
            "lastCheckedAt": datetime.now(UTC).isoformat(),
            "message": "Companyfacts normalization is deferred to the XBRL fact-enrichment phase.",
            "lastError": None if artifact_state.get("status") == "ready" else artifact_state.get("lastError"),
        }

    def _normalized_store_matches_source(self, state: dict[str, Any], artifact_state: dict[str, Any]) -> bool:
        return (
            state.get("scope", "all-filers") == "all-filers"
            and int(state.get("schemaVersion") or 0) == SUBMISSIONS_SQLITE_SCHEMA_VERSION
            and str(state.get("sourceLastModified") or "") == str(artifact_state.get("lastModified") or "")
            and str(state.get("sourceEtag") or "") == str(artifact_state.get("etag") or "")
            and str(state.get("sourceContentLength") or "") == str(artifact_state.get("contentLength") or "")
        )

    def _import_submissions_zip(self, artifact_path: Path, sqlite_path: Path) -> dict[str, Any]:
        imported_at = datetime.now(UTC).isoformat()
        temp_path = sqlite_path.with_name(f"{sqlite_path.name}.part")
        if temp_path.exists():
            temp_path.unlink()
        issuers_imported = 0
        filings_imported = 0
        with zipfile.ZipFile(artifact_path) as archive, sqlite3.connect(temp_path) as connection:
            self._create_submissions_schema(connection)
            for member in sorted(archive.infolist(), key=lambda item: item.filename):
                if member.is_dir() or not member.filename.lower().endswith(".json"):
                    continue
                with archive.open(member) as handle:
                    payload = json.load(handle)
                if not isinstance(payload, dict):
                    continue
                issuer = self._issuer_from_submission_payload(payload)
                if issuer is None:
                    continue
                self._upsert_issuer_row(
                    connection,
                    cik10=issuer["cik10"],
                    ticker=issuer["ticker"],
                    company_name=issuer["companyName"],
                    tickers=issuer["tickers"],
                    source_file=member.filename,
                    imported_at=imported_at,
                )
                issuers_imported += 1
                filing_rows = self._filing_rows_from_submission_payload(payload, issuer=issuer)
                self._upsert_filing_rows(
                    connection,
                    filing_rows,
                    source_file=member.filename,
                    imported_at=imported_at,
                    discovered_via="bulk",
                )
                filings_imported += len(filing_rows)
            connection.commit()
        temp_path.replace(sqlite_path)
        return {
            "lastImportedAt": imported_at,
            "issuersImported": issuers_imported,
            "filingsImported": filings_imported,
        }

    def _create_submissions_schema(self, connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS issuer_submissions (
                cik10 TEXT PRIMARY KEY,
                cik TEXT NOT NULL,
                ticker TEXT,
                company_name TEXT,
                tickers_json TEXT NOT NULL,
                source_file TEXT,
                imported_at TEXT NOT NULL
            )
            """
        )
        filing_schema = """
            CREATE TABLE IF NOT EXISTS filing_metadata (
                accession_number TEXT NOT NULL,
                cik10 TEXT NOT NULL,
                ticker TEXT,
                company_name TEXT,
                form TEXT,
                filing_date TEXT,
                report_date TEXT,
                acceptance_date_time TEXT,
                accession_number_no_dashes TEXT,
                primary_document TEXT,
                primary_doc_description TEXT,
                items TEXT,
                act TEXT,
                file_number TEXT,
                film_number TEXT,
                size INTEGER,
                is_xbrl INTEGER,
                is_inline_xbrl INTEGER,
                archive_base_url TEXT,
                primary_document_url TEXT,
                discovered_via TEXT,
                source_file TEXT,
                imported_at TEXT NOT NULL,
                PRIMARY KEY (cik10, accession_number)
            )
            """
        connection.execute(filing_schema)
        columns = connection.execute("PRAGMA table_info(filing_metadata)").fetchall()
        primary_key = [row[1] for row in sorted(columns, key=lambda row: row[5]) if row[5]]
        if primary_key == ["accession_number"]:
            # Ownership and joint filings can appear in multiple issuer feeds.
            # Preserve each issuer association instead of replacing another CIK.
            connection.execute("SAVEPOINT migrate_filing_identity")
            try:
                connection.execute("ALTER TABLE filing_metadata RENAME TO filing_metadata_v1")
                connection.execute(filing_schema)
                names = ",".join(row[1] for row in columns)
                connection.execute(f"INSERT INTO filing_metadata ({names}) SELECT {names} FROM filing_metadata_v1")
                connection.execute("DROP TABLE filing_metadata_v1")
                connection.execute("RELEASE SAVEPOINT migrate_filing_identity")
            except Exception:
                connection.execute("ROLLBACK TO SAVEPOINT migrate_filing_identity")
                connection.execute("RELEASE SAVEPOINT migrate_filing_identity")
                raise
        connection.execute("CREATE INDEX IF NOT EXISTS idx_filing_metadata_cik_date ON filing_metadata(cik10, filing_date DESC, accession_number DESC)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_filing_metadata_ticker_date ON filing_metadata(ticker, filing_date DESC, accession_number DESC)")

    def _upsert_issuer_row(
        self,
        connection: sqlite3.Connection,
        *,
        cik10: str,
        ticker: str,
        company_name: str,
        tickers: list[str],
        source_file: str,
        imported_at: str,
    ) -> None:
        connection.execute(
            """
            INSERT OR REPLACE INTO issuer_submissions(
                cik10, cik, ticker, company_name, tickers_json, source_file, imported_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (cik10, cik10.lstrip("0") or "0", ticker, company_name, json.dumps(tickers), source_file, imported_at),
        )

    def _upsert_filing_rows(
        self,
        connection: sqlite3.Connection,
        filings: list[dict[str, Any]],
        *,
        source_file: str,
        imported_at: str,
        discovered_via: str,
    ) -> None:
        for filing in filings:
            accession = str(filing.get("accessionNumber") or "").strip()
            if not accession:
                continue
            connection.execute(
                """
                INSERT OR REPLACE INTO filing_metadata(
                    accession_number, cik10, ticker, company_name, form, filing_date, report_date,
                    acceptance_date_time, accession_number_no_dashes, primary_document,
                    primary_doc_description, items, act, file_number, film_number, size, is_xbrl,
                    is_inline_xbrl, archive_base_url, primary_document_url, discovered_via,
                    source_file, imported_at
                )
                VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    COALESCE((SELECT discovered_via FROM filing_metadata WHERE cik10 = ? AND accession_number = ?), ?),
                    ?, ?
                )
                """,
                (
                    accession,
                    str(filing.get("cik10") or "").zfill(10),
                    filing.get("ticker"),
                    filing.get("companyName"),
                    filing.get("form"),
                    filing.get("filingDate"),
                    filing.get("reportDate"),
                    filing.get("acceptanceDateTime"),
                    filing.get("accessionNumberNoDashes"),
                    filing.get("primaryDocument"),
                    filing.get("primaryDocDescription"),
                    filing.get("items"),
                    filing.get("act"),
                    filing.get("fileNumber"),
                    filing.get("filmNumber"),
                    filing.get("size"),
                    filing.get("isXBRL"),
                    filing.get("isInlineXBRL"),
                    filing.get("archiveBaseUrl"),
                    filing.get("primaryDocumentUrl"),
                    str(filing.get("cik10") or "").zfill(10),
                    accession,
                    discovered_via,
                    source_file,
                    imported_at,
                ),
            )

    def _issuer_from_submission_payload(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        cik10 = self._normalize_cik(payload.get("cik"))
        if cik10 is None:
            return None
        tickers = [str(ticker).strip().upper() for ticker in payload.get("tickers", []) if str(ticker).strip()]
        ticker = tickers[0] if tickers else cik10
        company_name = str(payload.get("name") or ticker).strip()
        return {
            "cik10": cik10,
            "ticker": ticker,
            "tickers": tickers,
            "companyName": company_name,
        }

    def _filing_rows_from_submission_payload(self, payload: dict[str, Any], *, issuer: dict[str, Any]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for row in self._extract_compact_rows(payload):
            accession = str(row.get("accessionNumber") or "").strip()
            if not accession:
                continue
            accession_no_dashes = accession.replace("-", "")
            primary_document = str(row.get("primaryDocument") or "").strip()
            archive_base_url = ARCHIVE_BASE_URL_TEMPLATE.format(cik=issuer["cik10"].lstrip("0") or "0", accession=accession_no_dashes)
            rows.append(
                {
                    "ticker": issuer["ticker"],
                    "companyName": issuer["companyName"],
                    "cik": issuer["cik10"].lstrip("0") or "0",
                    "cik10": issuer["cik10"],
                    "form": str(row.get("form") or "").strip().upper(),
                    "filingDate": str(row.get("filingDate") or "").strip(),
                    "reportDate": str(row.get("reportDate") or "").strip() or None,
                    "acceptanceDateTime": str(row.get("acceptanceDateTime") or "").strip() or None,
                    "accessionNumber": accession,
                    "accessionNumberNoDashes": accession_no_dashes,
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
            )
        return rows

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
        return [{key: (values[index] if index < len(values) else None) for key, values in columnar_fields.items()} for index in range(length)]

    def _filing_row_from_sqlite(self, row: sqlite3.Row, *, resolved: ResolvedCompany) -> dict[str, Any]:
        return {
            "ticker": str(row["ticker"] or resolved.ticker),
            "companyName": str(row["company_name"] or resolved.company_name),
            "cik": resolved.cik,
            "cik10": resolved.cik10,
            "form": str(row["form"] or "").upper(),
            "filingDate": str(row["filing_date"] or ""),
            "reportDate": row["report_date"],
            "acceptanceDateTime": row["acceptance_date_time"],
            "accessionNumber": str(row["accession_number"] or ""),
            "accessionNumberNoDashes": str(row["accession_number_no_dashes"] or ""),
            "primaryDocument": row["primary_document"],
            "primaryDocDescription": row["primary_doc_description"],
            "items": row["items"],
            "act": row["act"],
            "fileNumber": row["file_number"],
            "filmNumber": row["film_number"],
            "size": row["size"],
            "isXBRL": row["is_xbrl"],
            "isInlineXBRL": row["is_inline_xbrl"],
            "archiveBaseUrl": row["archive_base_url"],
            "primaryDocumentUrl": row["primary_document_url"],
        }

    def _normalize_cik(self, value: Any) -> str | None:
        digits = "".join(character for character in str(value or "") if character.isdigit())
        if not digits:
            return None
        return digits.zfill(10)

    def _to_int(self, value: Any) -> int | None:
        if value in (None, ""):
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

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
