"""Portfolio analytics tuned for covered-call and short-put workflows."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime
from math import fabs

from investing_platform.models import (
    AlertItem,
    CollateralSummary,
    ExpiryExposureRow,
    PremiumSummary,
    RiskSummaryResponse,
    ScenarioResponse,
    ScenarioTickerImpact,
    TickerExposureRow,
)
from investing_platform.services.base import PortfolioSnapshot


def build_collateral_summary(snapshot: PortfolioSnapshot, safety_buffer: float) -> CollateralSummary:
    conservative_put_collateral = sum(
        position.collateralEstimate for position in snapshot.option_positions if position.strategyTag == "cash-secured-put"
    )
    open_order_capital = sum(order.estimatedCapitalImpact for order in snapshot.open_orders if order.openingOrClosing != "closing")
    free_capacity = max(
        0.0,
        min(snapshot.account.availableFunds, snapshot.account.excessLiquidity) - conservative_put_collateral - open_order_capital - safety_buffer,
    )
    return CollateralSummary(
        conservativeCashSecuredPutEstimate=round(conservative_put_collateral, 2),
        brokerReportedMarginImpact=round(snapshot.account.initMarginReq, 2),
        openOrderCommittedCapital=round(open_order_capital, 2),
        safetyBuffer=round(safety_buffer, 2),
        availableFunds=round(snapshot.account.availableFunds, 2),
        excessLiquidity=round(snapshot.account.excessLiquidity, 2),
        estimatedFreeOptionSellingCapacity=round(free_capacity, 2),
        generatedAt=snapshot.generated_at,
    )


def build_premium_summary(snapshot: PortfolioSnapshot) -> PremiumSummary:
    this_week_cutoff = date.today().toordinal() + 7
    week_positions = [position for position in snapshot.option_positions if position.shortOrLong == "short" and _expiry_ordinal(position.expiry) <= this_week_cutoff]
    covered_call_week = sum(
        position.premiumEstimate for position in week_positions if position.strategyTag == "covered-call"
    )
    put_week = sum(position.premiumEstimate for position in week_positions if position.strategyTag == "cash-secured-put")
    open_short_premium = sum(
        position.premiumEstimate for position in snapshot.option_positions if position.shortOrLong == "short"
    )
    return PremiumSummary(
        estimatedPremiumExpiringThisWeek=round(covered_call_week + put_week, 2),
        coveredCallPremiumThisWeek=round(covered_call_week, 2),
        putPremiumThisWeek=round(put_week, 2),
        estimatedOpenShortOptionPremium=round(open_short_premium, 2),
        methodology="Estimated from current midpoint or mark values on short option positions; treat as remaining premium at risk, not realized income.",
        generatedAt=snapshot.generated_at,
    )


def build_exposure_by_ticker(snapshot: PortfolioSnapshot) -> list[TickerExposureRow]:
    total_net_liquidation = max(snapshot.account.netLiquidation, 1.0)
    open_order_capital_by_symbol: dict[str, float] = defaultdict(float)
    for order in snapshot.open_orders:
        open_order_capital_by_symbol[order.symbol] += order.estimatedCapitalImpact

    stock_map: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for position in snapshot.positions:
        stock_map[position.symbol]["stockMarketValue"] += position.marketValue
        stock_map[position.symbol]["netStockShares"] += position.quantity

    option_map: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    risk_levels: dict[str, str] = defaultdict(lambda: "Low")
    for position in snapshot.option_positions:
        bucket = option_map[position.symbol]
        bucket["netOptionContracts"] += position.quantity
        if position.strategyTag == "cash-secured-put":
            bucket["shortPutContracts"] += abs(position.quantity)
            bucket["shortPutCollateral"] += position.collateralEstimate
            bucket["assignmentExposure"] += position.collateralEstimate
        if position.strategyTag == "covered-call":
            bucket["coveredCallContracts"] += abs(position.quantity)
        if _expires_this_week(position.expiry):
            bucket["premiumExpiringThisWeek"] += position.premiumEstimate
        if _risk_score(position.assignmentRiskLevel) > _risk_score(risk_levels[position.symbol]):
            risk_levels[position.symbol] = position.assignmentRiskLevel

    symbols = sorted(set(stock_map) | set(option_map) | set(open_order_capital_by_symbol))
    rows: list[TickerExposureRow] = []
    for symbol in symbols:
        stock_value = stock_map[symbol]["stockMarketValue"]
        row = TickerExposureRow(
            symbol=symbol,
            stockMarketValue=round(stock_value, 2),
            netStockShares=round(stock_map[symbol]["netStockShares"], 4),
            shortPutContracts=int(option_map[symbol]["shortPutContracts"]),
            coveredCallContracts=int(option_map[symbol]["coveredCallContracts"]),
            netOptionContracts=int(option_map[symbol]["netOptionContracts"]),
            shortPutCollateral=round(option_map[symbol]["shortPutCollateral"], 2),
            openOrderCapital=round(open_order_capital_by_symbol[symbol], 2),
            premiumExpiringThisWeek=round(option_map[symbol]["premiumExpiringThisWeek"], 2),
            assignmentExposure=round(option_map[symbol]["assignmentExposure"], 2),
            concentrationPct=round((fabs(stock_value) + option_map[symbol]["shortPutCollateral"]) / total_net_liquidation * 100.0, 2),
            riskLevel=risk_levels[symbol],  # type: ignore[arg-type]
        )
        rows.append(row)

    rows.sort(key=lambda row: (row.concentrationPct, row.shortPutCollateral, row.openOrderCapital), reverse=True)
    return rows


def build_exposure_by_expiry(snapshot: PortfolioSnapshot) -> list[ExpiryExposureRow]:
    grouped: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for position in snapshot.option_positions:
        expiry = position.expiry
        bucket = grouped[expiry]
        bucket["positionsCount"] += 1
        if position.strategyTag == "cash-secured-put":
            bucket["shortPutCollateral"] += position.collateralEstimate
        if position.strategyTag == "covered-call":
            bucket["coveredCallContracts"] += abs(position.quantity)
        if _expires_this_week(position.expiry):
            bucket["premiumExpiringThisWeek"] += position.premiumEstimate
        if position.assignmentRiskLevel in {"Elevated", "High"}:
            bucket["assignmentRiskContracts"] += abs(position.quantity)

    rows = [
        ExpiryExposureRow(
            expiry=expiry,
            weekLabel=_week_label(expiry),
            positionsCount=int(values["positionsCount"]),
            shortPutCollateral=round(values["shortPutCollateral"], 2),
            coveredCallContracts=int(values["coveredCallContracts"]),
            premiumExpiringThisWeek=round(values["premiumExpiringThisWeek"], 2),
            assignmentRiskContracts=int(values["assignmentRiskContracts"]),
        )
        for expiry, values in grouped.items()
    ]
    rows.sort(key=lambda row: row.expiry)
    return rows


def build_alerts(snapshot: PortfolioSnapshot, collateral: CollateralSummary, exposures: list[TickerExposureRow]) -> list[AlertItem]:
    alerts: list[AlertItem] = []
    margin_usage_pct = snapshot.account.marginUsagePct
    if margin_usage_pct >= 60:
        alerts.append(
            AlertItem(
                level="critical" if margin_usage_pct >= 75 else "warning",
                title="Liquidity pressure rising",
                detail=f"Initial margin is consuming {margin_usage_pct:.1f}% of net liquidation value.",
            )
        )
    if collateral.estimatedFreeOptionSellingCapacity <= 0:
        alerts.append(
            AlertItem(
                level="critical",
                title="No free put-selling capacity",
                detail="Available funds are fully consumed after open short-put obligations, open orders, and the configured safety buffer.",
            )
        )
    for position in sorted(snapshot.option_positions, key=lambda item: (item.dte, abs(item.distanceToStrikePct or 0.0)))[:5]:
        if position.shortOrLong != "short":
            continue
        if position.assignmentRiskLevel not in {"Elevated", "High"} and position.dte > 5:
            continue
        alerts.append(
            AlertItem(
                level="critical" if position.assignmentRiskLevel == "High" else "warning",
                title=f"{position.symbol} {position.right}{position.strike:g} needs attention",
                detail=f"{position.expiry} expiry, {position.assignmentRiskLevel.lower()} assignment risk, {position.dte} DTE.",
                symbol=position.symbol,
            )
        )
    for exposure in exposures[:3]:
        if exposure.concentrationPct >= 20:
            alerts.append(
                AlertItem(
                    level="warning",
                    title=f"{exposure.symbol} concentration is high",
                    detail=f"Combined stock plus put obligation is {exposure.concentrationPct:.1f}% of net liquidation.",
                    symbol=exposure.symbol,
                )
            )
    return alerts[:8]


def build_risk_summary(snapshot: PortfolioSnapshot, safety_buffer: float, watchlist: list[str]) -> RiskSummaryResponse:
    collateral = build_collateral_summary(snapshot, safety_buffer)
    premium = build_premium_summary(snapshot)
    exposure_by_ticker = build_exposure_by_ticker(snapshot)
    exposure_by_expiry = build_exposure_by_expiry(snapshot)
    closest = sorted(
        [position for position in snapshot.option_positions if position.shortOrLong == "short"],
        key=lambda position: (abs(position.distanceToStrikePct or 0.0), position.dte),
    )[:6]
    alerts = build_alerts(snapshot, collateral, exposure_by_ticker)
    return RiskSummaryResponse(
        account=snapshot.account,
        collateral=collateral,
        premium=premium,
        exposureByTicker=exposure_by_ticker,
        exposureByExpiry=exposure_by_expiry,
        positionsClosestToMoney=closest,
        alerts=alerts,
        watchlist=watchlist,
        generatedAt=snapshot.generated_at,
        isStale=snapshot.is_stale,
    )


def build_scenario(snapshot: PortfolioSnapshot, move_pct: float, days_forward: int, iv_shock_pct: float) -> ScenarioResponse:
    current_prices: dict[str, float] = {}
    for position in snapshot.positions:
        current_prices[position.symbol] = position.marketPrice
    for position in snapshot.option_positions:
        if position.underlyingSpot is not None:
            current_prices[position.symbol] = position.underlyingSpot

    stock_pnl_by_symbol: dict[str, float] = defaultdict(float)
    for position in snapshot.positions:
        projected_price = position.marketPrice * (1.0 + move_pct / 100.0)
        stock_pnl_by_symbol[position.symbol] += (projected_price - position.marketPrice) * position.quantity

    option_pnl_by_symbol: dict[str, float] = defaultdict(float)
    assigned_puts_by_symbol: dict[str, float] = defaultdict(float)
    call_away_by_symbol: dict[str, float] = defaultdict(float)

    for option in snapshot.option_positions:
        current_price = option.underlyingSpot or current_prices.get(option.symbol, 0.0)
        projected_price = current_price * (1.0 + move_pct / 100.0)
        multiplier = option.multiplier
        contracts = abs(option.quantity)
        current_intrinsic = _intrinsic_value(option.right, option.strike, current_price)
        projected_intrinsic = _intrinsic_value(option.right, option.strike, projected_price)
        intrinsic_move = (projected_intrinsic - current_intrinsic) * contracts * multiplier
        signed_move = -intrinsic_move if option.shortOrLong == "short" else intrinsic_move
        option_pnl_by_symbol[option.symbol] += signed_move
        if option.right == "P" and option.shortOrLong == "short" and projected_price < option.strike:
            assigned_puts_by_symbol[option.symbol] += option.strike * multiplier * contracts
        if option.right == "C" and option.shortOrLong == "short" and projected_price > option.strike:
            call_away_by_symbol[option.symbol] += option.strike * multiplier * contracts

    impacts: list[ScenarioTickerImpact] = []
    for symbol in sorted(set(current_prices) | set(stock_pnl_by_symbol) | set(option_pnl_by_symbol)):
        current_price = current_prices.get(symbol, 0.0)
        projected_price = current_price * (1.0 + move_pct / 100.0)
        total_approx_pnl = stock_pnl_by_symbol[symbol] + option_pnl_by_symbol[symbol]
        note = "Intrinsic-value shock only; time decay and IV effects are not fully modeled."
        impacts.append(
            ScenarioTickerImpact(
                symbol=symbol,
                currentPrice=round(current_price, 2),
                projectedPrice=round(projected_price, 2),
                stockPnL=round(stock_pnl_by_symbol[symbol], 2),
                optionIntrinsicPnL=round(option_pnl_by_symbol[symbol], 2),
                totalApproxPnL=round(total_approx_pnl, 2),
                assignedPutNotional=round(assigned_puts_by_symbol[symbol], 2),
                callAwayNotional=round(call_away_by_symbol[symbol], 2),
                note=note,
            )
        )
    impacts.sort(key=lambda item: abs(item.totalApproxPnL), reverse=True)
    return ScenarioResponse(
        movePct=move_pct,
        daysForward=days_forward,
        ivShockPct=iv_shock_pct,
        totalApproxPnL=round(sum(item.totalApproxPnL for item in impacts), 2),
        totalAssignedPutNotional=round(sum(item.assignedPutNotional for item in impacts), 2),
        totalCallAwayNotional=round(sum(item.callAwayNotional for item in impacts), 2),
        impacts=impacts,
        methodology="Scenario is a conservative intrinsic-value shock using the selected spot move. It does not fully model vega, skew, or path-dependent assignment behavior.",
        generatedAt=datetime.now(UTC),
        isStale=snapshot.is_stale,
    )


def _risk_score(level: str) -> int:
    return {"Low": 0, "Moderate": 1, "Elevated": 2, "High": 3}.get(level, 0)


def _intrinsic_value(right: str, strike: float, spot: float) -> float:
    if right == "P":
        return max(0.0, strike - spot)
    return max(0.0, spot - strike)


def _expiry_ordinal(expiry: str) -> int:
    return date.fromisoformat(expiry).toordinal()


def _expires_this_week(expiry: str) -> bool:
    return _expiry_ordinal(expiry) <= date.today().toordinal() + 7


def _week_label(expiry: str) -> str:
    parsed = date.fromisoformat(expiry)
    return parsed.strftime("%b %d")
