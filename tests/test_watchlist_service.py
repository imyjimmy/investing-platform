from __future__ import annotations

import json

import pytest

from investing_platform.config import DashboardSettings
from investing_platform.models import WatchlistUpdateRequest
from investing_platform.services.watchlist import WatchlistService


def test_watchlist_uses_settings_defaults_until_saved(tmp_path) -> None:
    settings = DashboardSettings(
        research_root=tmp_path / "research-root",
        watchlist_symbols=["nvda", "aapl", "NVDA"],
    )
    service = WatchlistService(settings)

    response = service.get_watchlist()

    assert response.symbols == ["NVDA", "AAPL"]
    assert response.statePath.endswith(".app/watchlist.json")
    assert response.updatedAt is None


def test_watchlist_persists_normalized_symbols(tmp_path) -> None:
    settings = DashboardSettings(research_root=tmp_path / "research-root", watchlist_symbols=["NVDA"])
    service = WatchlistService(settings)

    response = service.update_watchlist(WatchlistUpdateRequest(symbols=["iren", "brk.b", "IREN"]))

    assert response.symbols == ["IREN", "BRK.B"]
    assert service.symbols() == ["IREN", "BRK.B"]
    state_path = tmp_path / "research-root" / ".app" / "watchlist.json"
    assert json.loads(state_path.read_text(encoding="utf-8"))["symbols"] == ["IREN", "BRK.B"]


def test_watchlist_rejects_invalid_symbols(tmp_path) -> None:
    service = WatchlistService(DashboardSettings(research_root=tmp_path / "research-root"))

    with pytest.raises(ValueError, match="Invalid watchlist ticker"):
        service.update_watchlist(WatchlistUpdateRequest(symbols=["not a ticker"]))
