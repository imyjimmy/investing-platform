"""Persisted app-wide stock watchlist."""

from __future__ import annotations

from datetime import UTC, datetime
import json
import re
from typing import Any

from investing_platform.config import DashboardSettings
from investing_platform.models import WatchlistResponse, WatchlistUpdateRequest


WATCHLIST_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")


class WatchlistService:
    """Manage the app-wide ticker watchlist with env defaults as the initial seed."""

    def __init__(self, settings: DashboardSettings) -> None:
        self._settings = settings

    def get_watchlist(self) -> WatchlistResponse:
        state = self._load_state()
        saved_symbols = state.get("symbols")
        symbols = self._normalize_symbols(saved_symbols) if isinstance(saved_symbols, list) else self._settings.public_watchlist()
        updated_at = state.get("updatedAt") if isinstance(state.get("updatedAt"), str) else None
        return WatchlistResponse(symbols=symbols, statePath=str(self._state_path()), updatedAt=updated_at)

    def update_watchlist(self, request: WatchlistUpdateRequest) -> WatchlistResponse:
        symbols = self._normalize_symbols(request.symbols)
        updated_at = datetime.now(UTC)
        self._save_state(
            {
                "schemaVersion": 1,
                "symbols": symbols,
                "updatedAt": updated_at.isoformat(),
            }
        )
        return WatchlistResponse(symbols=symbols, statePath=str(self._state_path()), updatedAt=updated_at)

    def symbols(self) -> list[str]:
        return self.get_watchlist().symbols

    def _state_path(self):
        return self._settings.research_root / ".app" / "watchlist.json"

    def _load_state(self) -> dict[str, Any]:
        path = self._state_path()
        if not path.exists():
            return {"schemaVersion": 1}
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"schemaVersion": 1}
        return payload if isinstance(payload, dict) else {"schemaVersion": 1}

    def _save_state(self, payload: dict[str, Any]) -> None:
        path = self._state_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    def _normalize_symbols(self, values: list[Any]) -> list[str]:
        deduped: list[str] = []
        for value in values:
            symbol = str(value).strip().upper()
            if not symbol:
                continue
            if not WATCHLIST_SYMBOL_RE.match(symbol):
                raise ValueError(f"Invalid watchlist ticker: {value}")
            if symbol not in deduped:
                deduped.append(symbol)
        return deduped
