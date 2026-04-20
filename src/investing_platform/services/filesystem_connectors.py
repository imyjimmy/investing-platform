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


@dataclass(slots=True)
class StoredFilesystemConnector:
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

    def connector_status(self, connector_id: str) -> FilesystemConnectorStatus:
        record = self._read_record(connector_id)
        with self._lock:
            last_error = self._last_error_by_connector.get(connector_id)
            last_successful_sync_at = self._last_successful_sync_by_connector.get(connector_id)

        if record is None:
            return FilesystemConnectorStatus(
                connectorId=connector_id,
                available=True,
                connected=False,
                status="not_connected",
                detail="Add a CSV folder to start reading end-of-day files.",
                displayName=None,
                lastSuccessfulSyncAt=last_successful_sync_at,
                lastError=last_error,
            )

        directory = Path(record.directory_path).expanduser()
        csv_files = _list_csv_files(directory) if directory.exists() and directory.is_dir() else []
        latest_csv_path = str(csv_files[0]) if csv_files else None

        if not directory.exists() or not directory.is_dir():
            return FilesystemConnectorStatus(
                connectorId=connector_id,
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

        if not csv_files:
            return FilesystemConnectorStatus(
                connectorId=connector_id,
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

        return FilesystemConnectorStatus(
            connectorId=connector_id,
            available=True,
            connected=True,
            status="degraded" if last_error else "ready",
            detail=last_error or f"Using the latest CSV snapshot from {directory.name}.",
            displayName=record.display_name,
            directoryPath=str(directory),
            csvFilesCount=len(csv_files),
            latestCsvPath=latest_csv_path,
            lastSuccessfulSyncAt=last_successful_sync_at,
            lastError=last_error,
        )

    def configure_connector(self, connector_id: str, request: FilesystemConnectorConfigRequest) -> FilesystemConnectorStatus:
        display_name = request.displayName.strip()
        if not display_name:
            raise ValueError("Connector name is required.")
        directory = Path(request.directoryPath).expanduser()
        if not directory.exists():
            raise ValueError(f"Folder does not exist: {directory}")
        if not directory.is_dir():
            raise ValueError(f"Path is not a folder: {directory}")

        now = datetime.now(UTC)
        existing = self._read_record(connector_id)
        record = StoredFilesystemConnector(
            connector_id=connector_id,
            display_name=display_name,
            directory_path=str(directory),
            created_at=existing.created_at if existing else now,
            updated_at=now,
        )
        self._write_record(record)
        with self._lock:
            self._last_error_by_connector[connector_id] = None
        return self.connector_status(connector_id)

    def get_portfolio(self, connector_id: str) -> FilesystemConnectorPortfolioResponse:
        record = self._read_record(connector_id)
        if record is None:
            raise ValueError("This filesystem connector has not been configured yet.")

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
            self._remember_error(connector_id, str(exc))
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
            self._last_error_by_connector[connector_id] = None
            self._last_successful_sync_by_connector[connector_id] = now

        return FilesystemConnectorPortfolioResponse(
            connectorId=connector_id,
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

    def _remember_error(self, connector_id: str, message: str) -> None:
        with self._lock:
            self._last_error_by_connector[connector_id] = message

    def _read_record(self, connector_id: str) -> StoredFilesystemConnector | None:
        raw = self._read_state().get(connector_id)
        if not isinstance(raw, dict):
            return None
        directory_path = str(raw.get("directory_path") or "").strip()
        if not directory_path:
            return None
        return StoredFilesystemConnector(
            connector_id=connector_id,
            display_name=str(raw.get("display_name") or connector_id).strip() or connector_id,
            directory_path=directory_path,
            created_at=_parse_datetime(raw.get("created_at")) or datetime.now(UTC),
            updated_at=_parse_datetime(raw.get("updated_at")) or datetime.now(UTC),
        )

    def _write_record(self, record: StoredFilesystemConnector) -> None:
        path = self._settings.filesystem_connectors_state_path
        path.parent.mkdir(parents=True, exist_ok=True)
        state = self._read_state()
        state[record.connector_id] = {
            "display_name": record.display_name,
            "directory_path": record.directory_path,
            "created_at": record.created_at.isoformat(),
            "updated_at": record.updated_at.isoformat(),
        }
        path.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")

    def _read_state(self) -> dict[str, dict[str, str]]:
        path = self._settings.filesystem_connectors_state_path
        if not path.exists():
            return {}
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
        return loaded if isinstance(loaded, dict) else {}


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
