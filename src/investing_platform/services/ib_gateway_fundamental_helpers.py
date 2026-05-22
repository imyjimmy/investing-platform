"""Fundamental-data helpers for the IB Gateway adapter."""

from __future__ import annotations

from datetime import UTC, date, datetime
from math import isfinite
from typing import Any
from xml.etree import ElementTree

try:
    import yfinance as yf
except ImportError:  # pragma: no cover - optional fundamentals fallback
    yf = None  # type: ignore[assignment]

from investing_platform.services.ib_gateway_chain_helpers import *

def _account_value(values: dict[str, Any], tag: str) -> float:
    raw = values.get(tag)
    if raw in {None, ""}:
        return 0.0
    return float(raw)


def _market_data_mode_label(market_data_type: int) -> str:
    return {
        1: "LIVE",
        2: "FROZEN",
        3: "DELAYED",
        4: "DELAYED_FROZEN",
    }.get(market_data_type, "UNKNOWN")


def _ib_connection_port_candidates(primary_port: int, auto_discover: bool) -> list[int]:
    standard_ports = {4001, 4002, 7496, 7497}
    if not auto_discover and primary_port not in standard_ports:
        return [primary_port]
    candidates = [primary_port, 4001, 4002, 7496, 7497]
    ordered: list[int] = []
    for candidate in candidates:
        if candidate not in ordered:
            ordered.append(candidate)
    return ordered


def _market_data_type_candidates(preferred_type: int) -> list[int]:
    effective_preferred_type = _effective_market_data_type(preferred_type)
    candidates = [effective_preferred_type, preferred_type, 3, 4]
    deduped: list[int] = []
    for candidate in candidates:
        if candidate not in deduped:
            deduped.append(candidate)
    return deduped


def _option_market_data_type_candidates(preferred_type: int) -> list[int]:
    effective_preferred_type = _effective_market_data_type(preferred_type)
    candidates = [effective_preferred_type, preferred_type, 3]
    deduped: list[int] = []
    for candidate in candidates:
        if candidate not in deduped:
            deduped.append(candidate)
    return deduped


def _option_market_data_batch_size(configured_batch_size: int, market_data_type: int) -> int:
    effective_market_data_type = _effective_market_data_type(market_data_type)
    if effective_market_data_type in {2, 4}:
        return max(6, min(configured_batch_size, 12))
    return max(8, configured_batch_size)


def _option_market_data_wait_profile(market_data_type: int) -> tuple[float, float]:
    effective_market_data_type = _effective_market_data_type(market_data_type)
    if effective_market_data_type in {2, 4}:
        return 1.2, 2.4
    return 0.5, 1.2


def _effective_market_data_type(preferred_type: int) -> int:
    if preferred_type in {1, 2} and _should_prefer_frozen_market_data():
        return 2
    return preferred_type


def _merge_ticker_payloads(primary: Any, secondary: Any) -> Any:
    if primary is None:
        return secondary
    if secondary is None:
        return primary
    for attr_name in ("bid", "ask", "last", "close", "open", "high", "low", "volume"):
        secondary_value = getattr(secondary, attr_name, None)
        primary_value = getattr(primary, attr_name, None)
        if _safe_float(secondary_value) is None and _safe_float(primary_value) is not None:
            try:
                setattr(secondary, attr_name, primary_value)
            except Exception:
                pass
    return secondary


def _extract_fundamental_ratios(ratios: Any) -> dict[str, Any]:
    values: dict[str, Any] = {}
    if ratios is None:
        return values
    if isinstance(ratios, dict):
        iterable = ratios.items()
    else:
        raw = getattr(ratios, "__dict__", None)
        iterable = raw.items() if isinstance(raw, dict) else ((name, getattr(ratios, name, None)) for name in dir(ratios))
    for key, value in iterable:
        if str(key).startswith("_") or callable(value):
            continue
        values[_normalize_metric_key(key)] = value
    return values


def _extract_fundamental_xml_values(payload: str) -> dict[str, Any]:
    values: dict[str, Any] = {}
    try:
        root = ElementTree.fromstring(payload)
    except ElementTree.ParseError:
        return values
    for element in root.iter():
        tag_name = _strip_xml_namespace(element.tag)
        text = (element.text or "").strip()
        field_name = (
            element.attrib.get("FieldName")
            or element.attrib.get("fieldName")
            or element.attrib.get("Name")
            or element.attrib.get("name")
            or tag_name
        )
        if text and field_name:
            values[_normalize_metric_key(field_name)] = text
        for attr_key, attr_value in element.attrib.items():
            if attr_value not in {"", None}:
                values.setdefault(_normalize_metric_key(attr_key), attr_value)
    return values


def _strip_xml_namespace(tag_name: str) -> str:
    return tag_name.rsplit("}", 1)[-1] if "}" in tag_name else tag_name


def _normalize_metric_key(value: Any) -> str:
    return "".join(character for character in str(value).lower() if character.isalnum())


def _metric_raw_value(values: dict[str, Any], *aliases: str) -> Any | None:
    for alias in aliases:
        value = values.get(_normalize_metric_key(alias))
        if value is not None and value != "":
            return value
    return None


def _metric_value(values: dict[str, Any], *aliases: str) -> float | None:
    return _safe_float(_metric_raw_value(values, *aliases))


def _first_present(*values: Any) -> Any | None:
    for value in values:
        if value is not None and value != "":
            return value
    return None


def _fetch_yfinance_fundamentals(symbol: str) -> dict[str, Any]:
    if yf is None:
        return {}
    try:
        info = yf.Ticker(symbol).get_info()
    except Exception:
        return {}
    if not isinstance(info, dict):
        return {}
    return {_normalize_metric_key(key): value for key, value in info.items() if value is not None and value != ""}


def _normalize_large_statement_value(value: float | None) -> float | None:
    if value is None or not isfinite(value):
        return None
    if 0 < abs(value) < 1_000_000_000:
        return value * 1_000_000.0
    return value


def _normalize_share_count(value: float | None) -> float | None:
    if value is None or not isfinite(value):
        return None
    if 0 < value < 10_000_000:
        return value * 1_000_000.0
    return value


def _normalize_percent(value: float | None) -> float | None:
    if value is None or not isfinite(value):
        return None
    if -1.0 <= value <= 1.0:
        return value * 100.0
    return value


def _parse_date_value(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)) and value > 100_000:
        try:
            return datetime.fromtimestamp(value, UTC).date()
        except (OverflowError, OSError, ValueError):
            return None
    if value is None or value == "":
        return None
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%Y%m%d", "%m/%d/%Y", "%b %d, %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _analyst_rating(value: Any) -> str | None:
    if value is None or value == "":
        return None
    numeric = _safe_float(value)
    if numeric is not None:
        if numeric <= 1.5:
            return "Strong Buy"
        if numeric <= 2.5:
            return "Buy"
        if numeric <= 3.5:
            return "Hold"
        if numeric <= 4.5:
            return "Sell"
        return "Strong Sell"
    return str(value).replace("_", " ").replace("-", " ").strip().title()




__all__ = [name for name in globals() if ((name.startswith("_") and not name.startswith("__")) or name.isupper())]
