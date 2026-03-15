"""Synthetic providers that make the pipeline runnable without external APIs."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
import hashlib
from math import exp, log, sqrt
from typing import Sequence

import numpy as np
import pandas as pd
from scipy.stats import norm

from .base import OptionsChainProvider, PriceDataProvider, ReferenceDataProvider


RISK_FREE_RATE = 0.04


@dataclass(frozen=True)
class TickerProfile:
    ticker: str
    sector: str
    industry: str
    theme: str
    start_price: float
    market_cap: float
    shares_outstanding: float
    avg_volume: float
    beta_spy: float
    beta_qqq: float
    idio_vol: float
    jump_prob: float
    jump_scale: float
    base_iv: float
    put_skew: float
    call_skew: float
    option_liquidity: float
    option_spread: float
    next_earnings_offset_days: int
    is_etf: bool = False
    is_leveraged_etf: bool = False
    is_chinese_adr: bool = False
    binary_event_risk: bool = False
    theme_beta: float = 0.0


PROFILES: dict[str, TickerProfile] = {
    "IREN": TickerProfile("IREN", "Information Technology", "Bitcoin Mining", "BTC Miners", 11.5, 2_000_000_000, 185_000_000, 18_000_000, 1.8, 2.3, 0.035, 0.09, 0.10, 1.05, 0.35, 0.10, 0.82, 0.08, 22, theme_beta=1.8),
    "CIFR": TickerProfile("CIFR", "Information Technology", "Bitcoin Mining", "BTC Miners", 5.8, 1_400_000_000, 240_000_000, 14_000_000, 1.7, 2.1, 0.034, 0.09, 0.09, 0.98, 0.34, 0.10, 0.78, 0.09, 18, theme_beta=1.6),
    "MARA": TickerProfile("MARA", "Information Technology", "Bitcoin Mining", "BTC Miners", 24.0, 6_200_000_000, 255_000_000, 30_000_000, 1.9, 2.4, 0.032, 0.08, 0.09, 0.94, 0.30, 0.10, 0.95, 0.06, 15, theme_beta=1.5),
    "RIOT": TickerProfile("RIOT", "Information Technology", "Bitcoin Mining", "BTC Miners", 14.0, 4_300_000_000, 307_000_000, 22_000_000, 1.7, 2.2, 0.031, 0.08, 0.08, 0.90, 0.29, 0.10, 0.90, 0.07, 10, theme_beta=1.5),
    "CLSK": TickerProfile("CLSK", "Information Technology", "Bitcoin Mining", "BTC Miners", 17.5, 3_800_000_000, 215_000_000, 19_000_000, 1.6, 2.0, 0.030, 0.07, 0.08, 0.88, 0.27, 0.09, 0.78, 0.08, 16, theme_beta=1.4),
    "WULF": TickerProfile("WULF", "Information Technology", "Bitcoin Mining", "BTC Miners", 7.2, 1_600_000_000, 222_000_000, 12_000_000, 1.6, 2.0, 0.032, 0.08, 0.09, 0.96, 0.31, 0.10, 0.68, 0.10, 24, theme_beta=1.4),
    "BTDR": TickerProfile("BTDR", "Information Technology", "Bitcoin Mining", "BTC Miners", 13.5, 2_600_000_000, 192_000_000, 9_000_000, 1.5, 1.9, 0.031, 0.07, 0.08, 0.91, 0.27, 0.09, 0.58, 0.11, 35, is_chinese_adr=True, theme_beta=1.3),
    "TSLA": TickerProfile("TSLA", "Consumer Discretionary", "Auto Manufacturers", "EV", 220.0, 705_000_000_000, 3_200_000_000, 85_000_000, 1.5, 1.7, 0.024, 0.04, 0.06, 0.58, 0.16, 0.07, 0.99, 0.04, 28, theme_beta=0.8),
    "PLTR": TickerProfile("PLTR", "Technology", "Software - Infrastructure", "AI Infra", 28.0, 65_000_000_000, 2_320_000_000, 60_000_000, 1.4, 1.7, 0.022, 0.03, 0.05, 0.54, 0.14, 0.08, 0.85, 0.04, 20, theme_beta=0.9),
    "APP": TickerProfile("APP", "Communication Services", "Advertising Agencies", "Ad Tech", 118.0, 43_000_000_000, 365_000_000, 4_200_000, 1.4, 1.5, 0.026, 0.04, 0.06, 0.67, 0.15, 0.08, 0.66, 0.05, 17, theme_beta=0.9),
    "SMR": TickerProfile("SMR", "Industrials", "Specialty Industrial Machinery", "Nuclear", 22.0, 5_100_000_000, 230_000_000, 5_200_000, 1.5, 1.6, 0.030, 0.05, 0.07, 0.79, 0.24, 0.08, 0.52, 0.09, 12, theme_beta=1.1),
    "OKLO": TickerProfile("OKLO", "Utilities", "Utilities - Regulated Electric", "Nuclear", 26.0, 3_700_000_000, 142_000_000, 7_400_000, 1.6, 1.8, 0.032, 0.06, 0.08, 0.86, 0.24, 0.08, 0.55, 0.10, 8, theme_beta=1.1),
    "SOUN": TickerProfile("SOUN", "Technology", "Software - Application", "AI Infra", 9.0, 3_200_000_000, 355_000_000, 21_000_000, 1.7, 1.9, 0.033, 0.07, 0.08, 0.93, 0.25, 0.08, 0.61, 0.11, 14, theme_beta=1.2),
    "RKLB": TickerProfile("RKLB", "Industrials", "Aerospace & Defense", "Space", 19.0, 9_500_000_000, 505_000_000, 7_000_000, 1.5, 1.6, 0.025, 0.03, 0.05, 0.63, 0.18, 0.08, 0.57, 0.07, 27, theme_beta=0.8),
    "HIMS": TickerProfile("HIMS", "Healthcare", "Health Information Services", "Consumer Health", 36.0, 8_100_000_000, 225_000_000, 9_500_000, 1.3, 1.4, 0.021, 0.03, 0.04, 0.49, 0.11, 0.06, 0.52, 0.06, 19, theme_beta=0.6),
    "NVDA": TickerProfile("NVDA", "Technology", "Semiconductors", "AI Infra", 810.0, 1_980_000_000_000, 2_450_000_000, 46_000_000, 1.4, 1.5, 0.020, 0.02, 0.04, 0.43, 0.08, 0.05, 0.99, 0.03, 21, theme_beta=0.7),
    "SPY": TickerProfile("SPY", "ETF", "Index Fund", "Market", 520.0, 480_000_000_000, 925_000_000, 80_000_000, 1.0, 1.0, 0.010, 0.00, 0.00, 0.19, 0.02, 0.02, 1.00, 0.02, 42, is_etf=True),
    "QQQ": TickerProfile("QQQ", "ETF", "Index Fund", "Market", 450.0, 250_000_000_000, 555_000_000, 58_000_000, 1.1, 1.15, 0.013, 0.00, 0.00, 0.24, 0.03, 0.02, 0.99, 0.02, 42, is_etf=True),
    "XBI": TickerProfile("XBI", "ETF", "Biotech ETF", "Biotech", 92.0, 6_000_000_000, 65_000_000, 11_000_000, 1.1, 1.0, 0.018, 0.00, 0.00, 0.27, 0.05, 0.04, 0.84, 0.04, 42, is_etf=True),
}


THEME_FACTOR_NAMES = {
    "BTC Miners": "crypto_factor",
    "AI Infra": "ai_factor",
    "Nuclear": "nuclear_factor",
    "EV": "ev_factor",
    "Space": "space_factor",
    "Ad Tech": "ad_tech_factor",
    "Consumer Health": "consumer_health_factor",
    "Market": "market_factor",
}


def _rng_seed(*parts: object) -> int:
    digest = hashlib.sha256("|".join(str(part) for part in parts).encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


def _get_profile(ticker: str) -> TickerProfile:
    ticker = ticker.upper()
    if ticker in PROFILES:
        return PROFILES[ticker]

    rng = np.random.default_rng(_rng_seed("profile", ticker))
    start_price = float(rng.uniform(8, 120))
    shares_outstanding = float(rng.integers(80_000_000, 1_000_000_000))
    market_cap = start_price * shares_outstanding
    avg_volume = float(rng.integers(2_000_000, 18_000_000))
    return TickerProfile(
        ticker=ticker,
        sector="Technology",
        industry="Software",
        theme="Generic High Beta",
        start_price=start_price,
        market_cap=market_cap,
        shares_outstanding=shares_outstanding,
        avg_volume=avg_volume,
        beta_spy=float(rng.uniform(1.1, 1.7)),
        beta_qqq=float(rng.uniform(1.2, 1.9)),
        idio_vol=float(rng.uniform(0.02, 0.035)),
        jump_prob=float(rng.uniform(0.02, 0.08)),
        jump_scale=float(rng.uniform(0.04, 0.09)),
        base_iv=float(rng.uniform(0.45, 0.95)),
        put_skew=float(rng.uniform(0.10, 0.30)),
        call_skew=float(rng.uniform(0.05, 0.12)),
        option_liquidity=float(rng.uniform(0.35, 0.75)),
        option_spread=float(rng.uniform(0.05, 0.12)),
        next_earnings_offset_days=int(rng.integers(9, 42)),
        binary_event_risk=False,
        theme_beta=float(rng.uniform(0.5, 1.2)),
    )


def _market_factor_frame(start_date: date, end_date: date, as_of_date: date) -> pd.DataFrame:
    dates = pd.bdate_range(start=start_date, end=end_date)
    rng = np.random.default_rng(_rng_seed("market", as_of_date))
    spy_ret = rng.normal(0.0004, 0.0115, len(dates))
    qqq_ret = spy_ret * 1.12 + rng.normal(0.0001, 0.0065, len(dates))
    factor_frame = pd.DataFrame(
        {
            "date": dates,
            "spy_ret": spy_ret,
            "qqq_ret": qqq_ret,
            "crypto_factor": rng.normal(0.0005, 0.025, len(dates)),
            "ai_factor": rng.normal(0.0004, 0.018, len(dates)),
            "nuclear_factor": rng.normal(0.0004, 0.022, len(dates)),
            "ev_factor": rng.normal(0.0002, 0.017, len(dates)),
            "space_factor": rng.normal(0.0003, 0.016, len(dates)),
            "ad_tech_factor": rng.normal(0.0003, 0.017, len(dates)),
            "consumer_health_factor": rng.normal(0.0002, 0.012, len(dates)),
            "market_factor": spy_ret,
        }
    )
    return factor_frame


def _generate_price_history(ticker: str, start_date: date, end_date: date, as_of_date: date) -> pd.DataFrame:
    profile = _get_profile(ticker)
    factors = _market_factor_frame(start_date, end_date, as_of_date)
    rng = np.random.default_rng(_rng_seed("price", ticker, as_of_date))

    factor_name = THEME_FACTOR_NAMES.get(profile.theme, "market_factor")
    theme_factor = factors[factor_name].to_numpy()
    spy_ret = factors["spy_ret"].to_numpy()
    qqq_ret = factors["qqq_ret"].to_numpy()

    if ticker == "SPY":
        total_ret = spy_ret
    elif ticker == "QQQ":
        total_ret = qqq_ret
    else:
        total_ret = (
            profile.beta_spy * spy_ret
            + max(profile.beta_qqq - profile.beta_spy, 0.0) * (qqq_ret - spy_ret)
            + profile.theme_beta * theme_factor
            + rng.normal(0.0002, profile.idio_vol, len(factors))
        )
        jump_mask = rng.random(len(factors)) < profile.jump_prob
        total_ret += jump_mask * rng.normal(0.0, profile.jump_scale, len(factors))

    overnight_noise = rng.normal(0.0, profile.idio_vol * 0.35 + 0.004, len(factors))
    gap_jump_mask = rng.random(len(factors)) < profile.jump_prob * 0.6
    overnight_noise += gap_jump_mask * rng.normal(0.0, profile.jump_scale * 0.75, len(factors))

    close_prices: list[float] = []
    open_prices: list[float] = []
    high_prices: list[float] = []
    low_prices: list[float] = []
    volumes: list[int] = []

    prev_close = profile.start_price
    for index, daily_ret in enumerate(total_ret):
        open_price = max(1.0, prev_close * exp(overnight_noise[index]))
        close_price = max(1.0, open_price * exp(daily_ret - overnight_noise[index]))
        intraday_range = abs(daily_ret) * 1.4 + abs(overnight_noise[index]) * 0.8 + rng.uniform(0.002, 0.02)
        high_price = max(open_price, close_price) * (1.0 + intraday_range)
        low_price = min(open_price, close_price) * max(0.55, 1.0 - intraday_range * 0.9)
        liquidity_boost = 1.0 + abs(daily_ret) * 14.0 + abs(overnight_noise[index]) * 6.0
        volume = int(max(50_000, profile.avg_volume * liquidity_boost * rng.uniform(0.7, 1.4)))

        close_prices.append(close_price)
        open_prices.append(open_price)
        high_prices.append(high_price)
        low_prices.append(low_price)
        volumes.append(volume)
        prev_close = close_price

    frame = pd.DataFrame(
        {
            "ticker": ticker,
            "date": factors["date"].dt.date,
            "open": np.round(open_prices, 4),
            "high": np.round(high_prices, 4),
            "low": np.round(low_prices, 4),
            "close": np.round(close_prices, 4),
            "volume": volumes,
        }
    )
    return frame


def _next_fridays(as_of_date: date, count: int = 8) -> list[date]:
    expirations: list[date] = []
    current = as_of_date + timedelta(days=1)
    while len(expirations) < count:
        if current.weekday() == 4:
            expirations.append(current)
        current += timedelta(days=1)
    return expirations


def _black_scholes_price(spot: float, strike: float, time_to_expiry: float, sigma: float, option_type: str) -> float:
    if time_to_expiry <= 0 or sigma <= 0 or spot <= 0 or strike <= 0:
        intrinsic = max(0.0, spot - strike) if option_type == "call" else max(0.0, strike - spot)
        return intrinsic
    d1 = (log(spot / strike) + (RISK_FREE_RATE + 0.5 * sigma**2) * time_to_expiry) / (sigma * sqrt(time_to_expiry))
    d2 = d1 - sigma * sqrt(time_to_expiry)
    if option_type == "call":
        return spot * norm.cdf(d1) - strike * exp(-RISK_FREE_RATE * time_to_expiry) * norm.cdf(d2)
    return strike * exp(-RISK_FREE_RATE * time_to_expiry) * norm.cdf(-d2) - spot * norm.cdf(-d1)


def _black_scholes_delta(spot: float, strike: float, time_to_expiry: float, sigma: float, option_type: str) -> float:
    if time_to_expiry <= 0 or sigma <= 0 or spot <= 0 or strike <= 0:
        return 0.0
    d1 = (log(spot / strike) + (RISK_FREE_RATE + 0.5 * sigma**2) * time_to_expiry) / (sigma * sqrt(time_to_expiry))
    if option_type == "call":
        return float(norm.cdf(d1))
    return float(norm.cdf(d1) - 1.0)


def _generate_options_chain(ticker: str, as_of_date: date) -> pd.DataFrame:
    profile = _get_profile(ticker)
    price_frame = _generate_price_history(ticker, as_of_date - timedelta(days=45), as_of_date, as_of_date)
    spot = float(price_frame["close"].iloc[-1])
    expirations = _next_fridays(as_of_date, count=10)
    strike_step = max(1.0, round(spot * 0.025))
    strikes = np.arange(max(1.0, spot * 0.55), spot * 1.45 + strike_step, strike_step)
    rng = np.random.default_rng(_rng_seed("options", ticker, as_of_date))

    rows: list[dict[str, float | int | str]] = []
    for expiration in expirations:
        dte = max((expiration - as_of_date).days, 1)
        time_to_expiry = dte / 365.0
        term_bump = max(0.0, 0.16 - 0.0014 * dte)
        for strike in strikes:
            moneyness = strike / spot - 1.0
            abs_moneyness = abs(moneyness)
            for option_type in ("call", "put"):
                skew = 0.0
                if option_type == "put" and moneyness < 0:
                    skew += profile.put_skew * abs(moneyness) * 2.0
                if option_type == "call" and moneyness > 0:
                    skew += profile.call_skew * abs(moneyness) * 2.0
                sigma = max(0.18, profile.base_iv + term_bump + skew + abs_moneyness * 0.18)
                price_mid = _black_scholes_price(spot, strike, time_to_expiry, sigma, option_type)
                delta = _black_scholes_delta(spot, strike, time_to_expiry, sigma, option_type)
                spread_pct = min(0.45, profile.option_spread + abs_moneyness * 0.22 + (1.0 - profile.option_liquidity) * 0.12)
                spread_pct *= rng.uniform(0.85, 1.20)
                spread_pct = max(0.02, spread_pct)
                bid = max(0.01, price_mid * (1.0 - spread_pct / 2.0))
                ask = max(bid + 0.01, price_mid * (1.0 + spread_pct / 2.0))
                mid = (bid + ask) / 2.0
                volume_base = profile.option_liquidity * 2200 * exp(-abs_moneyness * 14.0) * (55 / (dte + 10))
                oi_base = profile.option_liquidity * 6500 * exp(-abs_moneyness * 10.0) * (75 / (dte + 15))
                if option_type == "put":
                    oi_base *= 1.15
                    volume_base *= 1.10
                volume = int(max(0, volume_base * rng.uniform(0.4, 1.7)))
                open_interest = int(max(0, oi_base * rng.uniform(0.6, 1.8)))
                rows.append(
                    {
                        "ticker": ticker,
                        "as_of_date": as_of_date.isoformat(),
                        "expiration": expiration.isoformat(),
                        "dte": dte,
                        "option_type": option_type,
                        "strike": round(float(strike), 2),
                        "bid": round(float(bid), 4),
                        "ask": round(float(ask), 4),
                        "mid": round(float(mid), 4),
                        "mark": round(float(mid), 4),
                        "volume": volume,
                        "open_interest": open_interest,
                        "implied_vol": round(float(sigma), 4),
                        "delta": round(float(delta), 4),
                        "underlying_price": round(float(spot), 4),
                    }
                )
    return pd.DataFrame(rows)


class MockPriceDataProvider(PriceDataProvider):
    """Deterministic synthetic price histories for local development and testing."""

    name = "mock"

    def get_prices(self, tickers: Sequence[str], start_date: date, end_date: date) -> pd.DataFrame:
        frames = [_generate_price_history(ticker.upper(), start_date, end_date, end_date) for ticker in tickers]
        return pd.concat(frames, ignore_index=True)


class MockOptionsChainProvider(OptionsChainProvider):
    """Synthetic option chains that resemble high-beta optionable US equities."""

    name = "mock"

    def get_options_chain(self, tickers: Sequence[str], as_of_date: date) -> pd.DataFrame:
        frames = [_generate_options_chain(ticker.upper(), as_of_date) for ticker in tickers]
        return pd.concat(frames, ignore_index=True)


class MockReferenceDataProvider(ReferenceDataProvider):
    """Synthetic equity metadata and event flags."""

    name = "mock"

    def get_reference_data(self, tickers: Sequence[str], as_of_date: date) -> pd.DataFrame:
        rows: list[dict[str, object]] = []
        for ticker in tickers:
            profile = _get_profile(ticker.upper())
            rows.append(
                {
                    "ticker": profile.ticker,
                    "sector": profile.sector,
                    "industry": profile.industry,
                    "theme_cluster": profile.theme,
                    "market_cap": profile.market_cap,
                    "shares_outstanding": profile.shares_outstanding,
                    "is_etf": profile.is_etf,
                    "is_leveraged_etf": profile.is_leveraged_etf,
                    "is_chinese_adr": profile.is_chinese_adr,
                    "next_earnings_date": (as_of_date + timedelta(days=profile.next_earnings_offset_days)).isoformat(),
                    "binary_event_risk": profile.binary_event_risk,
                }
            )
        return pd.DataFrame(rows)
