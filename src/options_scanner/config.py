"""Application configuration models and loaders."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime
import os
from pathlib import Path
from typing import Any

import yaml


DEFAULT_DEMO_TICKERS = [
    "IREN",
    "CIFR",
    "MARA",
    "RIOT",
    "CLSK",
    "WULF",
    "BTDR",
    "TSLA",
    "PLTR",
    "APP",
    "SMR",
    "OKLO",
    "SOUN",
    "RKLB",
    "HIMS",
    "NVDA",
]


@dataclass
class UniverseConfig:
    """Universe selection configuration."""

    tickers: list[str] = field(default_factory=lambda: DEFAULT_DEMO_TICKERS.copy())
    universe_csv: str | None = None
    benchmark_tickers: list[str] = field(default_factory=lambda: ["SPY", "QQQ"])
    universe_name: str = "demo_high_beta_optionable"

    def get_universe_tickers(self, project_root: Path) -> list[str]:
        tickers = [ticker.upper() for ticker in self.tickers]
        if self.universe_csv:
            csv_path = Path(self.universe_csv)
            if not csv_path.is_absolute():
                csv_path = project_root / csv_path
            with csv_path.open("r", encoding="utf-8") as handle:
                rows = [line.strip().split(",")[0].upper() for line in handle.readlines() if line.strip()]
            if rows and rows[0] == "TICKER":
                rows = rows[1:]
            tickers = rows
        deduped: list[str] = []
        for ticker in tickers:
            if ticker and ticker not in deduped:
                deduped.append(ticker)
        return deduped


@dataclass
class FilterConfig:
    """Hard filters used before scoring candidates."""

    min_market_cap: float = 750_000_000.0
    min_daily_dollar_volume: float = 10_000_000.0
    min_option_open_interest: int = 250
    max_option_spread_pct: float = 0.15
    min_stock_price: float = 5.0
    exclude_earnings_week: bool = True
    exclude_biotech_pharma: bool = True
    exclude_chinese_adrs: bool = True
    exclude_etfs: bool = True
    exclude_leveraged_etfs: bool = True
    exclude_binary_event_names: bool = True


@dataclass
class StrategyConfig:
    """Feature windows and tradability rules for premium selling."""

    target_dte_min: int = 30
    target_dte_max: int = 45
    front_month_min_dte: int = 7
    delta_abs_min: float = 0.10
    delta_abs_max: float = 0.30
    min_option_bid: float = 0.25
    near_dated_moneyness_pct: float = 0.10
    atr_window: int = 14
    avg_dollar_volume_window: int = 20
    gap_lookback_days: int = 120
    beta_windows: list[int] = field(default_factory=lambda: [60, 120])
    historical_vol_windows: list[int] = field(default_factory=lambda: [20, 60, 90])
    liquid_expiration_min_contracts: int = 4


@dataclass
class ProviderConfig:
    """Provider selection and per-provider settings."""

    price_provider: str = "ibkr"
    options_provider: str = "ibkr"
    reference_provider: str = "none"
    allow_mock_providers: bool = False
    provider_settings: dict[str, dict[str, Any]] = field(default_factory=dict)

    def settings_for(self, provider_name: str) -> dict[str, Any]:
        return _resolve_env_values(self.provider_settings.get(provider_name, {}))


@dataclass
class ScoringWeights:
    """Weighted scoring model configuration."""

    beta: float = 0.18
    implied_volatility: float = 0.17
    iv_vs_realized: float = 0.18
    option_liquidity: float = 0.16
    stock_liquidity: float = 0.10
    recurring_moves: float = 0.09
    tradability: float = 0.08
    persistent_iv: float = 0.04
    theme_cluster: float = 0.00
    penalty_wide_spreads: float = 0.12
    penalty_microcap: float = 0.08
    penalty_event_risk: float = 0.10


@dataclass
class RuntimeConfig:
    """Runtime and storage behavior."""

    as_of_date: date = field(default_factory=date.today)
    data_dir: str = "data"
    lookback_days: int = 400
    top_n: int = 15
    generate_plots: bool = True
    save_raw_snapshots: bool = True
    iv_history_lookback_days: int = 365
    log_level: str = "INFO"


@dataclass
class AppConfig:
    """Top-level application configuration."""

    universe: UniverseConfig = field(default_factory=UniverseConfig)
    filters: FilterConfig = field(default_factory=FilterConfig)
    strategy: StrategyConfig = field(default_factory=StrategyConfig)
    providers: ProviderConfig = field(default_factory=ProviderConfig)
    scoring: ScoringWeights = field(default_factory=ScoringWeights)
    runtime: RuntimeConfig = field(default_factory=RuntimeConfig)

    @classmethod
    def from_yaml(cls, path: str | Path) -> "AppConfig":
        config_path = Path(path)
        with config_path.open("r", encoding="utf-8") as handle:
            raw = yaml.safe_load(handle) or {}
        return cls.from_dict(raw)

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "AppConfig":
        runtime_raw = dict(raw.get("runtime", {}))
        if "as_of_date" in runtime_raw and runtime_raw["as_of_date"]:
            runtime_raw["as_of_date"] = _coerce_date(runtime_raw["as_of_date"])
        return cls(
            universe=UniverseConfig(**raw.get("universe", {})),
            filters=FilterConfig(**raw.get("filters", {})),
            strategy=StrategyConfig(**raw.get("strategy", {})),
            providers=ProviderConfig(**raw.get("providers", {})),
            scoring=ScoringWeights(**raw.get("scoring", {})),
            runtime=RuntimeConfig(**runtime_raw),
        )

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["runtime"]["as_of_date"] = self.runtime.as_of_date.isoformat()
        return payload

    def project_root(self) -> Path:
        return Path(__file__).resolve().parents[2]

    def resolved_data_dir(self) -> Path:
        data_dir = Path(self.runtime.data_dir)
        if not data_dir.is_absolute():
            data_dir = self.project_root() / data_dir
        return data_dir


def _coerce_date(value: Any) -> date:
    if isinstance(value, date):
        return value
    if isinstance(value, datetime):
        return value.date()
    return date.fromisoformat(str(value))


def _resolve_env_values(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _resolve_env_values(inner) for key, inner in value.items()}
    if isinstance(value, list):
        return [_resolve_env_values(item) for item in value]
    if isinstance(value, str) and value.startswith("${") and value.endswith("}"):
        body = value[2:-1]
        if ":-" in body:
            env_name, default_value = body.split(":-", 1)
            return os.environ.get(env_name, default_value)
        return os.environ.get(body)
    return value
