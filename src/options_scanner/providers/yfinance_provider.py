"""Example yfinance-backed providers for current market snapshots."""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Sequence

import pandas as pd

from .base import OptionsChainProvider, PriceDataProvider, ReferenceDataProvider


LOGGER = logging.getLogger(__name__)


def _load_yfinance():
    try:
        import yfinance as yf
    except ImportError as exc:  # pragma: no cover - import guard
        raise RuntimeError("yfinance is not installed. Add it to requirements.txt and pip install -r requirements.txt.") from exc
    return yf


class YFinancePriceDataProvider(PriceDataProvider):
    """Price history via yfinance. Best for prototyping, not institutional history research."""

    name = "yfinance"

    def get_prices(self, tickers: Sequence[str], start_date: date, end_date: date) -> pd.DataFrame:
        yf = _load_yfinance()
        download_end = end_date + timedelta(days=1)
        data = yf.download(
            tickers=list(tickers),
            start=start_date.isoformat(),
            end=download_end.isoformat(),
            auto_adjust=False,
            group_by="ticker",
            progress=False,
            threads=True,
        )
        frames: list[pd.DataFrame] = []
        if data.empty:
            return pd.DataFrame(columns=["ticker", "date", "open", "high", "low", "close", "volume"])

        if isinstance(data.columns, pd.MultiIndex):
            for ticker in tickers:
                if ticker not in data.columns.get_level_values(0):
                    continue
                frame = data[ticker].reset_index()
                frame.columns = [str(column).lower().replace(" ", "_") for column in frame.columns]
                frame["ticker"] = ticker
                frames.append(frame[["ticker", "date", "open", "high", "low", "close", "volume"]])
        else:
            frame = data.reset_index()
            frame.columns = [str(column).lower().replace(" ", "_") for column in frame.columns]
            frame["ticker"] = tickers[0]
            frames.append(frame[["ticker", "date", "open", "high", "low", "close", "volume"]])

        result = pd.concat(frames, ignore_index=True)
        result["date"] = pd.to_datetime(result["date"]).dt.date
        return result


class YFinanceOptionsChainProvider(OptionsChainProvider):
    """Current options chains from yfinance. Historical as-of snapshots are not supported."""

    name = "yfinance"

    def get_options_chain(self, tickers: Sequence[str], as_of_date: date) -> pd.DataFrame:
        yf = _load_yfinance()
        if as_of_date != date.today():
            LOGGER.warning(
                "yfinance does not provide historical point-in-time option chains. Requested %s; fetching latest available chains instead.",
                as_of_date.isoformat(),
            )

        frames: list[pd.DataFrame] = []
        for ticker in tickers:
            instrument = yf.Ticker(ticker)
            expirations = instrument.options or []
            if not expirations:
                continue
            history = instrument.history(period="5d")
            if history.empty:
                continue
            spot = float(history["Close"].iloc[-1])
            for expiration in expirations:
                chain = instrument.option_chain(expiration)
                for option_type, raw_frame in (("call", chain.calls), ("put", chain.puts)):
                    if raw_frame is None or raw_frame.empty:
                        continue
                    frame = raw_frame.copy()
                    frame["ticker"] = ticker
                    frame["as_of_date"] = as_of_date.isoformat()
                    frame["expiration"] = expiration
                    frame["dte"] = (pd.to_datetime(expiration).date() - as_of_date).days
                    frame["option_type"] = option_type
                    frame["mid"] = (frame["bid"].fillna(0.0) + frame["ask"].fillna(0.0)) / 2.0
                    frame["mark"] = frame["lastPrice"].fillna(frame["mid"])
                    frame["underlying_price"] = spot
                    frame = frame.rename(
                        columns={
                            "openInterest": "open_interest",
                            "impliedVolatility": "implied_vol",
                            "lastTradeDate": "last_trade_date",
                            "strike": "strike",
                            "volume": "volume",
                            "bid": "bid",
                            "ask": "ask",
                        }
                    )
                    frame["delta"] = pd.NA
                    keep = [
                        "ticker",
                        "as_of_date",
                        "expiration",
                        "dte",
                        "option_type",
                        "strike",
                        "bid",
                        "ask",
                        "mid",
                        "mark",
                        "volume",
                        "open_interest",
                        "implied_vol",
                        "delta",
                        "underlying_price",
                    ]
                    frames.append(frame[keep])
        if not frames:
            return pd.DataFrame()
        return pd.concat(frames, ignore_index=True)


class YFinanceReferenceDataProvider(ReferenceDataProvider):
    """Reference metadata via yfinance info fields."""

    name = "yfinance"

    def get_reference_data(self, tickers: Sequence[str], as_of_date: date) -> pd.DataFrame:
        yf = _load_yfinance()
        rows: list[dict[str, object]] = []
        for ticker in tickers:
            instrument = yf.Ticker(ticker)
            info = instrument.info or {}
            quote_type = str(info.get("quoteType", "")).lower()
            rows.append(
                {
                    "ticker": ticker,
                    "sector": info.get("sector"),
                    "industry": info.get("industry"),
                    "theme_cluster": info.get("industry") or info.get("sector"),
                    "market_cap": info.get("marketCap"),
                    "shares_outstanding": info.get("sharesOutstanding"),
                    "is_etf": quote_type == "etf",
                    "is_leveraged_etf": bool(info.get("fundFamily")) and ticker.upper().endswith(("QQQ", "TQQQ", "SOXL", "LABU")),
                    "is_chinese_adr": str(info.get("country", "")).lower() == "china",
                    "next_earnings_date": None,
                    "binary_event_risk": False,
                }
            )
        return pd.DataFrame(rows)
