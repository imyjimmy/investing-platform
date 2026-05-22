"""Shared optional ib_insync runtime imports and IB Gateway constants."""

from __future__ import annotations

try:
    from ib_insync import ComboLeg, IB, Contract, LimitOrder, MarketOrder, Option, Stock, Ticker
except ImportError:  # pragma: no cover - runtime guard
    ComboLeg = object  # type: ignore[assignment]
    IB = object  # type: ignore[assignment]
    Contract = object  # type: ignore[assignment]
    LimitOrder = object  # type: ignore[assignment]
    MarketOrder = object  # type: ignore[assignment]
    Option = object  # type: ignore[assignment]
    Stock = object  # type: ignore[assignment]
    Ticker = object  # type: ignore[assignment]


OPTION_GENERIC_TICKS = "100,101,106,221"
OPTION_CHAIN_GENERIC_TICKS = "100,101,221"
STOCK_OVERVIEW_GENERIC_TICKS = "165,258,456"
FUNDAMENTAL_FINANCIAL_REPORT_TYPES = ("ReportsFinStatements", "ReportRatios", "ReportsFinSummary", "RESC")

__all__ = [
    "ComboLeg",
    "IB",
    "Contract",
    "LimitOrder",
    "MarketOrder",
    "Option",
    "Stock",
    "Ticker",
    "OPTION_GENERIC_TICKS",
    "OPTION_CHAIN_GENERIC_TICKS",
    "STOCK_OVERVIEW_GENERIC_TICKS",
    "FUNDAMENTAL_FINANCIAL_REPORT_TYPES",
]
