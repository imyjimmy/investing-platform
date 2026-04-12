"""IB Gateway integration using ib_insync and a dedicated worker thread."""

from __future__ import annotations

import asyncio
from concurrent.futures import Future
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from math import isfinite
from queue import Empty, Queue
import threading
import time
from typing import Any, Callable, Iterable, TypeVar, cast

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
        self._resolved_account_id: str | None = self.settings.ib_account_id
        self._managed_accounts: list[str] = [self.settings.ib_account_id] if self.settings.ib_account_id else []
        self._portfolio_cache: dict[str, CacheEntry[PortfolioSnapshot]] = {}
        self._quote_cache: dict[str, CacheEntry[UnderlyingQuote]] = {}
        self._chain_cache: dict[str, CacheEntry[OptionChainResponse]] = {}
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
                host=self.settings.ib_host,
                port=self.settings.ib_port,
                clientId=self.settings.ib_client_id,
                accountId=self._resolved_account_id,
                managedAccounts=self._managed_accounts,
                marketDataType=self.settings.ib_market_data_type,
                marketDataMode=_market_data_mode_label(self.settings.ib_market_data_type),
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
        try:
            chain = cast(
                OptionChainResponse,
                self._submit(lambda ib: self._fetch_option_chain(ib, symbol, expiry), timeout=self.settings.ib_request_timeout_seconds + 8.0),
            )
            self._chain_cache[cache_key] = CacheEntry(chain, datetime.now(UTC))
            return chain
        except Exception as exc:
            if cached is not None:
                return cached.value.model_copy(update={"isStale": True})
            raise BrokerUnavailableError(str(exc)) from exc

    def _preview_option_order_on_thread(self, ib: Any, request: OptionOrderRequest) -> OptionOrderPreview:
        self._ensure_connected(ib)
        account_id = self._resolve_account_id(ib, request.accountId)
        self._ensure_paper_execution_allowed(account_id)
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
        self._ensure_paper_execution_allowed(account_id)
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
        self._ensure_paper_execution_allowed(resolved_account_id)
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
        return cast(
            OptionOrderPreview,
            self._submit(
                lambda ib: self._preview_option_order_on_thread(ib, request),
                timeout=self.settings.ib_request_timeout_seconds + 4.0,
            ),
        )

    def submit_option_order(self, request: OptionOrderRequest) -> SubmittedOrder:
        return cast(
            SubmittedOrder,
            self._submit(
                lambda ib: self._submit_option_order_on_thread(ib, request),
                timeout=self.settings.ib_request_timeout_seconds + self.settings.ib_order_ack_timeout_seconds + 4.0,
            ),
        )

    def cancel_order(self, account_id: str, order_id: int) -> OrderCancelResponse:
        return cast(
            OrderCancelResponse,
            self._submit(
                lambda ib: self._cancel_order_on_thread(ib, account_id, order_id),
                timeout=self.settings.ib_request_timeout_seconds + self.settings.ib_order_ack_timeout_seconds + 3.0,
            ),
        )

    def _submit(self, callback: Callable[[Any], TaskResultT], timeout: float) -> TaskResultT:
        future: Future[Any] = Future()
        self._tasks.put(_PendingTask(callback=callback, future=future))
        return cast(TaskResultT, future.result(timeout=timeout))

    def _worker_main(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        ib = IB()
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
            self._mark_connected()
            return
        ib.connect(
            self.settings.ib_host,
            self.settings.ib_port,
            clientId=self.settings.ib_client_id,
            readonly=self.settings.execution_mode == "disabled",
            timeout=self.settings.ib_connect_timeout_seconds,
            account=self.settings.ib_account_id or "",
        )
        ib.reqMarketDataType(self.settings.ib_market_data_type)
        self._remember_account_id(self._resolve_account_id(ib))
        self._mark_connected()

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
                    delta=round(delta, 4) if _is_valid_number(delta) else None,
                    gamma=round(gamma, 4) if _is_valid_number(gamma) else None,
                    theta=round(theta, 4) if _is_valid_number(theta) else None,
                    vega=round(vega, 4) if _is_valid_number(vega) else None,
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

        definitions = ib.reqSecDefOptParams(symbol, "", underlying_contract.secType, underlying_contract.conId)
        if not definitions:
            raise RuntimeError(f"IB Gateway returned no option definitions for {symbol}.")
        definition = _select_definition(definitions, self.settings.ib_option_exchange)
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
        tickers = self._req_market_data_in_batches(ib, qualified_contracts, resolved_market_data_type)
        quote_source = "streaming" if any(_ticker_has_quote_payload(ticker) for ticker in tickers) else "unavailable"
        quote_as_of: datetime | None = None
        historical_midpoints: dict[int, float] = {}
        if quote_source == "unavailable":
            historical_midpoints, quote_as_of = self._fetch_recent_option_midpoints(ib, qualified_contracts)
            if historical_midpoints:
                quote_source = "historical"
        by_strike: dict[float, dict[str, Any]] = {}
        for ticker in tickers:
            contract = ticker.contract
            by_strike.setdefault(float(contract.strike), {})[contract.right] = ticker
        rows: list[ChainRow] = []
        dte = max((date.fromisoformat(selected_expiry) - date.today()).days, 1)
        for strike in sorted(by_strike):
            call_ticker = by_strike[strike].get("C")
            put_ticker = by_strike[strike].get("P")
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
            rows.append(
                ChainRow(
                    strike=round(strike, 2),
                    distanceFromSpotPct=round((strike - underlying_price) / underlying_price * 100.0, 2),
                    callBid=_round_or_none(_safe_float(getattr(call_ticker, "bid", None)), 4),
                    callAsk=_round_or_none(_safe_float(getattr(call_ticker, "ask", None)), 4),
                    callMid=_round_or_none(call_mid, 4),
                    callIV=_round_or_none(_extract_greek(call_ticker, "impliedVol", percent=True), 2),
                    callDelta=_round_or_none(_extract_greek(call_ticker, "delta"), 4),
                    callTheta=_round_or_none(_extract_greek(call_ticker, "theta"), 4),
                    callAnnualizedYieldPct=_round_or_none(_annualized_yield(call_mid, underlying_price, dte), 2),
                    putBid=_round_or_none(_safe_float(getattr(put_ticker, "bid", None)), 4),
                    putAsk=_round_or_none(_safe_float(getattr(put_ticker, "ask", None)), 4),
                    putMid=_round_or_none(put_mid, 4),
                    putIV=_round_or_none(_extract_greek(put_ticker, "impliedVol", percent=True), 2),
                    putDelta=_round_or_none(_extract_greek(put_ticker, "delta"), 4),
                    putTheta=_round_or_none(_extract_greek(put_ticker, "theta"), 4),
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
            quoteNotice=_quote_notice(quote_source, quote_as_of),
            generatedAt=generated_at,
            isStale=False,
        )

    def _resolve_order_contract(self, ib: Any, request: OptionOrderRequest) -> tuple[Any, float | None]:
        underlying_contract = self._qualify_one(ib, Stock(request.symbol, self.settings.ib_underlying_exchange, self.settings.ib_currency))
        definitions = ib.reqSecDefOptParams(request.symbol, "", underlying_contract.secType, underlying_contract.conId)
        if not definitions:
            raise RuntimeError(f"IB Gateway returned no option definitions for {request.symbol}.")
        definition = _select_definition(definitions, self.settings.ib_option_exchange)
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
            ticker = self._req_market_data_snapshot(ib, contract, market_data_type)
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

    def _ensure_paper_execution_allowed(self, account_id: str) -> None:
        if self.settings.execution_mode != "paper":
            raise RuntimeError("Trade execution is disabled for this dashboard session.")
        if not _is_paper_account_id(account_id):
            raise RuntimeError(f"Paper-only execution is enabled, so account {account_id} is blocked from order submission.")

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
            side = str(order.action).upper()
            quantity = float(order.totalQuantity or 0.0)
            limit_price = _safe_float(getattr(order, "lmtPrice", None))
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
                    symbol=contract.symbol,
                    secType=contract.secType,
                    orderType=str(order.orderType),
                    side=side,
                    quantity=quantity,
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
        for market_data_type in _market_data_type_candidates(self.settings.ib_market_data_type):
            ticker = self._req_market_data_snapshot(ib, contract, market_data_type)
            last_ticker = ticker
            if _is_valid_number(_ticker_market_price(ticker)):
                return ticker, market_data_type
        raise RuntimeError(
            f"No market data returned for {contract.symbol}. Check the symbol and market data permissions in IB Gateway."
        )

    def _req_market_data_snapshot(self, ib: Any, contract: Any, market_data_type: int) -> Any:
        ib.reqMarketDataType(market_data_type)
        ticker = ib.reqMktData(contract, "", False, False)
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

    def _req_market_data_in_batches(self, ib: Any, contracts: list[Any], market_data_type: int) -> list[Any]:
        tickers: list[Any] = []
        for batch in _batched(contracts, self.settings.chain_batch_size):
            ib.reqMarketDataType(market_data_type)
            batch_tickers = [ib.reqMktData(contract, "", False, False) for contract in batch]
            deadline = time.monotonic() + min(max(self.settings.ib_request_timeout_seconds / 3.0, 1.5), 4.0)
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

    def _mark_connected(self) -> None:
        now = datetime.now(UTC)
        with self._status_lock:
            self._connected = True
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


def _market_data_type_candidates(preferred_type: int) -> list[int]:
    candidates = [preferred_type, 3, 4]
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


def _select_definition(definitions: Iterable[Any], preferred_exchange: str) -> Any:
    preferred_exchange = preferred_exchange.upper()
    ordered = sorted(
        definitions,
        key=lambda definition: (
            0 if str(getattr(definition, "exchange", "")).upper() == preferred_exchange else 1,
            0 if str(getattr(definition, "exchange", "")).upper() == "SMART" else 1,
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
    eligible = [float(strike) for strike in strikes if lower <= float(strike) <= upper]
    eligible.sort(key=lambda strike: (abs(strike - spot), strike))
    unique: list[float] = []
    for strike in eligible:
        if strike not in unique:
            unique.append(strike)
        if len(unique) >= limit * 2:
            break
    unique.sort()
    return unique


def _batched(items: list[Any], size: int) -> Iterable[list[Any]]:
    for index in range(0, len(items), size):
        yield items[index : index + size]


def _round_or_none(value: float | None, precision: int) -> float | None:
    if not _is_valid_number(value):
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


def _age_seconds(timestamp: datetime) -> float:
    return (datetime.now(UTC) - timestamp).total_seconds()


def _quote_notice(quote_source: str, quote_as_of: datetime | None) -> str | None:
    if quote_source == "historical":
        timestamp = quote_as_of.astimezone().strftime("%Y-%m-%d %I:%M %p %Z") if quote_as_of is not None else "the latest completed session"
        return (
            f"Streaming option quotes are not available in this session, so the chain is showing the latest historical option midpoint data from IBKR as of {timestamp}."
        )
    if quote_source == "unavailable":
        return (
            "IB Gateway returned the real option chain structure, but the API user did not receive option quote lines for this session."
        )
    return None


def _chain_cache_ttl_seconds(response: OptionChainResponse, default_ttl_seconds: float) -> float:
    if response.quoteSource == "historical":
        return max(default_ttl_seconds, 300.0)
    return default_ttl_seconds
