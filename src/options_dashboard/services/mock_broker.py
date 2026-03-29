"""Synthetic portfolio and chain data for local development."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any

from options_dashboard.config import DashboardSettings
from options_dashboard.models import (
    AccountSnapshot,
    ChainHighlight,
    ChainRow,
    ConnectionStatus,
    OpenOrderExposure,
    OptionChainResponse,
    OptionPosition,
    Position,
    UnderlyingQuote,
)
from options_dashboard.services.analytics import build_collateral_summary
from options_dashboard.services.base import BrokerService, PortfolioSnapshot
from options_scanner.providers.mock_provider import MockOptionsChainProvider, MockPriceDataProvider


class MockBrokerService(BrokerService):
    """Local fake-data implementation shaped like a concentrated options seller account."""

    def __init__(self, settings: DashboardSettings) -> None:
        self.settings = settings
        self.price_provider = MockPriceDataProvider()
        self.options_provider = MockOptionsChainProvider()

    def connect(self, force: bool = False) -> ConnectionStatus:
        return self.connection_status()

    def reconnect(self) -> ConnectionStatus:
        return self.connection_status()

    def connection_status(self) -> ConnectionStatus:
        now = datetime.now(UTC)
        return ConnectionStatus(
            mode="mock",
            connected=True,
            status="connected",
            host="localhost",
            port=0,
            clientId=0,
            accountId="DU-MOCK",
            managedAccounts=["DU-MOCK"],
            marketDataType=4,
            marketDataMode="MOCK",
            usingMockData=True,
            lastSuccessfulConnectAt=now,
            lastHeartbeatAt=now,
            nextReconnectAttemptAt=None,
            lastError=None,
        )

    def get_portfolio_snapshot(self, account_id: str | None = None) -> PortfolioSnapshot:
        today = date.today()
        generated_at = datetime.now(UTC)
        stock_positions = self._build_stock_positions(today)
        option_positions = self._build_option_positions(today)
        open_orders = self._build_open_orders(today, option_positions, stock_positions)
        account = self._build_account_snapshot(generated_at, stock_positions, option_positions, open_orders)
        if account_id:
            account.accountId = account_id
        return PortfolioSnapshot(
            account=account,
            positions=stock_positions,
            option_positions=option_positions,
            open_orders=open_orders,
            generated_at=generated_at,
            is_stale=False,
        )

    def get_underlying_quote(self, symbol: str) -> UnderlyingQuote:
        spot = self._spot_price(symbol)
        generated_at = datetime.now(UTC)
        return UnderlyingQuote(
            symbol=symbol.upper(),
            price=round(spot, 2),
            bid=round(spot * 0.999, 2),
            ask=round(spot * 1.001, 2),
            last=round(spot, 2),
            close=round(spot * 0.997, 2),
            marketDataStatus="MOCK",
            generatedAt=generated_at,
        )

    def get_option_chain(self, symbol: str, expiry: str | None = None) -> OptionChainResponse:
        symbol = symbol.upper()
        chain_frame = self.options_provider.get_options_chain([symbol], date.today())
        chain_frame = chain_frame.sort_values(["expiration", "strike", "option_type"]).reset_index(drop=True)
        expiries = sorted(chain_frame["expiration"].astype(str).unique().tolist())
        selected_expiry = expiry if expiry in expiries else expiries[0]
        filtered = chain_frame[chain_frame["expiration"].astype(str) == selected_expiry]
        spot = float(filtered["underlying_price"].iloc[0])
        rows: list[ChainRow] = []
        for strike, strike_frame in filtered.groupby("strike", sort=True):
            call_row = strike_frame[strike_frame["option_type"] == "call"].iloc[0] if not strike_frame[strike_frame["option_type"] == "call"].empty else None
            put_row = strike_frame[strike_frame["option_type"] == "put"].iloc[0] if not strike_frame[strike_frame["option_type"] == "put"].empty else None
            rows.append(
                ChainRow(
                    strike=float(strike),
                    distanceFromSpotPct=round((float(strike) - spot) / spot * 100.0, 2),
                    callBid=_frame_value(call_row, "bid"),
                    callAsk=_frame_value(call_row, "ask"),
                    callMid=_frame_value(call_row, "mid"),
                    callIV=_frame_value(call_row, "implied_vol", multiplier=100.0),
                    callDelta=_frame_value(call_row, "delta"),
                    callTheta=-0.01 if call_row is not None else None,
                    callAnnualizedYieldPct=_yield_pct(_frame_value(call_row, "mid"), spot, int(call_row["dte"]) if call_row is not None else None),
                    putBid=_frame_value(put_row, "bid"),
                    putAsk=_frame_value(put_row, "ask"),
                    putMid=_frame_value(put_row, "mid"),
                    putIV=_frame_value(put_row, "implied_vol", multiplier=100.0),
                    putDelta=_frame_value(put_row, "delta"),
                    putTheta=-0.01 if put_row is not None else None,
                    putAnnualizedYieldPct=_yield_pct(
                        _frame_value(put_row, "mid"),
                        float(strike),
                        int(put_row["dte"]) if put_row is not None else None,
                    ),
                    conservativePutCollateral=round(float(strike) * 100.0, 2),
                )
            )
        generated_at = datetime.now(UTC)
        return OptionChainResponse(
            symbol=symbol,
            selectedExpiry=selected_expiry,
            expiries=expiries[: self.settings.chain_expiry_limit],
            underlying=UnderlyingQuote(
                symbol=symbol,
                price=round(spot, 2),
                bid=round(spot * 0.999, 2),
                ask=round(spot * 1.001, 2),
                last=round(spot, 2),
                close=round(spot * 0.996, 2),
                marketDataStatus="MOCK",
                generatedAt=generated_at,
            ),
            rows=rows,
            highlights=_mock_chain_highlights(rows, selected_expiry),
            generatedAt=generated_at,
            isStale=False,
        )

    def _build_stock_positions(self, today: date) -> list[Position]:
        allocations = [
            ("NVDA", 300, 782.15),
            ("PYPL", 200, 67.45),
            ("GLD", 100, 214.30),
            ("VOO", 60, 476.10),
            ("IREN", 500, 10.85),
        ]
        positions: list[Position] = []
        for symbol, quantity, avg_cost in allocations:
            market_price = self._spot_price(symbol, as_of=today)
            market_value = market_price * quantity
            positions.append(
                Position(
                    symbol=symbol,
                    secType="STK",
                    conId=None,
                    quantity=quantity,
                    avgCost=round(avg_cost, 2),
                    marketPrice=round(market_price, 2),
                    marketValue=round(market_value, 2),
                    unrealizedPnL=round((market_price - avg_cost) * quantity, 2),
                    realizedPnL=None,
                )
            )
        return positions

    def _build_option_positions(self, today: date) -> list[OptionPosition]:
        stock_cover = {position.symbol: int(max(position.quantity, 0) // 100) for position in self._build_stock_positions(today)}
        blueprints = [
            {"symbol": "NVDA", "right": "C", "contracts": -3, "expiry_index": 1, "target_moneyness": 0.07, "entry_multiplier": 1.18},
            {"symbol": "IREN", "right": "P", "contracts": -6, "expiry_index": 0, "target_moneyness": -0.12, "entry_multiplier": 1.22},
            {"symbol": "AXTI", "right": "P", "contracts": -8, "expiry_index": 1, "target_moneyness": -0.10, "entry_multiplier": 1.15},
            {"symbol": "PYPL", "right": "C", "contracts": -2, "expiry_index": 2, "target_moneyness": 0.09, "entry_multiplier": 1.16},
            {"symbol": "GLD", "right": "P", "contracts": -2, "expiry_index": 2, "target_moneyness": -0.07, "entry_multiplier": 1.08},
            {"symbol": "IREN", "right": "P", "contracts": 2, "expiry_index": 3, "target_moneyness": -0.20, "entry_multiplier": 0.82},
        ]

        positions: list[OptionPosition] = []
        for blueprint in blueprints:
            chain = self.options_provider.get_options_chain([blueprint["symbol"]], today)
            expiries = sorted(chain["expiration"].astype(str).unique().tolist())
            expiry = expiries[min(blueprint["expiry_index"], len(expiries) - 1)]
            subset = chain[(chain["expiration"].astype(str) == expiry) & (chain["option_type"] == ("call" if blueprint["right"] == "C" else "put"))].copy()
            spot = float(subset["underlying_price"].iloc[0])
            target_strike = spot * (1.0 + blueprint["target_moneyness"])
            subset["distance"] = (subset["strike"] - target_strike).abs()
            row = subset.sort_values("distance").iloc[0]
            quantity = int(blueprint["contracts"])
            current_mid = float(row["mid"])
            avg_cost = max(0.05, round(current_mid * blueprint["entry_multiplier"], 2))
            short_or_long = "short" if quantity < 0 else "long"
            multiplier = 100
            market_value = current_mid * multiplier * quantity
            if short_or_long == "short":
                unrealized = (avg_cost - current_mid) * multiplier * abs(quantity)
            else:
                unrealized = (current_mid - avg_cost) * multiplier * abs(quantity)
            dte = int(row["dte"])
            moneyness_pct = _moneyness_pct(blueprint["right"], float(row["strike"]), spot)
            covered_contracts = min(stock_cover.get(blueprint["symbol"], 0), abs(quantity)) if blueprint["right"] == "C" and quantity < 0 else 0
            strategy_tag = _strategy_tag(blueprint["right"], quantity, covered_contracts)
            positions.append(
                OptionPosition(
                    symbol=blueprint["symbol"],
                    conId=None,
                    underlyingConId=None,
                    expiry=expiry,
                    strike=round(float(row["strike"]), 2),
                    right=blueprint["right"],
                    multiplier=multiplier,
                    quantity=quantity,
                    shortOrLong=short_or_long,  # type: ignore[arg-type]
                    avgCost=avg_cost,
                    currentMid=round(current_mid, 2),
                    bid=round(float(row["bid"]), 2),
                    ask=round(float(row["ask"]), 2),
                    marketPrice=round(float(row["mark"]), 2),
                    marketValue=round(market_value, 2),
                    unrealizedPnL=round(unrealized, 2),
                    realizedPnL=None,
                    delta=round(float(row["delta"]), 3),
                    gamma=None,
                    theta=round(-max(0.01, current_mid / max(dte, 1) / 9.0), 3),
                    vega=None,
                    impliedVol=round(float(row["implied_vol"]) * 100.0, 2),
                    dte=dte,
                    underlyingSpot=round(spot, 2),
                    moneynessPct=round(moneyness_pct * 100.0, 2),
                    distanceToStrikePct=round(_distance_to_strike_pct(blueprint["right"], float(row["strike"]), spot) * 100.0, 2),
                    collateralEstimate=round(float(row["strike"]) * multiplier * abs(quantity), 2) if strategy_tag == "cash-secured-put" else 0.0,
                    brokerMarginImpact=round(float(row["strike"]) * multiplier * abs(quantity) * 0.32, 2)
                    if strategy_tag == "cash-secured-put"
                    else None,
                    assignmentRiskLevel=_assignment_risk(blueprint["right"], quantity, dte, moneyness_pct, float(row["delta"])),
                    coveredStatus=_covered_status(strategy_tag, covered_contracts, quantity),
                    coveredContracts=covered_contracts,
                    strategyTag=strategy_tag,
                    premiumEstimate=round(current_mid * multiplier * abs(quantity), 2) if quantity < 0 else 0.0,
                    marketDataStatus="MOCK",
                )
            )
        positions.sort(key=lambda item: (item.expiry, item.symbol, item.right, item.strike))
        return positions

    def _build_open_orders(
        self,
        today: date,
        option_positions: list[OptionPosition],
        stock_positions: list[Position],
    ) -> list[OpenOrderExposure]:
        by_symbol = {position.symbol: position for position in stock_positions}
        option_by_symbol = {(item.symbol, item.right): item for item in option_positions if item.shortOrLong == "short"}
        orders = [
            OpenOrderExposure(
                orderId=9101,
                symbol="IREN",
                secType="OPT",
                orderType="LMT",
                side="SELL",
                quantity=3,
                limitPrice=0.41,
                estimatedCapitalImpact=2_850.0,
                estimatedCredit=123.0,
                openingOrClosing="opening",
                expiry=option_by_symbol[("IREN", "P")].expiry if ("IREN", "P") in option_by_symbol else None,
                strike=9.5,
                right="P",
                strategyTag="cash-secured-put",
                note="Conservative cash-secured reserve.",
            ),
            OpenOrderExposure(
                orderId=9102,
                symbol="NVDA",
                secType="STK",
                orderType="LMT",
                side="BUY",
                quantity=100,
                limitPrice=round(by_symbol["NVDA"].marketPrice * 0.96, 2),
                estimatedCapitalImpact=round(by_symbol["NVDA"].marketPrice * 0.96 * 100, 2),
                estimatedCredit=0.0,
                openingOrClosing="opening",
                strategyTag="stock",
                note="Staged entry order below spot.",
            ),
            OpenOrderExposure(
                orderId=9103,
                symbol="PYPL",
                secType="OPT",
                orderType="LMT",
                side="BUY",
                quantity=1,
                limitPrice=1.05,
                estimatedCapitalImpact=105.0,
                estimatedCredit=0.0,
                openingOrClosing="closing",
                expiry=option_by_symbol[("PYPL", "C")].expiry if ("PYPL", "C") in option_by_symbol else None,
                strike=option_by_symbol[("PYPL", "C")].strike if ("PYPL", "C") in option_by_symbol else None,
                right="C",
                strategyTag="covered-call",
                note="Working close order to free upside if momentum continues.",
            ),
            OpenOrderExposure(
                orderId=9104,
                symbol="AXTI",
                secType="OPT",
                orderType="LMT",
                side="SELL",
                quantity=4,
                limitPrice=0.17,
                estimatedCapitalImpact=1_400.0,
                estimatedCredit=68.0,
                openingOrClosing="opening",
                expiry=(today + timedelta(days=14)).isoformat(),
                strike=3.5,
                right="P",
                strategyTag="cash-secured-put",
                note="Adds to small-cap put exposure if liquidity stays available.",
            ),
        ]
        return orders

    def _build_account_snapshot(
        self,
        generated_at: datetime,
        stock_positions: list[Position],
        option_positions: list[OptionPosition],
        open_orders: list[OpenOrderExposure],
    ) -> AccountSnapshot:
        stock_value = sum(position.marketValue for position in stock_positions)
        option_value = sum(position.marketValue or 0.0 for position in option_positions)
        cash_balance = 246_500.0
        net_liq = cash_balance + stock_value + option_value
        conservative_collateral = sum(
            position.collateralEstimate for position in option_positions if position.strategyTag == "cash-secured-put"
        )
        committed_orders = sum(order.estimatedCapitalImpact for order in open_orders if order.openingOrClosing != "closing")
        init_margin = stock_value * 0.18 + conservative_collateral * 0.33
        maint_margin = stock_value * 0.14 + conservative_collateral * 0.28
        excess_liquidity = net_liq - maint_margin
        available_funds = max(0.0, net_liq - init_margin - committed_orders * 0.22)
        buying_power = max(0.0, excess_liquidity * 1.9)
        estimated_premium = sum(
            position.premiumEstimate
            for position in option_positions
            if position.shortOrLong == "short" and date.fromisoformat(position.expiry) <= date.today() + timedelta(days=7)
        )
        preview_account = AccountSnapshot(
            accountId="DU-MOCK",
            netLiquidation=round(net_liq, 2),
            availableFunds=round(available_funds, 2),
            excessLiquidity=round(excess_liquidity, 2),
            buyingPower=round(buying_power, 2),
            initMarginReq=round(init_margin, 2),
            maintMarginReq=round(maint_margin, 2),
            cashBalance=round(cash_balance, 2),
            marginUsagePct=round(init_margin / max(net_liq, 1.0) * 100.0, 2),
            optionPositionsCount=len(option_positions),
            openOrdersCount=len(open_orders),
            estimatedPremiumExpiringThisWeek=round(estimated_premium, 2),
            estimatedCommittedCapital=round(committed_orders, 2),
            estimatedFreeOptionSellingCapacity=0.0,
            generatedAt=generated_at,
            isStale=False,
        )
        collateral = build_collateral_summary(
            PortfolioSnapshot(
                account=preview_account,
                positions=stock_positions,
                option_positions=option_positions,
                open_orders=open_orders,
                generated_at=generated_at,
                is_stale=False,
            ),
            self.settings.safety_buffer,
        )
        preview_account.estimatedFreeOptionSellingCapacity = collateral.estimatedFreeOptionSellingCapacity
        return preview_account

    def _spot_price(self, symbol: str, as_of: date | None = None) -> float:
        as_of = as_of or date.today()
        frame = self.price_provider.get_prices([symbol.upper()], as_of - timedelta(days=40), as_of)
        return float(frame["close"].iloc[-1])


def _frame_value(row: Any, column: str, multiplier: float = 1.0) -> float | None:
    if row is None:
        return None
    value = row[column]
    return round(float(value) * multiplier, 2 if multiplier != 1.0 else 3 if column == "delta" else 2)


def _yield_pct(premium: float | None, base: float, dte: int | None) -> float | None:
    if premium is None or base <= 0 or not dte:
        return None
    return round((premium / base) * (365.0 / max(dte, 1)) * 100.0, 2)


def _moneyness_pct(right: str, strike: float, spot: float) -> float:
    if right == "P":
        return (strike - spot) / max(spot, 1e-6)
    return (spot - strike) / max(spot, 1e-6)


def _distance_to_strike_pct(right: str, strike: float, spot: float) -> float:
    if right == "P":
        return (spot - strike) / max(spot, 1e-6)
    return (strike - spot) / max(spot, 1e-6)


def _assignment_risk(right: str, quantity: int, dte: int, moneyness_pct: float, delta: float) -> str:
    if quantity >= 0:
        return "Low"
    score = 0.0
    if moneyness_pct > 0:
        score += 2.2
    elif moneyness_pct > -0.02:
        score += 1.4
    elif moneyness_pct > -0.06:
        score += 0.8
    if dte <= 2:
        score += 2.0
    elif dte <= 5:
        score += 1.2
    elif dte <= 10:
        score += 0.5
    delta_abs = abs(delta)
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


def _mock_chain_highlights(rows: list[ChainRow], expiry: str) -> list[ChainHighlight]:
    put_candidates = [row for row in rows if row.putMid and row.distanceFromSpotPct < 0]
    call_candidates = [row for row in rows if row.callMid and row.distanceFromSpotPct > 0]
    highlights: list[ChainHighlight] = []
    if put_candidates:
        best_put = max(put_candidates, key=lambda row: (row.putAnnualizedYieldPct or 0.0, abs(row.distanceFromSpotPct)))
        highlights.append(
            ChainHighlight(
                label="Short put candidate",
                right="P",
                strike=best_put.strike,
                expiry=expiry,
                metricLabel="Annualized yield",
                metricValue=best_put.putAnnualizedYieldPct or 0.0,
                description="Highest annualized premium per conservative collateral among out-of-the-money puts.",
            )
        )
    if call_candidates:
        best_call = max(call_candidates, key=lambda row: (row.callAnnualizedYieldPct or 0.0, row.distanceFromSpotPct))
        highlights.append(
            ChainHighlight(
                label="Covered call candidate",
                right="C",
                strike=best_call.strike,
                expiry=expiry,
                metricLabel="Annualized yield",
                metricValue=best_call.callAnnualizedYieldPct or 0.0,
                description="Strongest premium on the upside without immediately pinning at-the-money.",
            )
        )
    return highlights
