"""Account-scoped IBKR connector configuration backed by the existing connector state file."""

from __future__ import annotations

from datetime import UTC, date, datetime
import json
from pathlib import Path
import threading
from typing import Any

from investing_platform.config import DashboardSettings
from investing_platform.models import (
    AccountSourceMetrics,
    ConnectionStatus,
    IbkrConnectorConfigRequest,
    IbkrConnectorStatus,
    IbkrPortfolioResponse,
)
from investing_platform.services.ibkr_flex import FlexCashFlowSummary, IbkrFlexClient, IbkrFlexError


IBKR_CONNECTOR_ID = "ibkrGateway"


class IbkrConnectorService:
    """Makes the account source editor the owner of IBKR routing and runtime settings."""

    def __init__(self, settings: DashboardSettings, broker: Any, flex_client: IbkrFlexClient | None = None) -> None:
        self._settings = settings
        self._broker = broker
        self._flex_client = flex_client or IbkrFlexClient()
        self._lock = threading.Lock()
        self._flex_sync_lock = threading.Lock()

    def status(self, account_key: str) -> IbkrConnectorStatus:
        key = _normalize_account_key(account_key)
        record = self._record(key)
        connection: ConnectionStatus = self._broker.connection_status()
        configured = record is not None
        enabled = _bool(record.get("enabled"), True) if record else False
        account_id = _optional_text(record.get("account_id")) if record else None
        discovered = list(
            dict.fromkeys(
                normalized
                for value in [*connection.managedAccounts, connection.accountId]
                if (normalized := _normalize_account_id(value)) is not None
            )
        )
        selected_available = not account_id or account_id in discovered

        if not configured:
            state = "unconfigured"
            detail = "Add this connector to assign a discovered IBKR account to this dashboard account."
        elif not enabled:
            state = "disabled"
            detail = "This connector is saved but disabled."
        elif connection.connected and account_id and not selected_available:
            state = "misconfigured"
            available = ", ".join(discovered) or "none"
            detail = f"Selected account {account_id} is not available in this Gateway session. Discovered: {available}."
        elif connection.connected and account_id:
            state = "ready"
            detail = f"Connected to {account_id} through {connection.host}:{connection.port}."
        elif connection.connected:
            state = "misconfigured"
            detail = "Gateway is connected, but no IBKR account is assigned to this connector."
        else:
            state = "degraded"
            detail = connection.lastError or f"Gateway is unavailable at {self._host(record)}:{self._port(record)}."

        flex_fields = self._flex_status_fields(record)
        result = IbkrConnectorStatus(
            accountKey=key,
            displayName=_text(record.get("display_name"), "Interactive Brokers") if record else "Interactive Brokers",
            configured=configured,
            enabled=enabled,
            connected=bool(enabled and connection.connected and account_id and selected_available),
            status=state,
            detail=detail,
            host=self._host(record),
            port=self._port(record),
            clientId=self._client_id(record),
            readonly=_bool(record.get("readonly"), self._settings.execution_mode == "disabled") if record else self._settings.execution_mode == "disabled",
            accountId=account_id,
            discoveredAccounts=discovered,
            lastSuccessfulConnectAt=connection.lastSuccessfulConnectAt,
            lastHeartbeatAt=connection.lastHeartbeatAt,
            lastError=connection.lastError,
            **flex_fields,
        )
        self._schedule_flex_sync_if_due(key, record)
        return result

    def configure(self, account_key: str, request: IbkrConnectorConfigRequest) -> IbkrConnectorStatus:
        key = _normalize_account_key(account_key)
        account_id = _normalize_account_id(request.accountId)
        display_name = request.displayName.strip()
        host = request.host.strip()
        if not display_name:
            raise ValueError("Connector name is required.")
        if not host:
            raise ValueError("IBKR host is required.")
        connection: ConnectionStatus = self._broker.connection_status()
        discovered_accounts = {
            normalized
            for value in [*connection.managedAccounts, connection.accountId]
            if (normalized := _normalize_account_id(value)) is not None
        }
        if request.enabled and account_id and connection.connected and account_id not in discovered_accounts:
            raise ValueError(f"Account {account_id} is not available in the current IBKR Gateway session.")
        now = datetime.now(UTC).isoformat()
        state = self._read_state()
        accounts = state.setdefault("accounts", {})
        if not isinstance(accounts, dict):
            accounts = {}
            state["accounts"] = accounts
        account_state = accounts.setdefault(key, {})
        if not isinstance(account_state, dict):
            account_state = {}
            accounts[key] = account_state
        existing = account_state.get(IBKR_CONNECTOR_ID)
        created_at = existing.get("created_at") if isinstance(existing, dict) else now
        existing_token = _optional_secret(existing.get("flex_token")) if isinstance(existing, dict) else None
        submitted_token = _optional_secret(request.flexToken)
        flex_token = None if request.clearFlexToken else submitted_token or existing_token
        flex_query_id = _optional_query_id(request.flexQueryId)
        flex_config_changed = not isinstance(existing, dict) or any(
            (
                _optional_text(existing.get("account_id")) != account_id,
                _optional_secret(existing.get("flex_token")) != flex_token,
                _optional_query_id(existing.get("flex_query_id")) != flex_query_id,
            )
        )
        cached_flex_fields = (
            {}
            if flex_config_changed
            else {
                key: existing.get(key)
                for key in (
                    "flex_net_contributions",
                    "flex_cash_transactions_count",
                    "flex_cash_flows",
                    "flex_equity_history",
                    "flex_missing_sections",
                    "flex_period_start",
                    "flex_period_end",
                    "last_flex_attempt_at",
                    "last_successful_flex_sync_at",
                    "last_flex_error",
                )
                if key in existing
            }
        )
        account_state[IBKR_CONNECTOR_ID] = {
            "connector_id": IBKR_CONNECTOR_ID,
            "display_name": display_name,
            "enabled": request.enabled,
            "host": host,
            "port": request.port,
            "client_id": request.clientId,
            "readonly": request.readonly,
            "account_id": account_id,
            "flex_enabled": request.flexEnabled,
            "flex_token": flex_token,
            "flex_query_id": flex_query_id,
            **cached_flex_fields,
            "created_at": created_at,
            "updated_at": now,
        }
        self._write_state(state)
        self._apply_record(account_state[IBKR_CONNECTOR_ID])
        return self.status(key)

    def remove(self, account_key: str) -> None:
        key = _normalize_account_key(account_key)
        state = self._read_state()
        accounts = state.get("accounts")
        if not isinstance(accounts, dict) or not isinstance(accounts.get(key), dict):
            raise ValueError("This IBKR connector has not been configured.")
        account_state = accounts[key]
        if IBKR_CONNECTOR_ID not in account_state:
            raise ValueError("This IBKR connector has not been configured.")
        del account_state[IBKR_CONNECTOR_ID]
        self._write_state(state)

    def test(self, account_key: str) -> IbkrConnectorStatus:
        status = self.status(account_key)
        if status.configured and not status.enabled:
            raise ValueError("Enable the IBKR connector before testing it.")
        self._broker.reconnect()
        return self.status(account_key)

    def portfolio(self, account_key: str) -> IbkrPortfolioResponse:
        key = _normalize_account_key(account_key)
        status = self.status(key)
        if not status.connected or not status.accountId:
            raise ValueError("The IBKR account source must be connected before portfolio metrics can be loaded.")

        snapshot = self._broker.get_portfolio_snapshot(status.accountId)
        record = self._record(key) or {}
        net_worth = snapshot.account.netLiquidation
        net_contributions = status.flexNetContributions
        total_pnl = round(net_worth - net_contributions, 2) if net_contributions is not None else None
        today_pnl = snapshot.account.todayPnl
        equity_by_date = _stored_dated_values(record.get("flex_equity_history"), "net_liquidation")
        cash_flows_by_date = _stored_dated_values(record.get("flex_cash_flows"), "amount")
        snapshot_date = snapshot.generated_at.date()
        previous_equity = _latest_value_before(equity_by_date, snapshot_date)
        today_pnl_basis = previous_equity[1] if previous_equity is not None else None
        if today_pnl_basis is None and today_pnl is not None:
            today_pnl_basis = round(net_worth - today_pnl, 2)

        monthly_pnl: float | None = None
        monthly_pnl_basis: float | None = None
        month_start = snapshot_date.replace(day=1)
        month_start_equity = _latest_value_before(equity_by_date, month_start)
        if month_start_equity is not None:
            basis_date, monthly_pnl_basis = month_start_equity
            external_flows = sum(
                amount
                for flow_date, amount in cash_flows_by_date.items()
                if basis_date < flow_date <= snapshot_date
            )
            if previous_equity is not None and previous_equity[0] < snapshot_date and today_pnl is not None:
                implied_today_flow = net_worth - previous_equity[1] - today_pnl
                if snapshot_date not in cash_flows_by_date:
                    external_flows += implied_today_flow
            monthly_pnl = round(net_worth - monthly_pnl_basis - external_flows, 2)

        summary = AccountSourceMetrics(
            totalPnl=total_pnl,
            todayPnl=today_pnl,
            monthlyPnl=monthly_pnl,
            totalPnlPctBasis=net_contributions,
            todayPnlPctBasis=round(today_pnl_basis, 2) if today_pnl_basis is not None else None,
            monthlyPnlPctBasis=round(monthly_pnl_basis, 2) if monthly_pnl_basis is not None else None,
            netWorth=round(net_worth, 2),
            netContributions=net_contributions,
        )
        notice = None
        if summary.missingMetrics:
            missing = ", ".join(summary.missingMetrics)
            notice = f"IBKR is connected, but the account-source metric contract is incomplete: {missing}."
            if "monthlyPnl" in summary.missingMetrics:
                notice += (
                    " Update the Activity Flex Query to include Equity Summary by Report Date in Base "
                    "(Report Date and Net Liquidation) and Cash Transactions "
                    "(Date/Time, Amount, Currency, and FX Rate to Base)."
                )
        return IbkrPortfolioResponse(
            accountKey=key,
            accountId=status.accountId,
            summary=summary,
            sourceNotice=notice,
            generatedAt=snapshot.generated_at,
            isStale=snapshot.is_stale,
        )

    def sync_flex(self, account_key: str) -> IbkrConnectorStatus:
        key = _normalize_account_key(account_key)
        record = self._record(key)
        if record is None:
            raise ValueError("Configure the IBKR connector before syncing Flex history.")
        if not _bool(record.get("enabled"), True):
            raise ValueError("Enable the IBKR connector before syncing Flex history.")
        if not _bool(record.get("flex_enabled"), False):
            raise ValueError("Enable historical reporting before syncing Flex history.")
        token = _optional_secret(record.get("flex_token"))
        query_id = _optional_query_id(record.get("flex_query_id"))
        account_id = _optional_text(record.get("account_id"))
        if not token or not query_id:
            raise ValueError("Add a Flex token and Activity Flex Query ID before syncing history.")
        if not account_id:
            raise ValueError("Assign an IBKR account before syncing Flex history.")

        self._record_flex_attempt(key)
        try:
            with self._flex_sync_lock:
                summary = self._flex_client.fetch_cash_flows(token=token, query_id=query_id, account_id=account_id)
        except IbkrFlexError as exc:
            self._record_flex_error(key, str(exc))
            raise
        self._record_flex_summary(key, summary)
        return self.status(key)

    def apply_saved_configuration(self) -> None:
        state = self._read_state()
        accounts = state.get("accounts")
        if not isinstance(accounts, dict):
            return
        for raw_account in accounts.values():
            if not isinstance(raw_account, dict):
                continue
            record = raw_account.get(IBKR_CONNECTOR_ID)
            if isinstance(record, dict) and _bool(record.get("enabled"), True):
                self._apply_record(record)
                return

    def _flex_status_fields(self, record: dict[str, object] | None) -> dict[str, object]:
        if record is None:
            return {}
        flex_enabled = _bool(record.get("flex_enabled"), False)
        token_configured = bool(_optional_secret(record.get("flex_token")))
        query_id = _optional_query_id(record.get("flex_query_id"))
        flex_configured = bool(token_configured and query_id and _optional_text(record.get("account_id")))
        net_contributions = _optional_float(record.get("flex_net_contributions"))
        transaction_count = _int(record.get("flex_cash_transactions_count"), 0)
        equity_history = _stored_dated_values(record.get("flex_equity_history"), "net_liquidation")
        missing_sections = _string_list(record.get("flex_missing_sections"))
        if equity_history and _latest_value_before(equity_history, datetime.now(UTC).date().replace(day=1)) is None:
            missing_sections.append("month-start equity snapshot")
        missing_sections = list(dict.fromkeys(missing_sections))
        performance_ready = bool(equity_history) and not missing_sections
        period_start = _parse_date(record.get("flex_period_start"))
        period_end = _parse_date(record.get("flex_period_end"))
        last_sync = _parse_datetime(record.get("last_successful_flex_sync_at"))
        last_error = _optional_message(record.get("last_flex_error"))
        if not flex_enabled:
            flex_status = "disabled"
            detail = "Historical reporting is disabled."
        elif not flex_configured:
            flex_status = "unconfigured"
            detail = "Add a Flex token and Activity Flex Query ID to load contribution history."
        elif last_error:
            flex_status = "error"
            detail = last_error
        elif net_contributions is not None and last_sync is not None and performance_ready:
            flex_status = "ready"
            detail = (
                f"Synced the common metric history with {transaction_count} deposit/withdrawal transactions and "
                f"{len(equity_history)} equity snapshots; net contributions are ${net_contributions:,.2f}."
            )
        elif net_contributions is not None and last_sync is not None:
            flex_status = "partial"
            missing = ", ".join(missing_sections) or "performance history"
            detail = (
                f"Cash-flow history synced, but common metric history is incomplete ({missing}). "
                "Add the missing fields to the Activity Flex Query and sync again."
            )
        else:
            flex_status = "unconfigured"
            detail = "Flex reporting is configured and waiting for its first statement sync."
        return {
            "flexEnabled": flex_enabled,
            "flexConfigured": flex_configured,
            "flexTokenConfigured": token_configured,
            "flexQueryId": query_id,
            "flexStatus": flex_status,
            "flexDetail": detail,
            "flexNetContributions": net_contributions,
            "flexCashTransactionsCount": transaction_count,
            "flexEquitySnapshotsCount": len(equity_history),
            "flexPerformanceReady": performance_ready,
            "flexMissingSections": missing_sections,
            "flexPeriodStart": period_start,
            "flexPeriodEnd": period_end,
            "lastSuccessfulFlexSyncAt": last_sync,
            "lastFlexError": last_error,
        }

    def _schedule_flex_sync_if_due(self, account_key: str, record: dict[str, object] | None) -> None:
        if record is None or not _bool(record.get("enabled"), True) or not _bool(record.get("flex_enabled"), False):
            return
        if not _optional_secret(record.get("flex_token")) or not _optional_query_id(record.get("flex_query_id")):
            return
        last_attempt = _parse_datetime(record.get("last_flex_attempt_at"))
        if last_attempt is not None and last_attempt.date() >= datetime.now(UTC).date():
            return
        self._record_flex_attempt(account_key)
        threading.Thread(target=self._background_flex_sync, args=(account_key,), name=f"ibkr-flex-{account_key}", daemon=True).start()

    def _background_flex_sync(self, account_key: str) -> None:
        try:
            self.sync_flex(account_key)
        except (IbkrFlexError, ValueError):
            return

    def _record_flex_attempt(self, account_key: str) -> None:
        self._update_record(account_key, {"last_flex_attempt_at": datetime.now(UTC).isoformat()})

    def _record_flex_error(self, account_key: str, message: str) -> None:
        self._update_record(account_key, {"last_flex_error": message})

    def _record_flex_summary(self, account_key: str, summary: FlexCashFlowSummary) -> None:
        self._update_record(
            account_key,
            {
                "flex_net_contributions": summary.net_contributions,
                "flex_cash_transactions_count": summary.transaction_count,
                "flex_cash_flows": [
                    {"date": flow_date.isoformat(), "amount": amount}
                    for flow_date, amount in sorted(summary.cash_flows_by_date.items())
                ],
                "flex_equity_history": [
                    {"date": equity_date.isoformat(), "net_liquidation": value}
                    for equity_date, value in sorted(summary.equity_by_date.items())
                ],
                "flex_missing_sections": list(summary.missing_sections),
                "flex_period_start": summary.period_start.isoformat() if summary.period_start else None,
                "flex_period_end": summary.period_end.isoformat() if summary.period_end else None,
                "last_successful_flex_sync_at": summary.generated_at.isoformat(),
                "last_flex_error": None,
            },
        )

    def _update_record(self, account_key: str, patch: dict[str, object]) -> None:
        state = self._read_state()
        accounts = state.get("accounts")
        if not isinstance(accounts, dict):
            return
        account = accounts.get(account_key)
        if not isinstance(account, dict):
            return
        record = account.get(IBKR_CONNECTOR_ID)
        if not isinstance(record, dict):
            return
        record.update(patch)
        record["updated_at"] = datetime.now(UTC).isoformat()
        self._write_state(state)

    def _apply_record(self, record: dict[str, object]) -> None:
        if not _bool(record.get("enabled"), True):
            return
        self._settings.ib_host = self._host(record)
        self._settings.ib_port = self._port(record)
        self._settings.ib_port_auto_discover = False
        self._settings.ib_client_id = self._client_id(record)
        self._settings.ib_account_id = _optional_text(record.get("account_id"))
        self._settings.execution_mode = "disabled" if _bool(record.get("readonly"), True) else "enabled"
        if hasattr(self._broker, "_resolved_account_id"):
            self._broker._resolved_account_id = self._settings.ib_account_id

    def _record(self, account_key: str) -> dict[str, object] | None:
        accounts = self._read_state().get("accounts")
        if not isinstance(accounts, dict):
            return None
        account = accounts.get(account_key)
        if not isinstance(account, dict):
            return None
        record = account.get(IBKR_CONNECTOR_ID)
        return record if isinstance(record, dict) else None

    def _host(self, record: dict[str, object] | None) -> str:
        return _text(record.get("host"), self._settings.ib_host) if record else self._settings.ib_host

    def _port(self, record: dict[str, object] | None) -> int:
        return _int(record.get("port"), self._settings.ib_port) if record else self._settings.ib_port

    def _client_id(self, record: dict[str, object] | None) -> int:
        return _int(record.get("client_id"), self._settings.ib_client_id) if record else self._settings.ib_client_id

    def _read_state(self) -> dict[str, object]:
        path = self._settings.filesystem_connectors_state_path
        with self._lock:
            if not path.exists():
                return {}
            try:
                value = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                return {}
        return value if isinstance(value, dict) else {}

    def _write_state(self, state: dict[str, object]) -> None:
        path: Path = self._settings.filesystem_connectors_state_path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            path.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")
            path.chmod(0o600)


def _normalize_account_key(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("Account key is required.")
    return normalized


def _normalize_account_id(value: object) -> str | None:
    normalized = str(value or "").strip().upper()
    return normalized or None


def _text(value: object, default: str) -> str:
    normalized = str(value or "").strip()
    return normalized or default


def _optional_text(value: object) -> str | None:
    normalized = str(value or "").strip().upper()
    return normalized or None


def _optional_secret(value: object) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _optional_query_id(value: object) -> str | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    if not normalized.isdigit():
        raise ValueError("Flex Query ID must contain only numbers.")
    return normalized


def _optional_float(value: object) -> float | None:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _int(value: object, default: int) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def _bool(value: object, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return default


def _parse_datetime(value: object) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


def _parse_date(value: object) -> date | None:
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


def _optional_message(value: object) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _stored_dated_values(value: object, value_key: str) -> dict[date, float]:
    if not isinstance(value, list):
        return {}
    result: dict[date, float] = {}
    for item in value:
        if not isinstance(item, dict):
            continue
        item_date = _parse_date(item.get("date"))
        item_value = _optional_float(item.get(value_key))
        if item_date is not None and item_value is not None:
            result[item_date] = item_value
    return result


def _latest_value_before(values: dict[date, float], boundary: date) -> tuple[date, float] | None:
    candidates = [(value_date, value) for value_date, value in values.items() if value_date < boundary]
    return max(candidates, key=lambda item: item[0]) if candidates else None
