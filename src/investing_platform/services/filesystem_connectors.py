"""Filesystem-backed connector service for importing account CSV snapshots."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import UTC, datetime
import io
import json
from pathlib import Path
import threading

from investing_platform.config import DashboardSettings
from investing_platform.models import (
    FilesystemConnectorConfigRequest,
    FilesystemDocumentFile,
    FilesystemDocumentFolderResponse,
    FilesystemConnectorPortfolioResponse,
    FilesystemConnectorStatus,
    FilesystemHolding,
    FilesystemInvestmentAccount,
)


HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "account_id": ("account number", "account #", "account", "account id"),
    "account_name": ("account name", "registration", "account title", "account description"),
    "symbol": ("symbol", "ticker", "ticker symbol", "security symbol"),
    "name": ("description", "security description", "name", "security", "investment name"),
    "quantity": ("quantity", "qty", "shares", "current quantity"),
    "price": ("last price", "price", "current price", "mark price", "closing price"),
    "value": ("current value", "market value", "value", "current market value", "ending value"),
    "cost_basis": ("cost basis total", "cost basis", "total cost basis", "book cost", "cost"),
    "gain_loss": ("gain/loss dollar", "gain loss", "gain/loss", "total gain/loss dollar", "unrealized gain/loss"),
    "currency": ("currency", "currency code", "iso currency"),
}

CSV_FOLDER_CONNECTOR_ID = "csvFolder"
PDF_FOLDER_CONNECTOR_ID = "pdfFolder"


@dataclass(slots=True)
class StoredFilesystemConnector:
    account_key: str
    source_id: str
    connector_id: str
    display_name: str
    directory_path: str
    created_at: datetime
    updated_at: datetime


class FilesystemConnectorService:
    """Persists connector folders and normalizes the latest CSV snapshot."""

    def __init__(self, settings: DashboardSettings) -> None:
        self._settings = settings
        self._lock = threading.Lock()
        self._last_error_by_connector: dict[str, str | None] = {}
        self._last_successful_sync_by_connector: dict[str, datetime | None] = {}

    def list_connectors(self, account_key: str, connector_id: str | None = None) -> list[FilesystemConnectorStatus]:
        normalized_account_key = _normalize_account_key(account_key)
        records = self._read_records(normalized_account_key)
        if connector_id is not None:
            records = [record for record in records if record.connector_id == connector_id]
        records.sort(key=lambda record: (record.connector_id, record.display_name.lower(), record.created_at))
        return [self.connector_status(normalized_account_key, record.source_id) for record in records]

    def connector_status(self, account_key: str, source_id: str) -> FilesystemConnectorStatus:
        normalized_account_key = _normalize_account_key(account_key)
        normalized_source_id = _normalize_source_id(source_id)
        cache_key = _connector_cache_key(normalized_account_key, normalized_source_id)
        record = self._read_record(normalized_account_key, normalized_source_id)
        with self._lock:
            last_error = self._last_error_by_connector.get(cache_key)
            last_successful_sync_at = self._last_successful_sync_by_connector.get(cache_key)

        if record is None:
            raise ValueError("This filesystem connector source has not been configured yet.")

        directory = Path(record.directory_path).expanduser()
        csv_files = _list_csv_files(directory) if record.connector_id == CSV_FOLDER_CONNECTOR_ID and directory.exists() and directory.is_dir() else []
        pdf_files = _list_pdf_files(directory) if record.connector_id == PDF_FOLDER_CONNECTOR_ID and directory.exists() and directory.is_dir() else []
        latest_csv_path = str(csv_files[0]) if csv_files else None
        latest_pdf_path = str(pdf_files[0]) if pdf_files else None

        if not directory.exists() or not directory.is_dir():
            return FilesystemConnectorStatus(
                sourceId=record.source_id,
                connectorId=record.connector_id,
                available=True,
                connected=False,
                status="degraded",
                detail=f"Saved folder is unavailable: {directory}",
                displayName=record.display_name,
                directoryPath=str(directory),
                csvFilesCount=0,
                latestCsvPath=None,
                lastSuccessfulSyncAt=last_successful_sync_at,
                lastError=last_error or "Configured folder no longer exists.",
            )

        if record.connector_id == CSV_FOLDER_CONNECTOR_ID and not csv_files:
            return FilesystemConnectorStatus(
                sourceId=record.source_id,
                connectorId=record.connector_id,
                available=True,
                connected=True,
                status="degraded",
                detail="Folder is connected, but no CSV files were found yet.",
                displayName=record.display_name,
                directoryPath=str(directory),
                csvFilesCount=0,
                latestCsvPath=None,
                lastSuccessfulSyncAt=last_successful_sync_at,
                lastError=last_error,
            )

        if record.connector_id == PDF_FOLDER_CONNECTOR_ID and not pdf_files:
            return FilesystemConnectorStatus(
                sourceId=record.source_id,
                connectorId=record.connector_id,
                available=True,
                connected=True,
                status="degraded",
                detail="Folder is connected, but no PDF files were found yet.",
                displayName=record.display_name,
                directoryPath=str(directory),
                csvFilesCount=0,
                latestCsvPath=None,
                lastSuccessfulSyncAt=last_successful_sync_at,
                lastError=last_error,
            )

        return FilesystemConnectorStatus(
            sourceId=record.source_id,
            connectorId=record.connector_id,
            available=True,
            connected=True,
            status="degraded" if last_error else "ready",
            detail=last_error
            or (
                f"Using the latest CSV snapshot from {directory.name}."
                if record.connector_id == CSV_FOLDER_CONNECTOR_ID
                else f"Using the latest PDF library from {directory.name}."
            ),
            displayName=record.display_name,
            directoryPath=str(directory),
            csvFilesCount=len(csv_files) if record.connector_id == CSV_FOLDER_CONNECTOR_ID else len(pdf_files),
            latestCsvPath=latest_csv_path if record.connector_id == CSV_FOLDER_CONNECTOR_ID else latest_pdf_path,
            lastSuccessfulSyncAt=last_successful_sync_at,
            lastError=last_error,
        )

    def configure_connector(
        self,
        account_key: str,
        connector_id: str,
        request: FilesystemConnectorConfigRequest,
        source_id: str | None = None,
    ) -> FilesystemConnectorStatus:
        normalized_account_key = _normalize_account_key(account_key)
        display_name = request.displayName.strip()
        if not display_name:
            raise ValueError("Connector name is required.")
        directory = Path(request.directoryPath).expanduser()
        if not directory.exists():
            raise ValueError(f"Folder does not exist: {directory}")
        if not directory.is_dir():
            raise ValueError(f"Path is not a folder: {directory}")

        now = datetime.now(UTC)
        normalized_source_id = _normalize_source_id(source_id) if source_id is not None else self._next_source_id(normalized_account_key, connector_id)
        existing = self._read_record(normalized_account_key, normalized_source_id)
        record = StoredFilesystemConnector(
            account_key=normalized_account_key,
            source_id=normalized_source_id,
            connector_id=connector_id,
            display_name=display_name,
            directory_path=str(directory),
            created_at=existing.created_at if existing else now,
            updated_at=now,
        )
        self._write_record(record)
        with self._lock:
            self._last_error_by_connector[_connector_cache_key(normalized_account_key, normalized_source_id)] = None
        return self.connector_status(normalized_account_key, normalized_source_id)

    def get_portfolio(self, account_key: str, source_id: str) -> FilesystemConnectorPortfolioResponse:
        normalized_account_key = _normalize_account_key(account_key)
        normalized_source_id = _normalize_source_id(source_id)
        cache_key = _connector_cache_key(normalized_account_key, normalized_source_id)
        record = self._read_record(normalized_account_key, normalized_source_id)
        if record is None:
            raise ValueError("This filesystem connector has not been configured yet.")
        if record.connector_id != CSV_FOLDER_CONNECTOR_ID:
            raise ValueError("This filesystem connector does not expose holdings.")

        directory = Path(record.directory_path).expanduser()
        if not directory.exists() or not directory.is_dir():
            raise ValueError(f"Configured folder is unavailable: {directory}")

        csv_files = _list_csv_files(directory)
        if not csv_files:
            raise ValueError(f"No CSV files were found in {directory}.")

        latest_csv = csv_files[0]
        try:
            rows, source_notice = _read_snapshot_rows(latest_csv)
        except Exception as exc:
            self._remember_error(cache_key, str(exc))
            raise

        accounts_by_id: dict[str, FilesystemInvestmentAccount] = {}
        holdings: list[FilesystemHolding] = []
        parse_warnings = 0
        for row in rows:
            normalized = _normalize_row(row)
            account_id = normalized.get("account_id") or normalized.get("account_name") or "imported-account"
            account_name = normalized.get("account_name") or normalized.get("account_id") or "Imported account"
            symbol = normalized.get("symbol")
            name = normalized.get("name") or symbol or "Holding"

            quantity = _parse_number(normalized.get("quantity"))
            price = _parse_number(normalized.get("price"))
            value = _parse_number(normalized.get("value"))
            cost_basis = _parse_number(normalized.get("cost_basis"))
            gain_loss = _parse_number(normalized.get("gain_loss"))
            if gain_loss is None and value is not None and cost_basis is not None:
                gain_loss = round(value - cost_basis, 2)

            if not any(
                item is not None and item != ""
                for item in (symbol, name, normalized.get("value"), normalized.get("quantity"), normalized.get("cost_basis"))
            ):
                continue

            if name.strip().lower() in {"account total", "totals", "total"}:
                continue

            if value is None and quantity is None and price is None:
                parse_warnings += 1

            holding = FilesystemHolding(
                accountId=account_id,
                accountName=account_name,
                symbol=symbol,
                name=name,
                quantity=quantity,
                price=price,
                value=value,
                costBasis=cost_basis,
                gainLoss=gain_loss,
                isoCurrencyCode=normalized.get("currency"),
                sourceFile=str(latest_csv),
            )
            holdings.append(holding)

            current_balance = accounts_by_id.get(account_id).currentBalance if account_id in accounts_by_id else 0.0
            accounts_by_id[account_id] = FilesystemInvestmentAccount(
                accountId=account_id,
                name=account_name,
                currentBalance=round((current_balance or 0.0) + (value or 0.0), 2),
                isoCurrencyCode=normalized.get("currency"),
            )

        holdings.sort(key=lambda item: abs(item.value or 0.0), reverse=True)
        accounts = list(accounts_by_id.values())
        total_value = round(sum(account.currentBalance or 0.0 for account in accounts), 2)

        notices: list[str] = []
        if source_notice:
            notices.append(source_notice)
        if parse_warnings:
            notices.append(f"{parse_warnings} rows had partial values and were kept with missing fields.")
        if not holdings:
            notices.append("The latest CSV was found, but no holdings could be parsed from it.")

        now = datetime.now(UTC)
        with self._lock:
            self._last_error_by_connector[cache_key] = None
            self._last_successful_sync_by_connector[cache_key] = now

        return FilesystemConnectorPortfolioResponse(
            sourceId=record.source_id,
            connectorId=record.connector_id,
            displayName=record.display_name,
            directoryPath=str(directory),
            latestCsvPath=str(latest_csv),
            totalValue=total_value,
            investmentAccountsCount=len(accounts),
            holdingsCount=len(holdings),
            accounts=accounts,
            holdings=holdings,
            sourceNotice=" ".join(notices) if notices else None,
            generatedAt=now,
            isStale=False,
        )

    def get_document_library(self, account_key: str, source_id: str) -> FilesystemDocumentFolderResponse:
        normalized_account_key = _normalize_account_key(account_key)
        normalized_source_id = _normalize_source_id(source_id)
        cache_key = _connector_cache_key(normalized_account_key, normalized_source_id)
        record = self._read_record(normalized_account_key, normalized_source_id)
        if record is None:
            raise ValueError("This filesystem connector has not been configured yet.")
        if record.connector_id != PDF_FOLDER_CONNECTOR_ID:
            raise ValueError("This filesystem connector does not expose document files.")

        directory = Path(record.directory_path).expanduser()
        if not directory.exists() or not directory.is_dir():
            raise ValueError(f"Configured folder is unavailable: {directory}")

        pdf_files = _list_pdf_files(directory)
        if not pdf_files:
            raise ValueError(f"No PDF files were found in {directory}.")

        now = datetime.now(UTC)
        with self._lock:
            self._last_error_by_connector[cache_key] = None
            self._last_successful_sync_by_connector[cache_key] = now

        files: list[FilesystemDocumentFile] = []
        for path in pdf_files[:24]:
            stat = path.stat()
            files.append(
                FilesystemDocumentFile(
                    name=path.name,
                    path=str(path),
                    modifiedAt=datetime.fromtimestamp(stat.st_mtime, tz=UTC),
                    sizeBytes=stat.st_size,
                )
            )

        return FilesystemDocumentFolderResponse(
            sourceId=record.source_id,
            connectorId=record.connector_id,
            displayName=record.display_name,
            directoryPath=str(directory),
            latestPdfPath=str(pdf_files[0]),
            pdfFilesCount=len(pdf_files),
            files=files,
            sourceNotice=f"Showing the most recent {len(files)} PDFs." if len(pdf_files) > len(files) else None,
            generatedAt=now,
            isStale=False,
        )

    def _remember_error(self, cache_key: str, message: str) -> None:
        with self._lock:
            self._last_error_by_connector[cache_key] = message

    def _read_record(self, account_key: str, source_id: str) -> StoredFilesystemConnector | None:
        return next((record for record in self._read_records(account_key) if record.source_id == source_id), None)

    def _read_records(self, account_key: str) -> list[StoredFilesystemConnector]:
        accounts = self._read_accounts_state()
        raw_account = accounts.get(account_key)
        if not isinstance(raw_account, dict):
            return []
        records: list[StoredFilesystemConnector] = []
        for source_id, raw in raw_account.items():
            if not isinstance(source_id, str) or not isinstance(raw, dict):
                continue
            directory_path = str(raw.get("directory_path") or "").strip()
            if not directory_path:
                continue
            connector_id = str(raw.get("connector_id") or source_id).strip() or source_id
            records.append(
                StoredFilesystemConnector(
                    account_key=account_key,
                    source_id=source_id,
                    connector_id=connector_id,
                    display_name=str(raw.get("display_name") or connector_id).strip() or connector_id,
                    directory_path=directory_path,
                    created_at=_parse_datetime(raw.get("created_at")) or datetime.now(UTC),
                    updated_at=_parse_datetime(raw.get("updated_at")) or datetime.now(UTC),
                )
            )
        return records

    def _write_record(self, record: StoredFilesystemConnector) -> None:
        path = self._settings.filesystem_connectors_state_path
        path.parent.mkdir(parents=True, exist_ok=True)
        state = self._read_state()
        accounts = state.get("accounts")
        if not isinstance(accounts, dict):
            accounts = {}
            state["accounts"] = accounts
        account_state = accounts.get(record.account_key)
        if not isinstance(account_state, dict):
            account_state = {}
            accounts[record.account_key] = account_state
        account_state[record.source_id] = {
            "connector_id": record.connector_id,
            "display_name": record.display_name,
            "directory_path": record.directory_path,
            "created_at": record.created_at.isoformat(),
            "updated_at": record.updated_at.isoformat(),
        }
        path.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")

    def _read_state(self) -> dict[str, object]:
        path = self._settings.filesystem_connectors_state_path
        if not path.exists():
            return {}
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
        return loaded if isinstance(loaded, dict) else {}

    def _read_accounts_state(self) -> dict[str, dict[str, dict[str, str]]]:
        state = self._read_state()
        raw_accounts = state.get("accounts")
        if isinstance(raw_accounts, dict):
            return raw_accounts  # type: ignore[return-value]
        return {}

    def _next_source_id(self, account_key: str, connector_id: str) -> str:
        existing_source_ids = {record.source_id for record in self._read_records(account_key)}
        if connector_id not in existing_source_ids:
            return connector_id
        suffix = 2
        while True:
            candidate = f"{connector_id}-{suffix}"
            if candidate not in existing_source_ids:
                return candidate
            suffix += 1


def _read_snapshot_rows(path: Path) -> tuple[list[dict[str, str]], str | None]:
    content = path.read_text(encoding="utf-8-sig")
    lines = content.splitlines()
    if not lines:
        return [], "The latest CSV file is empty."

    header_index = 0
    best_score = -1
    for index, line in enumerate(lines[:12]):
        cells = [cell.strip() for cell in next(csv.reader([line]))]
        score = _header_score(cells)
        if score > best_score:
            best_score = score
            header_index = index

    selected_lines = lines[header_index:]
    if not selected_lines:
        return [], "No CSV header row could be detected."

    reader = csv.DictReader(io.StringIO("\n".join(selected_lines)))
    rows = [{str(key or "").strip(): str(value or "").strip() for key, value in row.items()} for row in reader]
    notice = None
    if header_index > 0:
        notice = f"Skipped {header_index} non-tabular lines before the CSV header."
    return rows, notice


def _header_score(cells: list[str]) -> int:
    normalized = {_normalize_header(cell) for cell in cells if cell.strip()}
    if not normalized:
        return -1
    score = 0
    for aliases in HEADER_ALIASES.values():
        if any(_normalize_header(alias) in normalized for alias in aliases):
            score += 1
    return score


def _normalize_row(row: dict[str, str]) -> dict[str, str]:
    normalized_headers = {_normalize_header(key): value for key, value in row.items()}
    resolved: dict[str, str] = {}
    for target, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            value = normalized_headers.get(_normalize_header(alias))
            if value not in {None, ""}:
                resolved[target] = value
                break
    return resolved


def _normalize_header(value: str) -> str:
    cleaned = value.strip().lower()
    return " ".join("".join(character if character.isalnum() else " " for character in cleaned).split())


def _list_csv_files(directory: Path) -> list[Path]:
    return sorted((path for path in directory.glob("*.csv") if path.is_file()), key=lambda path: path.stat().st_mtime, reverse=True)


def _list_pdf_files(directory: Path) -> list[Path]:
    return sorted((path for path in directory.glob("*.pdf") if path.is_file()), key=lambda path: path.stat().st_mtime, reverse=True)


def _parse_number(value: str | None) -> float | None:
    if value is None:
        return None
    trimmed = value.strip()
    if not trimmed or trimmed in {"--", "n/a", "N/A"}:
        return None
    negative = trimmed.startswith("(") and trimmed.endswith(")")
    cleaned = trimmed.strip("()").replace("$", "").replace(",", "").replace("%", "")
    try:
        parsed = float(cleaned)
    except ValueError:
        return None
    return -parsed if negative else parsed


def _parse_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _normalize_account_key(account_key: str) -> str:
    normalized = account_key.strip()
    if not normalized:
        raise ValueError("Account key is required.")
    return normalized


def _normalize_source_id(source_id: str) -> str:
    normalized = source_id.strip()
    if not normalized:
        raise ValueError("Connector source id is required.")
    return normalized


def _connector_cache_key(account_key: str, source_id: str) -> str:
    return f"{account_key}:{source_id}"
