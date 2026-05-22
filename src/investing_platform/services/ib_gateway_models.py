"""Small internal models used across the IB Gateway adapter modules."""

from __future__ import annotations

from concurrent.futures import Future
from dataclasses import dataclass
from typing import Any, Callable, TypeVar

from investing_platform.models import OptionOrderLegRequest, OptionOrderRequest


TaskResultT = TypeVar("TaskResultT")


@dataclass(slots=True)
class _PendingTask:
    callback: Callable[[Any], Any]
    future: Future[Any]


@dataclass(slots=True)
class _ResolvedOptionLeg:
    request_leg: OptionOrderLegRequest
    contract: Any
    market_reference_price: float | None


@dataclass(slots=True)
class _ResolvedOptionOrder:
    contract: Any
    market_reference_price: float | None
    legs: list[_ResolvedOptionLeg]


@dataclass(slots=True)
class _StrategyPermissionProbe:
    strategy_key: str
    label: str
    request: OptionOrderRequest | None
    unavailable_detail: str | None = None


__all__ = [
    "TaskResultT",
    "_PendingTask",
    "_ResolvedOptionLeg",
    "_ResolvedOptionOrder",
    "_StrategyPermissionProbe",
]
