"""Ingest raw price, options, and reference datasets via swappable providers."""

from __future__ import annotations

import inspect
import logging
from datetime import timedelta
from typing import Any

import pandas as pd

from .config import AppConfig
from .providers import (
    InteractiveBrokersOptionsProvider,
    InteractiveBrokersPriceProvider,
    MockOptionsChainProvider,
    MockPriceDataProvider,
    MockReferenceDataProvider,
    NullReferenceDataProvider,
    ProviderBundle,
    YFinanceOptionsChainProvider,
    YFinancePriceDataProvider,
    YFinanceReferenceDataProvider,
)
from .providers.vendor_stubs import (
    AlphaVantagePriceProvider,
    ORATSOptionsChainProvider,
    PolygonOptionsChainProvider,
    PolygonPriceDataProvider,
    TradierOptionsChainProvider,
)
from .storage import LocalDataStore


LOGGER = logging.getLogger(__name__)


LIVE_PRICE_PROVIDER_REGISTRY = {
    "ibkr": InteractiveBrokersPriceProvider,
    "yfinance": YFinancePriceDataProvider,
    "polygon": PolygonPriceDataProvider,
    "alpha_vantage": AlphaVantagePriceProvider,
}

LIVE_OPTIONS_PROVIDER_REGISTRY = {
    "yfinance": YFinanceOptionsChainProvider,
    "polygon": PolygonOptionsChainProvider,
    "tradier": TradierOptionsChainProvider,
    "orats": ORATSOptionsChainProvider,
    "ibkr": InteractiveBrokersOptionsProvider,
}

LIVE_REFERENCE_PROVIDER_REGISTRY = {
    "none": NullReferenceDataProvider,
    "yfinance": YFinanceReferenceDataProvider,
}

TEST_PRICE_PROVIDER_REGISTRY = {
    "mock": MockPriceDataProvider,
}

TEST_OPTIONS_PROVIDER_REGISTRY = {
    "mock": MockOptionsChainProvider,
}

TEST_REFERENCE_PROVIDER_REGISTRY = {
    "mock": MockReferenceDataProvider,
}


def build_provider_bundle(config: AppConfig) -> ProviderBundle:
    """Instantiate providers based on config."""

    price_registry = _merged_registry(LIVE_PRICE_PROVIDER_REGISTRY, TEST_PRICE_PROVIDER_REGISTRY, config.providers.allow_mock_providers)
    options_registry = _merged_registry(LIVE_OPTIONS_PROVIDER_REGISTRY, TEST_OPTIONS_PROVIDER_REGISTRY, config.providers.allow_mock_providers)
    reference_registry = _merged_registry(
        LIVE_REFERENCE_PROVIDER_REGISTRY,
        TEST_REFERENCE_PROVIDER_REGISTRY,
        config.providers.allow_mock_providers,
    )

    price_provider = _instantiate_provider(
        config.providers.price_provider,
        price_registry,
        config.providers.settings_for(config.providers.price_provider),
    )
    options_provider = _instantiate_provider(
        config.providers.options_provider,
        options_registry,
        config.providers.settings_for(config.providers.options_provider),
    )
    reference_provider = _instantiate_provider(
        config.providers.reference_provider,
        reference_registry,
        config.providers.settings_for(config.providers.reference_provider),
    )
    return ProviderBundle(
        price_provider=price_provider,
        options_provider=options_provider,
        reference_provider=reference_provider,
    )


def resolve_universe(config: AppConfig) -> list[str]:
    """Return the analysis universe excluding benchmark additions."""

    return config.universe.get_universe_tickers(config.project_root())


def ingest_raw_data(config: AppConfig, store: LocalDataStore) -> dict[str, pd.DataFrame]:
    """Fetch raw datasets and persist immutable snapshots."""

    providers = build_provider_bundle(config)
    universe = resolve_universe(config)
    all_price_tickers = _dedupe(universe + config.universe.benchmark_tickers)
    start_date = config.runtime.as_of_date - timedelta(days=config.runtime.lookback_days)
    end_date = config.runtime.as_of_date

    LOGGER.info("Fetching price history for %d tickers between %s and %s", len(all_price_tickers), start_date, end_date)
    prices = providers.price_provider.get_prices(all_price_tickers, start_date, end_date)
    LOGGER.info("Fetching options chains for %d tickers as of %s", len(universe), end_date)
    options = providers.options_provider.get_options_chain(universe, end_date)
    LOGGER.info("Fetching reference data for %d tickers", len(universe))
    reference = providers.reference_provider.get_reference_data(universe, end_date)

    prices = _normalize_price_frame(prices)
    options = _normalize_options_frame(options)
    reference = _normalize_reference_frame(reference)

    if config.runtime.save_raw_snapshots:
        store.save_raw(prices, "prices", end_date, providers.price_provider.name, "price_history.csv")
        store.save_raw(options, "options", end_date, providers.options_provider.name, "options_chain.csv")
        store.save_raw(reference, "reference", end_date, providers.reference_provider.name, "reference_data.csv")

    return {"prices": prices, "options": options, "reference": reference}


def _instantiate_provider(name: str, registry: dict[str, Any], settings: dict[str, Any]) -> Any:
    if name not in registry:
        raise ValueError(f"Unknown provider '{name}'. Available providers: {sorted(registry)}")
    provider_cls = registry[name]
    accepted_parameters = {
        parameter_name
        for parameter_name in inspect.signature(provider_cls.__init__).parameters
        if parameter_name != "self"
    }
    filtered_settings = {key: value for key, value in settings.items() if key in accepted_parameters}
    return provider_cls(**filtered_settings)


def _merged_registry(live_registry: dict[str, Any], test_registry: dict[str, Any], allow_mock_providers: bool) -> dict[str, Any]:
    if not allow_mock_providers:
        return live_registry
    merged = dict(live_registry)
    merged.update(test_registry)
    return merged


def _dedupe(items: list[str]) -> list[str]:
    seen: list[str] = []
    for item in items:
        if item not in seen:
            seen.append(item)
    return seen


def _normalize_price_frame(frame: pd.DataFrame) -> pd.DataFrame:
    normalized = frame.copy()
    if normalized.empty:
        return normalized
    normalized["ticker"] = normalized["ticker"].astype(str).str.upper()
    normalized["date"] = pd.to_datetime(normalized["date"]).dt.date
    for column in ("open", "high", "low", "close", "volume"):
        normalized[column] = pd.to_numeric(normalized[column], errors="coerce")
    normalized = normalized.sort_values(["ticker", "date"]).reset_index(drop=True)
    return normalized


def _normalize_options_frame(frame: pd.DataFrame) -> pd.DataFrame:
    normalized = frame.copy()
    if normalized.empty:
        return normalized
    normalized["ticker"] = normalized["ticker"].astype(str).str.upper()
    normalized["as_of_date"] = pd.to_datetime(normalized["as_of_date"]).dt.date
    normalized["expiration"] = pd.to_datetime(normalized["expiration"]).dt.date
    numeric_columns = [
        "dte",
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
    for column in numeric_columns:
        if column in normalized.columns:
            normalized[column] = pd.to_numeric(normalized[column], errors="coerce")
    normalized["option_type"] = normalized["option_type"].astype(str).str.lower()
    normalized = normalized.sort_values(["ticker", "expiration", "option_type", "strike"]).reset_index(drop=True)
    return normalized


def _normalize_reference_frame(frame: pd.DataFrame) -> pd.DataFrame:
    normalized = frame.copy()
    if normalized.empty:
        return normalized
    normalized["ticker"] = normalized["ticker"].astype(str).str.upper()
    if "next_earnings_date" in normalized.columns:
        normalized["next_earnings_date"] = pd.to_datetime(normalized["next_earnings_date"], errors="coerce").dt.date
    return normalized.reset_index(drop=True)
