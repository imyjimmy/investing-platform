"""Composite stock data service for the Stock tool."""

from __future__ import annotations

from investing_platform.services.base import BrokerService, BrokerServiceError
from investing_platform.services.finnhub import FinnhubService


class MarketDataService:
    """Chooses the best available source for stock overview and financials."""

    def __init__(self, broker: BrokerService, finnhub: FinnhubService) -> None:
        self._broker = broker
        self._finnhub = finnhub

    def get_underlying_quote(self, symbol: str):
        return self._dispatch("get_underlying_quote", symbol)

    def get_ticker_overview(self, symbol: str):
        return self._dispatch("get_ticker_overview", symbol)

    def get_ticker_financials(self, symbol: str):
        return self._dispatch("get_ticker_financials", symbol)

    def _dispatch(self, method_name: str, symbol: str):
        errors: list[str] = []
        for source_name, method in self._ordered_methods(method_name):
            try:
                return method(symbol)
            except BrokerServiceError as exc:
                errors.append(f"{source_name}: {exc}")
                continue
            except ValueError as exc:
                errors.append(f"{source_name}: {exc}")
                continue
            except RuntimeError as exc:
                errors.append(f"{source_name}: {exc}")
                continue
        joined = " ".join(errors).strip()
        raise BrokerServiceError(joined or f"No stock data source could satisfy {method_name} for {symbol.upper()}.")

    def _ordered_methods(self, method_name: str):
        broker_method = getattr(self._broker, method_name)
        finnhub_method = getattr(self._finnhub, method_name)
        if self._finnhub.is_configured():
            return [("finnhub", finnhub_method), ("broker", broker_method)]
        return [("broker", broker_method)]
