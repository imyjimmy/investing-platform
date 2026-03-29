"""Runtime configuration for the local options dashboard."""

from __future__ import annotations

from dataclasses import dataclass, field
import os
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")


def _env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    return int(value) if value not in {None, ""} else default


def _env_float(name: str, default: float) -> float:
    value = os.environ.get(name)
    return float(value) if value not in {None, ""} else default


def _env_str(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value if value not in {None, ""} else default


def _env_optional_str(name: str) -> str | None:
    value = os.environ.get(name)
    return value if value not in {None, ""} else None


def _env_list(name: str, default: list[str]) -> list[str]:
    value = os.environ.get(name)
    if value in {None, ""}:
        return default
    return [item.strip().upper() for item in value.split(",") if item.strip()]


@dataclass(slots=True)
class DashboardSettings:
    """Environment-backed settings for the dashboard."""

    data_mode: Literal["mock", "ibkr"] = "mock"
    ib_host: str = "127.0.0.1"
    ib_port: int = 4002
    ib_client_id: int = 17
    ib_account_id: str | None = None
    ib_market_data_type: int = 1
    ib_connect_timeout_seconds: float = 8.0
    ib_request_timeout_seconds: float = 12.0
    ib_reconnect_interval_seconds: float = 5.0
    ib_underlying_exchange: str = "SMART"
    ib_option_exchange: str = "SMART"
    ib_currency: str = "USD"
    chain_expiry_limit: int = 6
    chain_strike_limit: int = 14
    chain_moneyness_pct: float = 0.18
    chain_batch_size: int = 40
    chain_cache_ttl_seconds: float = 12.0
    snapshot_cache_ttl_seconds: float = 10.0
    safety_buffer: float = 25_000.0
    watchlist_symbols: list[str] = field(
        default_factory=lambda: ["NVDA", "IREN", "AXTI", "PYPL", "GLD", "IAU", "VOO"]
    )
    backend_host: str = "127.0.0.1"
    backend_port: int = 8000
    frontend_port: int = 5173

    @classmethod
    def load(cls) -> "DashboardSettings":
        return cls(
            data_mode=_env_str("OPTIONS_DASHBOARD_DATA_MODE", "mock").lower(),  # type: ignore[arg-type]
            ib_host=_env_str("OPTIONS_DASHBOARD_IB_HOST", "127.0.0.1"),
            ib_port=_env_int("OPTIONS_DASHBOARD_IB_PORT", 4002),
            ib_client_id=_env_int("OPTIONS_DASHBOARD_IB_CLIENT_ID", 17),
            ib_account_id=_env_optional_str("OPTIONS_DASHBOARD_IB_ACCOUNT_ID"),
            ib_market_data_type=_env_int("OPTIONS_DASHBOARD_IB_MARKET_DATA_TYPE", 1),
            ib_connect_timeout_seconds=_env_float("OPTIONS_DASHBOARD_IB_CONNECT_TIMEOUT_SECONDS", 8.0),
            ib_request_timeout_seconds=_env_float("OPTIONS_DASHBOARD_IB_REQUEST_TIMEOUT_SECONDS", 12.0),
            ib_reconnect_interval_seconds=_env_float("OPTIONS_DASHBOARD_IB_RECONNECT_INTERVAL_SECONDS", 5.0),
            ib_underlying_exchange=_env_str("OPTIONS_DASHBOARD_IB_UNDERLYING_EXCHANGE", "SMART"),
            ib_option_exchange=_env_str("OPTIONS_DASHBOARD_IB_OPTION_EXCHANGE", "SMART"),
            ib_currency=_env_str("OPTIONS_DASHBOARD_IB_CURRENCY", "USD"),
            chain_expiry_limit=_env_int("OPTIONS_DASHBOARD_CHAIN_EXPIRY_LIMIT", 6),
            chain_strike_limit=_env_int("OPTIONS_DASHBOARD_CHAIN_STRIKE_LIMIT", 14),
            chain_moneyness_pct=_env_float("OPTIONS_DASHBOARD_CHAIN_MONEYNESS_PCT", 0.18),
            chain_batch_size=_env_int("OPTIONS_DASHBOARD_CHAIN_BATCH_SIZE", 40),
            chain_cache_ttl_seconds=_env_float("OPTIONS_DASHBOARD_CHAIN_CACHE_TTL_SECONDS", 12.0),
            snapshot_cache_ttl_seconds=_env_float("OPTIONS_DASHBOARD_SNAPSHOT_CACHE_TTL_SECONDS", 10.0),
            safety_buffer=_env_float("OPTIONS_DASHBOARD_SAFETY_BUFFER", 25_000.0),
            watchlist_symbols=_env_list(
                "OPTIONS_DASHBOARD_WATCHLIST",
                ["NVDA", "IREN", "AXTI", "PYPL", "GLD", "IAU", "VOO"],
            ),
            backend_host=_env_str("OPTIONS_DASHBOARD_BACKEND_HOST", "127.0.0.1"),
            backend_port=_env_int("OPTIONS_DASHBOARD_BACKEND_PORT", 8000),
            frontend_port=_env_int("OPTIONS_DASHBOARD_FRONTEND_PORT", 5173),
        )

    @property
    def frontend_origin(self) -> str:
        return f"http://127.0.0.1:{self.frontend_port}"

    def public_watchlist(self) -> list[str]:
        deduped: list[str] = []
        for symbol in self.watchlist_symbols:
            upper = symbol.upper()
            if upper not in deduped:
                deduped.append(upper)
        return deduped
