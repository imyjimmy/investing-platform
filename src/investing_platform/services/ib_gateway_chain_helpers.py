"""Option-chain, numeric, time, and order-note helpers for IB Gateway."""

from __future__ import annotations

from datetime import UTC, date, datetime, time as dt_time
from math import isfinite
from pathlib import Path
from typing import Any, Iterable, Literal
from zoneinfo import ZoneInfo

import pandas as pd

from investing_platform.models import ChainHighlight, ChainRow, OptionOrderRequest, StockOrderRequest

def _strategy_family_key_for_tag(strategy_tag: str) -> str:
    mapping = {
        "long-option": "single-option",
        "short-option": "single-option",
        "cash-secured-put": "covered-option",
        "covered-call": "covered-option",
        "call-credit-spread": "vertical",
        "call-debit-spread": "vertical",
        "put-credit-spread": "vertical",
        "put-debit-spread": "vertical",
        "calendar-spread": "calendar",
        "diagonal-spread": "diagonal",
        "ratio-spread": "ratio",
    }
    return mapping.get(strategy_tag, strategy_tag)


def _chain_highlights(rows: list[ChainRow], expiry: str) -> list[ChainHighlight]:
    highlights: list[ChainHighlight] = []
    put_candidates = [row for row in rows if row.putMid and row.distanceFromSpotPct < 0]
    call_candidates = [row for row in rows if row.callMid and row.distanceFromSpotPct > 0]
    if put_candidates:
        best_put = max(put_candidates, key=lambda row: ((row.putAnnualizedYieldPct or 0.0), abs(row.distanceFromSpotPct)))
        highlights.append(
            ChainHighlight(
                label="Short put candidate",
                right="P",
                strike=best_put.strike,
                expiry=expiry,
                metricLabel="Annualized yield",
                metricValue=best_put.putAnnualizedYieldPct or 0.0,
                description="Heuristic highlight using premium per conservative collateral on out-of-the-money puts.",
            )
        )
    if call_candidates:
        best_call = max(call_candidates, key=lambda row: ((row.callAnnualizedYieldPct or 0.0), row.distanceFromSpotPct))
        highlights.append(
            ChainHighlight(
                label="Covered call candidate",
                right="C",
                strike=best_call.strike,
                expiry=expiry,
                metricLabel="Annualized yield",
                metricValue=best_call.callAnnualizedYieldPct or 0.0,
                description="Heuristic highlight using premium yield on upside strikes above spot.",
            )
        )
    return highlights


def _select_definition(definitions: Iterable[Any], preferred_exchange: str, symbol: str) -> Any:
    preferred_exchange = preferred_exchange.upper()
    symbol = symbol.upper()
    ordered = sorted(
        definitions,
        key=lambda definition: (
            0 if str(getattr(definition, "exchange", "")).upper() == preferred_exchange else 1,
            0 if str(getattr(definition, "exchange", "")).upper() == "SMART" else 1,
            0 if str(getattr(definition, "tradingClass", "")).upper() == symbol else 1,
            -len(getattr(definition, "expirations", []) or []),
            -len(getattr(definition, "strikes", []) or []),
        ),
    )
    return ordered[0]


def _select_expiries(expiries: Iterable[str], min_days: int, max_days: int, limit: int) -> list[str]:
    today = date.today()
    selected: list[str] = []
    for raw in sorted(expiries):
        expiry = date(int(raw[:4]), int(raw[4:6]), int(raw[6:8]))
        dte = (expiry - today).days
        if dte < min_days or dte > max_days:
            continue
        selected.append(expiry.isoformat())
        if len(selected) >= limit:
            break
    if not selected:
        raise RuntimeError("No expirations matched the selected date filters.")
    return selected


def _select_strikes(strikes: Iterable[float], spot: float, moneyness_pct: float, limit: int) -> list[float]:
    return _select_strikes_for_window(strikes, spot, moneyness_pct, moneyness_pct, limit, None, None)


def _select_strikes_for_window(
    strikes: Iterable[float],
    spot: float,
    lower_moneyness_pct: float,
    upper_moneyness_pct: float,
    limit: int,
    min_moneyness_pct: float | None,
    max_moneyness_pct: float | None,
) -> list[float]:
    if min_moneyness_pct is not None and max_moneyness_pct is not None:
        lower = spot * (1.0 + min(min_moneyness_pct, max_moneyness_pct))
        upper = spot * (1.0 + max(min_moneyness_pct, max_moneyness_pct))
    else:
        lower = spot * (1.0 - max(lower_moneyness_pct, 0.0))
        upper = spot * (1.0 + max(upper_moneyness_pct, 0.0))
    unique_all = sorted({float(strike) for strike in strikes})
    eligible = [strike for strike in unique_all if lower <= strike <= upper]
    if not eligible:
        eligible = unique_all
    if len(eligible) <= limit:
        return eligible
    pivot = min(range(len(eligible)), key=lambda index: (abs(eligible[index] - spot), eligible[index]))
    half_window = limit // 2
    start = max(0, pivot - half_window)
    end = start + limit
    if end > len(eligible):
        end = len(eligible)
        start = max(0, end - limit)
    return eligible[start:end]


def _normalize_chain_strike_limit(requested_limit: int | None, default_limit: int) -> int:
    raw_limit = requested_limit if requested_limit is not None else default_limit
    return max(4, min(int(raw_limit), 96))


def _normalize_chain_window(
    lower_moneyness_pct: float | None,
    upper_moneyness_pct: float | None,
    default_moneyness_pct: float,
) -> tuple[float, float]:
    lower = default_moneyness_pct if lower_moneyness_pct is None else lower_moneyness_pct
    upper = default_moneyness_pct if upper_moneyness_pct is None else upper_moneyness_pct
    return max(0.0, min(float(lower), 1.0)), max(0.0, min(float(upper), 1.0))


def _normalize_chain_moneyness_range(
    min_moneyness_pct: float | None,
    max_moneyness_pct: float | None,
) -> tuple[float | None, float | None]:
    if min_moneyness_pct is None or max_moneyness_pct is None:
        return None, None
    lower = max(-1.0, min(float(min_moneyness_pct), 1.0))
    upper = max(-1.0, min(float(max_moneyness_pct), 1.0))
    return min(lower, upper), max(lower, upper)


def _select_historical_fallback_contracts(contracts: Iterable[Any], spot: float, limit: int) -> list[Any]:
    ordered = sorted(
        contracts,
        key=lambda contract: (
            abs(float(getattr(contract, "strike", 0.0)) - spot),
            str(getattr(contract, "right", "")),
            float(getattr(contract, "strike", 0.0)),
        ),
    )
    return ordered[: max(limit, 0)]


def _batched(items: list[Any], size: int) -> Iterable[list[Any]]:
    for index in range(0, len(items), size):
        yield items[index : index + size]


def _round_or_none(value: float | None, precision: int) -> float | None:
    if not _is_valid_number(value):
        return None
    return round(float(value), precision)


def _round_signed_or_none(value: float | None, precision: int) -> float | None:
    if value is None or not isfinite(float(value)):
        return None
    return round(float(value), precision)


def _optional_float(value: Any) -> float | None:
    result = _safe_float(value)
    if result is None or not isfinite(result) or abs(result) >= 1e307:
        return None
    return round(float(result), 2)


def _optional_int(value: Any) -> int | None:
    try:
        result = int(value)
    except (TypeError, ValueError):
        return None
    return result if result > 0 else None


def _string_or_none(value: Any) -> str | None:
    if value in {None, ""}:
        return None
    text = str(value).strip()
    return text or None


def _latest_trade_message(trade: Any) -> str | None:
    logs = getattr(trade, "log", None) or []
    for entry in reversed(logs):
        message = _string_or_none(getattr(entry, "message", None))
        if message:
            return message
    return _string_or_none(getattr(getattr(trade, "advancedError", None), "message", None))


def _conservative_cash_impact(
    request: OptionOrderRequest,
    opening_or_closing: str,
    market_reference_price: float | None,
    *,
    max_loss: float | None = None,
) -> float | None:
    if len(request.resolved_legs()) > 1 and max_loss is not None:
        return max_loss
    multiplier = 100.0 * request.quantity
    if request.action == "SELL" and request.right == "P" and opening_or_closing == "opening":
        return round(request.strike * multiplier, 2)
    if request.orderType == "LMT" and request.limitPrice is not None and request.action == "BUY":
        return round(float(request.limitPrice) * multiplier, 2)
    if request.orderType == "MKT" and request.action == "BUY" and market_reference_price is not None:
        return round(float(market_reference_price) * multiplier, 2)
    if request.action == "SELL" and request.right == "C" and opening_or_closing == "opening":
        return 0.0
    return None


def _option_order_note(
    request: OptionOrderRequest,
    opening_or_closing: str,
    contract: Any,
    *,
    max_profit: float | None = None,
    max_loss: float | None = None,
) -> str | None:
    if len(request.resolved_legs()) > 1:
        if max_profit is not None and max_loss is not None and opening_or_closing == "opening":
            return f"Defined-risk structure. Approx. max profit ${max_profit:,.2f}; max loss ${max_loss:,.2f}."
        if request.orderType == "MKT":
            return "Market order preview for a multi-leg option structure. Use sparingly on complex options."
        return "Multi-leg option structure preview."
    if request.action == "SELL" and request.right == "P" and opening_or_closing == "opening":
        reserve = round(request.strike * 100.0 * request.quantity, 2)
        return f"Conservative cash-secured reserve: ${reserve:,.2f}."
    if request.action == "SELL" and request.right == "C" and opening_or_closing == "opening":
        return "Covered-call status is not enforced here. Confirm the selected account has enough shares before transmitting."
    if request.action == "BUY" and opening_or_closing == "closing":
        return "This looks like a closing buyback based on the current account position."
    if request.action == "SELL" and opening_or_closing == "closing":
        return "This looks like a closing sale against an existing long option position."
    if request.orderType == "MKT":
        return f"Market order preview for {contract.symbol} {request.expiry} {request.right}{request.strike:.2f}. Use sparingly on options."
    return None


def _stock_request_open_or_close(
    request: StockOrderRequest,
    stock_qty: dict[str, float],
) -> Literal["opening", "closing", "unknown"]:
    existing_stock = stock_qty.get(request.symbol, 0.0)
    if request.action == "BUY" and existing_stock < 0:
        return "closing"
    if request.action == "SELL" and existing_stock > 0:
        return "closing"
    return "opening"


def _stock_conservative_cash_impact(
    request: StockOrderRequest,
    opening_or_closing: str,
    pricing_reference: float | None,
) -> float | None:
    if pricing_reference is None:
        return None
    if request.action == "BUY":
        return round(float(pricing_reference) * request.quantity, 2)
    if opening_or_closing == "closing":
        return 0.0
    return None


def _stock_order_note(request: StockOrderRequest, opening_or_closing: str) -> str | None:
    if request.action == "SELL" and opening_or_closing == "closing":
        return "This looks like a closing sale against an existing stock position."
    if request.action == "BUY" and opening_or_closing == "closing":
        return "This looks like a buy-to-cover against an existing short stock position."
    if request.action == "SELL" and opening_or_closing == "opening":
        return "This looks like an opening short sale. Confirm borrow and margin availability before transmitting."
    if request.orderType == "MKT":
        return f"Market order preview for {request.symbol} stock. Use sparingly outside liquid market hours."
    return None


def _is_paper_account_id(account_id: str | None) -> bool:
    if not account_id:
        return False
    return account_id.strip().upper().startswith("DU")


def _account_route_kind(account_id: str | None) -> Literal["live", "paper", "unknown"]:
    if not account_id:
        return "unknown"
    return "paper" if _is_paper_account_id(account_id) else "live"


def _age_seconds(timestamp: datetime) -> float:
    return (datetime.now(UTC) - timestamp).total_seconds()


def _market_session_date() -> date:
    return datetime.now(ZoneInfo("America/New_York")).date()


def _is_weekend_market_session() -> bool:
    return _market_session_date().weekday() >= 5


def _should_prefer_frozen_market_data(now: datetime | None = None) -> bool:
    eastern_now = now.astimezone(ZoneInfo("America/New_York")) if now is not None else datetime.now(ZoneInfo("America/New_York"))
    if eastern_now.weekday() >= 5:
        return True
    current_time = eastern_now.time()
    return current_time < dt_time(hour=9, minute=30) or current_time >= dt_time(hour=16, minute=0)


def _extract_snapshot_date(path: Path) -> date | None:
    for part in path.parts:
        if not part.startswith("as_of="):
            continue
        try:
            return date.fromisoformat(part.split("=", 1)[1])
        except ValueError:
            return None
    return None


def _extract_snapshot_provider(path: Path) -> str | None:
    for part in path.parts:
        if part.startswith("provider="):
            return part.split("=", 1)[1].strip().lower() or None
    return None


def _snapshot_provider_priority(provider_name: str) -> int:
    priorities = {
        "ibkr": 3,
        "tradier": 2,
        "polygon": 2,
        "yfinance": 1,
    }
    return priorities.get(provider_name.lower(), 0)


def _snapshot_close_timestamp(snapshot_date: date) -> datetime:
    return datetime.combine(snapshot_date, dt_time(hour=16), tzinfo=ZoneInfo("America/New_York")).astimezone(UTC)


def _snapshot_option_row(frame: pd.DataFrame, option_type: str) -> pd.Series | None:
    matches = frame[frame["option_type"] == option_type]
    if matches.empty:
        return None
    return matches.iloc[0]


def _snapshot_float(row: pd.Series | None, column: str) -> float | None:
    if row is None or column not in row.index:
        return None
    value = _safe_float(row[column])
    return value if _is_valid_number(value) else None


def _snapshot_pct(row: pd.Series | None, column: str) -> float | None:
    value = _snapshot_float(row, column)
    if value is None:
        return None
    return value * 100.0


def _snapshot_int(row: pd.Series | None, column: str) -> int | None:
    if row is None or column not in row.index:
        return None
    try:
        return int(float(row[column]))
    except (TypeError, ValueError):
        return None


def _snapshot_option_mid(row: pd.Series | None) -> float | None:
    explicit_mid = _snapshot_float(row, "mid")
    if explicit_mid is not None:
        return explicit_mid
    mark = _snapshot_float(row, "mark")
    if mark is not None:
        return mark
    return _midpoint(_snapshot_float(row, "bid"), _snapshot_float(row, "ask"))


def _snapshot_underlying_price(frame: pd.DataFrame) -> float:
    if "underlying_price" in frame.columns:
        series = pd.to_numeric(frame["underlying_price"], errors="coerce").dropna()
        if not series.empty:
            return float(series.iloc[0])
    return 0.0


def _snapshot_dte(call_row: pd.Series | None, put_row: pd.Series | None, expiry: str, snapshot_date: date) -> int:
    for row in (call_row, put_row):
        value = _snapshot_int(row, "dte")
        if value is not None:
            return max(value, 1)
    return max((date.fromisoformat(expiry) - snapshot_date).days, 1)


def _quote_notice(quote_source: str, quote_as_of: datetime | None, market_data_issue: str | None = None) -> str | None:
    if quote_source == "historical":
        timestamp = quote_as_of.astimezone().strftime("%Y-%m-%d %I:%M %p %Z") if quote_as_of is not None else "the latest completed session"
        issue_suffix = f" {market_data_issue}" if market_data_issue else ""
        return (
            f"Streaming option quotes are not available in this session, so the chain is showing the latest historical option midpoint data from IBKR as of {timestamp}.{issue_suffix}"
        )
    if quote_source == "unavailable":
        if market_data_issue:
            return market_data_issue
        return "IB Gateway returned the real option chain structure, but the API user did not receive option quote lines for this session."
    return None


def _chain_cache_ttl_seconds(response: OptionChainResponse, default_ttl_seconds: float) -> float:
    if response.quoteSource == "historical":
        return max(default_ttl_seconds, 300.0)
    return default_ttl_seconds


def _is_hard_market_data_blocker(issue: str | None) -> bool:
    if not issue:
        return False
    lower_issue = issue.lower()
    return "another live tws/gateway session" in lower_issue or "different ip address" in lower_issue


__all__ = [name for name in globals() if ((name.startswith("_") and not name.startswith("__")) or name.isupper())]
