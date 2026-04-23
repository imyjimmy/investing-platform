"""Options intelligence engine for rule-based trade interpretation."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from math import sqrt
from typing import Any

import pandas as pd

from investing_platform.models import (
    OptionIntentProfile,
    OptionIntelligenceRequest,
    OptionIntelligenceResponse,
    OptionIntelligenceRule,
    OptionIntelligenceScenarioRow,
    OptionIntelligenceScorecard,
    OptionStateVector,
)
from investing_platform.services.base import BrokerService, PortfolioSnapshot
from options_scanner.providers.mock_provider import MockPriceDataProvider
from options_scanner.providers.yfinance_provider import YFinancePriceDataProvider


@dataclass(slots=True)
class _HistoryContext:
    realized_vol_20d: float | None = None
    realized_vol_60d: float | None = None
    price_trend_5d: str | None = None
    price_trend_20d: str | None = None
    price_trend_60d: str | None = None
    recent_drawdown_pct: float | None = None
    distance_from_20d_high_pct: float | None = None
    distance_from_60d_high_pct: float | None = None
    above_20d_ma: bool | None = None
    above_50d_ma: bool | None = None
    above_200d_ma: bool | None = None
    regime_guess: str | None = None
    regime_confidence: float | None = None
    missing_fields: list[str] | None = None


def analyze_option_contract(
    request: OptionIntelligenceRequest,
    broker: BrokerService,
    snapshot: PortfolioSnapshot,
    ticker_overview: Any | None = None,
) -> OptionIntelligenceResponse:
    chain = broker.get_option_chain(request.symbol, expiry=request.expiry)
    row = next((item for item in chain.rows if abs(float(item.strike) - float(request.strike)) <= 1e-6), None)
    if row is None:
        raise ValueError(f"Could not find {request.symbol} {request.expiry} {request.right}{request.strike:g} in the selected chain snapshot.")

    side_prefix = "call" if request.right == "C" else "put"
    raw_delta = _attr(row, f"{side_prefix}Delta")
    raw_gamma = _attr(row, f"{side_prefix}Gamma")
    raw_theta = _attr(row, f"{side_prefix}Theta")
    raw_vega = _attr(row, f"{side_prefix}Vega")
    raw_rho = _attr(row, f"{side_prefix}Rho")
    bid = _attr(row, f"{side_prefix}Bid")
    ask = _attr(row, f"{side_prefix}Ask")
    mid = _attr(row, f"{side_prefix}Mid")
    iv_pct = _attr(row, f"{side_prefix}IV")
    open_interest = _attr(row, f"{side_prefix}OpenInterest", integer=True)
    volume = _attr(row, f"{side_prefix}Volume", integer=True)

    spot = float(chain.underlying.price)
    quantity = int(request.quantity)
    contract_sign = -1 if request.action == "SELL" else 1
    signed_contracts = contract_sign * quantity
    shares_controlled = quantity * 100
    position_type = _position_type(request.right, request.action)
    strategy_label = _strategy_label(position_type, snapshot, request.symbol, quantity)
    shares_owned_total = int(max(0.0, sum(position.quantity for position in snapshot.positions if position.symbol == request.symbol and position.quantity > 0)))
    covered_status = _covered_status(position_type, shares_owned_total, shares_controlled)

    existing_contract = next(
        (
            position
            for position in snapshot.option_positions
            if position.symbol == request.symbol
            and position.expiry == request.expiry
            and abs(float(position.strike) - float(request.strike)) <= 1e-6
            and position.right == request.right
        ),
        None,
    )
    entry_price = request.entryPrice if request.entryPrice is not None else (existing_contract.avgCost if existing_contract else mid)
    premium_collected = None
    if entry_price is not None:
        premium_collected = round(entry_price * shares_controlled * (-1 if request.action == "BUY" else 1), 2)

    intrinsic_value = _intrinsic_value(request.right, request.strike, spot)
    extrinsic_value = None if mid is None else max(mid - intrinsic_value, 0.0)
    probability_itm = _probability_itm(raw_delta, request.right, spot, request.strike)
    probability_otm = None if probability_itm is None else max(0.0, 1.0 - probability_itm)
    spread_pct = _spread_pct(bid, ask, mid)
    liquidity_score = _liquidity_score(spread_pct, open_interest, volume)
    execution_quality_warning = bool(
        (spread_pct is not None and spread_pct > 0.05) or (open_interest is not None and open_interest < 100)
    )

    position_delta = _position_greek(raw_delta, signed_contracts)
    position_gamma = _position_greek(raw_gamma, signed_contracts)
    position_theta = _position_greek(raw_theta, signed_contracts)
    position_vega = _position_greek(raw_vega, signed_contracts)
    net_share_delta = float(sum(position.quantity for position in snapshot.positions if position.symbol == request.symbol))
    net_delta_after_shares = None if position_delta is None else net_share_delta + position_delta

    dte = max((date.fromisoformat(request.expiry) - date.today()).days, 0)
    strike_distance_abs = round(float(request.strike) - spot, 4)
    strike_distance_pct = round((strike_distance_abs / spot) if spot else 0.0, 4)
    moneyness = _moneyness(request.right, request.strike, spot)
    moneyness_bucket = _moneyness_bucket(request.right, request.strike, spot)
    dte_bucket = _dte_bucket(dte)
    gamma_risk_bucket = _gamma_risk_bucket(dte, strike_distance_pct, raw_gamma)
    theta_efficiency = _theta_efficiency(position_theta, spot, request.strike, shares_controlled)

    history = _load_history_context(request.symbol, broker)
    term_structure = _term_structure(broker, request.symbol, request.expiry, chain.expiries)
    call_put_iv_skew, skew_type = _skew_context(row)
    earnings_before_expiration, event_type = _event_context(ticker_overview, request.expiry)

    short_calls_same_underlying = sum(
        abs(position.quantity)
        for position in snapshot.option_positions
        if position.symbol == request.symbol and position.shortOrLong == "short" and position.right == "C"
    )
    short_puts_same_underlying = sum(
        abs(position.quantity)
        for position in snapshot.option_positions
        if position.symbol == request.symbol and position.shortOrLong == "short" and position.right == "P"
    )
    if position_type == "short_call":
        short_calls_same_underlying += quantity
    if position_type == "short_put":
        short_puts_same_underlying += quantity

    shares_at_risk_total = short_calls_same_underlying * 100
    pct_shares_capped = round((shares_at_risk_total / shares_owned_total) if shares_owned_total > 0 else 0.0, 4)
    cash_required_if_puts_assigned = round(short_puts_same_underlying * float(request.strike) * 100.0, 2) if request.right == "P" else round(
        sum(
            position.collateralEstimate
            for position in snapshot.option_positions
            if position.symbol == request.symbol and position.shortOrLong == "short" and position.right == "P"
        ),
        2,
    )

    iv_decimal = iv_pct / 100.0 if iv_pct is not None else None
    iv_vs_rv_spread = None
    if iv_decimal is not None and history.realized_vol_20d is not None:
        iv_vs_rv_spread = round(iv_decimal - history.realized_vol_20d, 4)

    missing_fields = [
        name
        for name, value in {
            "delta": raw_delta,
            "gamma": raw_gamma,
            "theta": raw_theta,
            "vega": raw_vega,
            "rho": raw_rho,
            "iv": iv_pct,
            "volume": volume,
            "open_interest": open_interest,
            "realized_vol_20d": history.realized_vol_20d,
            "realized_vol_60d": history.realized_vol_60d,
            "price_trend_20d": history.price_trend_20d,
            "iv_percentile": None,
            "iv_rank": None,
        }.items()
        if value is None
    ]
    if history.missing_fields:
        missing_fields.extend(history.missing_fields)
    missing_fields = sorted(set(missing_fields))
    analysis_confidence = _analysis_confidence(missing_fields)

    state_vector = OptionStateVector(
        underlying=request.symbol,
        underlyingPrice=round(spot, 4),
        positionType=position_type,
        strategyLabel=strategy_label,
        contracts=signed_contracts,
        sharesControlled=shares_controlled,
        sharesOwned=shares_owned_total,
        coveredStatus=covered_status,
        strike=round(float(request.strike), 4),
        expiration=request.expiry,
        dte=dte,
        dteBucket=dte_bucket,
        optionMidPrice=mid,
        entryPrice=entry_price,
        premiumCollected=premium_collected,
        markToMarketPnl=existing_contract.unrealizedPnL if existing_contract else 0.0,
        effectiveExitPrice=round(float(request.strike) + entry_price, 4) if position_type == "short_call" and entry_price is not None else None,
        effectiveEntryPrice=round(float(request.strike) - entry_price, 4) if position_type == "short_put" and entry_price is not None else None,
        moneyness=moneyness,
        intrinsicValue=round(intrinsic_value, 4),
        extrinsicValue=round(extrinsic_value, 4) if extrinsic_value is not None else None,
        bid=bid,
        ask=ask,
        mid=mid,
        bidAskSpreadPct=spread_pct,
        spreadPctOfMid=spread_pct,
        openInterest=open_interest,
        volume=volume,
        liquidityScore=liquidity_score,
        executionQualityWarning=execution_quality_warning,
        delta=raw_delta,
        gamma=raw_gamma,
        theta=raw_theta,
        vega=raw_vega,
        rho=raw_rho,
        positionDelta=position_delta,
        positionGamma=position_gamma,
        positionTheta=position_theta,
        positionVega=position_vega,
        netDeltaAfterShares=round(net_delta_after_shares, 4) if net_delta_after_shares is not None else None,
        netGammaAfterPosition=position_gamma,
        netThetaAfterPosition=position_theta,
        netVegaAfterPosition=position_vega,
        strikeDistanceAbs=strike_distance_abs,
        strikeDistancePct=strike_distance_pct,
        moneynessBucket=moneyness_bucket,
        probabilityItmEstimate=probability_itm,
        probabilityOtmEstimate=probability_otm,
        iv=iv_decimal,
        ivRank=None,
        ivPercentile=None,
        realizedVol20d=history.realized_vol_20d,
        realizedVol60d=history.realized_vol_60d,
        ivVsRvSpread=iv_vs_rv_spread,
        ivTrend5d=None,
        ivTrend20d=None,
        termStructure=term_structure,
        skewType=skew_type,
        callPutIvSkew=call_put_iv_skew,
        thetaEfficiency=theta_efficiency,
        gammaRiskBucket=gamma_risk_bucket,
        earningsBeforeExpiration=earnings_before_expiration,
        knownEventBeforeExpiration=earnings_before_expiration,
        eventType=event_type,
        portfolioValue=round(snapshot.account.netLiquidation, 2),
        underlyingPositionValue=round(shares_owned_total * spot, 2),
        underlyingPctOfPortfolio=round((shares_owned_total * spot) / snapshot.account.netLiquidation, 4)
        if snapshot.account.netLiquidation
        else None,
        contractsShortTotalSameUnderlying=short_calls_same_underlying + short_puts_same_underlying,
        sharesAtRiskTotal=shares_at_risk_total,
        sharesOwnedTotal=shares_owned_total,
        pctSharesCapped=pct_shares_capped,
        cashRequiredIfPutsAssigned=cash_required_if_puts_assigned,
        availableCash=round(snapshot.account.availableFunds, 2),
        marginRequired=round(snapshot.account.initMarginReq, 2),
        assignmentCashImpact=cash_required_if_puts_assigned,
        priceTrend5d=history.price_trend_5d,
        priceTrend20d=history.price_trend_20d,
        priceTrend60d=history.price_trend_60d,
        recentDrawdownPct=history.recent_drawdown_pct,
        distanceFrom20dHighPct=history.distance_from_20d_high_pct,
        distanceFrom60dHighPct=history.distance_from_60d_high_pct,
        above20dMovingAverage=history.above_20d_ma,
        above50dMovingAverage=history.above_50d_ma,
        above200dMovingAverage=history.above_200d_ma,
        regimeGuess=history.regime_guess,
        regimeConfidence=history.regime_confidence,
        analysisConfidence=analysis_confidence,
        missingFields=missing_fields,
    )

    rules = _evaluate_rules(state_vector, request.intent)
    scorecard = _score_trade(state_vector, request.intent, rules)
    summary = _summary(state_vector, rules)
    top_warnings = [rule.message for rule in rules if rule.severity in {"warning", "critical", "block"}][:3]
    badges = _badges(state_vector, rules)
    suggested_adjustments = _dedupe_actions(rules)

    return OptionIntelligenceResponse(
        stateVector=state_vector,
        intent=request.intent,
        scorecard=scorecard,
        rules=rules,
        summary=summary,
        topWarnings=top_warnings,
        badges=badges,
        whatYouAreBetting=_what_you_are_betting(state_vector),
        whatCanGoWrong=_what_can_go_wrong(state_vector, rules),
        whatGoesRight=_what_goes_right(state_vector),
        suggestedAdjustments=suggested_adjustments,
        scenarioTable=_scenario_table(state_vector),
        generatedAt=datetime.now(UTC),
        isStale=chain.isStale,
    )


def _attr(row: Any, name: str, integer: bool = False) -> float | int | None:
    value = getattr(row, name)
    if value is None:
        return None
    if integer:
        return int(value)
    return round(float(value), 4)


def _position_type(right: str, action: str) -> str:
    if right == "C" and action == "SELL":
        return "short_call"
    if right == "P" and action == "SELL":
        return "short_put"
    if right == "C":
        return "long_call"
    return "long_put"


def _strategy_label(position_type: str, snapshot: PortfolioSnapshot, symbol: str, quantity: int) -> str:
    shares_owned = int(max(0.0, sum(position.quantity for position in snapshot.positions if position.symbol == symbol and position.quantity > 0)))
    if position_type == "short_call":
        return "covered_call" if shares_owned >= quantity * 100 else "short_call"
    if position_type == "short_put":
        return "cash_secured_put"
    return position_type


def _covered_status(position_type: str, shares_owned: int, shares_controlled: int) -> str:
    if position_type != "short_call":
        return "n/a"
    if shares_owned >= shares_controlled:
        return "covered"
    if shares_owned > 0:
        return "partially-covered"
    return "uncovered"


def _intrinsic_value(right: str, strike: float, spot: float) -> float:
    if right == "C":
        return max(spot - float(strike), 0.0)
    return max(float(strike) - spot, 0.0)


def _probability_itm(delta: float | None, right: str, spot: float, strike: float) -> float | None:
    if delta is not None:
        return round(abs(float(delta)), 4)
    if spot <= 0:
        return None
    distance_pct = abs(float(strike) - spot) / spot
    baseline = max(0.05, 0.5 - distance_pct * 2.5)
    return round(baseline if _moneyness(right, strike, spot) == "ATM" else baseline * 0.7, 4)


def _spread_pct(bid: float | None, ask: float | None, mid: float | None) -> float | None:
    if bid is None or ask is None or mid is None or mid <= 0:
        return None
    return round((ask - bid) / mid, 4)


def _liquidity_score(spread_pct: float | None, open_interest: int | None, volume: int | None) -> int:
    score = 100.0
    if spread_pct is not None:
        score -= min(50.0, spread_pct * 450.0)
    else:
        score -= 18.0
    if open_interest is None:
        score -= 12.0
    elif open_interest < 100:
        score -= 22.0
    elif open_interest < 500:
        score -= 10.0
    if volume is None:
        score -= 8.0
    elif volume < 25:
        score -= 14.0
    elif volume < 100:
        score -= 6.0
    return max(0, min(100, int(round(score))))


def _position_greek(raw_greek: float | None, signed_contracts: int) -> float | None:
    if raw_greek is None:
        return None
    return round(float(raw_greek) * signed_contracts * 100.0, 4)


def _moneyness(right: str, strike: float, spot: float) -> str:
    distance_pct = abs(float(strike) - spot) / spot if spot else 0.0
    if distance_pct <= 0.015:
        return "ATM"
    if right == "C":
        return "ITM" if spot > float(strike) else "OTM"
    return "ITM" if spot < float(strike) else "OTM"


def _moneyness_bucket(right: str, strike: float, spot: float) -> str:
    if spot <= 0:
        return "near_atm"
    pct = (float(strike) - spot) / spot
    if abs(pct) <= 0.02:
        return "near_atm"
    itm = (right == "C" and spot > float(strike)) or (right == "P" and spot < float(strike))
    if itm:
        return "deep_itm" if abs(pct) >= 0.10 else "slightly_itm"
    return "deep_otm" if abs(pct) >= 0.12 else "otm"


def _dte_bucket(dte: int) -> str:
    if dte <= 3:
        return "ultra_short"
    if dte <= 14:
        return "short"
    if dte <= 60:
        return "medium"
    if dte <= 180:
        return "long"
    return "leap"


def _gamma_risk_bucket(dte: int, strike_distance_pct: float, gamma: float | None) -> str:
    closeness = abs(strike_distance_pct)
    gamma_value = abs(gamma) if gamma is not None else 0.0
    if dte <= 3 and closeness <= 0.02:
        return "extreme"
    if (dte <= 10 and closeness <= 0.05) or gamma_value >= 0.04:
        return "high"
    if (dte <= 21 and closeness <= 0.08) or gamma_value >= 0.02:
        return "moderate"
    return "low"


def _theta_efficiency(position_theta: float | None, spot: float, strike: float, shares_controlled: int) -> float | None:
    if position_theta is None:
        return None
    denominator = max(shares_controlled * max(spot, strike), 1.0)
    return round(abs(position_theta) / denominator, 6)


def _load_history_context(symbol: str, broker: BrokerService) -> _HistoryContext:
    end_date = date.today()
    start_date = end_date - timedelta(days=380)
    try:
        if broker.connection_status().mode == "mock":
            price_provider = MockPriceDataProvider()
        else:
            price_provider = YFinancePriceDataProvider()
        price_frame = price_provider.get_prices([symbol], start_date, end_date)
    except Exception:
        return _HistoryContext(missing_fields=["price_history", "regime_context"])

    if price_frame.empty:
        return _HistoryContext(missing_fields=["price_history", "regime_context"])

    frame = price_frame[price_frame["ticker"] == symbol].copy().sort_values("date")
    if frame.empty:
        return _HistoryContext(missing_fields=["price_history", "regime_context"])

    closes = frame["close"].astype(float)
    returns = closes.pct_change().dropna()
    current_price = float(closes.iloc[-1])
    ma20 = float(closes.tail(20).mean()) if len(closes) >= 20 else None
    ma50 = float(closes.tail(50).mean()) if len(closes) >= 50 else None
    ma200 = float(closes.tail(200).mean()) if len(closes) >= 200 else None
    high20 = float(closes.tail(20).max()) if len(closes) >= 20 else None
    high60 = float(closes.tail(60).max()) if len(closes) >= 60 else None
    rolling_max_60 = closes.tail(60).cummax()
    recent_drawdown_pct = None
    if not rolling_max_60.empty:
        recent_drawdown_pct = round(float(closes.tail(60).iloc[-1] / rolling_max_60.max() - 1.0), 4)

    context = _HistoryContext(
        realized_vol_20d=_annualized_vol(returns, 20),
        realized_vol_60d=_annualized_vol(returns, 60),
        price_trend_5d=_trend_label(_trailing_return(closes, 5)),
        price_trend_20d=_trend_label(_trailing_return(closes, 20)),
        price_trend_60d=_trend_label(_trailing_return(closes, 60)),
        recent_drawdown_pct=recent_drawdown_pct,
        distance_from_20d_high_pct=round(current_price / high20 - 1.0, 4) if high20 else None,
        distance_from_60d_high_pct=round(current_price / high60 - 1.0, 4) if high60 else None,
        above_20d_ma=(current_price > ma20) if ma20 else None,
        above_50d_ma=(current_price > ma50) if ma50 else None,
        above_200d_ma=(current_price > ma200) if ma200 else None,
        missing_fields=[],
    )
    context.regime_guess, context.regime_confidence = _regime_guess(context)
    return context


def _annualized_vol(returns: pd.Series, window: int) -> float | None:
    if len(returns) < window:
        return None
    return round(float(returns.tail(window).std() * sqrt(252.0)), 4)


def _trailing_return(series: pd.Series, window: int) -> float | None:
    if len(series) <= window:
        return None
    start = float(series.iloc[-window - 1])
    end = float(series.iloc[-1])
    if start <= 0:
        return None
    return round(end / start - 1.0, 4)


def _trend_label(value: float | None) -> str | None:
    if value is None:
        return None
    if value >= 0.08:
        return "up"
    if value <= -0.08:
        return "down"
    if value >= 0.02:
        return "up"
    if value <= -0.02:
        return "down"
    return "flat"


def _regime_guess(context: _HistoryContext) -> tuple[str | None, float | None]:
    if context.price_trend_20d is None or context.above_20d_ma is None:
        return None, None
    if context.price_trend_5d == "up" and context.price_trend_20d == "up" and context.above_20d_ma and context.above_50d_ma:
        if context.distance_from_60d_high_pct is not None and context.distance_from_60d_high_pct >= -0.04:
            return "possible_re_rating", 0.68
        return "uptrend", 0.62
    if context.recent_drawdown_pct is not None and context.recent_drawdown_pct <= -0.20 and context.price_trend_5d == "up":
        return "inflection", 0.61
    if context.recent_drawdown_pct is not None and context.recent_drawdown_pct <= -0.20:
        return "post_drawdown", 0.58
    if context.price_trend_20d == "down" and context.above_20d_ma is False:
        return "downtrend", 0.64
    if context.price_trend_20d == "flat" and context.distance_from_20d_high_pct is not None and abs(context.distance_from_20d_high_pct) <= 0.06:
        return "chop", 0.56
    return "chop", 0.45


def _term_structure(broker: BrokerService, symbol: str, selected_expiry: str, expiries: list[str]) -> str | None:
    if len(expiries) < 2:
        return None
    far_expiry = expiries[-1]
    if far_expiry == selected_expiry:
        far_expiry = expiries[0]
    try:
        selected_chain = broker.get_option_chain(symbol, expiry=selected_expiry, strike_limit=16, min_moneyness_pct=-0.05, max_moneyness_pct=0.05)
        far_chain = broker.get_option_chain(symbol, expiry=far_expiry, strike_limit=16, min_moneyness_pct=-0.05, max_moneyness_pct=0.05)
    except Exception:
        return None

    selected_iv = _atm_iv(selected_chain.rows)
    far_iv = _atm_iv(far_chain.rows)
    if selected_iv is None or far_iv is None:
        return None
    if selected_iv - far_iv >= 2.0:
        return "backwardated"
    if far_iv - selected_iv >= 2.0:
        return "contango"
    return "flat"


def _atm_iv(rows: list[Any]) -> float | None:
    if not rows:
        return None
    nearest = min(rows, key=lambda item: abs(item.distanceFromSpotPct))
    values = [value for value in [nearest.callIV, nearest.putIV] if value is not None]
    if not values:
        return None
    return float(sum(values) / len(values))


def _skew_context(row: Any) -> tuple[float | None, str | None]:
    if row.callIV is None or row.putIV is None:
        return None, None
    skew = round(float(row.callIV) - float(row.putIV), 4)
    if skew >= 3.0:
        return skew, "call_bid"
    if skew <= -3.0:
        return skew, "put_bid"
    return skew, "balanced"


def _event_context(ticker_overview: Any | None, expiry: str) -> tuple[bool, str | None]:
    if ticker_overview is None or getattr(ticker_overview, "earningsDate", None) is None:
        return False, None
    earnings_date = ticker_overview.earningsDate
    earnings_value = earnings_date if isinstance(earnings_date, date) else date.fromisoformat(str(earnings_date))
    return earnings_value <= date.fromisoformat(expiry), "earnings"


def _analysis_confidence(missing_fields: list[str]) -> str:
    if len(missing_fields) >= 6:
        return "low"
    if len(missing_fields) >= 3:
        return "medium"
    return "high"


def _rule(
    *,
    rule_id: str,
    severity: str,
    category: str,
    message: str,
    plain_english: str,
    suggested_actions: list[str] | None = None,
) -> OptionIntelligenceRule:
    return OptionIntelligenceRule(
        id=rule_id,
        severity=severity,  # type: ignore[arg-type]
        category=category,
        message=message,
        plainEnglish=plain_english,
        suggestedActions=suggested_actions or [],
    )


def _evaluate_rules(state: OptionStateVector, intent: OptionIntentProfile) -> list[OptionIntelligenceRule]:
    rules: list[OptionIntelligenceRule] = []
    abs_delta = abs(state.delta) if state.delta is not None else None

    if state.positionType == "short_call" and abs_delta is not None and abs_delta > intent.maxAcceptableDeltaForIncomeCalls and intent.primaryIntent == "income":
        rules.append(
            _rule(
                rule_id="CALL_DELTA_TOO_HIGH_FOR_INCOME",
                severity="warning",
                category="delta",
                message="High delta call",
                plain_english="This call is close enough to spot that assignment and upside-cap risk are meaningful.",
                suggested_actions=["Choose a higher strike", "Sell fewer contracts", "Skip call selling if upside conviction is high"],
            )
        )

    if state.positionType == "short_put" and abs_delta is not None and abs_delta > intent.maxAcceptableDeltaForIncomePuts and intent.primaryIntent == "income":
        rules.append(
            _rule(
                rule_id="PUT_DELTA_TOO_HIGH_FOR_INCOME",
                severity="warning",
                category="delta",
                message="Assignment likely",
                plain_english="This put carries a meaningful probability of assignment, so it behaves more like agreeing to buy stock than passive income.",
                suggested_actions=["Use a lower strike", "Reduce contracts", "Only sell it if you want the shares"],
            )
        )

    if state.contracts < 0 and state.dte < 14 and state.gammaRiskBucket in {"high", "extreme"}:
        rules.append(
            _rule(
                rule_id="SHORT_GAMMA_NEAR_EXPIRATION",
                severity="warning",
                category="gamma",
                message="Short gamma near expiration",
                plain_english="Short-dated short options can reprice very quickly if the stock moves.",
                suggested_actions=["Go farther out in time", "Use a farther OTM strike", "Reduce size before expiry week"],
            )
        )

    if state.positionType == "short_call" and state.gammaRiskBucket in {"high", "extreme"} and state.regimeGuess in {"uptrend", "possible_re_rating", "inflection"}:
        rules.append(
            _rule(
                rule_id="SHORT_GAMMA_IN_TREND",
                severity="warning",
                category="gamma",
                message="Short gamma in trend",
                plain_english="You are short convexity while the underlying may still be trending, which can make rolls expensive.",
                suggested_actions=["Sell fewer calls", "Move farther OTM", "Avoid repeated small rolls"],
            )
        )

    if state.contracts < 0 and state.ivVsRvSpread is not None and state.ivVsRvSpread > 0.12:
        rules.append(
            _rule(
                rule_id="HIGH_IV_IS_NOT_SAFETY",
                severity="caution",
                category="vega",
                message="IV elevated",
                plain_english="Premium is rich because the market expects larger movement; that is not automatically safe income.",
                suggested_actions=["Demand better strike distance", "Keep position sizes controlled"],
            )
        )

    if state.positionType == "short_call" and state.regimeGuess == "possible_re_rating" and abs_delta is not None and abs_delta > 0.25:
        rules.append(
            _rule(
                rule_id="COVERED_CALL_DURING_RERATING",
                severity="warning",
                category="regime",
                message="Possible re-rating",
                plain_english="You may be selling the ceiling while the stock is acting more like a trend continuation than a range.",
                suggested_actions=["Use farther OTM strikes", "Sell fewer calls", "Let the stock run if conviction is high"],
            )
        )

    if (
        state.positionType == "short_call"
        and state.recentDrawdownPct is not None
        and state.recentDrawdownPct < -0.20
        and state.ivVsRvSpread is not None
        and state.ivVsRvSpread > 0.08
        and abs_delta is not None
        and abs_delta > 0.25
    ):
        rules.append(
            _rule(
                rule_id="POST_DRAWDOWN_CALL_SALE",
                severity="warning",
                category="regime",
                message="Post-drawdown rebound cap",
                plain_english="High premium after a sharp drawdown can be a trap if the stock is starting to rebound.",
                suggested_actions=["Choose a higher strike", "Wait for a cleaner setup", "Reduce call coverage"],
            )
        )

    if state.positionType == "short_call" and not intent.willingToSellShares and state.moneyness == "ITM":
        rules.append(
            _rule(
                rule_id="ASSIGNMENT_VIOLATES_INTENT",
                severity="critical",
                category="assignment",
                message="Intent mismatch",
                plain_english="Assignment would force you to sell shares you said you want to keep.",
                suggested_actions=["Do not sell this call", "Close or roll earlier", "Use a much higher strike"],
            )
        )

    if (
        state.positionType == "short_call"
        and intent.desiredExitPrice is not None
        and state.effectiveExitPrice is not None
        and state.effectiveExitPrice < intent.desiredExitPrice
    ):
        rules.append(
            _rule(
                rule_id="EFFECTIVE_EXIT_BELOW_DESIRED_EXIT",
                severity="warning",
                category="assignment",
                message="Exit below desired target",
                plain_english="Your effective exit price is below the exit level you said you actually want.",
                suggested_actions=["Raise the strike", "Wait for better premium", "Skip the trade"],
            )
        )

    if state.positionType == "short_call" and state.pctSharesCapped > intent.maxPctSharesToCap:
        rules.append(
            _rule(
                rule_id="TOO_MANY_SHARES_CAPPED",
                severity="warning",
                category="sizing",
                message=f"Capping {int(round(state.pctSharesCapped * 100))}% of shares",
                plain_english="You are capping more of the position than your intent profile allows.",
                suggested_actions=["Sell fewer contracts", "Raise the strike", "Leave more core shares uncapped"],
            )
        )

    if state.positionType == "short_call" and state.coveredStatus == "uncovered":
        rules.append(
            _rule(
                rule_id="NAKED_CALL_EXPOSURE",
                severity="block",
                category="sizing",
                message="Naked call exposure",
                plain_english="This creates uncovered short-call exposure, which can carry unlimited upside loss.",
                suggested_actions=["Do not place this trade without stock coverage", "Use a defined-risk spread instead"],
            )
        )

    if state.positionType == "short_put" and state.cashRequiredIfPutsAssigned > (state.availableCash or 0):
        rules.append(
            _rule(
                rule_id="PUT_ASSIGNMENT_CASH_SHORTFALL",
                severity="block",
                category="sizing",
                message="Assignment cash shortfall",
                plain_english="Assignment would require more cash than is currently available.",
                suggested_actions=["Reduce contracts", "Lower the strike", "Fund the account first"],
            )
        )

    if state.earningsBeforeExpiration and state.contracts < 0 and intent.avoidEarningsShortOptions:
        rules.append(
            _rule(
                rule_id="EARNINGS_BEFORE_EXPIRATION",
                severity="critical",
                category="event",
                message="Earnings before expiration",
                plain_english="A known event sits inside the holding window, which can overwhelm normal theta assumptions.",
                suggested_actions=["Use an expiration after earnings", "Wait until the event passes", "Reduce size materially"],
            )
        )

    if state.spreadPctOfMid is not None and state.spreadPctOfMid > 0.05:
        rules.append(
            _rule(
                rule_id="WIDE_SPREAD",
                severity="caution",
                category="liquidity",
                message="Wide spread",
                plain_english="Closing or rolling may be expensive because the bid/ask spread is wide.",
                suggested_actions=["Prefer more liquid expirations", "Avoid frequent rolling", "Use patient limits"],
            )
        )

    if state.openInterest is not None and state.openInterest < 100:
        rules.append(
            _rule(
                rule_id="LOW_OPEN_INTEREST",
                severity="caution",
                category="liquidity",
                message="Low open interest",
                plain_english="Thin open interest can make execution and exits less reliable.",
                suggested_actions=["Choose strikes with more open interest", "Prefer front liquid expiries"],
            )
        )

    if intent.strategyFamily == "wheel" and state.regimeGuess not in {None, "chop"}:
        rules.append(
            _rule(
                rule_id="WHEEL_WORKS_BEST_IN_CHOP",
                severity="info",
                category="regime",
                message="Wheel prefers chop",
                plain_english="Wheel-style income works best in range-bound markets and can underperform in strong trends.",
                suggested_actions=["Keep wheel sizing smaller", "Be selective about strikes in trending names"],
            )
        )

    if state.positionType == "short_call" and intent.primaryIntent == "income" and not intent.willingToSellShares:
        rules.append(
            _rule(
                rule_id="INCOME_VS_UPSIDE_CONFLICT",
                severity="critical",
                category="intent",
                message="Income and upside goals conflict",
                plain_english="Covered-call income comes from selling upside, so these goals directly conflict.",
                suggested_actions=["Skip the call", "Use fewer contracts", "Only cap the shares you are willing to sell"],
            )
        )

    severity_order = {"block": 0, "critical": 1, "warning": 2, "caution": 3, "info": 4}
    return sorted(rules, key=lambda rule: (severity_order[rule.severity], rule.category, rule.id))


def _score_trade(
    state: OptionStateVector,
    intent: OptionIntentProfile,
    rules: list[OptionIntelligenceRule],
) -> OptionIntelligenceScorecard:
    penalties = {
        "intent": 0,
        "delta": 0,
        "gamma": 0,
        "iv": 0,
        "regime": 0,
        "liquidity": 0,
        "sizing": 0,
        "assignment": 0,
    }
    severity_penalty = {"info": 3, "caution": 8, "warning": 16, "critical": 28, "block": 45}
    category_map = {
        "intent": ["intent"],
        "delta": ["delta", "assignment"],
        "gamma": ["gamma"],
        "vega": ["iv"],
        "regime": ["regime"],
        "event": ["regime", "assignment"],
        "liquidity": ["liquidity"],
        "sizing": ["sizing"],
        "assignment": ["assignment", "intent"],
    }
    for rule in rules:
        for bucket in category_map.get(rule.category, []):
            penalties[bucket] += severity_penalty[rule.severity]

    liquidity_score = min(state.liquidityScore, max(0, 100 - penalties["liquidity"]))
    sizing_score = max(0, 100 - penalties["sizing"])
    intent_alignment_score = max(0, 100 - penalties["intent"])
    delta_score = max(0, 100 - penalties["delta"])
    gamma_score = max(0, 100 - penalties["gamma"])
    iv_score = max(0, 100 - penalties["iv"])
    regime_score = max(0, 100 - penalties["regime"])
    assignment_score = max(0, 100 - penalties["assignment"])

    weights = {
        "intent": 0.25,
        "delta": 0.20,
        "regime": 0.20,
        "iv": 0.10,
        "gamma": 0.10,
        "sizing": 0.10,
        "liquidity": 0.05,
    }
    overall = round(
        intent_alignment_score * weights["intent"]
        + delta_score * weights["delta"]
        + regime_score * weights["regime"]
        + iv_score * weights["iv"]
        + gamma_score * weights["gamma"]
        + sizing_score * weights["sizing"]
        + liquidity_score * weights["liquidity"]
    )
    if overall >= 90:
        band = "Strong fit"
    elif overall >= 75:
        band = "Good fit"
    elif overall >= 60:
        band = "Acceptable but watch risks"
    elif overall >= 40:
        band = "Misaligned / risky"
    else:
        band = "Avoid or require override"
    return OptionIntelligenceScorecard(
        intentAlignmentScore=int(round(intent_alignment_score)),
        deltaScore=int(round(delta_score)),
        gammaScore=int(round(gamma_score)),
        ivScore=int(round(iv_score)),
        regimeScore=int(round(regime_score)),
        liquidityScore=int(round(liquidity_score)),
        sizingScore=int(round(sizing_score)),
        assignmentScore=int(round(assignment_score)),
        overallScore=int(overall),
        band=band,
    )


def _summary(state: OptionStateVector, rules: list[OptionIntelligenceRule]) -> str:
    label = state.strategyLabel.replace("_", " ")
    if not rules:
        return f"This {label} setup looks internally consistent with the current inputs, with no major rule conflicts triggered."
    top = rules[0]
    if state.positionType == "short_call":
        return f"This {label} trade collects premium, but {top.plainEnglish.lower()}"
    if state.positionType == "short_put":
        return f"This {label} trade behaves like a paid buy order, and {top.plainEnglish.lower()}"
    return f"This {label} analysis is driven primarily by the current exposure, and {top.plainEnglish.lower()}"


def _badges(state: OptionStateVector, rules: list[OptionIntelligenceRule]) -> list[str]:
    badges: list[str] = []
    for rule in rules:
        if rule.message not in badges:
            badges.append(rule.message)
    if state.thetaEfficiency is not None and state.thetaEfficiency >= 0.0025:
        badges.append("Theta efficient")
    if state.ivVsRvSpread is not None and state.ivVsRvSpread > 0.10:
        badges.append("IV elevated")
    if state.pctSharesCapped > 0:
        badges.append(f"Capping {int(round(state.pctSharesCapped * 100))}% of shares")
    return badges[:8]


def _dedupe_actions(rules: list[OptionIntelligenceRule]) -> list[str]:
    actions: list[str] = []
    for rule in rules:
        for action in rule.suggestedActions:
            if action not in actions:
                actions.append(action)
    return actions[:5]


def _what_you_are_betting(state: OptionStateVector) -> str:
    if state.positionType == "short_call":
        reference = state.effectiveExitPrice or state.strike
        return f"You are betting the stock will not rise far beyond {reference:.2f} before expiration."
    if state.positionType == "short_put":
        reference = state.effectiveEntryPrice or state.strike
        return f"You are betting you would be comfortable owning shares near {reference:.2f} if assigned."
    if state.positionType == "long_call":
        return "You are betting the stock rises enough, fast enough, to outrun premium decay."
    return "You are betting downside grows faster than the premium you paid decays."


def _what_can_go_wrong(state: OptionStateVector, rules: list[OptionIntelligenceRule]) -> str:
    if any(rule.id == "ASSIGNMENT_VIOLATES_INTENT" for rule in rules):
        return "Assignment would directly conflict with the plan you described."
    if state.positionType == "short_call":
        return "The stock can keep trending higher, turning the trade into either assignment or an expensive buyback."
    if state.positionType == "short_put":
        return "The stock can keep falling, making assignment larger and more painful than the premium suggests."
    if state.positionType == "long_call":
        return "The stock may not move quickly enough, leaving time decay to overwhelm the thesis."
    return "The stock may not sell off enough or may stabilize before the put premium expands."


def _what_goes_right(state: OptionStateVector) -> str:
    if state.positionType == "short_call":
        return "The stock stays flat or below the strike so you keep the premium without giving up stock."
    if state.positionType == "short_put":
        return "The stock stays above the strike and the option expires worthless, leaving you with the credit."
    if state.positionType == "long_call":
        return "The stock rallies enough to expand intrinsic value faster than theta drains premium."
    return "The stock sells off enough for the put to gain value before expiration."


def _scenario_table(state: OptionStateVector) -> list[OptionIntelligenceScenarioRow]:
    strike = state.strike
    if state.positionType == "short_call":
        return [
            OptionIntelligenceScenarioRow(label="Below strike", underlyingPrice=round(strike * 0.92, 2), result="Keep shares and premium."),
            OptionIntelligenceScenarioRow(label="At strike", underlyingPrice=round(strike, 2), result="Premium is kept and assignment sits at the boundary."),
            OptionIntelligenceScenarioRow(label="Above strike", underlyingPrice=round(strike * 1.05, 2), result="Shares are likely called away near the strike."),
            OptionIntelligenceScenarioRow(label="Far above strike", underlyingPrice=round(strike * 1.15, 2), result="Opportunity cost grows because upside above the strike is gone."),
        ]
    if state.positionType == "short_put":
        return [
            OptionIntelligenceScenarioRow(label="Above strike", underlyingPrice=round(strike * 1.08, 2), result="Put expires worthless and the premium is retained."),
            OptionIntelligenceScenarioRow(label="At strike", underlyingPrice=round(strike, 2), result="Premium offsets some of the flat finish."),
            OptionIntelligenceScenarioRow(label="Below strike", underlyingPrice=round(strike * 0.94, 2), result="Assignment becomes likely near the strike."),
            OptionIntelligenceScenarioRow(label="Far below strike", underlyingPrice=round(strike * 0.82, 2), result="You may be forced to buy stock into a larger drawdown."),
        ]
    if state.positionType == "long_call":
        return [
            OptionIntelligenceScenarioRow(label="Below strike", underlyingPrice=round(strike * 0.92, 2), result="Option can expire worthless and premium is lost."),
            OptionIntelligenceScenarioRow(label="At strike", underlyingPrice=round(strike, 2), result="Intrinsic value is limited and time decay still matters."),
            OptionIntelligenceScenarioRow(label="Above strike", underlyingPrice=round(strike * 1.08, 2), result="Intrinsic value begins to outweigh premium decay."),
            OptionIntelligenceScenarioRow(label="Far above strike", underlyingPrice=round(strike * 1.18, 2), result="Leverage works in your favor if the move arrives early enough."),
        ]
    return [
        OptionIntelligenceScenarioRow(label="Above strike", underlyingPrice=round(strike * 1.08, 2), result="Put premium can decay quickly against you."),
        OptionIntelligenceScenarioRow(label="At strike", underlyingPrice=round(strike, 2), result="Breakeven pressure remains near the strike."),
        OptionIntelligenceScenarioRow(label="Below strike", underlyingPrice=round(strike * 0.94, 2), result="Intrinsic value starts to build in your favor."),
        OptionIntelligenceScenarioRow(label="Far below strike", underlyingPrice=round(strike * 0.82, 2), result="A sharp selloff can create outsized gains if timing is right."),
    ]
