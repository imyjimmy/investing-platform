"""Feature engineering for volatility, liquidity, and tradability metrics."""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Iterable

import numpy as np
import pandas as pd

from .config import AppConfig
from .storage import LocalDataStore


LOGGER = logging.getLogger(__name__)

BIOTECH_KEYWORDS = ("biotech", "pharma", "pharmaceutical", "drug", "therapeutic", "life sciences")
CHINA_KEYWORDS = ("china", "hong kong")
BTC_MINER_TICKERS = {"IREN", "CIFR", "MARA", "RIOT", "CLSK", "WULF", "BTBT", "BTDR", "HIVE"}


def build_feature_frame(raw_data: dict[str, pd.DataFrame], config: AppConfig, store: LocalDataStore) -> pd.DataFrame:
    """Create a reproducible feature layer using immutable raw inputs only."""

    prices = raw_data["prices"].copy()
    options = raw_data["options"].copy()
    reference = raw_data["reference"].copy()

    benchmarks = _benchmark_return_map(prices, config.universe.benchmark_tickers)
    option_history = store.load_option_snapshot_history(config.runtime.as_of_date, config.runtime.iv_history_lookback_days)

    feature_rows: list[dict[str, object]] = []
    universe = config.universe.get_universe_tickers(config.project_root())
    for ticker in universe:
        price_frame = prices[prices["ticker"] == ticker].copy()
        option_frame = options[options["ticker"] == ticker].copy()
        reference_row = reference[reference["ticker"] == ticker]
        if price_frame.empty:
            LOGGER.warning("Skipping %s because no price history was available.", ticker)
            continue

        stock_features = _compute_stock_features(price_frame, benchmarks, config)
        option_features = _compute_option_features(option_frame, config)
        historical_iv_features = _compute_historical_iv_features(ticker, option_history, config)
        metadata_features = _compute_metadata_features(ticker, reference_row, config)

        merged = {
            "ticker": ticker,
            **stock_features,
            **option_features,
            **historical_iv_features,
            **metadata_features,
        }
        merged["iv_to_hv20"] = _safe_divide(merged.get("atm_front_month_iv"), merged.get("hv20"))
        merged["iv_to_hv60"] = _safe_divide(merged.get("atm_front_month_iv"), merged.get("hv60"))
        merged["iv_minus_hv20"] = _safe_subtract(merged.get("atm_front_month_iv"), merged.get("hv20"))
        merged["iv_minus_hv60"] = _safe_subtract(merged.get("atm_30_45d_iv"), merged.get("hv60"))
        merged["tradability_balance"] = _safe_mean(
            [merged.get("put_candidate_count"), merged.get("call_candidate_count")]
        )
        merged["eligible"], merged["exclusion_reasons"] = _evaluate_eligibility(merged, config)
        feature_rows.append(merged)

    feature_frame = pd.DataFrame(feature_rows)
    if feature_frame.empty:
        return feature_frame

    feature_frame = feature_frame.sort_values("ticker").reset_index(drop=True)
    return feature_frame


def _benchmark_return_map(prices: pd.DataFrame, benchmark_tickers: Iterable[str]) -> dict[str, pd.Series]:
    benchmark_returns: dict[str, pd.Series] = {}
    for benchmark in benchmark_tickers:
        benchmark_frame = prices[prices["ticker"] == benchmark].copy()
        if benchmark_frame.empty:
            continue
        benchmark_frame = benchmark_frame.sort_values("date")
        benchmark_frame["return"] = benchmark_frame["close"].pct_change()
        benchmark_returns[benchmark] = benchmark_frame.set_index("date")["return"]
    return benchmark_returns


def _compute_stock_features(price_frame: pd.DataFrame, benchmark_returns: dict[str, pd.Series], config: AppConfig) -> dict[str, float | int | None]:
    price_frame = price_frame.sort_values("date").copy()
    price_frame["return"] = price_frame["close"].pct_change()
    price_frame["prev_close"] = price_frame["close"].shift(1)
    price_frame["gap_return"] = price_frame["open"] / price_frame["prev_close"] - 1.0

    daily_returns = price_frame["return"].dropna()
    latest_close = float(price_frame["close"].iloc[-1])
    last_date = price_frame["date"].iloc[-1]

    tr = pd.concat(
        [
            price_frame["high"] - price_frame["low"],
            (price_frame["high"] - price_frame["prev_close"]).abs(),
            (price_frame["low"] - price_frame["prev_close"]).abs(),
        ],
        axis=1,
    ).max(axis=1)

    gap_sample = price_frame["gap_return"].dropna().tail(config.strategy.gap_lookback_days)
    avg_dollar_volume_sample = (price_frame["close"] * price_frame["volume"]).tail(config.strategy.avg_dollar_volume_window)

    features: dict[str, float | int | None] = {
        "as_of_date": last_date,
        "last_close": latest_close,
        "hv20": _annualized_vol(daily_returns, 20),
        "hv60": _annualized_vol(daily_returns, 60),
        "hv90": _annualized_vol(daily_returns, 90),
        "atr_pct": _safe_divide(tr.tail(config.strategy.atr_window).mean(), latest_close),
        "avg_daily_dollar_volume_20d": float(avg_dollar_volume_sample.mean()) if not avg_dollar_volume_sample.empty else np.nan,
        "gap_freq_3pct": float((gap_sample.abs() > 0.03).mean()) if not gap_sample.empty else np.nan,
        "gap_freq_5pct": float((gap_sample.abs() > 0.05).mean()) if not gap_sample.empty else np.nan,
        "price_return_20d": _trailing_return(price_frame["close"], 20),
        "price_return_60d": _trailing_return(price_frame["close"], 60),
        "realized_move_mean_abs_20d": float(daily_returns.abs().tail(20).mean()) if not daily_returns.empty else np.nan,
    }

    stock_returns = price_frame.set_index("date")["return"]
    for benchmark_name, benchmark_series in benchmark_returns.items():
        for window in config.strategy.beta_windows:
            metric_name = f"beta_{benchmark_name.lower()}_{window}d"
            features[metric_name] = _beta(stock_returns, benchmark_series, window)
    return features


def _compute_option_features(option_frame: pd.DataFrame, config: AppConfig) -> dict[str, float | int | None]:
    if option_frame.empty:
        return {
            "atm_front_month_iv": np.nan,
            "atm_30_45d_iv": np.nan,
            "avg_near_dated_liquid_iv": np.nan,
            "put_skew": np.nan,
            "call_skew": np.nan,
            "avg_option_spread_pct": np.nan,
            "total_option_volume": 0,
            "total_option_open_interest": 0,
            "liquid_expiration_count": 0,
            "liquid_contract_count": 0,
            "put_candidate_count": 0,
            "call_candidate_count": 0,
            "avg_put_premium_yield_annualized": np.nan,
            "avg_call_premium_yield_annualized": np.nan,
            "best_put_premium_yield_annualized": np.nan,
            "best_call_premium_yield_annualized": np.nan,
        }

    chain = option_frame.copy()
    chain["mid"] = chain["mid"].fillna((chain["bid"] + chain["ask"]) / 2.0).fillna(chain["mark"])
    chain["spread_pct"] = np.where(chain["mid"] > 0, (chain["ask"] - chain["bid"]) / chain["mid"], np.nan)
    chain["abs_delta"] = chain["delta"].abs()
    chain["abs_moneyness"] = np.where(
        chain["underlying_price"] > 0,
        (chain["strike"] / chain["underlying_price"] - 1.0).abs(),
        np.nan,
    )
    chain["liquid_contract"] = (
        (chain["open_interest"].fillna(0) >= config.filters.min_option_open_interest)
        & (chain["mid"].fillna(0) > 0)
        & (chain["spread_pct"].fillna(np.inf) <= config.filters.max_option_spread_pct)
    )

    front_eligible = chain[chain["dte"] >= config.strategy.front_month_min_dte].copy()
    if front_eligible.empty:
        front_eligible = chain[chain["dte"] > 0].copy()
    front_month_iv = np.nan
    if not front_eligible.empty:
        front_dte = int(front_eligible["dte"].min())
        front_chain = front_eligible[front_eligible["dte"] == front_dte].copy()
        front_month_iv = _atm_iv(front_chain)

    target_chain = chain[
        chain["dte"].between(config.strategy.target_dte_min, config.strategy.target_dte_max, inclusive="both")
    ].copy()
    atm_target_iv = _atm_iv(target_chain)
    liquid_target = target_chain[target_chain["liquid_contract"]].copy()
    near_dated = liquid_target[liquid_target["abs_moneyness"] <= config.strategy.near_dated_moneyness_pct].copy()

    put_skew = _delta_bucket_iv(target_chain, "put", 0.20, 0.30) - atm_target_iv if not np.isnan(atm_target_iv) else np.nan
    call_skew = _delta_bucket_iv(target_chain, "call", 0.20, 0.30) - atm_target_iv if not np.isnan(atm_target_iv) else np.nan

    tradable = target_chain[
        target_chain["liquid_contract"] & (target_chain["bid"] >= config.strategy.min_option_bid)
    ].copy()
    put_candidates = tradable[
        (tradable["option_type"] == "put")
        & tradable["abs_delta"].between(config.strategy.delta_abs_min, config.strategy.delta_abs_max, inclusive="both")
    ].copy()
    call_candidates = tradable[
        (tradable["option_type"] == "call")
        & tradable["abs_delta"].between(config.strategy.delta_abs_min, config.strategy.delta_abs_max, inclusive="both")
    ].copy()

    put_candidates["annualized_yield"] = np.where(
        put_candidates["strike"] > 0,
        (put_candidates["bid"] / put_candidates["strike"]) * (365.0 / put_candidates["dte"]),
        np.nan,
    )
    call_candidates["annualized_yield"] = np.where(
        call_candidates["underlying_price"] > 0,
        (call_candidates["bid"] / call_candidates["underlying_price"]) * (365.0 / call_candidates["dte"]),
        np.nan,
    )

    liquid_expiration_count = int(
        (chain[chain["liquid_contract"]].groupby("expiration").size() >= config.strategy.liquid_expiration_min_contracts).sum()
    )

    return {
        "atm_front_month_iv": front_month_iv,
        "atm_30_45d_iv": atm_target_iv,
        "avg_near_dated_liquid_iv": float(near_dated["implied_vol"].mean()) if not near_dated.empty else np.nan,
        "put_skew": put_skew,
        "call_skew": call_skew,
        "avg_option_spread_pct": float(liquid_target["spread_pct"].mean()) if not liquid_target.empty else np.nan,
        "total_option_volume": int(chain["volume"].fillna(0).sum()),
        "total_option_open_interest": int(chain["open_interest"].fillna(0).sum()),
        "liquid_expiration_count": liquid_expiration_count,
        "liquid_contract_count": int(chain["liquid_contract"].sum()),
        "put_candidate_count": int(len(put_candidates)),
        "call_candidate_count": int(len(call_candidates)),
        "avg_put_premium_yield_annualized": float(put_candidates["annualized_yield"].mean()) if not put_candidates.empty else np.nan,
        "avg_call_premium_yield_annualized": float(call_candidates["annualized_yield"].mean()) if not call_candidates.empty else np.nan,
        "best_put_premium_yield_annualized": float(put_candidates["annualized_yield"].max()) if not put_candidates.empty else np.nan,
        "best_call_premium_yield_annualized": float(call_candidates["annualized_yield"].max()) if not call_candidates.empty else np.nan,
    }


def _compute_historical_iv_features(ticker: str, option_history: pd.DataFrame, config: AppConfig) -> dict[str, float | None]:
    if option_history.empty:
        return {"iv_rank_1y": np.nan, "iv_percentile_1y": np.nan, "iv_persistence_ratio_90d": np.nan}

    ticker_history = option_history[option_history["ticker"] == ticker].copy()
    if ticker_history.empty:
        return {"iv_rank_1y": np.nan, "iv_percentile_1y": np.nan, "iv_persistence_ratio_90d": np.nan}

    snapshot_rows: list[dict[str, object]] = []
    for snapshot_date, frame in ticker_history.groupby("as_of_date"):
        if isinstance(snapshot_date, pd.Timestamp):
            snapshot_date = snapshot_date.date()
        snapshot_features = _compute_option_features(frame, config)
        snapshot_rows.append(
            {
                "as_of_date": snapshot_date,
                "atm_30_45d_iv": snapshot_features.get("atm_30_45d_iv"),
            }
        )
    snapshot_frame = pd.DataFrame(snapshot_rows).dropna(subset=["atm_30_45d_iv"]).sort_values("as_of_date")
    if snapshot_frame.empty:
        return {"iv_rank_1y": np.nan, "iv_percentile_1y": np.nan, "iv_persistence_ratio_90d": np.nan}

    current_iv = float(snapshot_frame["atm_30_45d_iv"].iloc[-1])
    iv_min = float(snapshot_frame["atm_30_45d_iv"].min())
    iv_max = float(snapshot_frame["atm_30_45d_iv"].max())
    iv_rank = np.nan if np.isclose(iv_max, iv_min) else (current_iv - iv_min) / (iv_max - iv_min)
    iv_percentile = float((snapshot_frame["atm_30_45d_iv"] <= current_iv).mean())
    trailing_90 = snapshot_frame[snapshot_frame["as_of_date"] >= config.runtime.as_of_date - timedelta(days=90)].copy()
    if trailing_90.empty:
        persistence = np.nan
    else:
        median_iv = float(snapshot_frame["atm_30_45d_iv"].median())
        persistence = float((trailing_90["atm_30_45d_iv"] >= median_iv).mean())

    return {
        "iv_rank_1y": iv_rank,
        "iv_percentile_1y": iv_percentile,
        "iv_persistence_ratio_90d": persistence,
    }


def _compute_metadata_features(ticker: str, reference_row: pd.DataFrame, config: AppConfig) -> dict[str, object]:
    if reference_row.empty:
        sector = None
        industry = None
        market_cap = np.nan
        shares_outstanding = np.nan
        is_etf = False
        is_leveraged_etf = False
        is_chinese_adr = False
        next_earnings_date = None
        binary_event_risk = False
        theme_cluster = _infer_theme_cluster(ticker, sector, industry)
    else:
        row = reference_row.iloc[0]
        sector = row.get("sector")
        industry = row.get("industry")
        market_cap = row.get("market_cap")
        shares_outstanding = row.get("shares_outstanding")
        is_etf = bool(row.get("is_etf", False))
        is_leveraged_etf = bool(row.get("is_leveraged_etf", False))
        is_chinese_adr = bool(row.get("is_chinese_adr", False))
        next_earnings_date = row.get("next_earnings_date")
        binary_event_risk = bool(row.get("binary_event_risk", False))
        theme_cluster = row.get("theme_cluster") or _infer_theme_cluster(ticker, sector, industry)

    if pd.notna(next_earnings_date):
        earnings_within_7d = abs((next_earnings_date - config.runtime.as_of_date).days) <= 7
    else:
        earnings_within_7d = False
    sector_lower = str(sector or "").lower()
    industry_lower = str(industry or "").lower()
    biotech_or_pharma = any(keyword in sector_lower or keyword in industry_lower for keyword in BIOTECH_KEYWORDS)

    return {
        "sector": sector,
        "industry": industry,
        "theme_cluster": theme_cluster,
        "market_cap": float(market_cap) if pd.notna(market_cap) else np.nan,
        "shares_outstanding": float(shares_outstanding) if pd.notna(shares_outstanding) else np.nan,
        "is_etf": is_etf,
        "is_leveraged_etf": is_leveraged_etf,
        "is_chinese_adr": is_chinese_adr,
        "next_earnings_date": next_earnings_date,
        "earnings_within_7d": earnings_within_7d,
        "biotech_or_pharma": biotech_or_pharma,
        "binary_event_risk": bool(binary_event_risk or biotech_or_pharma),
    }


def _evaluate_eligibility(row: dict[str, object], config: AppConfig) -> tuple[bool, str]:
    reasons: list[str] = []

    if _numeric_or_nan(row.get("market_cap")) < config.filters.min_market_cap:
        reasons.append("market cap below minimum")
    if _numeric_or_nan(row.get("avg_daily_dollar_volume_20d")) < config.filters.min_daily_dollar_volume:
        reasons.append("daily dollar volume below minimum")
    if _numeric_or_nan(row.get("last_close")) < config.filters.min_stock_price:
        reasons.append("stock price below minimum")
    if _numeric_or_nan(row.get("liquid_contract_count")) == 0:
        reasons.append("no liquid option contracts")
    if _numeric_or_nan(row.get("total_option_open_interest")) < config.filters.min_option_open_interest:
        reasons.append("total option open interest below minimum")
    if _numeric_or_nan(row.get("avg_option_spread_pct")) > config.filters.max_option_spread_pct:
        reasons.append("option spread above limit")

    if config.filters.exclude_etfs and bool(row.get("is_etf")):
        reasons.append("ETF excluded")
    if config.filters.exclude_leveraged_etfs and bool(row.get("is_leveraged_etf")):
        reasons.append("leveraged ETF excluded")
    if config.filters.exclude_chinese_adrs and bool(row.get("is_chinese_adr")):
        reasons.append("Chinese ADR excluded")
    if config.filters.exclude_biotech_pharma and bool(row.get("biotech_or_pharma")):
        reasons.append("biotech/pharma excluded")
    if config.filters.exclude_earnings_week and bool(row.get("earnings_within_7d")):
        reasons.append("earnings week excluded")
    if config.filters.exclude_binary_event_names and bool(row.get("binary_event_risk")):
        reasons.append("binary event risk excluded")

    return len(reasons) == 0, "; ".join(reasons)


def _annualized_vol(returns: pd.Series, window: int) -> float:
    sample = returns.dropna().tail(window)
    if len(sample) < max(10, window // 2):
        return np.nan
    return float(sample.std(ddof=0) * np.sqrt(252.0))


def _beta(stock_returns: pd.Series, benchmark_returns: pd.Series, window: int) -> float:
    aligned = pd.concat([stock_returns, benchmark_returns], axis=1, keys=["stock", "benchmark"]).dropna().tail(window)
    if len(aligned) < max(20, window // 2):
        return np.nan
    benchmark_var = aligned["benchmark"].var(ddof=0)
    if benchmark_var == 0 or np.isnan(benchmark_var):
        return np.nan
    covariance = np.cov(aligned["stock"], aligned["benchmark"], ddof=0)[0, 1]
    return float(covariance / benchmark_var)


def _atm_iv(chain: pd.DataFrame) -> float:
    if chain.empty:
        return np.nan
    working = chain.copy()
    if working["abs_moneyness"].notna().any():
        working = working.sort_values(["abs_moneyness", "spread_pct", "open_interest"], ascending=[True, True, False])
    elif working["abs_delta"].notna().any():
        working["abs_delta_distance"] = (working["abs_delta"] - 0.50).abs()
        working = working.sort_values(["abs_delta_distance", "open_interest"], ascending=[True, False])
    else:
        working = working.sort_values(["open_interest"], ascending=False)

    calls = working[working["option_type"] == "call"].head(1)
    puts = working[working["option_type"] == "put"].head(1)
    selected = pd.concat([calls, puts], ignore_index=True)
    if selected.empty:
        return np.nan
    return float(selected["implied_vol"].mean())


def _delta_bucket_iv(chain: pd.DataFrame, option_type: str, low: float, high: float) -> float:
    subset = chain[chain["option_type"] == option_type].copy()
    if subset.empty:
        return np.nan
    if subset["abs_delta"].notna().any():
        subset = subset[subset["abs_delta"].between(low, high, inclusive="both")]
    else:
        lower_bound = 0.05 if option_type == "put" else 0.02
        upper_bound = 0.18 if option_type == "put" else 0.15
        subset = subset[subset["abs_moneyness"].between(lower_bound, upper_bound, inclusive="both")]
    if subset.empty:
        return np.nan
    subset = subset.sort_values(["open_interest", "volume"], ascending=[False, False])
    return float(subset.head(4)["implied_vol"].mean())


def _trailing_return(prices: pd.Series, window: int) -> float:
    sample = prices.dropna().tail(window + 1)
    if len(sample) < window + 1:
        return np.nan
    return float(sample.iloc[-1] / sample.iloc[0] - 1.0)


def _infer_theme_cluster(ticker: str, sector: object, industry: object) -> str:
    sector_lower = str(sector or "").lower()
    industry_lower = str(industry or "").lower()
    if ticker in BTC_MINER_TICKERS or "bitcoin" in industry_lower or "crypto" in industry_lower:
        return "BTC Miners"
    if "semiconductor" in industry_lower or "ai" in industry_lower or "software - infrastructure" in industry_lower:
        return "AI Infra"
    if "uranium" in industry_lower or "nuclear" in industry_lower:
        return "Nuclear"
    if "shipping" in industry_lower or "marine" in industry_lower:
        return "Shipping"
    if "biotech" in industry_lower or "pharma" in industry_lower:
        return "Biotech"
    if "energy" in sector_lower:
        return "Energy"
    return str(sector or "Other")


def _numeric_or_nan(value: object) -> float:
    try:
        if value is None:
            return np.nan
        return float(value)
    except (TypeError, ValueError):
        return np.nan


def _safe_divide(numerator: object, denominator: object) -> float:
    num = _numeric_or_nan(numerator)
    den = _numeric_or_nan(denominator)
    if np.isnan(num) or np.isnan(den) or den == 0:
        return np.nan
    return float(num / den)


def _safe_subtract(left: object, right: object) -> float:
    lhs = _numeric_or_nan(left)
    rhs = _numeric_or_nan(right)
    if np.isnan(lhs) or np.isnan(rhs):
        return np.nan
    return float(lhs - rhs)


def _safe_mean(values: Iterable[object]) -> float:
    numeric = [float(value) for value in values if value is not None and not pd.isna(value)]
    if not numeric:
        return np.nan
    return float(np.mean(numeric))
