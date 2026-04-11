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


def _env_optional_path(name: str) -> Path | None:
    value = os.environ.get(name)
    if value in {None, ""}:
        return None
    return Path(value).expanduser()


def _env_path(name: str, default: str) -> Path:
    value = os.environ.get(name)
    raw = value if value not in {None, ""} else default
    return Path(raw).expanduser()


def _env_list(name: str, default: list[str]) -> list[str]:
    value = os.environ.get(name)
    if value in {None, ""}:
        return default
    return [item.strip().upper() for item in value.split(",") if item.strip()]


@dataclass(slots=True)
class DashboardSettings:
    """Environment-backed settings for the dashboard."""

    data_mode: Literal["mock", "ibkr"] = "mock"
    execution_mode: Literal["disabled", "paper"] = "paper"
    ib_host: str = "127.0.0.1"
    ib_port: int = 4002
    ib_client_id: int = 17
    ib_account_id: str | None = None
    ib_market_data_type: int = 1
    ib_connect_timeout_seconds: float = 8.0
    ib_request_timeout_seconds: float = 12.0
    ib_order_ack_timeout_seconds: float = 4.0
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
    research_root: Path = Path("~/Documents/Finances/research").expanduser()
    edgar_user_agent: str = "Options Dashboard support@example.com"
    edgar_max_requests_per_second: float = 5.0
    edgar_timeout_seconds: float = 30.0
    edgar_retry_limit: int = 5
    coinbase_api_base_url: str = "https://api.coinbase.com"
    coinbase_api_key: str | None = None
    coinbase_api_key_id: str | None = None
    coinbase_api_key_name: str | None = None
    coinbase_api_private_key: str | None = None
    coinbase_api_key_file: Path | None = None
    coinbase_timeout_seconds: float = 15.0
    coinbase_snapshot_cache_ttl_seconds: float = 30.0
    backend_host: str = "127.0.0.1"
    backend_port: int = 8000
    frontend_port: int = 5173

    @classmethod
    def load(cls) -> "DashboardSettings":
        return cls(
            data_mode=_env_str("OPTIONS_DASHBOARD_DATA_MODE", "mock").lower(),  # type: ignore[arg-type]
            execution_mode=_env_str("OPTIONS_DASHBOARD_EXECUTION_MODE", "paper").lower(),  # type: ignore[arg-type]
            ib_host=_env_str("OPTIONS_DASHBOARD_IB_HOST", "127.0.0.1"),
            ib_port=_env_int("OPTIONS_DASHBOARD_IB_PORT", 4002),
            ib_client_id=_env_int("OPTIONS_DASHBOARD_IB_CLIENT_ID", 17),
            ib_account_id=_env_optional_str("OPTIONS_DASHBOARD_IB_ACCOUNT_ID"),
            ib_market_data_type=_env_int("OPTIONS_DASHBOARD_IB_MARKET_DATA_TYPE", 1),
            ib_connect_timeout_seconds=_env_float("OPTIONS_DASHBOARD_IB_CONNECT_TIMEOUT_SECONDS", 8.0),
            ib_request_timeout_seconds=_env_float("OPTIONS_DASHBOARD_IB_REQUEST_TIMEOUT_SECONDS", 12.0),
            ib_order_ack_timeout_seconds=_env_float("OPTIONS_DASHBOARD_IB_ORDER_ACK_TIMEOUT_SECONDS", 4.0),
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
            research_root=_env_path("OPTIONS_DASHBOARD_RESEARCH_ROOT", "~/Documents/Finances/research"),
            edgar_user_agent=_env_str("OPTIONS_DASHBOARD_EDGAR_USER_AGENT", "Options Dashboard support@example.com"),
            edgar_max_requests_per_second=_env_float("OPTIONS_DASHBOARD_EDGAR_MAX_REQUESTS_PER_SECOND", 5.0),
            edgar_timeout_seconds=_env_float("OPTIONS_DASHBOARD_EDGAR_TIMEOUT_SECONDS", 30.0),
            edgar_retry_limit=_env_int("OPTIONS_DASHBOARD_EDGAR_RETRY_LIMIT", 5),
            coinbase_api_base_url=_env_str("COINBASE_API_BASE_URL", "https://api.coinbase.com"),
            coinbase_api_key=_env_optional_str("COINBASE_API_KEY"),
            coinbase_api_key_id=_env_optional_str("COINBASE_API_KEY_ID"),
            coinbase_api_key_name=_env_optional_str("COINBASE_API_KEY_NAME"),
            coinbase_api_private_key=_env_optional_str("COINBASE_API_PRIVATE_KEY"),
            coinbase_api_key_file=_env_optional_path("COINBASE_API_KEY_FILE"),
            coinbase_timeout_seconds=_env_float("COINBASE_TIMEOUT_SECONDS", 15.0),
            coinbase_snapshot_cache_ttl_seconds=_env_float("COINBASE_SNAPSHOT_CACHE_TTL_SECONDS", 30.0),
            backend_host=_env_str("OPTIONS_DASHBOARD_BACKEND_HOST", "127.0.0.1"),
            backend_port=_env_int("OPTIONS_DASHBOARD_BACKEND_PORT", 8000),
            frontend_port=_env_int("OPTIONS_DASHBOARD_FRONTEND_PORT", 5173),
        )

    @property
    def frontend_origin(self) -> str:
        return f"http://127.0.0.1:{self.frontend_port}"

    @property
    def stocks_root(self) -> Path:
        return self.research_root / "stocks"

    def public_watchlist(self) -> list[str]:
        deduped: list[str] = []
        for symbol in self.watchlist_symbols:
            upper = symbol.upper()
            if upper not in deduped:
                deduped.append(upper)
        return deduped
