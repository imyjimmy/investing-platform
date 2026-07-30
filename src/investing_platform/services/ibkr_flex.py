"""Minimal IBKR Flex Web Service client for contribution-aware account PnL."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime
import re
import time
from typing import Any, Callable
from xml.etree import ElementTree

import requests


DEFAULT_FLEX_BASE_URL = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService"
PENDING_FLEX_ERROR_CODES = {"1003", "1004", "1005", "1006", "1007", "1008", "1009", "1019", "1021"}
FLEX_VERSION = 3


class IbkrFlexError(RuntimeError):
    """A safe, user-facing Flex request or statement error."""


@dataclass(slots=True)
class FlexCashFlowSummary:
    net_contributions: float
    transaction_count: int
    period_start: date | None
    period_end: date | None
    generated_at: datetime
    skipped_transactions: int = 0
    cash_flows_by_date: dict[date, float] = field(default_factory=dict)
    equity_by_date: dict[date, float] = field(default_factory=dict)
    missing_sections: tuple[str, ...] = ()


class IbkrFlexClient:
    def __init__(
        self,
        *,
        base_url: str = DEFAULT_FLEX_BASE_URL,
        session: requests.Session | None = None,
        sleeper: Callable[[float], None] = time.sleep,
        timeout_seconds: float = 20.0,
        poll_attempts: int = 10,
        poll_interval_seconds: float = 2.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._session = session or requests.Session()
        self._session.headers.update({"User-Agent": "investing-platform/0.1.0"})
        self._sleeper = sleeper
        self._timeout_seconds = timeout_seconds
        self._poll_attempts = poll_attempts
        self._poll_interval_seconds = poll_interval_seconds

    def fetch_cash_flows(self, *, token: str, query_id: str, account_id: str) -> FlexCashFlowSummary:
        reference_code = self._request_report(token=token, query_id=query_id)
        statement_xml = self._retrieve_report(token=token, reference_code=reference_code)
        return parse_flex_cash_flows(statement_xml, account_id=account_id)

    def _request_report(self, *, token: str, query_id: str) -> str:
        response = self._get("/SendRequest", token=token, query=query_id)
        root = _parse_xml(response.text, context="Flex request")
        if _element_text(root, "Status").lower() != "success":
            raise _flex_response_error(root, "IBKR could not start the Flex report.")
        reference_code = _element_text(root, "ReferenceCode")
        if not reference_code:
            raise IbkrFlexError("IBKR started the Flex report but did not return a reference code.")
        return reference_code

    def _retrieve_report(self, *, token: str, reference_code: str) -> str:
        last_error: IbkrFlexError | None = None
        for attempt in range(self._poll_attempts):
            if attempt:
                self._sleeper(self._poll_interval_seconds)
            response = self._get("/GetStatement", token=token, query=reference_code)
            text = response.text.strip()
            if not text.startswith("<"):
                raise IbkrFlexError("The Flex Query must use XML output format.")
            root = _parse_xml(text, context="Flex statement")
            if _local_tag(root.tag) == "FlexQueryResponse":
                return text
            code = _element_text(root, "ErrorCode")
            error = _flex_response_error(root, "IBKR has not made the Flex statement available yet.")
            if code in PENDING_FLEX_ERROR_CODES:
                last_error = error
                continue
            raise error
        raise last_error or IbkrFlexError("IBKR did not finish generating the Flex statement in time. Try syncing again shortly.")

    def _get(self, path: str, *, token: str, query: str) -> requests.Response:
        try:
            response = self._session.get(
                f"{self._base_url}{path}",
                params={"t": token, "q": query, "v": FLEX_VERSION},
                timeout=self._timeout_seconds,
                allow_redirects=True,
            )
        except requests.RequestException as exc:
            raise IbkrFlexError("Could not reach the IBKR Flex Web Service.") from exc
        if not response.ok:
            raise IbkrFlexError(f"IBKR Flex returned HTTP {response.status_code}.")
        return response


def parse_flex_cash_flows(xml_text: str, *, account_id: str) -> FlexCashFlowSummary:
    root = _parse_xml(xml_text, context="Flex statement")
    if _local_tag(root.tag) != "FlexQueryResponse":
        raise _flex_response_error(root, "IBKR did not return an Activity Flex statement.")

    normalized_account_id = account_id.strip().upper()
    matching_statements = [
        statement
        for statement in root.iter()
        if _local_tag(statement.tag) == "FlexStatement" and _normalized_attr(statement, "accountId") == normalized_account_id
    ]
    if not matching_statements:
        raise IbkrFlexError(f"The Flex statement does not contain assigned account {normalized_account_id}.")

    period_starts: list[date] = []
    period_ends: list[date] = []
    raw_transactions: list[ElementTree.Element] = []
    equity_rows: list[ElementTree.Element] = []
    cash_section_found = False
    for statement in matching_statements:
        if parsed := _parse_flex_date(statement.attrib.get("fromDate")):
            period_starts.append(parsed)
        if parsed := _parse_flex_date(statement.attrib.get("toDate")):
            period_ends.append(parsed)
        for element in statement.iter():
            tag = _local_tag(element.tag)
            if tag == "CashTransactions":
                cash_section_found = True
            elif tag == "CashTransaction" and _transaction_account_id(element, normalized_account_id) == normalized_account_id:
                raw_transactions.append(element)
            elif tag == "EquitySummaryByReportDateInBase" and _transaction_account_id(element, normalized_account_id) == normalized_account_id:
                equity_rows.append(element)

    if not cash_section_found:
        raise IbkrFlexError("The Activity Flex Query must include the Cash Transactions section.")

    detailed_transactions = [
        transaction
        for transaction in raw_transactions
        if transaction.attrib.get("levelOfDetail", "").strip().upper() != "SUMMARY"
    ]
    transactions = detailed_transactions or raw_transactions
    seen_ids: set[str] = set()
    net_contributions = 0.0
    transaction_count = 0
    skipped_transactions = 0
    cash_flows_by_date: dict[date, float] = {}
    dated_transactions = 0
    for transaction in transactions:
        if not _is_deposit_or_withdrawal(transaction):
            continue
        transaction_id = transaction.attrib.get("transactionID", "").strip()
        if transaction_id and transaction_id in seen_ids:
            continue
        if transaction_id:
            seen_ids.add(transaction_id)
        amount = _float_attr(transaction, "amount")
        if amount is None:
            skipped_transactions += 1
            continue
        currency = transaction.attrib.get("currency", "").strip().upper()
        fx_rate = _float_attr(transaction, "fxRateToBase")
        if currency == "USD" and fx_rate is None:
            fx_rate = 1.0
        if fx_rate is None or fx_rate <= 0:
            skipped_transactions += 1
            continue
        contribution = amount * fx_rate
        net_contributions += contribution
        transaction_count += 1
        transaction_date = _parse_flex_date(transaction.attrib.get("dateTime") or transaction.attrib.get("reportDate"))
        if transaction_date is not None:
            dated_transactions += 1
            cash_flows_by_date[transaction_date] = cash_flows_by_date.get(transaction_date, 0.0) + contribution

    equity_by_date: dict[date, float] = {}
    for equity_row in equity_rows:
        report_date = _parse_flex_date(equity_row.attrib.get("reportDate"))
        net_liquidation = _float_attr(equity_row, "netLiquidation")
        if report_date is None or net_liquidation is None:
            continue
        equity_by_date[report_date] = net_liquidation

    missing_sections: list[str] = []
    if not equity_by_date:
        missing_sections.append("Equity Summary by Report Date in Base")
    if dated_transactions < transaction_count:
        missing_sections.append("Cash Transactions date/time")

    return FlexCashFlowSummary(
        net_contributions=round(net_contributions, 2),
        transaction_count=transaction_count,
        period_start=min(period_starts) if period_starts else None,
        period_end=max(period_ends) if period_ends else None,
        generated_at=datetime.now(UTC),
        skipped_transactions=skipped_transactions,
        cash_flows_by_date={key: round(value, 2) for key, value in cash_flows_by_date.items()},
        equity_by_date={key: round(value, 2) for key, value in equity_by_date.items()},
        missing_sections=tuple(missing_sections),
    )


def _is_deposit_or_withdrawal(transaction: ElementTree.Element) -> bool:
    transaction_type = transaction.attrib.get("type", "").strip().lower()
    if "deposit" in transaction_type or "withdraw" in transaction_type:
        return True
    code_tokens = {
        token
        for token in re.split(r"[\s,;|]+", transaction.attrib.get("code", "").strip().upper())
        if token
    }
    return bool(code_tokens & {"DEP", "WITH"})


def _transaction_account_id(transaction: ElementTree.Element, fallback: str) -> str:
    return transaction.attrib.get("accountId", fallback).strip().upper()


def _normalized_attr(element: ElementTree.Element, name: str) -> str:
    return element.attrib.get(name, "").strip().upper()


def _float_attr(element: ElementTree.Element, name: str) -> float | None:
    raw = element.attrib.get(name)
    if raw is None:
        return None
    try:
        return float(raw.replace(",", ""))
    except (TypeError, ValueError):
        return None


def _parse_flex_date(value: str | None) -> date | None:
    normalized = (value or "").strip().split(";")[0]
    for date_format in ("%Y%m%d", "%Y-%m-%d"):
        try:
            return datetime.strptime(normalized, date_format).date()
        except ValueError:
            continue
    return None


def _parse_xml(value: str, *, context: str) -> ElementTree.Element:
    try:
        return ElementTree.fromstring(value)
    except ElementTree.ParseError as exc:
        raise IbkrFlexError(f"IBKR returned invalid XML for the {context}.") from exc


def _local_tag(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _element_text(root: ElementTree.Element, tag_name: str) -> str:
    for element in root.iter():
        if _local_tag(element.tag) == tag_name:
            return (element.text or "").strip()
    return ""


def _flex_response_error(root: ElementTree.Element, fallback: str) -> IbkrFlexError:
    code = _element_text(root, "ErrorCode")
    message = _element_text(root, "ErrorMessage")
    if code and message:
        return IbkrFlexError(f"IBKR Flex error {code}: {message}")
    return IbkrFlexError(message or fallback)
