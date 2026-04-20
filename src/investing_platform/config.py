"""Runtime configuration for the local investing platform."""

from __future__ import annotations

from dataclasses import dataclass, field
import os
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")


def _first_env(*names: str) -> str | None:
    for name in names:
        value = os.environ.get(name)
        if value not in {None, ""}:
            return value
    return None


def _env_int(*names: str, default: int) -> int:
    value = _first_env(*names)
    return int(value) if value is not None else default


def _env_float(*names: str, default: float) -> float:
    value = _first_env(*names)
    return float(value) if value is not None else default


def _env_str(*names: str, default: str) -> str:
    value = _first_env(*names)
    return value if value is not None else default


def _env_execution_mode(*names: str, default: str) -> Literal["disabled", "enabled"]:
    value = _env_str(*names, default=default).strip().lower()
    if value in {"enabled", "paper"}:
        return "enabled"
    return "disabled"


def _env_optional_str(*names: str) -> str | None:
    return _first_env(*names)


def _env_optional_path(*names: str) -> Path | None:
    value = _first_env(*names)
    if value is None:
        return None
    return Path(value).expanduser()


def _env_path(*names: str, default: str) -> Path:
    raw = _first_env(*names) or default
    return Path(raw).expanduser()


def _env_list(*names: str, default: list[str]) -> list[str]:
    value = _first_env(*names)
    if value is None:
        return default
    return [item.strip().upper() for item in value.split(",") if item.strip()]


@dataclass(slots=True)
class DashboardSettings:
    """Environment-backed settings for the platform."""

    data_mode: Literal["mock", "ibkr"] = "mock"
    execution_mode: Literal["disabled", "enabled"] = "enabled"
    ib_host: str = "127.0.0.1"
    ib_port: int = 4002
    ib_port_auto_discover: bool = True
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
    chain_strike_limit: int = 30
    chain_moneyness_pct: float = 0.18
    chain_batch_size: int = 40
    chain_historical_fallback_contract_limit: int = 4
    chain_cache_ttl_seconds: float = 120.0
    snapshot_cache_ttl_seconds: float = 10.0
    data_dir: Path = PROJECT_ROOT / "data"
    safety_buffer: float = 25_000.0
    watchlist_symbols: list[str] = field(
        default_factory=lambda: ["NVDA", "IREN", "AXTI", "PYPL", "GLD", "IAU", "VOO"]
    )
    research_root: Path = Path("~/Documents/Finances/research").expanduser()
    edgar_user_agent: str = "Investing Platform support@example.com"
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
    plaid_environment: Literal["sandbox", "development", "production"] = "sandbox"
    plaid_client_id: str | None = None
    plaid_secret: str | None = None
    plaid_client_name: str = "Investing Platform"
    plaid_redirect_uri: str | None = None
    plaid_timeout_seconds: float = 20.0
    backend_host: str = "127.0.0.1"
    backend_port: int = 8000
    frontend_port: int = 5173

    @classmethod
    def load(cls) -> "DashboardSettings":
        explicit_ib_port = _first_env("INVESTING_PLATFORM_IB_PORT", "OPTIONS_DASHBOARD_IB_PORT")
        return cls(
            data_mode=_env_str("INVESTING_PLATFORM_DATA_MODE", "OPTIONS_DASHBOARD_DATA_MODE", default="mock").lower(),  # type: ignore[arg-type]
            execution_mode=_env_execution_mode(
                "INVESTING_PLATFORM_EXECUTION_MODE",
                "OPTIONS_DASHBOARD_EXECUTION_MODE",
                default="enabled",
            ),
            ib_host=_env_str("INVESTING_PLATFORM_IB_HOST", "OPTIONS_DASHBOARD_IB_HOST", default="127.0.0.1"),
            ib_port=int(explicit_ib_port) if explicit_ib_port is not None else 4002,
            ib_port_auto_discover=explicit_ib_port is None,
            ib_client_id=_env_int(
                "INVESTING_PLATFORM_IB_CLIENT_ID",
                "OPTIONS_DASHBOARD_IB_CLIENT_ID",
                default=17,
            ),
            ib_account_id=_env_optional_str("INVESTING_PLATFORM_IB_ACCOUNT_ID", "OPTIONS_DASHBOARD_IB_ACCOUNT_ID"),
            ib_market_data_type=_env_int(
                "INVESTING_PLATFORM_IB_MARKET_DATA_TYPE",
                "OPTIONS_DASHBOARD_IB_MARKET_DATA_TYPE",
                default=1,
            ),
            ib_connect_timeout_seconds=_env_float(
                "INVESTING_PLATFORM_IB_CONNECT_TIMEOUT_SECONDS",
                "OPTIONS_DASHBOARD_IB_CONNECT_TIMEOUT_SECONDS",
                default=8.0,
            ),
            ib_request_timeout_seconds=_env_float(
                "INVESTING_PLATFORM_IB_REQUEST_TIMEOUT_SECONDS",
                "OPTIONS_DASHBOARD_IB_REQUEST_TIMEOUT_SECONDS",
                default=120.0,
            ),
            ib_order_ack_timeout_seconds=_env_float(
                "INVESTING_PLATFORM_IB_ORDER_ACK_TIMEOUT_SECONDS",
                "OPTIONS_DASHBOARD_IB_ORDER_ACK_TIMEOUT_SECONDS",
                default=4.0,
            ),
            ib_reconnect_interval_seconds=_env_float(
                "INVESTING_PLATFORM_IB_RECONNECT_INTERVAL_SECONDS",
                "OPTIONS_DASHBOARD_IB_RECONNECT_INTERVAL_SECONDS",
                default=5.0,
            ),
            ib_underlying_exchange=_env_str(
                "INVESTING_PLATFORM_IB_UNDERLYING_EXCHANGE",
                "OPTIONS_DASHBOARD_IB_UNDERLYING_EXCHANGE",
                default="SMART",
            ),
            ib_option_exchange=_env_str(
                "INVESTING_PLATFORM_IB_OPTION_EXCHANGE",
                "OPTIONS_DASHBOARD_IB_OPTION_EXCHANGE",
                default="SMART",
            ),
            ib_currency=_env_str("INVESTING_PLATFORM_IB_CURRENCY", "OPTIONS_DASHBOARD_IB_CURRENCY", default="USD"),
            chain_expiry_limit=_env_int(
                "INVESTING_PLATFORM_CHAIN_EXPIRY_LIMIT",
                "OPTIONS_DASHBOARD_CHAIN_EXPIRY_LIMIT",
                default=4,
            ),
            chain_strike_limit=_env_int(
                "INVESTING_PLATFORM_CHAIN_STRIKE_LIMIT",
                "OPTIONS_DASHBOARD_CHAIN_STRIKE_LIMIT",
                default=30,
            ),
            chain_moneyness_pct=_env_float(
                "INVESTING_PLATFORM_CHAIN_MONEYNESS_PCT",
                "OPTIONS_DASHBOARD_CHAIN_MONEYNESS_PCT",
                default=0.18,
            ),
            chain_batch_size=_env_int(
                "INVESTING_PLATFORM_CHAIN_BATCH_SIZE",
                "OPTIONS_DASHBOARD_CHAIN_BATCH_SIZE",
                default=40,
            ),
            chain_historical_fallback_contract_limit=_env_int(
                "INVESTING_PLATFORM_CHAIN_HISTORICAL_FALLBACK_CONTRACT_LIMIT",
                "OPTIONS_DASHBOARD_CHAIN_HISTORICAL_FALLBACK_CONTRACT_LIMIT",
                default=6,
            ),
            chain_cache_ttl_seconds=_env_float(
                "INVESTING_PLATFORM_CHAIN_CACHE_TTL_SECONDS",
                "OPTIONS_DASHBOARD_CHAIN_CACHE_TTL_SECONDS",
                default=12.0,
            ),
            data_dir=_env_path(
                "INVESTING_PLATFORM_DATA_DIR",
                "OPTIONS_DASHBOARD_DATA_DIR",
                default=str(PROJECT_ROOT / "data"),
            ),
            snapshot_cache_ttl_seconds=_env_float(
                "INVESTING_PLATFORM_SNAPSHOT_CACHE_TTL_SECONDS",
                "OPTIONS_DASHBOARD_SNAPSHOT_CACHE_TTL_SECONDS",
                default=10.0,
            ),
            safety_buffer=_env_float(
                "INVESTING_PLATFORM_SAFETY_BUFFER",
                "OPTIONS_DASHBOARD_SAFETY_BUFFER",
                default=25_000.0,
            ),
            watchlist_symbols=_env_list(
                "INVESTING_PLATFORM_WATCHLIST",
                "OPTIONS_DASHBOARD_WATCHLIST",
                default=["NVDA", "IREN", "AXTI", "PYPL", "GLD", "IAU", "VOO"],
            ),
            research_root=_env_path(
                "INVESTING_PLATFORM_RESEARCH_ROOT",
                "OPTIONS_DASHBOARD_RESEARCH_ROOT",
                default="~/Documents/Finances/research",
            ),
            edgar_user_agent=_env_str(
                "INVESTING_PLATFORM_EDGAR_USER_AGENT",
                "OPTIONS_DASHBOARD_EDGAR_USER_AGENT",
                default="Investing Platform support@example.com",
            ),
            edgar_max_requests_per_second=_env_float(
                "INVESTING_PLATFORM_EDGAR_MAX_REQUESTS_PER_SECOND",
                "OPTIONS_DASHBOARD_EDGAR_MAX_REQUESTS_PER_SECOND",
                default=5.0,
            ),
            edgar_timeout_seconds=_env_float(
                "INVESTING_PLATFORM_EDGAR_TIMEOUT_SECONDS",
                "OPTIONS_DASHBOARD_EDGAR_TIMEOUT_SECONDS",
                default=30.0,
            ),
            edgar_retry_limit=_env_int(
                "INVESTING_PLATFORM_EDGAR_RETRY_LIMIT",
                "OPTIONS_DASHBOARD_EDGAR_RETRY_LIMIT",
                default=5,
            ),
            coinbase_api_base_url=_env_str("COINBASE_API_BASE_URL", default="https://api.coinbase.com"),
            coinbase_api_key=_env_optional_str("COINBASE_API_KEY"),
            coinbase_api_key_id=_env_optional_str("COINBASE_API_KEY_ID"),
            coinbase_api_key_name=_env_optional_str("COINBASE_API_KEY_NAME"),
            coinbase_api_private_key=_env_optional_str("COINBASE_API_PRIVATE_KEY"),
            coinbase_api_key_file=_env_optional_path("COINBASE_API_KEY_FILE"),
            coinbase_timeout_seconds=_env_float("COINBASE_TIMEOUT_SECONDS", default=15.0),
            coinbase_snapshot_cache_ttl_seconds=_env_float("COINBASE_SNAPSHOT_CACHE_TTL_SECONDS", default=30.0),
            plaid_environment=_env_str("PLAID_ENV", default="sandbox").lower(),  # type: ignore[arg-type]
            plaid_client_id=_env_optional_str("PLAID_CLIENT_ID"),
            plaid_secret=_env_optional_str("PLAID_SECRET"),
            plaid_client_name=_env_str("PLAID_CLIENT_NAME", default="Investing Platform"),
            plaid_redirect_uri=_env_optional_str("PLAID_REDIRECT_URI"),
            plaid_timeout_seconds=_env_float("PLAID_TIMEOUT_SECONDS", default=20.0),
            backend_host=_env_str(
                "INVESTING_PLATFORM_BACKEND_HOST",
                "OPTIONS_DASHBOARD_BACKEND_HOST",
                default="127.0.0.1",
            ),
            backend_port=_env_int(
                "INVESTING_PLATFORM_BACKEND_PORT",
                "OPTIONS_DASHBOARD_BACKEND_PORT",
                default=8000,
            ),
            frontend_port=_env_int(
                "INVESTING_PLATFORM_FRONTEND_PORT",
                "OPTIONS_DASHBOARD_FRONTEND_PORT",
                default=5173,
            ),
        )

    @property
    def frontend_origin(self) -> str:
        return f"http://127.0.0.1:{self.frontend_port}"

    @property
    def plaid_base_url(self) -> str:
        return f"https://{self.plaid_environment}.plaid.com"

    @property
    def plaid_state_path(self) -> Path:
        return self.data_dir / "plaid" / "connectors.json"

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
