"""Vendor adapter examples that can be fleshed out for production use."""

from __future__ import annotations

from datetime import date
from typing import Sequence

import pandas as pd

from .base import OptionsChainProvider, PriceDataProvider


class PolygonPriceDataProvider(PriceDataProvider):
    """Placeholder for Polygon aggregates/history integration."""

    name = "polygon"

    def __init__(self, api_key: str | None = None, base_url: str = "https://api.polygon.io") -> None:
        self.api_key = api_key
        self.base_url = base_url

    def get_prices(self, tickers: Sequence[str], start_date: date, end_date: date) -> pd.DataFrame:
        raise NotImplementedError("Implement Polygon grouped daily bars or per-ticker aggregates here.")


class PolygonOptionsChainProvider(OptionsChainProvider):
    """Placeholder for Polygon options snapshot/reference endpoints."""

    name = "polygon"

    def __init__(self, api_key: str | None = None, base_url: str = "https://api.polygon.io") -> None:
        self.api_key = api_key
        self.base_url = base_url

    def get_options_chain(self, tickers: Sequence[str], as_of_date: date) -> pd.DataFrame:
        raise NotImplementedError("Implement Polygon options snapshot fetching here.")


class TradierOptionsChainProvider(OptionsChainProvider):
    """Placeholder for Tradier options chain endpoints."""

    name = "tradier"

    def __init__(self, api_token: str | None = None, base_url: str = "https://api.tradier.com/v1") -> None:
        self.api_token = api_token
        self.base_url = base_url

    def get_options_chain(self, tickers: Sequence[str], as_of_date: date) -> pd.DataFrame:
        raise NotImplementedError("Implement Tradier option chain fetching here.")


class ORATSOptionsChainProvider(OptionsChainProvider):
    """Placeholder for ORATS historical IV and chain analytics."""

    name = "orats"

    def __init__(self, api_key: str | None = None, base_url: str = "https://api.orats.io") -> None:
        self.api_key = api_key
        self.base_url = base_url

    def get_options_chain(self, tickers: Sequence[str], as_of_date: date) -> pd.DataFrame:
        raise NotImplementedError("Implement ORATS historical chain and IV fetching here.")


class AlphaVantagePriceProvider(PriceDataProvider):
    """Placeholder for Alpha Vantage daily adjusted bars."""

    name = "alpha_vantage"

    def __init__(self, api_key: str | None = None, base_url: str = "https://www.alphavantage.co") -> None:
        self.api_key = api_key
        self.base_url = base_url

    def get_prices(self, tickers: Sequence[str], start_date: date, end_date: date) -> pd.DataFrame:
        raise NotImplementedError("Implement Alpha Vantage daily time series fetching here.")

