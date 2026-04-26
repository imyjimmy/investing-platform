"""Finnhub-backed connector for lightweight stock market data."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
import json
from pathlib import Path
import threading
from typing import Any

import requests

from investing_platform.config import DashboardSettings
from investing_platform.models import (
    FinancialMetricRow,
    FinancialPeriodColumn,
    FinancialStatementTable,
    FinancialStatementType,
    FinnhubConnectorConfigRequest,
    FinnhubSourceStatus,
    FundamentalReportStatus,
    TickerFinancialsResponse,
    TickerOverviewResponse,
    UnderlyingQuote,
)
from investing_platform.services.base import BrokerUnavailableError


_FINNHUB_PROVIDER_LABEL = "FINNHUB"
_DEFAULT_TEST_SYMBOL = "AAPL"


@dataclass(slots=True)
class StoredFinnhubConnector:
    api_key: str
    updated_at: datetime


class FinnhubService:
    """Stores Finnhub credentials and translates free-tier responses into local models."""

    def __init__(self, settings: DashboardSettings) -> None:
        self._settings = settings
        self._session = requests.Session()
        self._lock = threading.Lock()
        self._last_error: str | None = None
        self._last_successful_sync_at: datetime | None = None

    def source_status(self, probe: bool = False) -> FinnhubSourceStatus:
        record = self._read_record()
        if record is None:
            return FinnhubSourceStatus(
                available=False,
                configured=False,
                status="degraded",
                apiBaseUrl=self._settings.finnhub_api_base_url.rstrip("/"),
                detail="Finnhub API key not configured. Add a key to power basic stock data in the Stock tool.",
                maskedApiKey=None,
                lastSuccessfulSyncAt=self._last_successful_sync_at,
                lastError=self._last_error,
            )
        if probe:
            self._run_health_probe(record.api_key)
        with self._lock:
            last_error = self._last_error
            last_successful_sync_at = self._last_successful_sync_at or record.updated_at
        healthy = last_error is None
        return FinnhubSourceStatus(
            available=healthy,
            configured=True,
            status="ready" if healthy else "degraded",
            apiBaseUrl=self._settings.finnhub_api_base_url.rstrip("/"),
            detail=(
                "Finnhub quote health check is passing for the configured stock data fallback."
                if healthy
                else f"Finnhub quote health check failed: {last_error}"
            ),
            maskedApiKey=_mask_api_key(record.api_key),
            lastSuccessfulSyncAt=last_successful_sync_at,
            lastError=last_error,
        )

    def configure(self, request: FinnhubConnectorConfigRequest) -> FinnhubSourceStatus:
        normalized_key = (request.apiKey or "").strip()
        if not normalized_key:
            self._delete_record()
            with self._lock:
                self._last_error = None
                self._last_successful_sync_at = None
            return self.source_status()

        try:
            self._assert_quote_probe(normalized_key)
        except RuntimeError as exc:
            raise ValueError(f"Finnhub API key test failed: {exc}") from exc

        record = StoredFinnhubConnector(api_key=normalized_key, updated_at=datetime.now(UTC))
        self._write_record(record)
        self._mark_success(record.updated_at)
        return self.source_status()

    def is_configured(self) -> bool:
        return self._read_record() is not None

    def get_underlying_quote(self, symbol: str) -> UnderlyingQuote:
        record = self._require_record()
        now = datetime.now(UTC)
        payload = self._request_json("/quote", {"symbol": symbol.upper()}, api_key=record.api_key)
        price = _coerce_float(payload.get("c"))
        if price is None or price <= 0:
            raise BrokerUnavailableError(f"Finnhub did not return a usable quote for {symbol.upper()}.")

        bid = _coerce_float(payload.get("b"))
        ask = _coerce_float(payload.get("a"))
        last = price
        close = _coerce_float(payload.get("pc"))
        self._mark_success(now)
        return UnderlyingQuote(
            symbol=symbol.upper(),
            price=price,
            bid=bid,
            ask=ask,
            last=last,
            close=close,
            marketDataStatus=_FINNHUB_PROVIDER_LABEL,
            generatedAt=now,
        )

    def get_ticker_overview(self, symbol: str) -> TickerOverviewResponse:
        symbol = symbol.upper()
        record = self._require_record()
        now = datetime.now(UTC)
        quote_payload = self._request_json("/quote", {"symbol": symbol}, api_key=record.api_key)
        quote = self.get_underlying_quote(symbol)
        profile = self._safe_request("/stock/profile2", {"symbol": symbol}, record.api_key) or {}
        basics = self._safe_request("/stock/metric", {"symbol": symbol, "metric": "all"}, record.api_key) or {}
        metrics = basics.get("metric") if isinstance(basics.get("metric"), dict) else {}
        recommendations = self._safe_request("/stock/recommendation", {"symbol": symbol}, record.api_key) or []
        earnings_calendar = self._safe_request(
            "/calendar/earnings",
            {"symbol": symbol, "from": date.today().isoformat(), "to": (date.today() + timedelta(days=365)).isoformat()},
            record.api_key,
        ) or {}

        shares_outstanding = _scaled_share_count(_coerce_float(profile.get("shareOutstanding")))
        revenue_ttm = _metric_value(metrics, "revenueTTM")
        if revenue_ttm is None:
            revenue_per_share_ttm = _metric_value(metrics, "revenuePerShareTTM")
            if revenue_per_share_ttm is not None and shares_outstanding is not None:
                revenue_ttm = revenue_per_share_ttm * shares_outstanding
        net_income_ttm = _metric_value(metrics, "netIncomePerShareTTM")
        if net_income_ttm is not None and shares_outstanding is not None:
            net_income_ttm *= shares_outstanding
        elif revenue_ttm is not None:
            net_margin = _metric_value(metrics, "netMarginTTM")
            if net_margin is not None:
                net_income_ttm = revenue_ttm * (net_margin / 100.0 if net_margin > 1 else net_margin)

        metric_dividend_yield = _metric_value(metrics, "dividendYieldIndicatedAnnual")
        if metric_dividend_yield is None:
            metric_dividend_yield = _metric_value(metrics, "currentDividendYieldTTM")
        metric_dividend_amount = _metric_value(metrics, "dividendPerShareAnnual")
        price_target = None
        price_target_upside = None

        latest_recommendation = recommendations[0] if isinstance(recommendations, list) and recommendations else {}
        analyst_rating = _recommendation_label(latest_recommendation)

        earnings_rows = earnings_calendar.get("earningsCalendar") if isinstance(earnings_calendar, dict) else []
        upcoming_earnings = earnings_rows[0] if isinstance(earnings_rows, list) and earnings_rows else {}

        market_cap = _scaled_market_cap(_coerce_float(profile.get("marketCapitalization")))
        previous_close = _coerce_float(quote_payload.get("pc"))
        current_price = quote.price
        market_cap_change_pct = ((current_price / previous_close) - 1.0) * 100.0 if market_cap and previous_close and previous_close > 0 else None

        self._mark_success(now)

        return TickerOverviewResponse(
            symbol=symbol,
            quote=quote,
            marketCap=market_cap,
            marketCapChangePct=_round_or_none(market_cap_change_pct, 2),
            revenueTtm=_round_or_none(revenue_ttm, 2),
            revenueTtmChangePct=_round_or_none(_metric_value(metrics, "revenueGrowthTTMYoy"), 2),
            netIncomeTtm=_round_or_none(net_income_ttm, 2),
            netIncomeTtmChangePct=_round_or_none(_metric_value(metrics, "netIncomeGrowthTTMYoy"), 2),
            epsTtm=_round_or_none(_metric_value(metrics, "epsTTM"), 4),
            epsTtmChangePct=_round_or_none(_metric_value(metrics, "epsGrowthTTMYoy"), 2),
            sharesOutstanding=_round_or_none(shares_outstanding, 0),
            peRatio=_round_or_none(_metric_value(metrics, "peTTM"), 2),
            forwardPeRatio=_round_or_none(_metric_value(metrics, "forwardPE"), 2),
            dividendAmount=_round_or_none(metric_dividend_amount, 4),
            dividendYieldPct=_round_or_none(metric_dividend_yield, 2),
            exDividendDate=None,
            volume=_round_int(_metric_value(metrics, "10DayAverageTradingVolume")),
            open=_round_or_none(_coerce_float(quote_payload.get("o")), 4),
            previousClose=_round_or_none(previous_close, 4),
            dayRangeLow=_round_or_none(_coerce_float(quote_payload.get("l")), 4),
            dayRangeHigh=_round_or_none(_coerce_float(quote_payload.get("h")), 4),
            week52Low=_round_or_none(_metric_value(metrics, "52WeekLow"), 4),
            week52High=_round_or_none(_metric_value(metrics, "52WeekHigh"), 4),
            beta=_round_or_none(_metric_value(metrics, "beta"), 4),
            analystRating=analyst_rating,
            priceTarget=_round_or_none(price_target, 4),
            priceTargetUpsidePct=_round_or_none(price_target_upside, 2),
            earningsDate=_coerce_date(upcoming_earnings.get("date")),
            sourceNotice="Finnhub free-tier connector is supplying this stock overview.",
            generatedAt=now,
            isStale=False,
        )

    def get_ticker_financials(self, symbol: str) -> TickerFinancialsResponse:
        symbol = symbol.upper()
        record = self._require_record()
        now = datetime.now(UTC)
        reported_payload = self._request_json("/stock/financials-reported", {"symbol": symbol}, api_key=record.api_key)
        basics = self._safe_request("/stock/metric", {"symbol": symbol, "metric": "all"}, record.api_key) or {}
        metrics = basics.get("metric") if isinstance(basics.get("metric"), dict) else {}
        reported_rows = reported_payload.get("data") if isinstance(reported_payload, dict) else []
        annual_reports = [entry for entry in reported_rows if isinstance(entry, dict) and int(entry.get("quarter") or 0) == 0][:5]
        quarterly_reports = [entry for entry in reported_rows if isinstance(entry, dict) and int(entry.get("quarter") or 0) > 0][:5]

        statements: list[FinancialStatementTable] = []
        statements.extend(_build_statement_tables(annual_reports, period_type="annual"))
        statements.extend(_build_statement_tables(quarterly_reports, period_type="quarterly"))
        ratios = _build_ratio_tables(metrics)
        reports = [
            FundamentalReportStatus(reportType="income_statement", available=any(table.statementType == "income_statement" for table in statements)),
            FundamentalReportStatus(reportType="balance_sheet", available=any(table.statementType == "balance_sheet" for table in statements)),
            FundamentalReportStatus(reportType="cash_flow", available=any(table.statementType == "cash_flow" for table in statements)),
            FundamentalReportStatus(reportType="ratios", available=bool(ratios)),
            FundamentalReportStatus(reportType="estimates", available=False, message="Finnhub free tier does not provide the estimates tables used here."),
        ]

        self._mark_success(now)

        return TickerFinancialsResponse(
            symbol=symbol,
            reports=reports,
            statements=statements,
            ratios=ratios,
            estimates=[],
            sourceNotices=[
                "Finnhub free-tier connector is supplying financials as reported and ratio snapshots.",
                "Estimate tables are omitted because the free Finnhub tier does not expose the historical estimates payload used by this panel.",
            ],
            generatedAt=now,
            isStale=False,
        )

    def _safe_request(self, path: str, params: dict[str, Any], api_key: str) -> Any | None:
        try:
            return self._request_json(path, params, api_key=api_key)
        except RuntimeError:
            return None

    def _request_json(self, path: str, params: dict[str, Any], api_key: str) -> Any:
        base_url = self._settings.finnhub_api_base_url.rstrip("/")
        url = f"{base_url}{path}"
        query = {**params, "token": api_key}
        try:
            response = self._session.get(url, params=query, timeout=self._settings.finnhub_timeout_seconds)
            response.raise_for_status()
        except requests.RequestException as exc:
            detail = _response_error_detail(getattr(exc, "response", None))
            message = detail or str(exc)
            with self._lock:
                self._last_error = message
            raise RuntimeError(message) from exc

        payload = response.json()
        if isinstance(payload, dict) and payload.get("error"):
            message = str(payload["error"]).strip()
            with self._lock:
                self._last_error = message
            raise RuntimeError(message)
        return payload

    def _run_health_probe(self, api_key: str) -> None:
        try:
            self._assert_quote_probe(api_key)
        except RuntimeError as exc:
            with self._lock:
                self._last_error = str(exc)
            return
        self._mark_success(datetime.now(UTC))

    def _assert_quote_probe(self, api_key: str) -> None:
        payload = self._request_json("/quote", {"symbol": _DEFAULT_TEST_SYMBOL}, api_key=api_key)
        current_price = _coerce_float(payload.get("c"))
        previous_close = _coerce_float(payload.get("pc"))
        if (current_price is None or current_price <= 0) and (previous_close is None or previous_close <= 0):
            raise RuntimeError(f"Finnhub did not return a usable {_DEFAULT_TEST_SYMBOL} quote during the health check.")

    def _mark_success(self, captured_at: datetime) -> None:
        with self._lock:
            self._last_error = None
            self._last_successful_sync_at = captured_at

    def _require_record(self) -> StoredFinnhubConnector:
        record = self._read_record()
        if record is None:
            raise BrokerUnavailableError("Finnhub is not configured. Add an API key in Global Settings to use Finnhub for stock data.")
        return record

    def _read_record(self) -> StoredFinnhubConnector | None:
        path = self._settings.finnhub_connector_state_path
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        api_key = str(payload.get("apiKey") or "").strip()
        if not api_key:
            return None
        updated_raw = payload.get("updatedAt")
        try:
            updated_at = datetime.fromisoformat(str(updated_raw)) if updated_raw else datetime.now(UTC)
        except ValueError:
            updated_at = datetime.now(UTC)
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=UTC)
        return StoredFinnhubConnector(api_key=api_key, updated_at=updated_at)

    def _write_record(self, record: StoredFinnhubConnector) -> None:
        path = self._settings.finnhub_connector_state_path
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "apiKey": record.api_key,
            "updatedAt": record.updated_at.isoformat(),
        }
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def _delete_record(self) -> None:
        path = self._settings.finnhub_connector_state_path
        if path.exists():
            path.unlink()


def _mask_api_key(value: str) -> str:
    trimmed = value.strip()
    if len(trimmed) <= 8:
        return "*" * len(trimmed)
    return f"{trimmed[:4]}...{trimmed[-4:]}"


def _scaled_market_cap(value: float | None) -> float | None:
    if value is None:
        return None
    return value * 1_000_000 if value < 10_000_000 else value


def _scaled_share_count(value: float | None) -> float | None:
    if value is None:
        return None
    return value * 1_000_000 if value < 10_000_000 else value


def _metric_value(metrics: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        if key in metrics:
            return _coerce_float(metrics.get(key))
    return None


def _coerce_float(value: Any) -> float | None:
    if value in {None, ""}:
        return None
    if isinstance(value, dict):
        for key in ("value", "v", "amount"):
            if key in value:
                return _coerce_float(value.get(key))
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_date(value: Any) -> date | None:
    if value in {None, ""}:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    date_portion = raw.split(" ")[0]
    try:
        return date.fromisoformat(date_portion)
    except ValueError:
        return None


def _round_or_none(value: float | None, digits: int) -> float | None:
    if value is None:
        return None
    return round(value, digits)


def _round_int(value: float | None) -> int | None:
    if value is None:
        return None
    return int(round(value))


def _recommendation_label(recommendation: Any) -> str | None:
    if not isinstance(recommendation, dict):
        return None
    strong_buy = int(recommendation.get("strongBuy") or 0)
    buy = int(recommendation.get("buy") or 0)
    hold = int(recommendation.get("hold") or 0)
    sell = int(recommendation.get("sell") or 0)
    strong_sell = int(recommendation.get("strongSell") or 0)
    bullish = strong_buy + buy
    bearish = sell + strong_sell
    total = bullish + hold + bearish
    if total == 0:
        return None
    if strong_buy >= max(buy, hold, bearish):
        return "Strong Buy"
    if bullish > hold and bullish > bearish:
        return "Buy"
    if bearish > bullish and bearish >= hold:
        return "Sell"
    return "Hold"


def _build_statement_tables(reports: list[dict[str, Any]], period_type: str) -> list[FinancialStatementTable]:
    if not reports:
        return []

    columns = [
        FinancialPeriodColumn(
            label=_period_label(entry),
            periodEnding=_coerce_date(entry.get("endDate")),
            fiscalPeriod=_fiscal_period_label(entry),
        )
        for entry in reports
    ]
    return [
        FinancialStatementTable(
            statementType="income_statement",
            periodType=period_type,  # type: ignore[arg-type]
            title="Income Statement",
            currency="USD",
            unit="reported",
            columns=columns,
            rows=_build_metric_rows(reports, "ic", _INCOME_STATEMENT_METRICS),
        ),
        FinancialStatementTable(
            statementType="balance_sheet",
            periodType=period_type,  # type: ignore[arg-type]
            title="Balance Sheet",
            currency="USD",
            unit="reported",
            columns=columns,
            rows=_build_metric_rows(reports, "bs", _BALANCE_SHEET_METRICS),
        ),
        FinancialStatementTable(
            statementType="cash_flow",
            periodType=period_type,  # type: ignore[arg-type]
            title="Cash Flow",
            currency="USD",
            unit="reported",
            columns=columns,
            rows=_build_metric_rows(reports, "cf", _CASH_FLOW_METRICS),
        ),
    ]


def _build_metric_rows(
    reports: list[dict[str, Any]],
    report_key: str,
    metric_map: list[tuple[str, tuple[str, ...]]],
) -> list[FinancialMetricRow]:
    rows: list[FinancialMetricRow] = []
    for label, keys in metric_map:
        values = [_statement_value(report, report_key, keys) for report in reports]
        if any(value is not None for value in values):
            rows.append(FinancialMetricRow(label=label, values=values))
    return rows


def _statement_value(report: dict[str, Any], report_key: str, keys: tuple[str, ...]) -> float | None:
    root = report.get("report")
    if not isinstance(root, dict):
        return None
    section = root.get(report_key)
    if not isinstance(section, dict):
        return None
    for key in keys:
        value = _coerce_float(section.get(key))
        if value is not None:
            return value
    return None


def _build_ratio_tables(metrics: dict[str, Any]) -> list[FinancialStatementTable]:
    rows = []
    for label, keys in _RATIO_METRICS:
        value = _metric_value(metrics, *keys)
        if value is not None:
            rows.append(FinancialMetricRow(label=label, values=[round(value, 4)]))
    if not rows:
        return []
    return [
        FinancialStatementTable(
            statementType="ratios",
            periodType="current",
            title="Ratios",
            currency=None,
            unit=None,
            columns=[FinancialPeriodColumn(label="Current")],
            rows=rows,
        )
    ]


def _period_label(report: dict[str, Any]) -> str:
    year = report.get("year")
    quarter = int(report.get("quarter") or 0)
    if quarter <= 0:
        return f"FY {year}" if year else "Annual"
    return f"Q{quarter} {year}" if year else f"Q{quarter}"


def _fiscal_period_label(report: dict[str, Any]) -> str | None:
    year = report.get("year")
    quarter = int(report.get("quarter") or 0)
    if year is None:
        return None
    return f"FY {year}" if quarter <= 0 else f"Q{quarter} {year}"


def _response_error_detail(response: requests.Response | None) -> str | None:
    if response is None:
        return None
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if isinstance(payload, dict):
        detail = payload.get("error") or payload.get("detail")
        if isinstance(detail, str) and detail.strip():
            return detail.strip()
    text = response.text.strip()
    if text:
        return text
    return None


_INCOME_STATEMENT_METRICS = [
    ("Revenue", ("RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet")),
    ("Gross Profit", ("GrossProfit",)),
    ("Operating Income", ("OperatingIncomeLoss",)),
    ("Net Income", ("NetIncomeLoss", "ProfitLoss")),
    ("EPS Diluted", ("EarningsPerShareDiluted",)),
    ("Diluted Shares", ("WeightedAverageNumberOfDilutedSharesOutstanding",)),
]

_BALANCE_SHEET_METRICS = [
    ("Cash & Equivalents", ("CashAndCashEquivalentsAtCarryingValue",)),
    ("Inventory", ("InventoryNet",)),
    ("Current Assets", ("AssetsCurrent",)),
    ("Total Assets", ("Assets",)),
    ("Current Liabilities", ("LiabilitiesCurrent",)),
    ("Total Liabilities", ("Liabilities",)),
    ("Shareholders' Equity", ("StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest")),
    ("Long-Term Debt", ("LongTermDebtNoncurrent", "LongTermDebt",)),
]

_CASH_FLOW_METRICS = [
    ("Operating Cash Flow", ("NetCashProvidedByUsedInOperatingActivities",)),
    ("Capex", ("PaymentsToAcquirePropertyPlantAndEquipment",)),
    ("Investing Cash Flow", ("NetCashProvidedByUsedInInvestingActivities",)),
    ("Financing Cash Flow", ("NetCashProvidedByUsedInFinancingActivities",)),
    ("Net Change in Cash", ("CashAndCashEquivalentsPeriodIncreaseDecrease",)),
    ("Share-Based Comp", ("ShareBasedCompensation",)),
]

_RATIO_METRICS = [
    ("P/E (TTM)", ("peTTM",)),
    ("P/B", ("pbQuarterly",)),
    ("P/S (TTM)", ("psTTM",)),
    ("P/CF (TTM)", ("pfcfShareTTM",)),
    ("ROE (TTM)", ("roeTTM",)),
    ("ROA (TTM)", ("roaTTM",)),
    ("Net Margin (TTM)", ("netMarginTTM",)),
    ("Operating Margin (TTM)", ("operatingMarginTTM",)),
    ("Current Ratio", ("currentRatioQuarterly",)),
    ("Quick Ratio", ("quickRatioQuarterly",)),
    ("Debt / Equity", ("totalDebt/totalEquityQuarterly", "totalDebtToEquityQuarterly")),
    ("Beta", ("beta",)),
]
