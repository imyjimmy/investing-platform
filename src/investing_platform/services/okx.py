"""Public OKX market-data connector for crypto prices."""

from __future__ import annotations

from datetime import UTC, datetime
import threading
from typing import Any

import requests

from investing_platform.config import DashboardSettings
from investing_platform.models import CryptoMarketQuote, CryptoMarketResponse, OkxSourceStatus


class OkxService:
    """Fetches public crypto market data from OKX without credentials."""

    def __init__(self, settings: DashboardSettings) -> None:
        self._settings = settings
        self._session = requests.Session()
        self._session.headers.update({"User-Agent": "investing-platform/0.1.0"})
        self._state_lock = threading.Lock()
        self._last_error: str | None = None
        self._last_successful_sync_at: datetime | None = None

    def source_status(self) -> OkxSourceStatus:
        with self._state_lock:
            last_error = self._last_error
            last_successful_sync_at = self._last_successful_sync_at
        return OkxSourceStatus(
            available=last_error is None,
            status="degraded" if last_error else "ready",
            apiBaseUrl=self._settings.okx_api_base_url.rstrip("/"),
            detail=last_error or "OKX public market data is enabled globally for the crypto market workspace.",
            authMode="public",
            lastSuccessfulSyncAt=last_successful_sync_at,
            lastError=last_error,
        )

    def get_major_market(self) -> CryptoMarketResponse:
        payload = self._request_json("/api/v5/market/tickers", {"instType": "SPOT"})
        rows = payload.get("data")
        if not isinstance(rows, list):
            raise RuntimeError("OKX returned an unexpected market tickers payload.")

        quotes: list[CryptoMarketQuote] = []
        missing_symbols: list[str] = []
        for symbol, name, instrument_id in [
            ("BTC", "Bitcoin", "BTC-USDT"),
            ("ETH", "Ethereum", "ETH-USDT"),
        ]:
            row = next((item for item in rows if isinstance(item, dict) and item.get("instId") == instrument_id), None)
            if row is None:
                missing_symbols.append(symbol)
                continue
            price = _safe_float(row.get("last"))
            if price is None:
                missing_symbols.append(symbol)
                continue
            quotes.append(CryptoMarketQuote(symbol=symbol, name=name, priceUsd=round(price, 2)))

        if not quotes:
            raise RuntimeError("OKX public spot tickers are unavailable for BTC-USDT and ETH-USDT right now.")

        now = datetime.now(UTC)
        with self._state_lock:
            self._last_error = None
            self._last_successful_sync_at = now

        source_notice = "Live spot pricing is available for BTC and ETH majors."
        if missing_symbols:
            source_notice = f"{source_notice} Missing: {', '.join(missing_symbols)}."

        return CryptoMarketResponse(
            source="Global crypto market data",
            quotes=quotes,
            generatedAt=now,
            sourceNotice=source_notice,
            isStale=bool(missing_symbols),
        )

    def _request_json(self, path: str, params: dict[str, Any]) -> Any:
        url = f"{self._settings.okx_api_base_url.rstrip('/')}{path}"
        try:
            response = self._session.get(url, params=params, timeout=self._settings.okx_timeout_seconds)
            response.raise_for_status()
        except requests.RequestException as exc:
            message = _response_error_detail(getattr(exc, "response", None)) or str(exc)
            with self._state_lock:
                self._last_error = message
            raise RuntimeError(message) from exc

        payload = response.json()
        if isinstance(payload, dict) and str(payload.get("code") or "0") != "0":
            message = str(payload.get("msg") or "OKX returned a market-data error.").strip()
            with self._state_lock:
                self._last_error = message
            raise RuntimeError(message)
        return payload


def _safe_float(value: Any) -> float | None:
    if value in {None, ""}:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _response_error_detail(response: requests.Response | None) -> str | None:
    if response is None:
        return None
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if isinstance(payload, dict):
        message = payload.get("msg") or payload.get("detail")
        if isinstance(message, str) and message.strip():
            return message.strip()
    text = response.text.strip()
    return text or None
