"""IB Gateway integration facade using ib_insync and focused adapter modules."""

from __future__ import annotations

from concurrent.futures import TimeoutError as FutureTimeoutError
from datetime import UTC, datetime
from queue import Queue
import threading
from typing import cast

from investing_platform.config import DashboardSettings
from investing_platform.models import (
    ConnectionStatus,
    OptionChainResponse,
    OptionOrderPreview,
    OptionOrderRequest,
    OptionStrategyPermissionsResponse,
    OrderCancelResponse,
    StockOrderPreview,
    StockOrderRequest,
    SubmittedOrder,
    TickerFinancialsResponse,
    TickerOverviewResponse,
    UnderlyingQuote,
)
from investing_platform.services.base import BrokerService, BrokerUnavailableError, CacheEntry, PortfolioSnapshot
from investing_platform.services.ib_gateway_chain_helpers import *
from investing_platform.services.ib_gateway_connection import IBGatewayConnectionMixin
from investing_platform.services.ib_gateway_execution import IBGatewayExecutionMixin
from investing_platform.services.ib_gateway_fundamental_helpers import *
from investing_platform.services.ib_gateway_market_data import IBGatewayMarketDataMixin
from investing_platform.services.ib_gateway_models import _PendingTask
from investing_platform.services.ib_gateway_option_chain import IBGatewayOptionChainMixin
from investing_platform.services.ib_gateway_order_helpers import *
from investing_platform.services.ib_gateway_portfolio import IBGatewayPortfolioMixin
from investing_platform.services.ib_gateway_quote_helpers import *
from investing_platform.services.ib_gateway_runtime import IB


class IBGatewayBrokerService(
    IBGatewayConnectionMixin,
    IBGatewayPortfolioMixin,
    IBGatewayMarketDataMixin,
    IBGatewayOptionChainMixin,
    IBGatewayExecutionMixin,
    BrokerService,
):
    """Thread-confined ib_insync service with reconnect and stale-cache fallback."""

    def __init__(self, settings: DashboardSettings) -> None:
        if IB is object:
            raise RuntimeError(
                "ib_insync is not installed. Run `./scripts/bootstrap.sh` or `pip install -r requirements.txt` first."
            )
        self.settings = settings
        self._status_lock = threading.Lock()
        self._connected = False
        self._last_successful_connect_at: datetime | None = None
        self._last_heartbeat_at: datetime | None = None
        self._next_reconnect_attempt_at: datetime | None = None
        self._last_error: str | None = None
        self._recent_ib_errors: list[tuple[datetime, int, str]] = []
        self._resolved_account_id: str | None = self.settings.ib_account_id
        self._resolved_port: int = self.settings.ib_port
        self._managed_accounts: list[str] = [self.settings.ib_account_id] if self.settings.ib_account_id else []
        self._portfolio_cache: dict[str, CacheEntry[PortfolioSnapshot]] = {}
        self._quote_cache: dict[str, CacheEntry[UnderlyingQuote]] = {}
        self._ticker_overview_cache: dict[str, CacheEntry[TickerOverviewResponse]] = {}
        self._ticker_financials_cache: dict[str, CacheEntry[TickerFinancialsResponse]] = {}
        self._chain_cache: dict[str, CacheEntry[OptionChainResponse]] = {}
        self._option_snapshot_root = self.settings.data_dir / "raw" / "options"
        self._tasks: Queue[_PendingTask] = Queue()
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._worker_main, name="ib-gateway-service", daemon=True)
        self._thread.start()

    def connect(self, force: bool = False) -> ConnectionStatus:
        self._submit(lambda ib: self._connect_on_thread(ib, force), timeout=self.settings.ib_connect_timeout_seconds + 3.0)
        return self.connection_status()

    def reconnect(self) -> ConnectionStatus:
        return self.connect(force=True)

    def connection_status(self) -> ConnectionStatus:
        with self._status_lock:
            return ConnectionStatus(
                mode="ibkr",
                connected=self._connected,
                status="connected" if self._connected else "disconnected",
                executionMode=self.settings.execution_mode,
                routedAccountType=_account_route_kind(self._resolved_account_id),
                host=self.settings.ib_host,
                port=self._resolved_port,
                clientId=self.settings.ib_client_id,
                accountId=self._resolved_account_id,
                managedAccounts=self._managed_accounts,
                marketDataType=self.settings.ib_market_data_type,
                marketDataMode=_market_data_mode_label(self.settings.ib_market_data_type) if self._connected else "UNAVAILABLE",
                usingMockData=False,
                lastSuccessfulConnectAt=self._last_successful_connect_at,
                lastHeartbeatAt=self._last_heartbeat_at,
                nextReconnectAttemptAt=self._next_reconnect_attempt_at,
                lastError=self._last_error,
            )

    def get_portfolio_snapshot(self, account_id: str | None = None) -> PortfolioSnapshot:
        cache_key = self._portfolio_cache_key(account_id)
        cached = self._portfolio_cache.get(cache_key)
        if cached and _age_seconds(cached.captured_at) <= self.settings.snapshot_cache_ttl_seconds:
            return cached.value
        try:
            snapshot = cast(
                PortfolioSnapshot,
                self._submit(lambda ib: self._fetch_portfolio_snapshot(ib, account_id), timeout=self.settings.ib_request_timeout_seconds + 5.0),
            )
            resolved_key = snapshot.account.accountId or cache_key
            cache_entry = CacheEntry(snapshot, datetime.now(UTC))
            self._portfolio_cache[resolved_key] = cache_entry
            self._portfolio_cache[cache_key] = cache_entry
            return snapshot
        except Exception as exc:
            stale_entry = self._portfolio_cache.get(cache_key)
            if stale_entry is not None:
                stale = stale_entry.value
                return PortfolioSnapshot(
                    account=stale.account.model_copy(update={"isStale": True}),
                    positions=stale.positions,
                    option_positions=[position.model_copy() for position in stale.option_positions],
                    open_orders=[order.model_copy() for order in stale.open_orders],
                    generated_at=stale.generated_at,
                    is_stale=True,
                )
            raise BrokerUnavailableError(str(exc)) from exc

    def get_underlying_quote(self, symbol: str) -> UnderlyingQuote:
        symbol = symbol.upper()
        cached = self._quote_cache.get(symbol)
        if cached and _age_seconds(cached.captured_at) <= self.settings.chain_cache_ttl_seconds:
            return cached.value
        try:
            quote = cast(UnderlyingQuote, self._submit(lambda ib: self._fetch_underlying_quote(ib, symbol), timeout=self.settings.ib_request_timeout_seconds))
            self._quote_cache[symbol] = CacheEntry(quote, datetime.now(UTC))
            return quote
        except Exception as exc:
            if cached is not None:
                return cached.value.model_copy(update={"marketDataStatus": "STALE"})
            raise BrokerUnavailableError(str(exc)) from exc

    def get_ticker_overview(self, symbol: str) -> TickerOverviewResponse:
        symbol = symbol.upper()
        cached = self._ticker_overview_cache.get(symbol)
        if cached and _age_seconds(cached.captured_at) <= self.settings.chain_cache_ttl_seconds:
            return cached.value
        try:
            overview = cast(
                TickerOverviewResponse,
                self._submit(lambda ib: self._fetch_ticker_overview(ib, symbol), timeout=self.settings.ib_request_timeout_seconds + 8.0),
            )
            self._ticker_overview_cache[symbol] = CacheEntry(overview, datetime.now(UTC))
            self._quote_cache[symbol] = CacheEntry(overview.quote, datetime.now(UTC))
            return overview
        except Exception as exc:
            if cached is not None:
                return cached.value.model_copy(update={"isStale": True, "sourceNotice": f"Showing stale ticker overview. {exc}"})
            raise BrokerUnavailableError(str(exc)) from exc

    def get_ticker_financials(self, symbol: str) -> TickerFinancialsResponse:
        symbol = symbol.upper()
        cached = self._ticker_financials_cache.get(symbol)
        if cached and _age_seconds(cached.captured_at) <= self.settings.chain_cache_ttl_seconds:
            return cached.value
        try:
            financials = cast(
                TickerFinancialsResponse,
                self._submit(lambda ib: self._fetch_ticker_financials(ib, symbol), timeout=self.settings.ib_request_timeout_seconds + 16.0),
            )
            self._ticker_financials_cache[symbol] = CacheEntry(financials, datetime.now(UTC))
            return financials
        except Exception as exc:
            if cached is not None:
                notices = [*cached.value.sourceNotices, f"Showing stale ticker financials. {exc}"]
                return cached.value.model_copy(update={"isStale": True, "sourceNotices": notices})
            raise BrokerUnavailableError(str(exc)) from exc

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
        symbol = symbol.upper()
        requested_strike_limit = _normalize_chain_strike_limit(strike_limit, self.settings.chain_strike_limit)
        lower_pct, upper_pct = _normalize_chain_window(
            lower_moneyness_pct,
            upper_moneyness_pct,
            self.settings.chain_moneyness_pct,
        )
        min_pct, max_pct = _normalize_chain_moneyness_range(min_moneyness_pct, max_moneyness_pct)
        range_key = f"{min_pct:.4f}:{max_pct:.4f}" if min_pct is not None and max_pct is not None else f"{lower_pct:.4f}:{upper_pct:.4f}"
        cache_key = f"{symbol}:{expiry or 'AUTO'}:{requested_strike_limit}:{range_key}"
        cached = self._chain_cache.get(cache_key)
        if cached and _age_seconds(cached.captured_at) <= _chain_cache_ttl_seconds(cached.value, self.settings.chain_cache_ttl_seconds):
            return cached.value
        if _is_weekend_market_session():
            saved_chain = self._load_saved_option_chain(symbol, expiry, requested_strike_limit, lower_pct, upper_pct, min_pct, max_pct)
            if saved_chain is not None:
                self._chain_cache[cache_key] = CacheEntry(saved_chain, datetime.now(UTC))
                return saved_chain
        try:
            chain = cast(
                OptionChainResponse,
                self._submit(
                    lambda ib: self._fetch_option_chain(ib, symbol, expiry, requested_strike_limit, lower_pct, upper_pct, min_pct, max_pct),
                    timeout=self.settings.ib_request_timeout_seconds + 18.0,
                ),
            )
            self._chain_cache[cache_key] = CacheEntry(chain, datetime.now(UTC))
            return chain
        except FutureTimeoutError as exc:
            if cached is not None:
                return cached.value.model_copy(update={"isStale": True})
            raise BrokerUnavailableError(
                f"Timed out loading the option chain for {symbol}. The IBKR session may be missing option quote entitlements or responding slowly."
            ) from exc
        except Exception as exc:
            if cached is not None:
                return cached.value.model_copy(update={"isStale": True})
            raise BrokerUnavailableError(str(exc)) from exc

    def get_option_strategy_permissions(
        self,
        account_id: str,
        symbol: str,
        expiry: str | None = None,
    ) -> OptionStrategyPermissionsResponse:
        symbol = symbol.upper()
        try:
            return cast(
                OptionStrategyPermissionsResponse,
                self._submit(
                    lambda ib: self._fetch_option_strategy_permissions(ib, account_id, symbol, expiry),
                    timeout=self.settings.ib_request_timeout_seconds + 24.0,
                ),
            )
        except FutureTimeoutError as exc:
            raise BrokerUnavailableError(
                f"Timed out checking option strategy permissions for {symbol}. The IBKR worker is busy or contract lookups are slow."
            ) from exc
