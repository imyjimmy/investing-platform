"""Quote, position, and option-risk helpers for the IB Gateway adapter."""

from __future__ import annotations

from datetime import date, datetime
from math import isfinite
from typing import Any

from investing_platform.models import Position
from investing_platform.services.ib_gateway_chain_helpers import *
from investing_platform.services.ib_gateway_fundamental_helpers import *

def _extract_greek(ticker: Any, field_name: str, percent: bool = False) -> float | None:
    if ticker is None:
        return None
    for attr_name in ("modelGreeks", "lastGreeks", "bidGreeks", "askGreeks"):
        greeks = getattr(ticker, attr_name, None)
        if greeks is None:
            continue
        value = getattr(greeks, field_name, None)
        value_float = _safe_float(value)
        if _is_finite_number(value_float):
            return value_float * 100.0 if percent else value_float
    return None


def _extract_under_price(ticker: Any) -> float:
    if ticker is None:
        return 0.0
    for attr_name in ("modelGreeks", "lastGreeks", "bidGreeks", "askGreeks"):
        greeks = getattr(ticker, attr_name, None)
        if greeks is None:
            continue
        value = _safe_float(getattr(greeks, "undPrice", None))
        if _is_finite_number(value):
            return float(value)
    return 0.0


def _ticker_market_price(ticker: Any) -> float:
    candidates = [
        _safe_float(getattr(ticker, "marketPrice", lambda: None)() if ticker is not None and callable(getattr(ticker, "marketPrice", None)) else None),
        _safe_float(getattr(ticker, "last", None)),
        _midpoint(_safe_float(getattr(ticker, "bid", None)), _safe_float(getattr(ticker, "ask", None))),
        _safe_float(getattr(ticker, "close", None)),
    ]
    for candidate in candidates:
        if _is_valid_number(candidate):
            return float(candidate)
    return 0.0


def _ticker_option_mark(ticker: Any) -> float:
    candidates = [
        _safe_float(getattr(ticker, "marketPrice", lambda: None)() if ticker is not None and callable(getattr(ticker, "marketPrice", None)) else None),
        _midpoint(_safe_float(getattr(ticker, "bid", None)), _safe_float(getattr(ticker, "ask", None))),
        _safe_float(getattr(ticker, "last", None)),
        _safe_float(getattr(ticker, "close", None)),
    ]
    for candidate in candidates:
        if _is_valid_number(candidate):
            return float(candidate)
    return 0.0


def _ticker_has_quote_payload(ticker: Any) -> bool:
    if _is_valid_number(_ticker_market_price(ticker)):
        return True
    return any(
        _is_finite_number(_extract_greek(ticker, field_name))
        for field_name in ("delta", "gamma", "theta", "vega", "impliedVol")
    )


def _ticker_has_option_payload(ticker: Any) -> bool:
    return _ticker_option_payload_score(ticker) > 0


def _ticker_has_live_option_quote(ticker: Any) -> bool:
    if ticker is None:
        return False
    bid = _safe_float(getattr(ticker, "bid", None))
    ask = _safe_float(getattr(ticker, "ask", None))
    last = _safe_float(getattr(ticker, "last", None))
    market_price = _safe_float(
        getattr(ticker, "marketPrice", lambda: None)() if callable(getattr(ticker, "marketPrice", None)) else None
    )
    return any(_is_valid_number(candidate) for candidate in (bid, ask, last, market_price))


def _ticker_option_payload_score(ticker: Any) -> int:
    score = 0
    bid = _safe_float(getattr(ticker, "bid", None))
    ask = _safe_float(getattr(ticker, "ask", None))
    if _is_valid_number(bid) or _is_valid_number(ask):
        score += 3
    if any(_is_finite_number(_extract_greek(ticker, field_name)) for field_name in ("delta", "theta", "impliedVol")):
        score += 2
    if _is_valid_number(_ticker_option_mark(ticker)):
        score += 1
    if _is_valid_number(_safe_float(getattr(ticker, "last", None))) or _is_valid_number(_safe_float(getattr(ticker, "close", None))):
        score += 1
    return score


def _extract_option_volume(ticker: Any, right: str) -> int | None:
    if ticker is None:
        return None
    attr_names = ("callVolume", "volume") if right == "C" else ("putVolume", "volume")
    for attr_name in attr_names:
        value = _optional_int(getattr(ticker, attr_name, None))
        if value is not None:
            return value
    return None


def _extract_option_open_interest(ticker: Any, right: str) -> int | None:
    if ticker is None:
        return None
    attr_names = ("callOpenInterest", "futuresOpenInterest") if right == "C" else ("putOpenInterest", "futuresOpenInterest")
    for attr_name in attr_names:
        value = _optional_int(getattr(ticker, attr_name, None))
        if value is not None:
            return value
    return None


def _latest_underlying_price(ib: Any, contract: Any) -> float | None:
    try:
        bars = ib.reqHistoricalData(
            contract,
            endDateTime="",
            durationStr="5 D",
            barSizeSetting="1 hour",
            whatToShow="TRADES",
            useRTH=False,
            formatDate=1,
            keepUpToDate=False,
        )
    except Exception:
        return None
    if not bars:
        return None
    close_value = _safe_float(getattr(bars[-1], "close", None))
    return close_value if _is_valid_number(close_value) else None


def _latest_option_midpoint(ib: Any, contract: Any) -> tuple[float | None, datetime | None]:
    for what_to_show in ("MIDPOINT", "TRADES"):
        try:
            bars = ib.reqHistoricalData(
                contract,
                endDateTime="",
                durationStr="2 D",
                barSizeSetting="1 hour",
                whatToShow=what_to_show,
                useRTH=False,
                formatDate=1,
                keepUpToDate=False,
            )
        except Exception:
            continue
        if not bars:
            continue
        last_bar = bars[-1]
        close_value = _safe_float(getattr(last_bar, "close", None))
        if _is_valid_number(close_value):
            return close_value, _coerce_bar_datetime(getattr(last_bar, "date", None))
    return None, None


def _coerce_bar_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


def _normalize_option_avg_cost(raw_avg_cost: float, multiplier: float, mark: float) -> float:
    candidates = [abs(raw_avg_cost), abs(raw_avg_cost) / max(multiplier, 1.0)]
    valid = [candidate for candidate in candidates if candidate > 0]
    if not valid:
        return 0.0
    if _is_valid_number(mark) and mark > 0:
        return min(valid, key=lambda value: abs(value - mark))
    return min(valid)


def _best_underlying_from_portfolio(symbol: str, stock_positions: list[Position]) -> float:
    for position in stock_positions:
        if position.symbol == symbol:
            return position.marketPrice
    return 0.0


def _annualized_yield(premium: float | None, base: float, dte: int) -> float | None:
    if not _is_valid_number(premium) or base <= 0 or dte <= 0:
        return None
    return (float(premium) / base) * (365.0 / dte) * 100.0


def _midpoint(bid: float | None, ask: float | None) -> float | None:
    if _is_valid_number(bid) and _is_valid_number(ask):
        return (float(bid) + float(ask)) / 2.0
    return None


def _safe_float(value: Any) -> float | None:
    if isinstance(value, str):
        value = value.strip().replace(",", "").replace("$", "").replace("%", "")
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result


def _is_finite_number(value: float | None) -> bool:
    return value is not None and isfinite(value) and abs(value) < 1e307


def _is_valid_number(value: float | None) -> bool:
    return _is_finite_number(value) and value > 0


def _normalize_expiry(raw_expiry: str) -> str:
    raw_expiry = str(raw_expiry)
    if "-" in raw_expiry:
        return raw_expiry
    return f"{raw_expiry[:4]}-{raw_expiry[4:6]}-{raw_expiry[6:8]}"


def _moneyness_pct(right: str, strike: float, spot: float) -> float:
    if spot <= 0:
        return 0.0
    if right == "P":
        return (strike - spot) / spot
    return (spot - strike) / spot


def _distance_to_strike_pct(right: str, strike: float, spot: float) -> float:
    if spot <= 0:
        return 0.0
    if right == "P":
        return (spot - strike) / spot
    return (strike - spot) / spot


def _assignment_risk(right: str, quantity: int, dte: int, moneyness_pct: float, delta: float | None) -> str:
    if quantity >= 0:
        return "Low"
    score = 0.0
    if moneyness_pct > 0:
        score += 2.2
    elif moneyness_pct > -0.02:
        score += 1.4
    elif moneyness_pct > -0.05:
        score += 0.7
    if dte <= 2:
        score += 2.0
    elif dte <= 5:
        score += 1.2
    elif dte <= 10:
        score += 0.5
    delta_abs = abs(delta or 0.0)
    if delta_abs >= 0.5:
        score += 1.1
    elif delta_abs >= 0.3:
        score += 0.5
    if right == "C" and moneyness_pct > 0 and dte <= 7:
        score += 0.4
    if score >= 4.0:
        return "High"
    if score >= 2.5:
        return "Elevated"
    if score >= 1.2:
        return "Moderate"
    return "Low"


def _covered_status(strategy_tag: str, covered_contracts: int, quantity: int) -> str:
    if strategy_tag != "covered-call":
        return "n/a"
    if covered_contracts >= abs(quantity):
        return "covered"
    if covered_contracts > 0:
        return "partially-covered"
    return "uncovered"




__all__ = [name for name in globals() if ((name.startswith("_") and not name.startswith("__")) or name.isupper())]
