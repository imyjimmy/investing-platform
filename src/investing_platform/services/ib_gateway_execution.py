"""IB Gateway order preview, submission, cancellation, and open-order shaping."""

from __future__ import annotations

import time
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Literal, cast

import pandas as pd

from investing_platform.models import *
from investing_platform.services.analytics import build_collateral_summary
from investing_platform.services.base import PortfolioSnapshot
from investing_platform.services.ib_gateway_chain_helpers import *
from investing_platform.services.ib_gateway_fundamental_helpers import *
from investing_platform.services.ib_gateway_models import *
from investing_platform.services.ib_gateway_order_helpers import *
from investing_platform.services.ib_gateway_quote_helpers import *
from investing_platform.services.ib_gateway_runtime import *
from investing_platform.services.ibkr_fundamentals import parse_ibkr_fundamental_reports


class IBGatewayExecutionMixin:
    def _preview_option_order_on_thread(self, ib: Any, request: OptionOrderRequest) -> OptionOrderPreview:
        self._ensure_connected(ib)
        account_id = self._resolve_account_id(ib, request.accountId)
        self._ensure_execution_allowed(account_id)
        resolved_order = self._resolve_order_contract(ib, request)
        stock_qty, option_qty = self._position_maps_for_account(ib, account_id)
        opening_or_closing = _request_open_or_close(request, resolved_order.legs, stock_qty, option_qty)
        order = self._build_ib_order(request, account_id)
        order_state = ib.whatIfOrder(resolved_order.contract, order)
        return self._build_option_order_preview(
            request=request,
            account_id=account_id,
            resolved_order=resolved_order,
            order_state=order_state,
            opening_or_closing=opening_or_closing,
        )

    def _fetch_option_strategy_permissions(
        self,
        ib: Any,
        account_id: str,
        symbol: str,
        expiry: str | None = None,
    ) -> OptionStrategyPermissionsResponse:
        self._ensure_connected(ib)
        resolved_account_id = self._resolve_account_id(ib, account_id)
        self._ensure_execution_allowed(resolved_account_id)
        requested_strike_limit = max(16, _normalize_chain_strike_limit(None, self.settings.chain_strike_limit))
        lower_pct, upper_pct = _normalize_chain_window(None, None, self.settings.chain_moneyness_pct)
        chain = self._fetch_option_chain(ib, symbol, expiry, requested_strike_limit, lower_pct, upper_pct, None, None)
        stock_qty, _option_qty = self._position_maps_for_account(ib, resolved_account_id)
        probes = _build_strategy_permission_probes(chain, stock_shares=int(stock_qty.get(symbol, 0)))
        permissions: list[OptionStrategyPermission] = []
        for probe in probes:
            if probe.request is None:
                permissions.append(
                    OptionStrategyPermission(
                        strategyKey=probe.strategy_key,
                        label=probe.label,
                        status="unknown",
                        permitted=None,
                        detail=probe.unavailable_detail,
                    )
                )
                continue
            request = probe.request.model_copy(update={"accountId": resolved_account_id})
            try:
                preview = self._preview_option_order_on_thread(ib, request)
            except Exception as exc:
                status, detail = _strategy_permission_from_error(str(exc))
            else:
                status, detail = _strategy_permission_from_preview(preview.warningText, preview.note)
            permissions.append(
                OptionStrategyPermission(
                    strategyKey=probe.strategy_key,
                    label=probe.label,
                    status=status,
                    permitted=True if status == "permitted" else False if status == "blocked" else None,
                    detail=detail,
                )
            )
        return OptionStrategyPermissionsResponse(
            accountId=resolved_account_id,
            symbol=chain.symbol,
            expiry=chain.selectedExpiry,
            permissions=permissions,
            source="ibkr-whatif",
            generatedAt=datetime.now(UTC),
            isStale=False,
        )

    def _submit_option_order_on_thread(self, ib: Any, request: OptionOrderRequest) -> SubmittedOrder:
        self._ensure_connected(ib)
        account_id = self._resolve_account_id(ib, request.accountId)
        self._ensure_execution_allowed(account_id)
        resolved_order = self._resolve_order_contract(ib, request)
        order = self._build_ib_order(request, account_id)
        trade = ib.placeOrder(resolved_order.contract, order)
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
            structureLabel=request.structureLabel,
            legCount=len(request.resolved_legs()),
            message=message,
            submittedAt=datetime.now(UTC),
        )

    def _preview_stock_order_on_thread(self, ib: Any, request: StockOrderRequest) -> StockOrderPreview:
        self._ensure_connected(ib)
        account_id = self._resolve_account_id(ib, request.accountId)
        self._ensure_execution_allowed(account_id)
        contract = self._qualify_one(ib, Stock(request.symbol, self.settings.ib_underlying_exchange, self.settings.ib_currency))
        stock_qty, _option_qty = self._position_maps_for_account(ib, account_id)
        opening_or_closing = _stock_request_open_or_close(request, stock_qty)
        market_reference_price = self._request_stock_reference_price(ib, contract)
        order = self._build_stock_ib_order(request, account_id)
        order_state = ib.whatIfOrder(contract, order)
        return self._build_stock_order_preview(
            request=request,
            account_id=account_id,
            market_reference_price=market_reference_price,
            order_state=order_state,
            opening_or_closing=opening_or_closing,
        )

    def _submit_stock_order_on_thread(self, ib: Any, request: StockOrderRequest) -> SubmittedOrder:
        self._ensure_connected(ib)
        account_id = self._resolve_account_id(ib, request.accountId)
        self._ensure_execution_allowed(account_id)
        contract = self._qualify_one(ib, Stock(request.symbol, self.settings.ib_underlying_exchange, self.settings.ib_currency))
        order = self._build_stock_ib_order(request, account_id)
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
            structureLabel=None,
            legCount=1,
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

    def preview_stock_order(self, request: StockOrderRequest) -> StockOrderPreview:
        try:
            return cast(
                StockOrderPreview,
                self._submit(
                    lambda ib: self._preview_stock_order_on_thread(ib, request),
                    timeout=self.settings.ib_request_timeout_seconds + 18.0,
                ),
            )
        except FutureTimeoutError as exc:
            raise BrokerUnavailableError(
                f"Timed out previewing {request.symbol} stock order. The IBKR worker is busy or the contract lookup is slow."
            ) from exc

    def submit_stock_order(self, request: StockOrderRequest) -> SubmittedOrder:
        try:
            return cast(
                SubmittedOrder,
                self._submit(
                    lambda ib: self._submit_stock_order_on_thread(ib, request),
                    timeout=self.settings.ib_request_timeout_seconds + self.settings.ib_order_ack_timeout_seconds + 18.0,
                ),
            )
        except FutureTimeoutError as exc:
            raise BrokerUnavailableError(
                f"Timed out submitting {request.symbol} stock order. The IBKR worker is busy or order routing is slow."
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

    def _resolve_order_contract(self, ib: Any, request: OptionOrderRequest) -> _ResolvedOptionOrder:
        underlying_contract = self._qualify_one(ib, Stock(request.symbol, self.settings.ib_underlying_exchange, self.settings.ib_currency))
        definitions = ib.reqSecDefOptParams(request.symbol, "", underlying_contract.secType, underlying_contract.conId)
        if not definitions:
            raise RuntimeError(f"IB Gateway returned no option definitions for {request.symbol}.")
        definition = _select_definition(definitions, self.settings.ib_option_exchange, request.symbol)
        resolved_legs = [
            self._resolve_order_leg_contract(ib, request.symbol, definition.tradingClass, leg_request)
            for leg_request in request.resolved_legs()
        ]
        if len(resolved_legs) == 1:
            resolved_leg = resolved_legs[0]
            return _ResolvedOptionOrder(
                contract=resolved_leg.contract,
                market_reference_price=resolved_leg.market_reference_price,
                legs=resolved_legs,
            )

        combo_contract = Contract(
            symbol=request.symbol,
            secType="BAG",
            exchange="SMART",
            currency=self.settings.ib_currency,
        )
        combo_contract.comboLegs = [
            ComboLeg(
                conId=int(resolved_leg.contract.conId),
                ratio=int(resolved_leg.request_leg.ratio),
                action=resolved_leg.request_leg.action,
                exchange="SMART",
            )
            for resolved_leg in resolved_legs
        ]
        return _ResolvedOptionOrder(
            contract=combo_contract,
            market_reference_price=_aggregate_leg_reference_price(resolved_legs),
            legs=resolved_legs,
        )

    def _resolve_order_leg_contract(
        self,
        ib: Any,
        symbol: str,
        trading_class: str,
        leg_request: OptionOrderLegRequest,
    ) -> _ResolvedOptionLeg:
        contract = self._qualify_one(
            ib,
            Option(
                symbol,
                leg_request.expiry.replace("-", ""),
                float(leg_request.strike),
                leg_request.right,
                self.settings.ib_option_exchange,
                currency=self.settings.ib_currency,
                tradingClass=trading_class,
            ),
        )
        return _ResolvedOptionLeg(
            request_leg=leg_request,
            contract=contract,
            market_reference_price=self._request_option_reference_price(ib, contract),
        )

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

    def _request_stock_reference_price(self, ib: Any, contract: Any) -> float | None:
        for market_data_type in _market_data_type_candidates(self.settings.ib_market_data_type):
            ticker = self._req_market_data_snapshot(ib, contract, market_data_type)
            price = _ticker_market_price(ticker)
            if _is_valid_number(price):
                return round(float(price), 4)
        latest = _latest_underlying_price(ib, contract)
        return round(float(latest), 4) if _is_valid_number(latest) else None

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
        resolved_legs = request.resolved_legs()
        if len(resolved_legs) > 1:
            strategy_tag = request.strategyTag or "other"
            return (
                f"options-dashboard:paper:{account_id}:{request.symbol}:"
                f"{strategy_tag}:{request.action}:{request.quantity}:{len(resolved_legs)}legs"
            )
        return (
            f"options-dashboard:paper:{account_id}:{request.symbol}:"
            f"{request.expiry}:{request.right}:{request.strike:.2f}:{request.action}:{request.quantity}"
        )

    def _build_stock_ib_order(self, request: StockOrderRequest, account_id: str) -> Any:
        order_kwargs = {
            "account": account_id,
            "tif": request.tif,
            "orderRef": request.orderRef or self._default_stock_order_ref(request, account_id),
            "transmit": True,
        }
        if request.orderType == "MKT":
            return MarketOrder(request.action, request.quantity, **order_kwargs)
        return LimitOrder(request.action, request.quantity, float(request.limitPrice or 0.0), **order_kwargs)

    def _default_stock_order_ref(self, request: StockOrderRequest, account_id: str) -> str:
        return f"stocks-dashboard:paper:{account_id}:{request.symbol}:stock:{request.action}:{request.quantity}"

    def _build_option_order_preview(
        self,
        request: OptionOrderRequest,
        account_id: str,
        resolved_order: _ResolvedOptionOrder,
        order_state: Any,
        opening_or_closing: str,
    ) -> OptionOrderPreview:
        estimated_gross_premium = None
        if request.orderType == "LMT" and request.limitPrice is not None:
            signed = 1.0 if request.action == "SELL" else -1.0
            estimated_gross_premium = round(float(request.limitPrice) * 100.0 * request.quantity * signed, 2)
        max_profit, max_loss = _strategy_payoff_bounds(request, opening_or_closing)
        conservative_cash_impact = _conservative_cash_impact(
            request,
            opening_or_closing,
            resolved_order.market_reference_price,
            max_loss=max_loss,
        )
        note = _option_order_note(
            request,
            opening_or_closing,
            resolved_order.contract,
            max_profit=max_profit,
            max_loss=max_loss,
        )
        warning_text = _string_or_none(getattr(order_state, "warningText", None))
        primary_leg = request.resolved_legs()[0]
        return OptionOrderPreview(
            accountId=account_id,
            symbol=request.symbol,
            expiry=request.expiry,
            strike=round(float(primary_leg.strike), 2),
            right=primary_leg.right,
            action=request.action,
            quantity=request.quantity,
            orderType=request.orderType,
            limitPrice=request.limitPrice,
            tif=request.tif,
            orderRef=request.orderRef or self._default_order_ref(request, account_id),
            openingOrClosing=opening_or_closing,  # type: ignore[arg-type]
            strategyTag=request.strategyTag,
            structureLabel=request.structureLabel,
            legs=[
                OptionOrderLegPreview(
                    expiry=leg.request_leg.expiry,
                    strike=leg.request_leg.strike,
                    right=leg.request_leg.right,
                    action=leg.request_leg.action,
                    ratio=leg.request_leg.ratio,
                    marketReferencePrice=leg.market_reference_price,
                )
                for leg in resolved_order.legs
            ],
            marketReferencePrice=resolved_order.market_reference_price,
            estimatedGrossPremium=estimated_gross_premium,
            conservativeCashImpact=conservative_cash_impact,
            brokerInitialMarginChange=_optional_float(getattr(order_state, "initMarginChange", None)),
            brokerMaintenanceMarginChange=_optional_float(getattr(order_state, "maintMarginChange", None)),
            commissionEstimate=_optional_float(getattr(order_state, "commission", None)),
            maxProfit=max_profit,
            maxLoss=max_loss,
            warningText=warning_text,
            note=note,
            generatedAt=datetime.now(UTC),
        )

    def _build_stock_order_preview(
        self,
        request: StockOrderRequest,
        account_id: str,
        market_reference_price: float | None,
        order_state: Any,
        opening_or_closing: str,
    ) -> StockOrderPreview:
        pricing_reference = request.limitPrice if request.orderType == "LMT" else market_reference_price
        estimated_gross_trade_value = None
        if pricing_reference is not None:
            signed = 1.0 if request.action == "SELL" else -1.0
            estimated_gross_trade_value = round(float(pricing_reference) * request.quantity * signed, 2)
        warning_text = _string_or_none(getattr(order_state, "warningText", None))
        return StockOrderPreview(
            accountId=account_id,
            symbol=request.symbol,
            action=request.action,
            quantity=request.quantity,
            orderType=request.orderType,
            limitPrice=request.limitPrice,
            tif=request.tif,
            orderRef=request.orderRef or self._default_stock_order_ref(request, account_id),
            openingOrClosing=opening_or_closing,  # type: ignore[arg-type]
            marketReferencePrice=market_reference_price,
            estimatedGrossTradeValue=estimated_gross_trade_value,
            conservativeCashImpact=_stock_conservative_cash_impact(request, opening_or_closing, pricing_reference),
            brokerInitialMarginChange=_optional_float(getattr(order_state, "initMarginChange", None)),
            brokerMaintenanceMarginChange=_optional_float(getattr(order_state, "maintMarginChange", None)),
            commissionEstimate=_optional_float(getattr(order_state, "commission", None)),
            warningText=warning_text,
            note=_stock_order_note(request, opening_or_closing),
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
            if contract.secType == "BAG":
                opening_or_closing = "unknown"
                strategy_tag = _strategy_tag_from_order_ref(getattr(order, "orderRef", None)) or "other"
            else:
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
            elif contract.secType == "BAG":
                estimated_capital = abs(limit_price or 0.0) * 100.0 * quantity
                if side == "SELL":
                    estimated_credit = max(limit_price or 0.0, 0.0) * 100.0 * quantity
                note = "Multi-leg combo order."
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
                    openingOrClosing=opening_or_closing,  # type: ignore[arg-type]
                    expiry=_normalize_expiry(contract.lastTradeDateOrContractMonth) if contract.secType == "OPT" else None,
                    strike=round(float(contract.strike), 2) if contract.secType == "OPT" else None,
                    right=contract.right if contract.secType == "OPT" else None,
                    strategyTag=strategy_tag,  # type: ignore[arg-type]
                    note=note,
                )
            )
        orders.sort(key=lambda order: (order.symbol, order.orderId))
        return orders

