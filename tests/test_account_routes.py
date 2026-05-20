from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient

import investing_platform.api.routes.account as account_routes
from investing_platform.main import app
from investing_platform.models import WatchlistResponse


NOW = datetime(2026, 4, 27, 20, 0, tzinfo=UTC)


class FakeWatchlistService:
    def __init__(self) -> None:
        self.symbols_value = ["NVDA", "IREN"]
        self.update_requests: list[list[str]] = []

    def get_watchlist(self) -> WatchlistResponse:
        return WatchlistResponse(symbols=self.symbols_value, statePath="/tmp/research-root/.app/watchlist.json", updatedAt=NOW)

    def update_watchlist(self, request) -> WatchlistResponse:
        self.update_requests.append(request.symbols)
        self.symbols_value = request.symbols
        return self.get_watchlist()


def test_watchlist_routes_return_and_update_symbols(monkeypatch) -> None:
    fake_service = FakeWatchlistService()
    monkeypatch.setattr(account_routes, "watchlist_service", lambda: fake_service)

    with TestClient(app) as client:
        get_response = client.get("/api/account/watchlist")
        post_response = client.post("/api/account/watchlist", json={"symbols": ["aapl", "nvda", "AAPL"]})

    assert get_response.status_code == 200
    assert get_response.json()["symbols"] == ["NVDA", "IREN"]
    assert post_response.status_code == 200
    assert post_response.json()["symbols"] == ["AAPL", "NVDA"]
    assert fake_service.update_requests == [["AAPL", "NVDA"]]
