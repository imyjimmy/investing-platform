"""Plaid connector service for account-linked investment holdings."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import json
from pathlib import Path
import threading
from typing import Any
from uuid import uuid4

import requests

from investing_platform.config import DashboardSettings
from investing_platform.models import (
    PlaidConnectorPortfolioResponse,
    PlaidConnectorStatus,
    PlaidHolding,
    PlaidInvestmentAccount,
    PlaidLinkTokenResponse,
    PlaidPublicTokenExchangeRequest,
)


@dataclass(slots=True)
class StoredPlaidConnector:
    connector_id: str
    access_token: str
    item_id: str
    institution_id: str | None
    institution_name: str | None
    selected_account_ids: list[str]
    created_at: datetime
    updated_at: datetime


class PlaidService:
    """Creates Plaid Link tokens, persists Items, and normalizes investment holdings."""

    def __init__(self, settings: DashboardSettings) -> None:
        self._settings = settings
        self._session = requests.Session()
        self._session.headers.update({"User-Agent": "investing-platform/0.1.0"})
        self._lock = threading.Lock()
        self._last_error_by_connector: dict[str, str | None] = {}
        self._last_successful_sync_by_connector: dict[str, datetime | None] = {}

    def connector_status(self, connector_id: str) -> PlaidConnectorStatus:
        record = self._read_record(connector_id)
        configured = self._credentials_configured()
        with self._lock:
            last_error = self._last_error_by_connector.get(connector_id)
            last_successful_sync_at = self._last_successful_sync_by_connector.get(connector_id)
        if not configured:
            return PlaidConnectorStatus(
                connectorId=connector_id,
                available=False,
                connected=False,
                status="needs_setup",
                detail="Plaid is not configured yet. Set PLAID_CLIENT_ID, PLAID_SECRET, and PLAID_ENV in your local .env file.",
                institutionName=record.institution_name if record else None,
                selectedAccountsCount=len(record.selected_account_ids) if record else 0,
                lastSuccessfulSyncAt=last_successful_sync_at,
                lastError=last_error,
            )
        if record is None:
            return PlaidConnectorStatus(
                connectorId=connector_id,
                available=True,
                connected=False,
                status="not_connected",
                detail="Ready to link through Plaid.",
                institutionName=None,
                selectedAccountsCount=0,
                lastSuccessfulSyncAt=last_successful_sync_at,
                lastError=last_error,
            )
        status = "degraded" if last_error else "ready"
        detail = last_error if last_error else "Linked through Plaid."
        return PlaidConnectorStatus(
            connectorId=connector_id,
            available=True,
            connected=True,
            status=status,
            detail=detail,
            institutionName=record.institution_name,
            selectedAccountsCount=len(record.selected_account_ids),
            lastSuccessfulSyncAt=last_successful_sync_at,
            lastError=last_error,
        )

    def create_link_token(self, connector_id: str) -> PlaidLinkTokenResponse:
        self._require_credentials()
        payload: dict[str, Any] = {
            "client_id": self._settings.plaid_client_id,
            "secret": self._settings.plaid_secret,
            "client_name": self._settings.plaid_client_name,
            "language": "en",
            "country_codes": ["US"],
            "products": ["investments"],
            "user": {
                "client_user_id": f"{connector_id}-{uuid4()}",
            },
            "account_filters": {
                "investment": {
                    "account_subtypes": ["all"],
                }
            },
        }
        if self._settings.plaid_redirect_uri:
            payload["redirect_uri"] = self._settings.plaid_redirect_uri
        response = self._post("/link/token/create", payload)
        return PlaidLinkTokenResponse(
            connectorId=connector_id,
            linkToken=str(response.get("link_token") or ""),
            expiration=_parse_datetime(response.get("expiration")),
        )

    def exchange_public_token(self, connector_id: str, request: PlaidPublicTokenExchangeRequest) -> PlaidConnectorStatus:
        self._require_credentials()
        response = self._post(
            "/item/public_token/exchange",
            {
                "client_id": self._settings.plaid_client_id,
                "secret": self._settings.plaid_secret,
                "public_token": request.publicToken,
            },
        )
        now = datetime.now(UTC)
        record = StoredPlaidConnector(
            connector_id=connector_id,
            access_token=str(response.get("access_token") or ""),
            item_id=str(response.get("item_id") or ""),
            institution_id=request.institutionId,
            institution_name=request.institutionName,
            selected_account_ids=request.accountIds,
            created_at=now,
            updated_at=now,
        )
        self._write_record(record)
        with self._lock:
            self._last_error_by_connector[connector_id] = None
            self._last_successful_sync_by_connector[connector_id] = now
        return self.connector_status(connector_id)

    def get_portfolio(self, connector_id: str) -> PlaidConnectorPortfolioResponse:
        self._require_credentials()
        record = self._read_record(connector_id)
        if record is None:
            raise ValueError("This Plaid connector has not been linked yet.")
        try:
            payload = self._post(
                "/investments/holdings/get",
                {
                    "client_id": self._settings.plaid_client_id,
                    "secret": self._settings.plaid_secret,
                    "access_token": record.access_token,
                },
            )
        except Exception as exc:
            self._remember_error(connector_id, str(exc))
            raise

        selected_account_ids = set(record.selected_account_ids)
        all_accounts = payload.get("accounts") if isinstance(payload.get("accounts"), list) else []
        filtered_accounts = [
            account
            for account in all_accounts
            if not selected_account_ids or str(account.get("account_id") or "") in selected_account_ids
        ]
        accounts_by_id = {
            str(account.get("account_id") or ""): account
            for account in filtered_accounts
            if str(account.get("account_id") or "")
        }
        securities_by_id = {
            str(security.get("security_id") or ""): security
            for security in (payload.get("securities") if isinstance(payload.get("securities"), list) else [])
            if str(security.get("security_id") or "")
        }
        raw_holdings = payload.get("holdings") if isinstance(payload.get("holdings"), list) else []
        filtered_holdings = [
            holding
            for holding in raw_holdings
            if str(holding.get("account_id") or "") in accounts_by_id
        ]

        accounts = [
            PlaidInvestmentAccount(
                accountId=account_id,
                name=str(account.get("name") or account.get("official_name") or "Investment account"),
                mask=_optional_string(account.get("mask")),
                subtype=_optional_string(account.get("subtype")),
                currentBalance=_optional_float((account.get("balances") or {}).get("current")),
                availableBalance=_optional_float((account.get("balances") or {}).get("available")),
                isoCurrencyCode=_optional_string((account.get("balances") or {}).get("iso_currency_code")),
            )
            for account_id, account in accounts_by_id.items()
        ]

        holdings: list[PlaidHolding] = []
        for holding in filtered_holdings:
            account_id = str(holding.get("account_id") or "")
            security = securities_by_id.get(str(holding.get("security_id") or ""), {})
            quantity = _optional_float(holding.get("quantity"))
            price = _optional_float(holding.get("institution_price"))
            value = _optional_float(holding.get("institution_value"))
            cost_basis = _optional_float(holding.get("cost_basis"))
            gain_loss = round(value - cost_basis, 2) if value is not None and cost_basis is not None else None
            holdings.append(
                PlaidHolding(
                    accountId=account_id,
                    accountName=next((account.name for account in accounts if account.accountId == account_id), "Investment account"),
                    securityId=_optional_string(holding.get("security_id")),
                    symbol=_optional_string(security.get("ticker_symbol")),
                    name=str(security.get("name") or security.get("ticker_symbol") or "Holding"),
                    quantity=quantity,
                    price=price,
                    value=value,
                    costBasis=cost_basis,
                    gainLoss=gain_loss,
                    isoCurrencyCode=_optional_string(holding.get("iso_currency_code") or security.get("iso_currency_code")),
                )
            )
        holdings.sort(key=lambda item: abs(item.value or 0.0), reverse=True)

        total_value = round(
            sum(account.currentBalance or 0.0 for account in accounts) or sum(holding.value or 0.0 for holding in holdings),
            2,
        )
        source_notice = None
        if not accounts:
            source_notice = "No linked Plaid investment accounts were returned for this connector."
        elif not holdings:
            source_notice = "The linked account returned balances, but no holdings were available in the latest Plaid snapshot."

        now = datetime.now(UTC)
        with self._lock:
            self._last_error_by_connector[connector_id] = None
            self._last_successful_sync_by_connector[connector_id] = now

        return PlaidConnectorPortfolioResponse(
            connectorId=connector_id,
            institutionName=record.institution_name,
            totalValue=total_value,
            investmentAccountsCount=len(accounts),
            holdingsCount=len(holdings),
            accounts=accounts,
            holdings=holdings,
            sourceNotice=source_notice,
            generatedAt=now,
            isStale=False,
        )

    def _credentials_configured(self) -> bool:
        return bool((self._settings.plaid_client_id or "").strip() and (self._settings.plaid_secret or "").strip())

    def _require_credentials(self) -> None:
        if not self._credentials_configured():
            raise ValueError("Plaid is not configured yet. Set PLAID_CLIENT_ID, PLAID_SECRET, and PLAID_ENV first.")

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = self._session.post(
            f"{self._settings.plaid_base_url.rstrip('/')}{path}",
            json=payload,
            timeout=self._settings.plaid_timeout_seconds,
        )
        try:
            data = response.json()
        except Exception:
            data = {}
        if not response.ok:
            error_message = str(data.get("display_message") or data.get("error_message") or f"Plaid request failed with {response.status_code}.")
            raise RuntimeError(error_message)
        return data if isinstance(data, dict) else {}

    def _read_record(self, connector_id: str) -> StoredPlaidConnector | None:
        records = self._read_all_records()
        raw_record = records.get(connector_id)
        if not isinstance(raw_record, dict):
            return None
        try:
            return StoredPlaidConnector(
                connector_id=connector_id,
                access_token=str(raw_record.get("access_token") or ""),
                item_id=str(raw_record.get("item_id") or ""),
                institution_id=_optional_string(raw_record.get("institution_id")),
                institution_name=_optional_string(raw_record.get("institution_name")),
                selected_account_ids=[
                    str(account_id).strip()
                    for account_id in (raw_record.get("selected_account_ids") if isinstance(raw_record.get("selected_account_ids"), list) else [])
                    if str(account_id).strip()
                ],
                created_at=_parse_datetime(raw_record.get("created_at")) or datetime.now(UTC),
                updated_at=_parse_datetime(raw_record.get("updated_at")) or datetime.now(UTC),
            )
        except Exception:
            return None

    def _write_record(self, record: StoredPlaidConnector) -> None:
        path = self._settings.plaid_state_path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            records = self._read_all_records()
            records[record.connector_id] = {
                "access_token": record.access_token,
                "item_id": record.item_id,
                "institution_id": record.institution_id,
                "institution_name": record.institution_name,
                "selected_account_ids": record.selected_account_ids,
                "created_at": record.created_at.isoformat(),
                "updated_at": record.updated_at.isoformat(),
            }
            path.write_text(json.dumps(records, indent=2, sort_keys=True), encoding="utf-8")

    def _read_all_records(self) -> dict[str, Any]:
        path = self._settings.plaid_state_path
        if not path.exists():
            return {}
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}
        return payload if isinstance(payload, dict) else {}

    def _remember_error(self, connector_id: str, message: str) -> None:
        with self._lock:
            self._last_error_by_connector[connector_id] = message


def _optional_string(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _optional_float(value: Any) -> float | None:
    if value in {None, ""}:
        return None
    try:
        return round(float(value), 2)
    except Exception:
        return None


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None
