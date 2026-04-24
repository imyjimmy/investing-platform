"""Shared service contracts and helpers for dashboard data providers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Generic, TypeVar

from investing_platform.models import (
    AccountSnapshot,
    ConnectionStatus,
    OpenOrderExposure,
    OptionOrderPreview,
    OptionOrderRequest,
    OptionStrategyPermissionsResponse,
    OptionChainResponse,
    OptionPosition,
    OrderCancelResponse,
    Position,
    StockOrderPreview,
    StockOrderRequest,
    SubmittedOrder,
    TickerOverviewResponse,
    TickerFinancialsResponse,
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

    def get_ticker_overview(self, symbol: str) -> TickerOverviewResponse:
        raise NotImplementedError

    def get_ticker_financials(self, symbol: str) -> TickerFinancialsResponse:
        raise NotImplementedError

    def get_option_chain(
        self,
        symbol: str,
        expiry: str | None = None,
        strike_limit: int | None = None,
        lower_moneyness_pct: float | None = None,
        upper_moneyness_pct: float | None = None,
        min_moneyness_pct: float | None = None,
        max_moneyness_pct: float | None = None,
    ) -> OptionChainResponse:
        raise NotImplementedError

    def get_option_strategy_permissions(
        self,
        account_id: str,
        symbol: str,
        expiry: str | None = None,
    ) -> OptionStrategyPermissionsResponse:
        raise NotImplementedError

    def preview_option_order(self, request: OptionOrderRequest) -> OptionOrderPreview:
        raise NotImplementedError

    def submit_option_order(self, request: OptionOrderRequest) -> SubmittedOrder:
        raise NotImplementedError

    def preview_stock_order(self, request: StockOrderRequest) -> StockOrderPreview:
        raise NotImplementedError

    def submit_stock_order(self, request: StockOrderRequest) -> SubmittedOrder:
        raise NotImplementedError

    def cancel_order(self, account_id: str, order_id: int) -> OrderCancelResponse:
        raise NotImplementedError
