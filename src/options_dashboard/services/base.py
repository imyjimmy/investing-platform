"""Shared service contracts and helpers for dashboard data providers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Generic, TypeVar

from options_dashboard.models import (
    AccountSnapshot,
    ConnectionStatus,
    OpenOrderExposure,
    OptionOrderPreview,
    OptionOrderRequest,
    OptionChainResponse,
    OptionPosition,
    OrderCancelResponse,
    Position,
    SubmittedOrder,
    UnderlyingQuote,
)


class BrokerServiceError(RuntimeError):
    """Base error raised by broker service implementations."""


class BrokerUnavailableError(BrokerServiceError):
    """Raised when the broker is disconnected and no fresh data is available."""


@dataclass(slots=True)
class PortfolioSnapshot:
    account: AccountSnapshot
    positions: list[Position]
    option_positions: list[OptionPosition]
    open_orders: list[OpenOrderExposure]
    generated_at: datetime
    is_stale: bool = False


T = TypeVar("T")


@dataclass(slots=True)
class CacheEntry(Generic[T]):
    value: T
    captured_at: datetime


class BrokerService:
    """Abstract contract for IBKR or mock-backed portfolio data."""

    def connect(self, force: bool = False) -> ConnectionStatus:
        raise NotImplementedError

    def reconnect(self) -> ConnectionStatus:
        raise NotImplementedError

    def connection_status(self) -> ConnectionStatus:
        raise NotImplementedError

    def get_portfolio_snapshot(self, account_id: str | None = None) -> PortfolioSnapshot:
        raise NotImplementedError

    def get_underlying_quote(self, symbol: str) -> UnderlyingQuote:
        raise NotImplementedError

    def get_option_chain(self, symbol: str, expiry: str | None = None) -> OptionChainResponse:
        raise NotImplementedError

    def preview_option_order(self, request: OptionOrderRequest) -> OptionOrderPreview:
        raise NotImplementedError

    def submit_option_order(self, request: OptionOrderRequest) -> SubmittedOrder:
        raise NotImplementedError

    def cancel_order(self, account_id: str, order_id: int) -> OrderCancelResponse:
        raise NotImplementedError
