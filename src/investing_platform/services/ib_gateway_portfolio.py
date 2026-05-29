"""IB Gateway account and portfolio snapshot loading."""

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


class IBGatewayPortfolioMixin:
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


