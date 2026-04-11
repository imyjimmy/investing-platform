"""Coinbase account connector for the Van Aken dashboard."""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
import secrets
import threading
import time
from typing import Any, Literal
from urllib.parse import urljoin, urlparse

import requests

from options_dashboard.config import DashboardSettings
from options_dashboard.models import CoinbaseHolding, CoinbasePortfolioResponse, CoinbaseSourceStatus
from options_dashboard.services.base import CacheEntry


@dataclass(slots=True)
class ResolvedCoinbaseCredentials:
    auth_mode: Literal["jwt", "bearer", "missing", "unsupported"]
    detail: str
    key_id: str | None = None
    key_name: str | None = None
    private_key: str | None = None
    key_secret: str | None = None
    bearer_token: str | None = None


class CoinbaseService:
    """Fetches Coinbase account balances and normalizes them for the dashboard."""

    def __init__(self, settings: DashboardSettings) -> None:
        self._settings = settings
        self._session = requests.Session()
        self._session.headers.update({"User-Agent": "options-dashboard/0.1.0"})
        self._portfolio_cache: CacheEntry[CoinbasePortfolioResponse] | None = None
        self._portfolio_cache_lock = threading.Lock()
        self._rate_cache: dict[str, CacheEntry[float]] = {}
        self._rate_cache_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._last_error: str | None = None
        self._last_successful_sync_at: datetime | None = None

    def source_status(self) -> CoinbaseSourceStatus:
        credentials = self._resolve_credentials()
        with self._state_lock:
            last_error = self._last_error
            last_successful_sync_at = self._last_successful_sync_at
        available = credentials.auth_mode in {"jwt", "bearer"}
        is_degraded = not available or (last_error is not None and last_successful_sync_at is None)
        detail = last_error if is_degraded and last_error else credentials.detail
        return CoinbaseSourceStatus(
            available=available,
            status="degraded" if is_degraded else "ready",
            authMode=credentials.auth_mode,
            apiBaseUrl=self._settings.coinbase_api_base_url.rstrip("/"),
            detail=detail,
            lastSuccessfulSyncAt=last_successful_sync_at,
            lastError=last_error,
        )

    def get_portfolio(self) -> CoinbasePortfolioResponse:
        cached = self._fresh_cached_portfolio()
        if cached is not None:
            return cached

        try:
            portfolio = self._fetch_portfolio()
        except Exception as exc:
            self._remember_error(str(exc))
            cached = self._latest_cached_portfolio()
            if cached is not None:
                return cached.model_copy(
                    update={
                        "isStale": True,
                        "sourceNotice": f"Coinbase refresh failed. Showing the last good snapshot. {exc}",
                    }
                )
            raise

        with self._portfolio_cache_lock:
            self._portfolio_cache = CacheEntry(value=portfolio, captured_at=portfolio.generatedAt)
        self._remember_success()
        return portfolio

    def _fetch_portfolio(self) -> CoinbasePortfolioResponse:
        credentials = self._resolve_credentials()
        if credentials.auth_mode not in {"jwt", "bearer"}:
            raise ValueError(credentials.detail)

        accounts = self._list_accounts(credentials)
        visible_holdings: list[CoinbaseHolding] = []
        pricing_gaps: list[str] = []

        for account in accounts:
            holding = self._build_holding(account)
            if holding is None:
                continue
            if holding.usdRate is None:
                pricing_gaps.append(holding.currencyCode)
            if holding.balance <= 0:
                continue
            visible_holdings.append(holding)

        visible_holdings.sort(key=lambda holding: (holding.usdValue or 0.0, holding.balance), reverse=True)
        total_usd_value = round(sum(holding.usdValue or 0.0 for holding in visible_holdings), 2)
        holdings: list[CoinbaseHolding] = []
        for holding in visible_holdings:
            allocation_pct = round((holding.usdValue or 0.0) / total_usd_value * 100.0, 2) if total_usd_value > 0 else None
            holdings.append(holding.model_copy(update={"allocationPct": allocation_pct}))

        cash_like_usd_value = round(sum(holding.usdValue or 0.0 for holding in holdings if holding.isCashLike), 2)
        crypto_usd_value = round(sum(holding.usdValue or 0.0 for holding in holdings if not holding.isCashLike), 2)
        total_hold_usd_value = round(
            sum((holding.holdBalance or 0.0) * (holding.usdRate or 0.0) for holding in holdings),
            2,
        )
        source_notice: str | None = None
        if pricing_gaps:
            unresolved = ", ".join(sorted(set(pricing_gaps)))
            source_notice = f"USD pricing was unavailable for {unresolved}. Those balances are excluded from the total."
        elif total_hold_usd_value > 0:
            source_notice = f"Includes {currency_format(total_hold_usd_value)} on hold for open Coinbase orders."
        elif not holdings:
            source_notice = "No positive Coinbase balances were returned for the configured account."

        return CoinbasePortfolioResponse(
            totalUsdValue=total_usd_value,
            cryptoUsdValue=crypto_usd_value,
            cashLikeUsdValue=cash_like_usd_value,
            visibleHoldingsCount=len(holdings),
            totalAccountsCount=len(accounts),
            holdings=holdings,
            sourceNotice=source_notice,
            generatedAt=datetime.now(UTC),
            isStale=False,
        )

    def _build_holding(self, account: dict[str, Any]) -> CoinbaseHolding | None:
        account_id = str(account.get("id") or account.get("uuid") or "").strip()
        currency_payload = account.get("currency")
        currency = currency_payload if isinstance(currency_payload, dict) else {}
        balance_payload = account.get("balance") if isinstance(account.get("balance"), dict) else {}
        available_balance_payload = account.get("available_balance") if isinstance(account.get("available_balance"), dict) else {}
        hold_balance_payload = account.get("hold") if isinstance(account.get("hold"), dict) else {}
        currency_code = str(
            currency.get("code")
            or currency_payload
            or balance_payload.get("currency")
            or available_balance_payload.get("currency")
            or hold_balance_payload.get("currency")
            or ""
        ).strip().upper()
        if not account_id or not currency_code:
            return None

        available_balance = (
            _safe_float(available_balance_payload.get("value"))
            if available_balance_payload
            else _safe_float(balance_payload.get("amount"))
        )
        hold_balance = _safe_float(hold_balance_payload.get("value")) if hold_balance_payload else 0.0
        balance = available_balance + hold_balance
        usd_rate = self._lookup_usd_rate(currency_code)
        usd_value = round(balance * usd_rate, 2) if usd_rate is not None else None
        return CoinbaseHolding(
            accountId=account_id,
            accountName=str(account.get("name") or currency.get("name") or currency_code),
            accountType=str(account.get("type") or "wallet"),
            primary=bool(account.get("primary")),
            ready=bool(account["ready"]) if "ready" in account else None,
            currencyCode=currency_code,
            currencyName=str(currency.get("name")) if currency.get("name") else None,
            currencyType=str(currency.get("type")) if currency.get("type") else None,
            balance=round(balance, 8),
            availableBalance=round(available_balance, 8),
            holdBalance=round(hold_balance, 8),
            usdRate=usd_rate,
            usdValue=usd_value,
            allocationPct=None,
            isCashLike=_is_cash_like(currency_code, str(currency.get("type") or ""), str(account.get("type") or "")),
            updatedAt=_parse_timestamp(account.get("updated_at")),
        )

    def _list_accounts(self, credentials: ResolvedCoinbaseCredentials) -> list[dict[str, Any]]:
        brokerage_accounts = self._list_brokerage_accounts(credentials)
        if brokerage_accounts:
            return brokerage_accounts

        return self._list_track_accounts(credentials)

    def _list_brokerage_accounts(self, credentials: ResolvedCoinbaseCredentials) -> list[dict[str, Any]]:
        base_url = self._settings.coinbase_api_base_url.rstrip("/")
        next_url: str | None = f"{base_url}/api/v3/brokerage/accounts"
        accounts: list[dict[str, Any]] = []
        while next_url:
            parsed = urlparse(next_url)
            request_path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
            headers = self._auth_headers("GET", request_path, credentials)
            payload = self._request_json(next_url, headers=headers)
            page_accounts = payload.get("accounts")
            if not isinstance(page_accounts, list):
                return []
            accounts.extend(item for item in page_accounts if isinstance(item, dict))
            has_next = bool(payload.get("has_next"))
            cursor = str(payload.get("cursor") or "").strip()
            next_url = f"{base_url}/api/v3/brokerage/accounts?cursor={cursor}" if has_next and cursor else None
        return accounts

    def _list_track_accounts(self, credentials: ResolvedCoinbaseCredentials) -> list[dict[str, Any]]:
        base_url = self._settings.coinbase_api_base_url.rstrip("/")
        next_url: str | None = f"{base_url}/v2/accounts"
        accounts: list[dict[str, Any]] = []
        while next_url:
            parsed = urlparse(next_url)
            request_path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
            headers = self._auth_headers("GET", request_path, credentials)
            payload = self._request_json(next_url, headers=headers)
            page_accounts = payload.get("data")
            if not isinstance(page_accounts, list):
                raise RuntimeError("Coinbase returned an unexpected accounts payload.")
            accounts.extend(item for item in page_accounts if isinstance(item, dict))
            next_uri = payload.get("pagination", {}).get("next_uri")
            next_url = urljoin(f"{base_url}/", str(next_uri)) if next_uri else None
        return accounts

    def _lookup_usd_rate(self, currency_code: str) -> float | None:
        code = currency_code.upper()
        if code == "USD":
            return 1.0

        cached = self._fresh_cached_rate(code)
        if cached is not None:
            return cached

        endpoint = f"{self._settings.coinbase_api_base_url.rstrip('/')}/v2/exchange-rates?currency={code}"
        try:
            payload = self._request_json(endpoint)
        except Exception:
            return None
        rates = payload.get("data", {}).get("rates")
        if not isinstance(rates, dict):
            return None
        usd_rate = _safe_float(rates.get("USD"))
        if usd_rate <= 0:
            return None
        with self._rate_cache_lock:
            self._rate_cache[code] = CacheEntry(value=usd_rate, captured_at=datetime.now(UTC))
        return usd_rate

    def _auth_headers(
        self,
        request_method: str,
        request_path: str,
        credentials: ResolvedCoinbaseCredentials,
    ) -> dict[str, str]:
        if credentials.auth_mode == "bearer" and credentials.bearer_token:
            return {"Authorization": f"Bearer {credentials.bearer_token}"}
        if credentials.auth_mode == "jwt" and credentials.key_id and credentials.key_secret:
            jwt_token = self._build_ed25519_jwt(
                request_method=request_method,
                request_path=request_path,
                key_id=credentials.key_id,
                key_secret=credentials.key_secret,
            )
            return {"Authorization": f"Bearer {jwt_token}"}
        if credentials.auth_mode == "jwt" and credentials.key_name and credentials.private_key:
            jwt_token = self._build_jwt(
                request_method=request_method,
                request_path=request_path,
                key_name=credentials.key_name,
                private_key=credentials.private_key,
            )
            return {"Authorization": f"Bearer {jwt_token}"}
        raise ValueError(credentials.detail)

    def _build_jwt(self, request_method: str, request_path: str, key_name: str, private_key: str) -> str:
        import jwt
        from cryptography.hazmat.primitives import serialization

        request_host = urlparse(self._settings.coinbase_api_base_url).netloc or "api.coinbase.com"
        uri = f"{request_method.upper()} {request_host}{request_path}"
        normalized_key = _normalize_private_key(private_key)
        try:
            signing_key = serialization.load_pem_private_key(normalized_key.encode("utf-8"), password=None)
        except ValueError as exc:
            raise ValueError(
                "Coinbase private key could not be parsed. Coinbase App account access expects an ECDSA PEM private key."
            ) from exc

        payload = {
            "sub": key_name,
            "iss": "cdp",
            "nbf": int(time.time()),
            "exp": int(time.time()) + 120,
            "uri": uri,
        }
        token = jwt.encode(
            payload,
            signing_key,
            algorithm="ES256",
            headers={"kid": key_name, "nonce": secrets.token_hex()},
        )
        return token if isinstance(token, str) else token.decode("utf-8")

    def _build_ed25519_jwt(self, request_method: str, request_path: str, key_id: str, key_secret: str) -> str:
        import jwt
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

        request_host = urlparse(self._settings.coinbase_api_base_url).netloc or "api.coinbase.com"
        uri = f"{request_method.upper()} {request_host}{request_path}"
        raw_secret = _decode_ed25519_secret(key_secret)
        signing_key = Ed25519PrivateKey.from_private_bytes(raw_secret[:32])
        payload = {
            "sub": key_id,
            "iss": "cdp",
            "nbf": int(time.time()),
            "exp": int(time.time()) + 120,
            "uri": uri,
        }
        token = jwt.encode(
            payload,
            signing_key,
            algorithm="EdDSA",
            headers={"kid": key_id, "nonce": secrets.token_hex(), "typ": "JWT"},
        )
        return token if isinstance(token, str) else token.decode("utf-8")

    def _request_json(self, url: str, headers: dict[str, str] | None = None) -> dict[str, Any]:
        try:
            response = self._session.get(url, headers=headers, timeout=self._settings.coinbase_timeout_seconds)
        except requests.RequestException as exc:
            raise RuntimeError(f"Coinbase request failed: {exc}") from exc

        if response.status_code == 401:
            raise ValueError(
                "Coinbase rejected the configured credentials. Coinbase App account access requires a valid bearer token or an ECDSA key name + private key pair."
            )

        if not response.ok:
            detail = _response_error_detail(response)
            raise RuntimeError(f"Coinbase request failed ({response.status_code}): {detail}")

        try:
            payload = response.json()
        except ValueError as exc:
            raise RuntimeError("Coinbase returned a non-JSON response.") from exc

        if not isinstance(payload, dict):
            raise RuntimeError("Coinbase returned an unexpected response shape.")
        return payload

    def _resolve_credentials(self) -> ResolvedCoinbaseCredentials:
        key_file_credentials = self._credentials_from_key_file(self._settings.coinbase_api_key_file)
        if key_file_credentials is not None:
            return key_file_credentials

        key_id = (self._settings.coinbase_api_key_id or "").strip()
        key_name = (self._settings.coinbase_api_key_name or "").strip()
        private_key = (self._settings.coinbase_api_private_key or "").strip()
        key_value = (self._settings.coinbase_api_key or "").strip()

        if key_id and key_value and _looks_like_raw_secret(key_value):
            return ResolvedCoinbaseCredentials(
                auth_mode="jwt",
                detail="Coinbase CDP credentials configured with key id and Ed25519 secret.",
                key_id=key_id,
                key_secret=key_value,
            )

        if key_name and private_key:
            return ResolvedCoinbaseCredentials(
                auth_mode="jwt",
                detail="Coinbase App credentials configured with key name and private key.",
                key_name=key_name,
                private_key=private_key,
            )

        if key_value:
            inline_key_file_credentials = self._credentials_from_inline_value(key_value)
            if inline_key_file_credentials is not None:
                return inline_key_file_credentials

            if key_value.startswith("organizations/") and private_key:
                return ResolvedCoinbaseCredentials(
                    auth_mode="jwt",
                    detail="Coinbase App credentials configured with inline key name and private key.",
                    key_name=key_value,
                    private_key=private_key,
                )

            if key_name and _looks_like_pem_key(key_value):
                return ResolvedCoinbaseCredentials(
                    auth_mode="jwt",
                    detail="Coinbase App credentials configured with private key stored in COINBASE_API_KEY.",
                    key_name=key_name,
                    private_key=key_value,
                )

            if _looks_like_bearer_token(key_value):
                return ResolvedCoinbaseCredentials(
                    auth_mode="bearer",
                    detail="Coinbase bearer token configured.",
                    bearer_token=key_value,
                )

            if _looks_like_raw_secret(key_value):
                return ResolvedCoinbaseCredentials(
                    auth_mode="unsupported",
                    detail=(
                        "The current COINBASE_API_KEY value looks like a raw Ed25519 secret. Add COINBASE_API_KEY_ID "
                        "to use it for Coinbase account access."
                    ),
                )

        return ResolvedCoinbaseCredentials(
            auth_mode="missing",
            detail=(
                "Coinbase is not configured yet. Add a bearer token, set COINBASE_API_KEY_ID + COINBASE_API_KEY for an "
                "Ed25519 CDP secret key, or set COINBASE_API_KEY_NAME + COINBASE_API_PRIVATE_KEY for a PEM-based key."
            ),
        )

    def _credentials_from_key_file(self, key_file: Path | None) -> ResolvedCoinbaseCredentials | None:
        if key_file is None:
            return None
        if not key_file.exists():
            return ResolvedCoinbaseCredentials(
                auth_mode="unsupported",
                detail=f"COINBASE_API_KEY_FILE does not exist: {key_file}",
            )
        try:
            payload = json.loads(key_file.read_text())
        except (OSError, json.JSONDecodeError) as exc:
            return ResolvedCoinbaseCredentials(
                auth_mode="unsupported",
                detail=f"Coinbase key file could not be read: {exc}",
            )
        return _credentials_from_key_payload(payload)

    def _credentials_from_inline_value(self, value: str) -> ResolvedCoinbaseCredentials | None:
        stripped = value.strip()
        potential_path = Path(stripped).expanduser()
        if potential_path.exists():
            return self._credentials_from_key_file(potential_path)
        if stripped.startswith("{") and stripped.endswith("}"):
            try:
                payload = json.loads(stripped)
            except json.JSONDecodeError:
                return ResolvedCoinbaseCredentials(
                    auth_mode="unsupported",
                    detail="COINBASE_API_KEY looked like inline JSON but could not be parsed.",
                )
            return _credentials_from_key_payload(payload)
        return None

    def _fresh_cached_portfolio(self) -> CoinbasePortfolioResponse | None:
        cached = self._latest_cached_portfolio()
        if cached is None:
            return None
        max_age = timedelta(seconds=self._settings.coinbase_snapshot_cache_ttl_seconds)
        if datetime.now(UTC) - cached.generatedAt > max_age:
            return None
        return cached

    def _latest_cached_portfolio(self) -> CoinbasePortfolioResponse | None:
        with self._portfolio_cache_lock:
            return self._portfolio_cache.value if self._portfolio_cache else None

    def _fresh_cached_rate(self, currency_code: str) -> float | None:
        with self._rate_cache_lock:
            entry = self._rate_cache.get(currency_code)
        if entry is None:
            return None
        if datetime.now(UTC) - entry.captured_at > timedelta(minutes=5):
            return None
        return entry.value

    def _remember_success(self) -> None:
        with self._state_lock:
            self._last_successful_sync_at = datetime.now(UTC)
            self._last_error = None

    def _remember_error(self, error: str) -> None:
        with self._state_lock:
            self._last_error = error


def _credentials_from_key_payload(payload: Any) -> ResolvedCoinbaseCredentials:
    if not isinstance(payload, dict):
        return ResolvedCoinbaseCredentials(
            auth_mode="unsupported",
            detail="Coinbase key payload must be a JSON object.",
        )

    key_id = str(payload.get("id") or payload.get("keyId") or payload.get("key_id") or "").strip()
    key_name = str(payload.get("name") or payload.get("keyName") or payload.get("key_name") or "").strip()
    key_secret = str(payload.get("keySecret") or payload.get("key_secret") or "").strip()
    private_key = str(payload.get("privateKey") or payload.get("private_key") or "").strip()
    if key_id and key_secret and _looks_like_raw_secret(key_secret):
        return ResolvedCoinbaseCredentials(
            auth_mode="jwt",
            detail="Coinbase CDP credentials loaded from JSON key material.",
            key_id=key_id,
            key_secret=key_secret,
        )
    if key_name and private_key:
        return ResolvedCoinbaseCredentials(
            auth_mode="jwt",
            detail="Coinbase App credentials loaded from JSON key material.",
            key_name=key_name,
            private_key=private_key,
        )
    return ResolvedCoinbaseCredentials(
        auth_mode="unsupported",
        detail="Coinbase key payload is missing the expected name/privateKey fields.",
    )


def _normalize_private_key(value: str) -> str:
    normalized = value.strip().replace("\\n", "\n")
    if not normalized.endswith("\n"):
        normalized = f"{normalized}\n"
    return normalized


def _decode_ed25519_secret(value: str) -> bytes:
    normalized = value.strip()
    try:
        decoded = base64.b64decode(normalized, validate=True)
    except Exception as exc:
        raise ValueError("Coinbase Ed25519 secret must be base64-encoded.") from exc
    if len(decoded) not in {32, 64}:
        raise ValueError("Coinbase Ed25519 secret decoded to an unexpected length.")
    return decoded


def _looks_like_pem_key(value: str) -> bool:
    normalized = value.strip()
    return "BEGIN EC PRIVATE KEY" in normalized or "BEGIN PRIVATE KEY" in normalized


def _looks_like_bearer_token(value: str) -> bool:
    normalized = value.strip()
    if not normalized or normalized.startswith("organizations/") or _looks_like_pem_key(normalized):
        return False
    if normalized.count(".") == 2:
        return True
    return not _looks_like_raw_secret(normalized)


def _looks_like_raw_secret(value: str) -> bool:
    normalized = value.strip()
    if not normalized or normalized.startswith("organizations/") or _looks_like_pem_key(normalized):
        return False
    if not any(character in normalized for character in "+/="):
        return False
    try:
        decoded = base64.b64decode(normalized, validate=True)
    except Exception:
        return False
    return len(decoded) in {32, 48, 64}


def _safe_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    candidate = value.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(candidate)
    except ValueError:
        return None


def _is_cash_like(currency_code: str, currency_type: str, account_type: str) -> bool:
    code = currency_code.upper()
    if code in {"USD", "USDC", "USDT", "DAI", "PYUSD"}:
        return True
    return currency_type.lower() == "fiat" or account_type.lower() == "fiat"


def _response_error_detail(response: requests.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text.strip() or response.reason
    if isinstance(payload, dict):
        errors = payload.get("errors")
        if isinstance(errors, list) and errors:
            return "; ".join(str(item) for item in errors)
        message = payload.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()
    return response.text.strip() or response.reason


def currency_format(value: float) -> str:
    return f"${value:,.2f}"
