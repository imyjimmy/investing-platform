"""Composite scoring and shortlist generation for volatility-selling candidates."""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import AppConfig


def score_candidates(feature_frame: pd.DataFrame, config: AppConfig) -> pd.DataFrame:
    """Apply weighted scoring to engineered features."""

    if feature_frame.empty:
        return feature_frame.copy()

    scored = feature_frame.copy()

    scored["beta_component"] = _row_mean(
        [
            _percentile_score(scored["beta_qqq_60d"]),
            _percentile_score(scored["beta_qqq_120d"]),
            _percentile_score(scored["beta_spy_120d"]),
        ]
    )
    scored["implied_vol_component"] = _row_mean(
        [
            _percentile_score(scored["atm_front_month_iv"]),
            _percentile_score(scored["atm_30_45d_iv"]),
            _percentile_score(scored["avg_near_dated_liquid_iv"]),
        ]
    )
    scored["iv_vs_realized_component"] = _row_mean(
        [
            _percentile_score(scored["iv_to_hv20"]),
            _percentile_score(scored["iv_to_hv60"]),
            _percentile_score(scored["iv_minus_hv20"]),
        ]
    )
    scored["option_liquidity_component"] = _row_mean(
        [
            _percentile_score(scored["total_option_open_interest"]),
            _percentile_score(scored["total_option_volume"]),
            _percentile_score(scored["liquid_expiration_count"]),
            _percentile_score(scored["liquid_contract_count"]),
        ]
    )
    scored["stock_liquidity_component"] = _row_mean(
        [
            _percentile_score(scored["avg_daily_dollar_volume_20d"]),
            _percentile_score(scored["market_cap"]),
            _percentile_score(scored["last_close"]),
        ]
    )
    scored["recurring_moves_component"] = _row_mean(
        [
            _percentile_score(scored["gap_freq_3pct"]),
            _percentile_score(scored["gap_freq_5pct"]),
            _percentile_score(scored["atr_pct"]),
            _percentile_score(scored["hv20"]),
        ]
    )
    scored["tradability_component"] = _row_mean(
        [
            _percentile_score(scored["put_candidate_count"]),
            _percentile_score(scored["call_candidate_count"]),
            _percentile_score(scored["avg_put_premium_yield_annualized"]),
            _percentile_score(scored["avg_call_premium_yield_annualized"]),
        ]
    )
    scored["persistent_iv_component"] = _row_mean(
        [
            _percentile_score(scored["iv_rank_1y"]),
            _percentile_score(scored["iv_percentile_1y"]),
            _percentile_score(scored["iv_persistence_ratio_90d"]),
        ]
    )
    scored["theme_cluster_component"] = _theme_cluster_score(scored)

    scored["wide_spread_penalty"] = _percentile_score(scored["avg_option_spread_pct"]).fillna(0.5)
    scored["microcap_penalty"] = _percentile_score(scored["market_cap"], invert=True).fillna(0.5)
    scored["event_risk_penalty"] = (
        scored["binary_event_risk"].fillna(False).astype(float)
        + scored["earnings_within_7d"].fillna(False).astype(float) * 0.5
    ).clip(0.0, 1.0)

    positive_weights = {
        "beta_component": config.scoring.beta,
        "implied_vol_component": config.scoring.implied_volatility,
        "iv_vs_realized_component": config.scoring.iv_vs_realized,
        "option_liquidity_component": config.scoring.option_liquidity,
        "stock_liquidity_component": config.scoring.stock_liquidity,
        "recurring_moves_component": config.scoring.recurring_moves,
        "tradability_component": config.scoring.tradability,
        "persistent_iv_component": config.scoring.persistent_iv,
        "theme_cluster_component": config.scoring.theme_cluster,
    }
    penalty_weights = {
        "wide_spread_penalty": config.scoring.penalty_wide_spreads,
        "microcap_penalty": config.scoring.penalty_microcap,
        "event_risk_penalty": config.scoring.penalty_event_risk,
    }

    positive_total = sum(positive_weights.values())
    raw_positive = sum(scored[column] * weight for column, weight in positive_weights.items())
    raw_penalty = sum(scored[column] * weight for column, weight in penalty_weights.items())
    scored["raw_score"] = raw_positive - raw_penalty
    scored["composite_score"] = (100.0 * (scored["raw_score"] / positive_total)).clip(lower=0.0, upper=100.0)
    scored.loc[~scored["eligible"], "composite_score"] = 0.0

    scored["cash_secured_put_score"] = (
        0.40 * _percentile_score(scored["avg_put_premium_yield_annualized"])
        + 0.25 * _percentile_score(scored["put_candidate_count"])
        + 0.20 * scored["option_liquidity_component"]
        + 0.15 * scored["iv_vs_realized_component"]
    )
    scored["covered_call_score"] = (
        0.35 * _percentile_score(scored["avg_call_premium_yield_annualized"])
        + 0.25 * _percentile_score(scored["call_candidate_count"])
        + 0.20 * scored["option_liquidity_component"]
        + 0.20 * scored["stock_liquidity_component"]
    )
    scored["wheel_score"] = _row_mean(
        [scored["cash_secured_put_score"], scored["covered_call_score"], scored["option_liquidity_component"]]
    )
    scored["watchlist_score"] = _row_mean(
        [scored["composite_score"] / 100.0, scored["beta_component"], scored["implied_vol_component"]]
    )

    scored["suitable_cash_secured_puts"] = (
        scored["eligible"]
        & (scored["put_candidate_count"] >= 2)
        & (scored["cash_secured_put_score"] >= 0.60)
    )
    scored["suitable_covered_calls"] = (
        scored["eligible"]
        & (scored["call_candidate_count"] >= 2)
        & (scored["covered_call_score"] >= 0.60)
    )
    scored["suitable_wheel"] = (
        scored["eligible"]
        & scored["suitable_cash_secured_puts"]
        & scored["suitable_covered_calls"]
        & (scored["wheel_score"] >= 0.60)
    )
    scored["suitable_watchlist"] = scored["eligible"] & ((scored["watchlist_score"] >= 0.65) | (scored["composite_score"] >= 55))
    scored["recommended_strategy"] = scored.apply(_recommended_strategy, axis=1)
    scored["why_it_ranked"] = scored.apply(_why_it_ranked, axis=1)

    return scored.sort_values(["eligible", "composite_score"], ascending=[False, False]).reset_index(drop=True)


def build_strategy_shortlists(scored: pd.DataFrame, top_n: int) -> dict[str, pd.DataFrame]:
    """Return top-N strategy-specific ranked views."""

    eligible = scored[scored["eligible"]].copy()
    return {
        "cash_secured_puts": eligible[eligible["suitable_cash_secured_puts"]]
        .sort_values("cash_secured_put_score", ascending=False)
        .head(top_n),
        "covered_calls": eligible[eligible["suitable_covered_calls"]]
        .sort_values("covered_call_score", ascending=False)
        .head(top_n),
        "wheel": eligible[eligible["suitable_wheel"]].sort_values("wheel_score", ascending=False).head(top_n),
        "watchlist": eligible[eligible["suitable_watchlist"]]
        .sort_values("composite_score", ascending=False)
        .head(top_n),
    }


def _recommended_strategy(row: pd.Series) -> str:
    strategy_scores = {
        "cash_secured_puts": row.get("cash_secured_put_score", 0.0),
        "covered_calls": row.get("covered_call_score", 0.0),
        "wheel": row.get("wheel_score", 0.0),
        "watchlist": row.get("watchlist_score", 0.0),
    }
    if not row.get("eligible", False):
        return "excluded"
    ranked = sorted(strategy_scores.items(), key=lambda item: item[1], reverse=True)
    best_name, best_score = ranked[0]
    return best_name if best_score >= 0.55 else "watchlist"


def _why_it_ranked(row: pd.Series) -> str:
    if not row.get("eligible", False):
        return f"Excluded: {row.get('exclusion_reasons', 'failed filters')}"

    reasons: list[str] = []
    if row.get("beta_component", 0.0) >= 0.70:
        reasons.append("High beta vs QQQ/SPY")
    if row.get("implied_vol_component", 0.0) >= 0.70:
        reasons.append("Elevated ATM IV")
    if row.get("option_liquidity_component", 0.0) >= 0.70:
        reasons.append("Strong option liquidity")
    if row.get("iv_vs_realized_component", 0.0) >= 0.70:
        reasons.append("IV well above realized vol")
    if row.get("recurring_moves_component", 0.0) >= 0.70:
        reasons.append("Frequent large gaps and ATR")
    if row.get("tradability_component", 0.0) >= 0.70:
        reasons.append("Multiple sellable 10-30 delta strikes")
    if row.get("persistent_iv_component", 0.0) >= 0.65:
        reasons.append("Persistent elevated IV backdrop")
    if not reasons:
        reasons.append("Balanced beta, IV, and liquidity profile")
    return ", ".join(reasons[:4])


def _theme_cluster_score(scored: pd.DataFrame) -> pd.Series:
    if "theme_cluster" not in scored.columns or scored["theme_cluster"].isna().all():
        return pd.Series(0.5, index=scored.index)
    theme_iv = scored.groupby("theme_cluster")["atm_front_month_iv"].transform("mean")
    return _percentile_score(theme_iv).fillna(0.5)


def _row_mean(series_list: list[pd.Series]) -> pd.Series:
    concatenated = pd.concat(series_list, axis=1)
    return concatenated.mean(axis=1, skipna=True).fillna(0.5)


def _percentile_score(series: pd.Series, invert: bool = False) -> pd.Series:
    numeric = pd.to_numeric(series, errors="coerce")
    if numeric.dropna().empty:
        scored = pd.Series(0.5, index=series.index)
    elif numeric.nunique(dropna=True) <= 1:
        scored = pd.Series(0.5, index=series.index)
    else:
        scored = numeric.rank(method="average", pct=True)
        scored = scored.fillna(scored.dropna().median() if not scored.dropna().empty else 0.5)
    return 1.0 - scored if invert else scored
