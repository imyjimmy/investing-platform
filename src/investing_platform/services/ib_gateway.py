"""IB Gateway integration using ib_insync and a dedicated worker thread."""

from __future__ import annotations

import asyncio
from concurrent.futures import Future, TimeoutError as FutureTimeoutError
from dataclasses import dataclass
from datetime import UTC, date, datetime, time as dt_time, timedelta
from math import erf, exp, isfinite, log, pi, sqrt
from pathlib import Path
from queue import Empty, Queue
import threading
import time
from typing import Any, Callable, Iterable, Literal, TypeVar, cast
from zoneinfo import ZoneInfo

import pandas as pd

from investing_platform.config import DashboardSettings
from investing_platform.models import (
    AccountSnapshot,
    ChainHighlight,
    ChainRow,
    ConnectionStatus,
    OpenOrderExposure,
    OptionChainResponse,
    OptionOrderPreview,
    OptionOrderRequest,
    OptionPosition,
    OrderCancelResponse,
    Position,
    SubmittedOrder,
    UnderlyingQuote,
)
from investing_platform.services.analytics import build_collateral_summary
from investing_platform.services.base import BrokerService, BrokerUnavailableError, CacheEntry, PortfolioSnapshot


try:
    from ib_insync import IB, Contract, LimitOrder, MarketOrder, Option, Stock, Ticker
except ImportError:  # pragma: no cover - runtime guard
    IB = object  # type: ignore[assignment]
    Contract = object  # type: ignore[assignment]
    LimitOrder = object  # type: ignore[assignment]
    MarketOrder = object  # type: ignore[assignment]
    Option = object  # type: ignore[assignment]
    Stock = object  # type: ignore[assignment]
    Ticker = object  # type: ignore[assignment]


TaskResultT = TypeVar("TaskResultT")
OPTION_GENERIC_TICKS = "100,101,106,221"


@dataclass(slots=True)
class _PendingTask:
    callback: Callable[[Any], Any]
    future: Future[Any]


class IBGatewayBrokerService(BrokerService):
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

    def get_option_chain(self, symbol: str, expiry: str | None = None) -> OptionChainResponse:
        symbol = symbol.upper()
        cache_key = f"{symbol}:{expiry or 'AUTO'}"
        cached = self._chain_cache.get(cache_key)
        if cached and _age_seconds(cached.captured_at) <= _chain_cache_ttl_seconds(cached.value, self.settings.chain_cache_ttl_seconds):
            return cached.value
        if _is_weekend_market_session():
            saved_chain = self._load_saved_option_chain(symbol, expiry)
            if saved_chain is not None:
                self._chain_cache[cache_key] = CacheEntry(saved_chain, datetime.now(UTC))
                return saved_chain
        try:
            chain = cast(
                OptionChainResponse,
                self._submit(lambda ib: self._fetch_option_chain(ib, symbol, expiry), timeout=self.settings.ib_request_timeout_seconds + 18.0),
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

    def _load_saved_option_chain(self, symbol: str, expiry: str | None) -> OptionChainResponse | None:
        if not self._option_snapshot_root.exists():
            return None

        ranked_snapshots: list[tuple[date, int, Path, str]] = []
        for path in self._option_snapshot_root.glob("as_of=*/provider=*/options_chain.csv"):
            provider_name = _extract_snapshot_provider(path)
            if provider_name is None or provider_name == "mock":
                continue
            snapshot_date = _extract_snapshot_date(path)
            if snapshot_date is None or snapshot_date > _market_session_date():
                continue
            ranked_snapshots.append((snapshot_date, _snapshot_provider_priority(provider_name), path, provider_name))

        for snapshot_date, _priority, path, provider_name in sorted(
            ranked_snapshots,
            key=lambda item: (item[0], item[1]),
            reverse=True,
        ):
            try:
                frame = pd.read_csv(path)
            except Exception:
                continue
            if frame.empty or "ticker" not in frame.columns:
                continue
            symbol_frame = frame[frame["ticker"].astype(str).str.upper() == symbol].copy()
            if symbol_frame.empty:
                continue
            response = self._build_saved_option_chain_response(symbol_frame, symbol, expiry, snapshot_date, provider_name)
            if response is not None:
                return response
        return None

    def _build_saved_option_chain_response(
        self,
        frame: pd.DataFrame,
        symbol: str,
        expiry: str | None,
        snapshot_date: date,
        provider_name: str,
    ) -> OptionChainResponse | None:
        if "expiration" not in frame.columns or "strike" not in frame.columns or "option_type" not in frame.columns:
            return None

        working = frame.copy()
        working["expiration"] = working["expiration"].astype(str)
        working["option_type"] = working["option_type"].astype(str).str.lower()
        expiries = sorted(working["expiration"].dropna().unique().tolist())
        if not expiries:
            return None

        selected_expiry = expiry if expiry in expiries else expiries[0]
        filtered = working[working["expiration"] == selected_expiry].copy()
        if filtered.empty:
            return None

        quote_as_of = _snapshot_close_timestamp(snapshot_date)
        underlying_price = _snapshot_underlying_price(filtered)
        rows: list[ChainRow] = []
        for strike, strike_frame in filtered.groupby("strike", sort=True):
            call_row = _snapshot_option_row(strike_frame, "call")
            put_row = _snapshot_option_row(strike_frame, "put")
            dte = _snapshot_dte(call_row, put_row, selected_expiry, snapshot_date)
            call_mid = _snapshot_option_mid(call_row)
            put_mid = _snapshot_option_mid(put_row)
            rows.append(
                ChainRow(
                    strike=round(float(strike), 2),
                    distanceFromSpotPct=round((float(strike) - underlying_price) / underlying_price * 100.0, 2)
                    if _is_valid_number(underlying_price) and underlying_price > 0
                    else 0.0,
                    callBid=_round_or_none(_snapshot_float(call_row, "bid"), 4),
                    callAsk=_round_or_none(_snapshot_float(call_row, "ask"), 4),
                    callMid=_round_or_none(call_mid, 4),
                    callVolume=_snapshot_int(call_row, "volume"),
                    callOpenInterest=_snapshot_int(call_row, "open_interest"),
                    callIV=_round_or_none(_snapshot_pct(call_row, "implied_vol"), 2),
                    callDelta=_round_signed_or_none(_snapshot_float(call_row, "delta"), 4),
                    callTheta=None,
                    callVega=None,
                    callRho=None,
                    callAnnualizedYieldPct=_round_or_none(_annualized_yield(call_mid, underlying_price, dte), 2),
                    putBid=_round_or_none(_snapshot_float(put_row, "bid"), 4),
                    putAsk=_round_or_none(_snapshot_float(put_row, "ask"), 4),
                    putMid=_round_or_none(put_mid, 4),
                    putVolume=_snapshot_int(put_row, "volume"),
                    putOpenInterest=_snapshot_int(put_row, "open_interest"),
                    putIV=_round_or_none(_snapshot_pct(put_row, "implied_vol"), 2),
                    putDelta=_round_signed_or_none(_snapshot_float(put_row, "delta"), 4),
                    putTheta=None,
                    putVega=None,
                    putRho=None,
                    putAnnualizedYieldPct=_round_or_none(_annualized_yield(put_mid, float(strike), dte), 2),
                    conservativePutCollateral=round(float(strike) * 100.0, 2),
                )
            )

        if not rows:
            return None

        provider_label = provider_name.upper()
        return OptionChainResponse(
            symbol=symbol,
            selectedExpiry=selected_expiry,
            expiries=expiries,
            underlying=UnderlyingQuote(
                symbol=symbol,
                price=round(underlying_price, 4),
                bid=None,
                ask=None,
                last=None,
                close=round(underlying_price, 4),
                marketDataStatus=f"{provider_label} SNAPSHOT",
                generatedAt=quote_as_of,
            ),
            rows=rows,
            highlights=_chain_highlights(rows, selected_expiry),
            quoteSource="historical",
            quoteAsOf=quote_as_of,
            quoteNotice=(
                f"Market is closed, so the chain is showing the latest saved {provider_label} snapshot for {symbol} "
                f"from {snapshot_date.isoformat()} close."
            ),
            generatedAt=datetime.now(UTC),
            isStale=False,
        )

    def _preview_option_order_on_thread(self, ib: Any, request: OptionOrderRequest) -> OptionOrderPreview:
        self._ensure_connected(ib)
        account_id = self._resolve_account_id(ib, request.accountId)
        self._ensure_execution_allowed(account_id)
        contract, market_reference_price = self._resolve_order_contract(ib, request)
        stock_qty, option_qty = self._position_maps_for_account(ib, account_id)
        opening_or_closing = _order_open_or_close(contract, request.action, float(request.quantity), stock_qty, option_qty)
        order = self._build_ib_order(request, account_id)
        order_state = ib.whatIfOrder(contract, order)
        return self._build_option_order_preview(
            request=request,
            account_id=account_id,
            contract=contract,
            order_state=order_state,
            market_reference_price=market_reference_price,
            opening_or_closing=opening_or_closing,
        )

    def _submit_option_order_on_thread(self, ib: Any, request: OptionOrderRequest) -> SubmittedOrder:
        self._ensure_connected(ib)
        account_id = self._resolve_account_id(ib, request.accountId)
        self._ensure_execution_allowed(account_id)
        contract, _ = self._resolve_order_contract(ib, request)
        order = self._build_ib_order(request, account_id)
        trade = ib.placeOrder(contract, order)
        order_status, message = self._await_trade_ack(ib, trade)
        status = str(getattr(order_status, "status", "") or "Submitted")
        if status in {"Cancelled", "ApiCancelled", "Inactive"}:
            raise RuntimeError(message or f"IB Gateway did not accept the order. Final status: {status}.")
        self._clear_portfolio_cache(account_id)
        return SubmittedOrder(
            orderId=int(getattr(trade.order, "orderId", 0)),
            permId=_optional_int(getattr(order_status, "permId", None)),
            clientId=_optional_int(getattr(order_status, "clientId", None)),
            status=status,
            filledQuantity=round(float(getattr(order_status, "filled", 0.0) or 0.0), 4),
            remainingQuantity=round(float(getattr(order_status, "remaining", 0.0) or 0.0), 4),
            message=message,
            submittedAt=datetime.now(UTC),
        )

    def _cancel_order_on_thread(self, ib: Any, account_id: str, order_id: int) -> OrderCancelResponse:
        self._ensure_connected(ib)
        resolved_account_id = self._resolve_account_id(ib, account_id)
        self._ensure_execution_allowed(resolved_account_id)
        trade = self._find_open_trade(ib, resolved_account_id, order_id)
        if trade is None:
            raise RuntimeError(f"Open order {order_id} was not found for account {resolved_account_id}.")
        ib.cancelOrder(trade.order)
        order_status, message = self._await_trade_ack(ib, trade)
        self._clear_portfolio_cache(resolved_account_id)
        return OrderCancelResponse(
            orderId=order_id,
            accountId=resolved_account_id,
            status=str(getattr(order_status, "status", "") or "PendingCancel"),
            message=message,
            cancelledAt=datetime.now(UTC),
        )

    def preview_option_order(self, request: OptionOrderRequest) -> OptionOrderPreview:
        try:
            return cast(
                OptionOrderPreview,
                self._submit(
                    lambda ib: self._preview_option_order_on_thread(ib, request),
                    timeout=self.settings.ib_request_timeout_seconds + 18.0,
                ),
            )
        except FutureTimeoutError as exc:
            raise BrokerUnavailableError(
                f"Timed out previewing {request.symbol} {request.expiry} {request.right}{request.strike:.2f}. The IBKR worker is busy or the contract lookup is slow."
            ) from exc

    def submit_option_order(self, request: OptionOrderRequest) -> SubmittedOrder:
        try:
            return cast(
                SubmittedOrder,
                self._submit(
                    lambda ib: self._submit_option_order_on_thread(ib, request),
                    timeout=self.settings.ib_request_timeout_seconds + self.settings.ib_order_ack_timeout_seconds + 18.0,
                ),
            )
        except FutureTimeoutError as exc:
            raise BrokerUnavailableError(
                f"Timed out submitting {request.symbol} {request.expiry} {request.right}{request.strike:.2f}. The IBKR worker is busy or order routing is slow."
            ) from exc

    def cancel_order(self, account_id: str, order_id: int) -> OrderCancelResponse:
        try:
            return cast(
                OrderCancelResponse,
                self._submit(
                    lambda ib: self._cancel_order_on_thread(ib, account_id, order_id),
                    timeout=self.settings.ib_request_timeout_seconds + self.settings.ib_order_ack_timeout_seconds + 12.0,
                ),
            )
        except FutureTimeoutError as exc:
            raise BrokerUnavailableError(
                f"Timed out cancelling order {order_id} for {account_id}. The IBKR worker is busy or order routing is slow."
            ) from exc

    def _submit(self, callback: Callable[[Any], TaskResultT], timeout: float) -> TaskResultT:
        future: Future[Any] = Future()
        self._tasks.put(_PendingTask(callback=callback, future=future))
        return cast(TaskResultT, future.result(timeout=timeout))

    def _worker_main(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        ib = IB()
        ib.errorEvent += self._handle_ib_error
        try:
            while not self._stop_event.is_set():
                try:
                    self._auto_reconnect_if_needed(ib)
                    task = self._tasks.get(timeout=0.2)
                except Empty:
                    task = None
                if task is not None:
                    if task.future.cancelled():
                        continue
                    try:
                        result = task.callback(ib)
                    except Exception as exc:  # pragma: no cover - exercised in runtime
                        task.future.set_exception(exc)
                    else:
                        task.future.set_result(result)
                try:
                    if ib.isConnected():
                        ib.sleep(0.05)
                        self._mark_heartbeat()
                    else:
                        time.sleep(0.05)
                except Exception as exc:  # pragma: no cover - defensive
                    self._mark_error(str(exc))
                    try:
                        if ib.isConnected():
                            ib.disconnect()
                    except Exception:
                        pass
                    time.sleep(0.2)
        finally:
            try:
                if ib.isConnected():
                    ib.disconnect()
            finally:
                asyncio.set_event_loop(None)
                loop.close()

    def _handle_ib_error(self, req_id: int, error_code: int, error_string: str, contract: Any | None = None) -> None:
        contract_symbol = _string_or_none(getattr(contract, "symbol", None)) if contract is not None else None
        detail = error_string.strip()
        if contract_symbol:
            detail = f"{detail} [{contract_symbol}]"
        with self._status_lock:
            self._recent_ib_errors.append((datetime.now(UTC), int(error_code), detail))
            self._recent_ib_errors = self._recent_ib_errors[-24:]

    def _latest_market_data_issue(self, *, max_age_seconds: float = 30.0) -> str | None:
        cutoff = datetime.now(UTC) - timedelta(seconds=max_age_seconds)
        with self._status_lock:
            recent_errors = [entry for entry in self._recent_ib_errors if entry[0] >= cutoff]
        for _at, error_code, detail in reversed(recent_errors):
            lower_detail = detail.lower()
            if error_code == 10197 or "competing live session" in lower_detail:
                return (
                    "IBKR is blocking market data because another live TWS/Gateway session is active. "
                    "Log out of other live sessions, then reconnect this dashboard."
                )
            if error_code == 162 and "different ip address" in lower_detail:
                return (
                    "IBKR is blocking historical market data because the trading session is connected from a different IP address."
                )
            if error_code in {354, 10089, 10090, 10091} or "additional subscription" in lower_detail or "not subscribed" in lower_detail:
                return (
                    "IBKR says this API session is missing the required market-data subscriptions or entitlements."
                )
        return None

    def _auto_reconnect_if_needed(self, ib: Any) -> None:
        if ib.isConnected():
            return
        with self._status_lock:
            next_attempt = self._next_reconnect_attempt_at
        if next_attempt and datetime.now(UTC) < next_attempt:
            return
        try:
            self._connect_on_thread(ib, force=False)
        except Exception as exc:
            self._mark_error(str(exc))

    def _connect_on_thread(self, ib: Any, force: bool) -> None:
        if force and ib.isConnected():
            ib.disconnect()
            self._mark_disconnected(None)
        if ib.isConnected():
            self._mark_connected(self._resolved_port)
            return
        last_error: Exception | None = None
        for port in _ib_connection_port_candidates(self.settings.ib_port, self.settings.ib_port_auto_discover):
            try:
                ib.connect(
                    self.settings.ib_host,
                    port,
                    clientId=self.settings.ib_client_id,
                    readonly=self.settings.execution_mode == "disabled",
                    timeout=self.settings.ib_connect_timeout_seconds,
                    account=self.settings.ib_account_id or "",
                )
            except Exception as exc:
                last_error = exc
                continue
            ib.reqMarketDataType(self.settings.ib_market_data_type)
            self._remember_account_id(self._resolve_account_id(ib))
            self._mark_connected(port)
            return
        if last_error is not None:
            raise last_error

    def _fetch_portfolio_snapshot(self, ib: Any, requested_account_id: str | None = None) -> PortfolioSnapshot:
        self._ensure_connected(ib)
        generated_at = datetime.now(UTC)
        account_id = self._resolve_account_id(ib, requested_account_id)
        self._remember_account_id(account_id)
        account_summary_rows = list(ib.accountSummary(account_id))
        account_values = {item.tag: item.value for item in account_summary_rows}
        portfolio_items = list(ib.portfolio(account_id))
        open_trades = [trade for trade in ib.openTrades() if trade.isActive()]

        stock_positions: list[Position] = []
        stock_shares_by_symbol: dict[str, int] = {}
        option_items: list[Any] = []

        for item in portfolio_items:
            contract = item.contract
            if contract.secType in {"STK", "ETF"}:
                stock_positions.append(
                    Position(
                        symbol=contract.symbol,
                        secType=contract.secType,
                        conId=getattr(contract, "conId", None),
                        quantity=float(item.position),
                        avgCost=round(float(item.averageCost), 4),
                        marketPrice=round(float(item.marketPrice), 4),
                        marketValue=round(float(item.marketValue), 2),
                        unrealizedPnL=round(float(item.unrealizedPNL), 2),
                        realizedPnL=round(float(item.realizedPNL), 2),
                    )
                )
                stock_shares_by_symbol[contract.symbol] = int(item.position)
            elif contract.secType == "OPT":
                option_items.append(item)

        option_contracts = [item.contract for item in option_items]
        underlying_contracts = [Stock(symbol, self.settings.ib_underlying_exchange, self.settings.ib_currency) for symbol in sorted(stock_shares_by_symbol)]
        qualified_underlyings = self._qualify_in_batches(ib, underlying_contracts)
        quotes_by_con_id: dict[int, Any] = {}
        if option_contracts:
            for ticker in self._req_tickers_in_batches(ib, option_contracts):
                contract = ticker.contract
                con_id = getattr(contract, "conId", None)
                if con_id:
                    quotes_by_con_id[int(con_id)] = ticker
        for ticker in self._req_tickers_in_batches(ib, qualified_underlyings):
            con_id = getattr(ticker.contract, "conId", None)
            if con_id:
                quotes_by_con_id[int(con_id)] = ticker

        option_positions: list[OptionPosition] = []
        for item in option_items:
            contract = item.contract
            ticker = quotes_by_con_id.get(int(contract.conId))
            underlying_ticker = quotes_by_con_id.get(int(getattr(contract, "underConId", 0))) if getattr(contract, "underConId", 0) else None
            underlying_spot = _ticker_market_price(underlying_ticker)
            if not _is_valid_number(underlying_spot):
                underlying_spot = _extract_under_price(ticker)
            if not _is_valid_number(underlying_spot):
                underlying_spot = _best_underlying_from_portfolio(contract.symbol, stock_positions)
            mark = _ticker_option_mark(ticker)
            bid = _safe_float(getattr(ticker, "bid", None))
            ask = _safe_float(getattr(ticker, "ask", None))
            delta = _extract_greek(ticker, "delta")
            gamma = _extract_greek(ticker, "gamma")
            theta = _extract_greek(ticker, "theta")
            vega = _extract_greek(ticker, "vega")
            iv = _extract_greek(ticker, "impliedVol")
            avg_cost = _normalize_option_avg_cost(float(item.averageCost), float(contract.multiplier or 100), mark)
            quantity = int(item.position)
            short_or_long = "short" if quantity < 0 else "long"
            dte = max((date.fromisoformat(_normalize_expiry(contract.lastTradeDateOrContractMonth)) - date.today()).days, 0)
            moneyness = _moneyness_pct(contract.right, float(contract.strike), underlying_spot)
            distance_to_strike = _distance_to_strike_pct(contract.right, float(contract.strike), underlying_spot)
            covered_contracts = min(stock_shares_by_symbol.get(contract.symbol, 0) // 100, abs(quantity)) if contract.right == "C" and quantity < 0 else 0
            strategy_tag = _strategy_tag(contract.right, quantity, covered_contracts)
            market_status = _market_data_mode_label(self.settings.ib_market_data_type)
            option_positions.append(
                OptionPosition(
                    symbol=contract.symbol,
                    conId=int(contract.conId),
                    underlyingConId=getattr(contract, "underConId", None),
                    expiry=_normalize_expiry(contract.lastTradeDateOrContractMonth),
                    strike=round(float(contract.strike), 2),
                    right=contract.right,
                    multiplier=int(float(contract.multiplier or 100)),
                    quantity=quantity,
                    shortOrLong=short_or_long,  # type: ignore[arg-type]
                    avgCost=round(avg_cost, 4),
                    currentMid=round(_midpoint(bid, ask) or mark or 0.0, 4) if _is_valid_number(_midpoint(bid, ask) or mark) else None,
                    bid=round(bid, 4) if _is_valid_number(bid) else None,
                    ask=round(ask, 4) if _is_valid_number(ask) else None,
                    marketPrice=round(mark, 4) if _is_valid_number(mark) else None,
                    marketValue=round(float(item.marketValue), 2),
                    unrealizedPnL=round(float(item.unrealizedPNL), 2),
                    realizedPnL=round(float(item.realizedPNL), 2),
                    delta=_round_signed_or_none(delta, 4),
                    gamma=_round_signed_or_none(gamma, 4),
                    theta=_round_signed_or_none(theta, 4),
                    vega=_round_signed_or_none(vega, 4),
                    impliedVol=round(iv * 100.0, 2) if _is_valid_number(iv) else None,
                    dte=dte,
                    underlyingSpot=round(underlying_spot, 4) if _is_valid_number(underlying_spot) else None,
                    moneynessPct=round(moneyness * 100.0, 2) if _is_valid_number(moneyness) else None,
                    distanceToStrikePct=round(distance_to_strike * 100.0, 2) if _is_valid_number(distance_to_strike) else None,
                    collateralEstimate=round(float(contract.strike) * float(contract.multiplier or 100) * abs(quantity), 2)
                    if strategy_tag == "cash-secured-put"
                    else 0.0,
                    brokerMarginImpact=None,
                    assignmentRiskLevel=_assignment_risk(contract.right, quantity, dte, moneyness, delta),
                    coveredStatus=_covered_status(strategy_tag, covered_contracts, quantity),
                    coveredContracts=covered_contracts,
                    strategyTag=strategy_tag,
                    premiumEstimate=round(((_midpoint(bid, ask) or mark or 0.0) * float(contract.multiplier or 100) * abs(quantity)), 2)
                    if quantity < 0 and _is_valid_number((_midpoint(bid, ask) or mark))
                    else 0.0,
                    marketDataStatus=market_status,
                )
            )

        open_orders = self._build_open_orders(open_trades, stock_positions, option_positions)
        init_margin = _account_value(account_values, "InitMarginReq")
        maint_margin = _account_value(account_values, "MaintMarginReq")
        net_liq = _account_value(account_values, "NetLiquidation")
        available_funds = _account_value(account_values, "AvailableFunds")
        excess_liquidity = _account_value(account_values, "ExcessLiquidity")
        buying_power = _account_value(account_values, "BuyingPower")
        cash_balance = _account_value(account_values, "TotalCashValue")
        estimated_premium = sum(
            position.premiumEstimate
            for position in option_positions
            if position.shortOrLong == "short" and date.fromisoformat(position.expiry) <= date.today() + timedelta(days=7)
        )
        committed_capital = sum(order.estimatedCapitalImpact for order in open_orders if order.openingOrClosing != "closing")

        base_account = AccountSnapshot(
            accountId=account_id,
            netLiquidation=round(net_liq, 2),
            availableFunds=round(available_funds, 2),
            excessLiquidity=round(excess_liquidity, 2),
            buyingPower=round(buying_power, 2),
            initMarginReq=round(init_margin, 2),
            maintMarginReq=round(maint_margin, 2),
            cashBalance=round(cash_balance, 2),
            marginUsagePct=round((init_margin / net_liq) * 100.0, 2) if net_liq > 0 else 0.0,
            optionPositionsCount=len(option_positions),
            openOrdersCount=len(open_orders),
            estimatedPremiumExpiringThisWeek=round(estimated_premium, 2),
            estimatedCommittedCapital=round(committed_capital, 2),
            estimatedFreeOptionSellingCapacity=0.0,
            generatedAt=generated_at,
            isStale=False,
        )
        collateral = build_collateral_summary(
            PortfolioSnapshot(
                account=base_account,
                positions=stock_positions,
                option_positions=option_positions,
                open_orders=open_orders,
                generated_at=generated_at,
                is_stale=False,
            ),
            self.settings.safety_buffer,
        )
        base_account.estimatedFreeOptionSellingCapacity = collateral.estimatedFreeOptionSellingCapacity
        return PortfolioSnapshot(
            account=base_account,
            positions=stock_positions,
            option_positions=sorted(option_positions, key=lambda item: (item.expiry, item.symbol, item.right, item.strike)),
            open_orders=open_orders,
            generated_at=generated_at,
            is_stale=False,
        )

    def _fetch_underlying_quote(self, ib: Any, symbol: str) -> UnderlyingQuote:
        self._ensure_connected(ib)
        contract = Stock(symbol, self.settings.ib_underlying_exchange, self.settings.ib_currency)
        qualified = self._qualify_one(ib, contract)
        ticker, resolved_market_data_type = self._request_underlying_ticker(ib, qualified)
        generated_at = datetime.now(UTC)
        price = _ticker_market_price(ticker)
        if not _is_valid_number(price):
            price = _latest_underlying_price(ib, qualified) or 0.0
        return UnderlyingQuote(
            symbol=symbol,
            price=round(price, 4),
            bid=round(_safe_float(getattr(ticker, "bid", None)), 4) if _is_valid_number(_safe_float(getattr(ticker, "bid", None))) else None,
            ask=round(_safe_float(getattr(ticker, "ask", None)), 4) if _is_valid_number(_safe_float(getattr(ticker, "ask", None))) else None,
            last=round(_safe_float(getattr(ticker, "last", None)), 4) if _is_valid_number(_safe_float(getattr(ticker, "last", None))) else None,
            close=round(_safe_float(getattr(ticker, "close", None)), 4) if _is_valid_number(_safe_float(getattr(ticker, "close", None))) else None,
            marketDataStatus=_market_data_mode_label(resolved_market_data_type),
            generatedAt=generated_at,
        )

    def _fetch_option_chain(self, ib: Any, symbol: str, expiry: str | None) -> OptionChainResponse:
        self._ensure_connected(ib)
        generated_at = datetime.now(UTC)
        underlying_contract = self._qualify_one(ib, Stock(symbol, self.settings.ib_underlying_exchange, self.settings.ib_currency))
        underlying_ticker, resolved_market_data_type = self._request_underlying_ticker(ib, underlying_contract)
        underlying_price = _ticker_market_price(underlying_ticker)
        if not _is_valid_number(underlying_price):
            underlying_price = _latest_underlying_price(ib, underlying_contract) or 0.0
        if not _is_valid_number(underlying_price):
            market_data_issue = self._latest_market_data_issue()
            if market_data_issue:
                raise RuntimeError(
                    f"No market or recent historical price returned for {symbol}. {market_data_issue}"
                )
            raise RuntimeError(
                f"No market or recent historical price returned for {symbol}. Check the symbol and market data permissions in IB Gateway."
            )

        definitions = ib.reqSecDefOptParams(symbol, "", underlying_contract.secType, underlying_contract.conId)
        if not definitions:
            raise RuntimeError(f"IB Gateway returned no option definitions for {symbol}.")
        definition = _select_definition(definitions, self.settings.ib_option_exchange, symbol)
        expiries = _select_expiries(
            definition.expirations,
            min_days=0,
            max_days=120,
            limit=self.settings.chain_expiry_limit,
        )
        selected_expiry = expiry if expiry in expiries else expiries[0]
        strikes = _select_strikes(
            definition.strikes,
            underlying_price,
            moneyness_pct=self.settings.chain_moneyness_pct,
            limit=self.settings.chain_strike_limit,
        )
        contracts: list[Any] = []
        for strike in strikes:
            contracts.append(
                Option(
                    symbol,
                    selected_expiry.replace("-", ""),
                    float(strike),
                    "C",
                    self.settings.ib_option_exchange,
                    currency=self.settings.ib_currency,
                    tradingClass=definition.tradingClass,
                )
            )
            contracts.append(
                Option(
                    symbol,
                    selected_expiry.replace("-", ""),
                    float(strike),
                    "P",
                    self.settings.ib_option_exchange,
                    currency=self.settings.ib_currency,
                    tradingClass=definition.tradingClass,
                )
            )
        qualified_contracts = self._qualify_in_batches(ib, contracts)
        contracts_by_strike: dict[float, dict[str, Any]] = {}
        for contract in qualified_contracts:
            contracts_by_strike.setdefault(float(contract.strike), {})[contract.right] = contract
        if not qualified_contracts:
            raise RuntimeError(f"No option contracts qualified for {symbol} {selected_expiry}.")
        tickers, resolved_market_data_type = self._request_option_tickers(ib, qualified_contracts, resolved_market_data_type)
        market_data_issue = self._latest_market_data_issue()
        quote_source = "streaming" if any(_ticker_has_live_option_quote(ticker) for ticker in tickers) else "unavailable"
        quote_as_of: datetime | None = None
        historical_midpoints: dict[int, float] = {}
        if quote_source == "unavailable":
            fallback_contracts = _select_historical_fallback_contracts(
                qualified_contracts,
                underlying_price,
                self.settings.chain_historical_fallback_contract_limit,
            )
            historical_midpoints, quote_as_of = self._fetch_recent_option_midpoints(ib, fallback_contracts)
            if historical_midpoints:
                quote_source = "historical"
        by_strike: dict[float, dict[str, Any]] = {}
        for ticker in tickers:
            contract = ticker.contract
            by_strike.setdefault(float(contract.strike), {})[contract.right] = ticker
        rows: list[ChainRow] = []
        dte = max((date.fromisoformat(selected_expiry) - date.today()).days, 1)
        for strike in sorted(contracts_by_strike):
            strike_tickers = by_strike.get(strike, {})
            call_ticker = strike_tickers.get("C")
            put_ticker = strike_tickers.get("P")
            call_contract = contracts_by_strike[strike].get("C")
            put_contract = contracts_by_strike[strike].get("P")
            call_historical_mid = historical_midpoints.get(int(call_contract.conId)) if call_contract is not None else None
            put_historical_mid = historical_midpoints.get(int(put_contract.conId)) if put_contract is not None else None
            call_mid = (
                _midpoint(_safe_float(getattr(call_ticker, "bid", None)), _safe_float(getattr(call_ticker, "ask", None)))
                or _ticker_option_mark(call_ticker)
                or call_historical_mid
            )
            put_mid = (
                _midpoint(_safe_float(getattr(put_ticker, "bid", None)), _safe_float(getattr(put_ticker, "ask", None)))
                or _ticker_option_mark(put_ticker)
                or put_historical_mid
            )
            call_iv = _extract_greek(call_ticker, "impliedVol", percent=True)
            call_delta = _extract_greek(call_ticker, "delta")
            call_gamma = _extract_greek(call_ticker, "gamma")
            call_theta = _extract_greek(call_ticker, "theta")
            call_vega = _extract_greek(call_ticker, "vega")
            call_rho = _extract_greek(call_ticker, "rho")
            put_iv = _extract_greek(put_ticker, "impliedVol", percent=True)
            put_delta = _extract_greek(put_ticker, "delta")
            put_gamma = _extract_greek(put_ticker, "gamma")
            put_theta = _extract_greek(put_ticker, "theta")
            put_vega = _extract_greek(put_ticker, "vega")
            put_rho = _extract_greek(put_ticker, "rho")
            rows.append(
                ChainRow(
                    strike=round(strike, 2),
                    distanceFromSpotPct=round((strike - underlying_price) / underlying_price * 100.0, 2),
                    callBid=_round_or_none(_safe_float(getattr(call_ticker, "bid", None)), 4),
                    callAsk=_round_or_none(_safe_float(getattr(call_ticker, "ask", None)), 4),
                    callMid=_round_or_none(call_mid, 4),
                    callVolume=_extract_option_volume(call_ticker, "C"),
                    callOpenInterest=_extract_option_open_interest(call_ticker, "C"),
                    callIV=_round_or_none(call_iv, 2),
                    callDelta=_round_signed_or_none(call_delta, 4),
                    callGamma=_round_signed_or_none(call_gamma, 4),
                    callTheta=_round_signed_or_none(call_theta, 4),
                    callVega=_round_signed_or_none(call_vega, 4),
                    callRho=_round_signed_or_none(call_rho, 4),
                    callAnnualizedYieldPct=_round_or_none(_annualized_yield(call_mid, underlying_price, dte), 2),
                    putBid=_round_or_none(_safe_float(getattr(put_ticker, "bid", None)), 4),
                    putAsk=_round_or_none(_safe_float(getattr(put_ticker, "ask", None)), 4),
                    putMid=_round_or_none(put_mid, 4),
                    putVolume=_extract_option_volume(put_ticker, "P"),
                    putOpenInterest=_extract_option_open_interest(put_ticker, "P"),
                    putIV=_round_or_none(put_iv, 2),
                    putDelta=_round_signed_or_none(put_delta, 4),
                    putGamma=_round_signed_or_none(put_gamma, 4),
                    putTheta=_round_signed_or_none(put_theta, 4),
                    putVega=_round_signed_or_none(put_vega, 4),
                    putRho=_round_signed_or_none(put_rho, 4),
                    putAnnualizedYieldPct=_round_or_none(_annualized_yield(put_mid, strike, dte), 2),
                    conservativePutCollateral=round(strike * 100.0, 2),
                )
            )
        underlying = UnderlyingQuote(
            symbol=symbol,
            price=round(underlying_price, 4),
            bid=_round_or_none(_safe_float(getattr(underlying_ticker, "bid", None)), 4),
            ask=_round_or_none(_safe_float(getattr(underlying_ticker, "ask", None)), 4),
            last=_round_or_none(_safe_float(getattr(underlying_ticker, "last", None)), 4),
            close=_round_or_none(_safe_float(getattr(underlying_ticker, "close", None)), 4),
            marketDataStatus=_market_data_mode_label(resolved_market_data_type),
            generatedAt=generated_at,
        )
        return OptionChainResponse(
            symbol=symbol,
            selectedExpiry=selected_expiry,
            expiries=expiries,
            underlying=underlying,
            rows=rows,
            highlights=_chain_highlights(rows, selected_expiry),
            quoteSource=quote_source,  # type: ignore[arg-type]
            quoteAsOf=quote_as_of,
            quoteNotice=_quote_notice(quote_source, quote_as_of, market_data_issue),
            generatedAt=generated_at,
            isStale=False,
        )

    def _resolve_order_contract(self, ib: Any, request: OptionOrderRequest) -> tuple[Any, float | None]:
        underlying_contract = self._qualify_one(ib, Stock(request.symbol, self.settings.ib_underlying_exchange, self.settings.ib_currency))
        definitions = ib.reqSecDefOptParams(request.symbol, "", underlying_contract.secType, underlying_contract.conId)
        if not definitions:
            raise RuntimeError(f"IB Gateway returned no option definitions for {request.symbol}.")
        definition = _select_definition(definitions, self.settings.ib_option_exchange, request.symbol)
        contract = self._qualify_one(
            ib,
            Option(
                request.symbol,
                request.expiry.replace("-", ""),
                float(request.strike),
                request.right,
                self.settings.ib_option_exchange,
                currency=self.settings.ib_currency,
                tradingClass=definition.tradingClass,
            ),
        )
        return contract, self._request_option_reference_price(ib, contract)

    def _request_option_reference_price(self, ib: Any, contract: Any) -> float | None:
        for market_data_type in _market_data_type_candidates(self.settings.ib_market_data_type):
            ticker = self._req_market_data_snapshot(ib, contract, market_data_type, generic_tick_list=OPTION_GENERIC_TICKS)
            mark = _ticker_option_mark(ticker)
            if _is_valid_number(mark):
                return round(float(mark), 4)
        midpoint, _ = _latest_option_midpoint(ib, contract)
        if _is_valid_number(midpoint):
            return round(float(midpoint), 4)
        return None

    def _position_maps_for_account(
        self,
        ib: Any,
        account_id: str,
    ) -> tuple[dict[str, float], dict[tuple[str, str, str, float], int]]:
        stock_qty: dict[str, float] = {}
        option_qty: dict[tuple[str, str, str, float], int] = {}
        for item in ib.portfolio(account_id):
            contract = item.contract
            quantity = float(item.position)
            if contract.secType in {"STK", "ETF"}:
                stock_qty[contract.symbol] = quantity
            elif contract.secType == "OPT":
                key = (
                    contract.symbol,
                    contract.right,
                    _normalize_expiry(contract.lastTradeDateOrContractMonth),
                    round(float(contract.strike), 2),
                )
                option_qty[key] = int(quantity)
        return stock_qty, option_qty

    def _build_ib_order(self, request: OptionOrderRequest, account_id: str) -> Any:
        order_kwargs = {
            "account": account_id,
            "tif": request.tif,
            "orderRef": request.orderRef or self._default_order_ref(request, account_id),
            "transmit": True,
        }
        if request.orderType == "MKT":
            return MarketOrder(request.action, request.quantity, **order_kwargs)
        return LimitOrder(request.action, request.quantity, float(request.limitPrice or 0.0), **order_kwargs)

    def _default_order_ref(self, request: OptionOrderRequest, account_id: str) -> str:
        return (
            f"options-dashboard:paper:{account_id}:{request.symbol}:"
            f"{request.expiry}:{request.right}:{request.strike:.2f}:{request.action}:{request.quantity}"
        )

    def _build_option_order_preview(
        self,
        request: OptionOrderRequest,
        account_id: str,
        contract: Any,
        order_state: Any,
        market_reference_price: float | None,
        opening_or_closing: str,
    ) -> OptionOrderPreview:
        estimated_gross_premium = None
        if request.orderType == "LMT" and request.limitPrice is not None:
            signed = 1.0 if request.action == "SELL" else -1.0
            estimated_gross_premium = round(float(request.limitPrice) * 100.0 * request.quantity * signed, 2)
        conservative_cash_impact = _conservative_cash_impact(request, opening_or_closing)
        note = _option_order_note(request, opening_or_closing, contract)
        warning_text = _string_or_none(getattr(order_state, "warningText", None))
        return OptionOrderPreview(
            accountId=account_id,
            symbol=request.symbol,
            expiry=request.expiry,
            strike=round(float(contract.strike), 2),
            right=request.right,
            action=request.action,
            quantity=request.quantity,
            orderType=request.orderType,
            limitPrice=request.limitPrice,
            tif=request.tif,
            orderRef=request.orderRef or self._default_order_ref(request, account_id),
            openingOrClosing=opening_or_closing,  # type: ignore[arg-type]
            marketReferencePrice=market_reference_price,
            estimatedGrossPremium=estimated_gross_premium,
            conservativeCashImpact=conservative_cash_impact,
            brokerInitialMarginChange=_optional_float(getattr(order_state, "initMarginChange", None)),
            brokerMaintenanceMarginChange=_optional_float(getattr(order_state, "maintMarginChange", None)),
            commissionEstimate=_optional_float(getattr(order_state, "commission", None)),
            warningText=warning_text,
            note=note,
            generatedAt=datetime.now(UTC),
        )

    def _ensure_execution_allowed(self, account_id: str) -> None:
        if self.settings.execution_mode != "enabled":
            raise RuntimeError("Trade execution is disabled for this dashboard session.")

    def _clear_portfolio_cache(self, account_id: str) -> None:
        resolved = account_id.strip().upper()
        stale_keys = [key for key in self._portfolio_cache if key == resolved or key == "__default__"]
        if self._resolved_account_id:
            stale_keys.append(self._resolved_account_id.strip().upper())
        for key in set(stale_keys):
            self._portfolio_cache.pop(key, None)

    def _find_open_trade(self, ib: Any, account_id: str, order_id: int) -> Any | None:
        for trade in ib.openTrades():
            trade_order_id = _optional_int(getattr(trade.order, "orderId", None))
            trade_account = _string_or_none(getattr(trade.order, "account", None)) or account_id
            if trade_order_id == order_id and trade_account.upper() == account_id:
                return trade
        return None

    def _await_trade_ack(self, ib: Any, trade: Any) -> tuple[Any, str | None]:
        deadline = time.monotonic() + self.settings.ib_order_ack_timeout_seconds
        message = _latest_trade_message(trade)
        while time.monotonic() < deadline:
            ib.sleep(0.2)
            status = str(getattr(trade.orderStatus, "status", "") or "")
            message = _latest_trade_message(trade) or message
            if status in {"PreSubmitted", "Submitted", "Filled", "Cancelled", "ApiCancelled", "Inactive", "PendingCancel"}:
                break
            if _optional_int(getattr(trade.orderStatus, "permId", None)):
                break
        return trade.orderStatus, message

    def _build_open_orders(
        self,
        open_trades: list[Any],
        stock_positions: list[Position],
        option_positions: list[OptionPosition],
    ) -> list[OpenOrderExposure]:
        stock_qty = {position.symbol: position.quantity for position in stock_positions}
        option_qty = {(position.symbol, position.right, position.expiry, position.strike): position.quantity for position in option_positions}
        orders: list[OpenOrderExposure] = []
        for trade in open_trades:
            order = trade.order
            contract = trade.contract
            order_status = trade.orderStatus
            side = str(order.action).upper()
            quantity = float(order.totalQuantity or 0.0)
            limit_price = _safe_float(getattr(order, "lmtPrice", None))
            status = str(getattr(order_status, "status", "") or "Submitted")
            filled_quantity = float(getattr(order_status, "filled", 0.0) or 0.0)
            remaining_quantity = float(getattr(order_status, "remaining", quantity) or 0.0)
            opening_or_closing = _order_open_or_close(contract, side, quantity, stock_qty, option_qty)
            strategy_tag = _strategy_tag(contract.right, -1 if side == "SELL" else 1, 0) if contract.secType == "OPT" else "stock"
            estimated_credit = 0.0
            estimated_capital = 0.0
            note = None
            if contract.secType == "OPT":
                multiplier = float(contract.multiplier or 100)
                strike = float(contract.strike)
                if side == "SELL" and contract.right == "P" and opening_or_closing == "opening":
                    estimated_capital = strike * multiplier * quantity
                    estimated_credit = max(limit_price or 0.0, 0.0) * multiplier * quantity
                    note = "Conservative cash-secured reserve."
                elif side == "BUY" and opening_or_closing == "closing":
                    estimated_capital = max(limit_price or 0.0, 0.0) * multiplier * quantity
                    note = "Closing premium outlay."
                else:
                    estimated_capital = max(limit_price or 0.0, 0.0) * multiplier * quantity
            else:
                estimated_capital = max(limit_price or 0.0, 0.0) * quantity
                if side == "SELL" and opening_or_closing == "closing":
                    note = "Potential stock reduction."
            orders.append(
                OpenOrderExposure(
                    orderId=int(order.orderId),
                    status=status,
                    symbol=contract.symbol,
                    secType=contract.secType,
                    orderType=str(order.orderType),
                    side=side,
                    quantity=quantity,
                    filledQuantity=round(filled_quantity, 4),
                    remainingQuantity=round(remaining_quantity, 4),
                    limitPrice=round(limit_price, 4) if _is_valid_number(limit_price) else None,
                    estimatedCapitalImpact=round(estimated_capital, 2),
                    estimatedCredit=round(estimated_credit, 2),
                    openingOrClosing=opening_or_closing,
                    expiry=_normalize_expiry(contract.lastTradeDateOrContractMonth) if contract.secType == "OPT" else None,
                    strike=round(float(contract.strike), 2) if contract.secType == "OPT" else None,
                    right=contract.right if contract.secType == "OPT" else None,
                    strategyTag=strategy_tag,  # type: ignore[arg-type]
                    note=note,
                )
            )
        orders.sort(key=lambda order: (order.symbol, order.orderId))
        return orders

    def _qualify_one(self, ib: Any, contract: Any) -> Any:
        qualified = self._qualify_in_batches(ib, [contract])
        if not qualified:
            raise RuntimeError(f"Unable to qualify contract for {getattr(contract, 'symbol', 'unknown')}.")
        return qualified[0]

    def _qualify_in_batches(self, ib: Any, contracts: list[Any]) -> list[Any]:
        qualified: list[Any] = []
        for batch in _batched(contracts, 30):
            result = ib.qualifyContracts(*batch)
            qualified.extend(result)
        return qualified

    def _request_underlying_ticker(self, ib: Any, contract: Any) -> tuple[Any, int]:
        last_ticker: Any | None = None
        last_market_data_type = self.settings.ib_market_data_type
        for market_data_type in _market_data_type_candidates(self.settings.ib_market_data_type):
            ticker = self._req_ticker_snapshot(ib, contract, market_data_type) or self._req_market_data_snapshot(ib, contract, market_data_type)
            last_ticker = ticker
            last_market_data_type = market_data_type
            if _is_valid_number(_ticker_market_price(ticker)):
                return ticker, market_data_type
            market_data_issue = self._latest_market_data_issue()
            if _is_hard_market_data_blocker(market_data_issue):
                break
        if last_ticker is not None:
            return last_ticker, last_market_data_type
        market_data_issue = self._latest_market_data_issue()
        if market_data_issue:
            raise RuntimeError(f"No market data returned for {contract.symbol}. {market_data_issue}")
        raise RuntimeError(f"No market data returned for {contract.symbol}. Check the symbol and market data permissions in IB Gateway.")

    def _req_ticker_snapshot(self, ib: Any, contract: Any, market_data_type: int) -> Any | None:
        ib.reqMarketDataType(market_data_type)
        try:
            tickers = ib.reqTickers(contract)
        except Exception:
            return None
        if not tickers:
            return None
        return tickers[0]

    def _request_option_tickers(self, ib: Any, contracts: list[Any], preferred_market_data_type: int) -> tuple[list[Any], int]:
        best_tickers: list[Any] = []
        best_market_data_type = preferred_market_data_type
        best_score = -1
        minimum_useful_payloads = max(4, min(len(contracts), 10))
        for market_data_type in _option_market_data_type_candidates(preferred_market_data_type):
            tickers = self._req_market_data_in_batches(
                ib,
                contracts,
                market_data_type,
                generic_tick_list=OPTION_GENERIC_TICKS,
            )
            payload_count = sum(1 for ticker in tickers if _ticker_has_option_payload(ticker))
            score = sum(_ticker_option_payload_score(ticker) for ticker in tickers)
            if score > best_score:
                best_tickers = tickers
                best_market_data_type = market_data_type
                best_score = score
            if payload_count >= minimum_useful_payloads:
                break
            market_data_issue = self._latest_market_data_issue()
            if _is_hard_market_data_blocker(market_data_issue):
                break
        return best_tickers, best_market_data_type

    def _req_market_data_snapshot(self, ib: Any, contract: Any, market_data_type: int, generic_tick_list: str = "") -> Any:
        ib.reqMarketDataType(market_data_type)
        ticker = ib.reqMktData(contract, generic_tick_list, False, False)
        try:
            deadline = time.monotonic() + min(max(self.settings.ib_request_timeout_seconds / 4.0, 1.5), 4.0)
            while time.monotonic() < deadline:
                ib.sleep(0.2)
                if _ticker_has_quote_payload(ticker):
                    break
            return ticker
        finally:
            try:
                ib.cancelMktData(contract)
            except Exception:
                pass

    def _req_market_data_in_batches(
        self,
        ib: Any,
        contracts: list[Any],
        market_data_type: int,
        generic_tick_list: str = "",
    ) -> list[Any]:
        tickers: list[Any] = []
        for batch in _batched(contracts, self.settings.chain_batch_size):
            ib.reqMarketDataType(market_data_type)
            batch_tickers = [ib.reqMktData(contract, generic_tick_list, False, False) for contract in batch]
            deadline = time.monotonic() + min(max(self.settings.ib_request_timeout_seconds / 18.0, 0.4), 0.8)
            while time.monotonic() < deadline:
                ib.sleep(0.2)
                if all(_ticker_has_quote_payload(ticker) for ticker in batch_tickers):
                    break
            tickers.extend(batch_tickers)
            for contract in batch:
                try:
                    ib.cancelMktData(contract)
                except Exception:
                    pass
        return tickers

    def _fetch_recent_option_midpoints(self, ib: Any, contracts: list[Any]) -> tuple[dict[int, float], datetime | None]:
        historical_midpoints: dict[int, float] = {}
        latest_bar_at: datetime | None = None
        for contract in contracts:
            midpoint, bar_at = _latest_option_midpoint(ib, contract)
            con_id = getattr(contract, "conId", None)
            if con_id and _is_valid_number(midpoint):
                historical_midpoints[int(con_id)] = round(float(midpoint), 4)
            if bar_at is not None and (latest_bar_at is None or bar_at > latest_bar_at):
                latest_bar_at = bar_at
        return historical_midpoints, latest_bar_at

    def _req_tickers_in_batches(self, ib: Any, contracts: list[Any]) -> list[Any]:
        tickers: list[Any] = []
        for batch in _batched(contracts, self.settings.chain_batch_size):
            tickers.extend(ib.reqTickers(*batch))
        return tickers

    def _ensure_connected(self, ib: Any) -> None:
        if not ib.isConnected():
            self._connect_on_thread(ib, force=False)
        if not ib.isConnected():
            raise RuntimeError(
                f"Unable to connect to IB Gateway at {self.settings.ib_host}:{self.settings.ib_port}. Verify the gateway is running and socket API access is enabled."
            )

    def _resolve_account_id(self, ib: Any, requested_account_id: str | None = None) -> str:
        if requested_account_id:
            normalized = requested_account_id.strip().upper()
            accounts = self._load_managed_accounts(ib)
            if accounts and normalized not in accounts:
                raise RuntimeError(f"Account {normalized} is not available in the current IB Gateway session.")
            return normalized
        if self.settings.ib_account_id:
            return self.settings.ib_account_id
        accounts = self._load_managed_accounts(ib)
        if not accounts:
            raise RuntimeError("IB Gateway returned no managed accounts. Check your gateway session and account permissions.")
        return accounts[0]

    def _load_managed_accounts(self, ib: Any) -> list[str]:
        accounts = list(ib.managedAccounts())
        normalized = [str(account).strip().upper() for account in accounts if str(account).strip()]
        self._remember_managed_accounts(normalized)
        return normalized

    def _portfolio_cache_key(self, account_id: str | None) -> str:
        return (account_id or self._resolved_account_id or self.settings.ib_account_id or "__default__").strip().upper()

    def _remember_account_id(self, account_id: str | None) -> None:
        if not account_id:
            return
        with self._status_lock:
            self._resolved_account_id = account_id

    def _remember_managed_accounts(self, accounts: list[str]) -> None:
        normalized = [account.strip().upper() for account in accounts if account.strip()]
        with self._status_lock:
            self._managed_accounts = normalized

    def _mark_connected(self, port: int | None = None) -> None:
        now = datetime.now(UTC)
        with self._status_lock:
            self._connected = True
            if port is not None:
                self._resolved_port = port
            self._last_successful_connect_at = now
            self._last_heartbeat_at = now
            self._last_error = None
            self._next_reconnect_attempt_at = None

    def _mark_disconnected(self, error: str | None) -> None:
        with self._status_lock:
            self._connected = False
            self._last_error = error
            self._next_reconnect_attempt_at = datetime.now(UTC) + timedelta(seconds=self.settings.ib_reconnect_interval_seconds)

    def _mark_error(self, error: str) -> None:
        self._mark_disconnected(error)

    def _mark_heartbeat(self) -> None:
        with self._status_lock:
            self._last_heartbeat_at = datetime.now(UTC)


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
    candidates = [preferred_type, 3, 4]
    deduped: list[int] = []
    for candidate in candidates:
        if candidate not in deduped:
            deduped.append(candidate)
    return deduped


def _option_market_data_type_candidates(preferred_type: int) -> list[int]:
    candidates = [preferred_type, 3]
    deduped: list[int] = []
    for candidate in candidates:
        if candidate not in deduped:
            deduped.append(candidate)
    return deduped


def _extract_greek(ticker: Any, field_name: str, percent: bool = False) -> float | None:
    if ticker is None:
        return None
    for attr_name in ("modelGreeks", "lastGreeks", "bidGreeks", "askGreeks"):
        greeks = getattr(ticker, attr_name, None)
        if greeks is None:
            continue
        value = getattr(greeks, field_name, None)
        value_float = _safe_float(value)
        if _is_valid_number(value_float):
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
        if _is_valid_number(value):
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
        _is_valid_number(_extract_greek(ticker, field_name))
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
    if any(_is_valid_number(_extract_greek(ticker, field_name)) for field_name in ("delta", "theta", "impliedVol")):
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


def _approximate_option_greeks(
    premium: float,
    spot: float,
    strike: float,
    dte: int,
    right: str,
    risk_free_rate: float = 0.045,
) -> dict[str, float | None]:
    if not _is_valid_number(premium) or not _is_valid_number(spot) or not _is_valid_number(strike):
        return {"impliedVolPct": None, "delta": None, "gamma": None, "theta": None, "vega": None, "rho": None}
    years = max(dte / 365.0, 1.0 / 365.0)
    intrinsic_value = max(spot - strike, 0.0) if right == "C" else max(strike - spot, 0.0)
    target_price = max(float(premium), intrinsic_value)
    sigma = _implied_volatility_from_price(target_price, spot, strike, years, right, risk_free_rate)
    if sigma is None:
        return {"impliedVolPct": None, "delta": None, "gamma": None, "theta": None, "vega": None, "rho": None}
    _, delta, gamma, theta, vega, rho = _black_scholes_metrics(spot, strike, years, sigma, right, risk_free_rate)
    return {
        "impliedVolPct": sigma * 100.0,
        "delta": delta,
        "gamma": gamma,
        "theta": theta,
        "vega": vega,
        "rho": rho,
    }


def _implied_volatility_from_price(
    option_price: float,
    spot: float,
    strike: float,
    years: float,
    right: str,
    risk_free_rate: float,
) -> float | None:
    lower = 0.0001
    upper = 6.0
    lower_price, _, _, _, _, _ = _black_scholes_metrics(spot, strike, years, lower, right, risk_free_rate)
    upper_price, _, _, _, _, _ = _black_scholes_metrics(spot, strike, years, upper, right, risk_free_rate)
    if option_price < lower_price - 1e-4 or option_price > upper_price + 1e-4:
        return None
    for _ in range(60):
        midpoint = (lower + upper) / 2.0
        midpoint_price, _, _, _, _, _ = _black_scholes_metrics(spot, strike, years, midpoint, right, risk_free_rate)
        if abs(midpoint_price - option_price) <= 1e-4:
            return midpoint
        if midpoint_price > option_price:
            upper = midpoint
        else:
            lower = midpoint
    return (lower + upper) / 2.0


def _black_scholes_metrics(
    spot: float,
    strike: float,
    years: float,
    sigma: float,
    right: str,
    risk_free_rate: float,
) -> tuple[float, float, float, float, float, float]:
    sqrt_t = sqrt(max(years, 1e-9))
    sigma = max(sigma, 1e-9)
    d1 = (log(spot / strike) + (risk_free_rate + 0.5 * sigma * sigma) * years) / (sigma * sqrt_t)
    d2 = d1 - sigma * sqrt_t
    discount = exp(-risk_free_rate * years)
    pdf_d1 = _normal_pdf(d1)
    gamma = pdf_d1 / (spot * sigma * sqrt_t)
    vega = spot * pdf_d1 * sqrt_t / 100.0
    if right == "C":
        price = spot * _normal_cdf(d1) - strike * discount * _normal_cdf(d2)
        delta = _normal_cdf(d1)
        theta_annual = (-(spot * pdf_d1 * sigma) / (2.0 * sqrt_t)) - (risk_free_rate * strike * discount * _normal_cdf(d2))
        rho = strike * years * discount * _normal_cdf(d2) / 100.0
    else:
        price = strike * discount * _normal_cdf(-d2) - spot * _normal_cdf(-d1)
        delta = _normal_cdf(d1) - 1.0
        theta_annual = (-(spot * pdf_d1 * sigma) / (2.0 * sqrt_t)) + (risk_free_rate * strike * discount * _normal_cdf(-d2))
        rho = -(strike * years * discount * _normal_cdf(-d2)) / 100.0
    return price, delta, gamma, theta_annual / 365.0, vega, rho


def _normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + erf(value / sqrt(2.0)))


def _normal_pdf(value: float) -> float:
    return exp(-0.5 * value * value) / sqrt(2.0 * pi)


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
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result


def _is_valid_number(value: float | None) -> bool:
    return value is not None and isfinite(value) and value > 0


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


def _strategy_tag(right: str, quantity: int, covered_contracts: int) -> str:
    if right == "C" and quantity < 0:
        return "covered-call" if covered_contracts >= abs(quantity) else "short-option"
    if right == "P" and quantity < 0:
        return "cash-secured-put"
    if quantity > 0:
        return "long-option"
    return "other"


def _order_open_or_close(
    contract: Any,
    side: str,
    quantity: float,
    stock_qty: dict[str, float],
    option_qty: dict[tuple[str, str, str, float], int],
) -> str:
    if contract.secType == "OPT":
        key = (
            contract.symbol,
            contract.right,
            _normalize_expiry(contract.lastTradeDateOrContractMonth),
            round(float(contract.strike), 2),
        )
        existing_qty = option_qty.get(key, 0)
        if side == "BUY" and existing_qty < 0:
            return "closing"
        if side == "SELL" and existing_qty > 0:
            return "closing"
        return "opening"
    existing_stock = stock_qty.get(contract.symbol, 0.0)
    if side == "SELL" and existing_stock > 0:
        return "closing"
    return "opening"


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
    lower = spot * (1.0 - moneyness_pct)
    upper = spot * (1.0 + moneyness_pct)
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


def _conservative_cash_impact(request: OptionOrderRequest, opening_or_closing: str) -> float | None:
    multiplier = 100.0 * request.quantity
    if request.action == "SELL" and request.right == "P" and opening_or_closing == "opening":
        return round(request.strike * multiplier, 2)
    if request.orderType == "LMT" and request.limitPrice is not None and request.action == "BUY":
        return round(float(request.limitPrice) * multiplier, 2)
    if request.action == "SELL" and request.right == "C" and opening_or_closing == "opening":
        return 0.0
    return None


def _option_order_note(request: OptionOrderRequest, opening_or_closing: str, contract: Any) -> str | None:
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
