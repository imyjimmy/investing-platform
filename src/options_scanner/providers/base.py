"""Abstract provider interfaces for price, options, and reference data."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date
from typing import Sequence

import pandas as pd


class PriceDataProvider(ABC):
    """Fetches daily OHLCV price history."""

    name: str

    @abstractmethod
    def get_prices(self, tickers: Sequence[str], start_date: date, end_date: date) -> pd.DataFrame:
        """Return columns: ticker, date, open, high, low, close, volume."""


class OptionsChainProvider(ABC):
    """Fetches a point-in-time option chain snapshot."""

    name: str

    @abstractmethod
    def get_options_chain(self, tickers: Sequence[str], as_of_date: date) -> pd.DataFrame:
        """
        Return columns:
        ticker, as_of_date, expiration, dte, option_type, strike, bid, ask, mid,
        mark, volume, open_interest, implied_vol, delta, underlying_price.
        """


class ReferenceDataProvider(ABC):
    """Fetches reference metadata for equities."""

    name: str

    @abstractmethod
    def get_reference_data(self, tickers: Sequence[str], as_of_date: date) -> pd.DataFrame:
        """
        Return columns:
        ticker, sector, industry, market_cap, shares_outstanding, is_etf,
        is_leveraged_etf, is_chinese_adr, next_earnings_date, binary_event_risk.
        """


@dataclass
class ProviderBundle:
    """Container for the active provider implementations."""

    price_provider: PriceDataProvider
    options_provider: OptionsChainProvider
    reference_provider: ReferenceDataProvider
