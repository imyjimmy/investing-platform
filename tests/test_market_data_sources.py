from __future__ import annotations

import json

import pytest

from investing_platform.config import DashboardSettings
from investing_platform.models import MarketDataSourceConfigRequest
from investing_platform.services.market_data_sources import MarketDataSourceService


def test_market_data_sources_list_external_provider_catalog(tmp_path) -> None:
    service = MarketDataSourceService(
        DashboardSettings(market_data_sources_state_file=tmp_path / "market-data-sources.json")
    )

    response = service.source_status()

    provider_ids = {source.providerId for source in response.sources}
    assert {"polygon", "alpha_vantage", "marketbeat", "seeking_alpha", "factset", "refinitiv", "investing_com"} <= provider_ids
    polygon = next(source for source in response.sources if source.providerId == "polygon")
    assert polygon.status == "not_configured"
    assert polygon.configurable is True
    assert polygon.maskedApiKey is None


def test_market_data_source_configure_stores_masked_key_and_enablement(tmp_path) -> None:
    state_path = tmp_path / "market-data-sources.json"
    service = MarketDataSourceService(DashboardSettings(market_data_sources_state_file=state_path))

    status = service.configure("polygon", MarketDataSourceConfigRequest(apiKey="pk_test_1234567890"))

    assert status.status == "ready"
    assert status.available is True
    assert status.configured is True
    assert status.enabled is True
    assert status.maskedApiKey == "pk_t...7890"
    payload = json.loads(state_path.read_text(encoding="utf-8"))
    assert payload["sources"]["polygon"]["apiKey"] == "pk_test_1234567890"


def test_market_data_source_can_be_disabled_without_losing_key(tmp_path) -> None:
    state_path = tmp_path / "market-data-sources.json"
    service = MarketDataSourceService(DashboardSettings(market_data_sources_state_file=state_path))
    service.configure("alpha_vantage", MarketDataSourceConfigRequest(apiKey="alpha-key"))

    disabled = service.configure("alpha_vantage", MarketDataSourceConfigRequest(enabled=False))

    assert disabled.status == "disabled"
    payload = json.loads(state_path.read_text(encoding="utf-8"))
    assert payload["sources"]["alpha_vantage"]["apiKey"] == "alpha-key"
    assert payload["sources"]["alpha_vantage"]["enabled"] is False


def test_market_data_source_clear_removes_key(tmp_path) -> None:
    state_path = tmp_path / "market-data-sources.json"
    service = MarketDataSourceService(DashboardSettings(market_data_sources_state_file=state_path))
    service.configure("marketbeat", MarketDataSourceConfigRequest(apiKey="marketbeat-key"))

    cleared = service.configure("marketbeat", MarketDataSourceConfigRequest(clearApiKey=True))

    assert cleared.status == "not_configured"
    payload = json.loads(state_path.read_text(encoding="utf-8"))
    assert "marketbeat" not in payload["sources"]


def test_market_data_source_rejects_enabling_without_key(tmp_path) -> None:
    service = MarketDataSourceService(
        DashboardSettings(market_data_sources_state_file=tmp_path / "market-data-sources.json")
    )

    with pytest.raises(ValueError, match="Add an API key"):
        service.configure("polygon", MarketDataSourceConfigRequest(enabled=True))
