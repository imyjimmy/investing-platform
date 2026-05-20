"""Settings-backed registry for external market intelligence providers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import json
from typing import Any

from investing_platform.config import DashboardSettings
from investing_platform.models import (
    MarketDataSourceConfigRequest,
    MarketDataSourceStatus,
    MarketDataSourcesResponse,
)


@dataclass(frozen=True, slots=True)
class MarketDataSourceDefinition:
    provider_id: str
    display_name: str
    category: str
    api_base_url: str | None
    capabilities: tuple[str, ...]
    requires_api_key: bool = True
    configurable: bool = True
    unconfigured_detail: str = "Add an API key to make this provider available to market intelligence workflows."
    planned_detail: str = "This source is tracked for the earnings intelligence roadmap but is not configurable in-app yet."


SOURCE_DEFINITIONS: tuple[MarketDataSourceDefinition, ...] = (
    MarketDataSourceDefinition(
        provider_id="polygon",
        display_name="Polygon.io",
        category="Market data API",
        api_base_url="https://api.polygon.io",
        capabilities=("prices", "ticker details", "news", "earnings events"),
    ),
    MarketDataSourceDefinition(
        provider_id="alpha_vantage",
        display_name="Alpha Vantage",
        category="Market data API",
        api_base_url="https://www.alphavantage.co",
        capabilities=("prices", "fundamentals", "earnings", "analyst estimates"),
    ),
    MarketDataSourceDefinition(
        provider_id="marketbeat",
        display_name="MarketBeat",
        category="Consensus data",
        api_base_url="https://www.marketbeat.com",
        capabilities=("earnings estimates", "analyst ratings", "price targets"),
    ),
    MarketDataSourceDefinition(
        provider_id="seeking_alpha",
        display_name="Seeking Alpha",
        category="Consensus and news",
        api_base_url="https://seekingalpha.com",
        capabilities=("earnings estimates", "earnings revisions", "news"),
    ),
    MarketDataSourceDefinition(
        provider_id="factset",
        display_name="FactSet",
        category="Enterprise data",
        api_base_url="https://api.factset.com",
        capabilities=("consensus estimates", "actuals", "company fundamentals"),
    ),
    MarketDataSourceDefinition(
        provider_id="refinitiv",
        display_name="Refinitiv / LSEG",
        category="Enterprise data",
        api_base_url=None,
        capabilities=("consensus estimates", "actuals", "company fundamentals"),
    ),
    MarketDataSourceDefinition(
        provider_id="investing_com",
        display_name="Investing.com",
        category="Web source",
        api_base_url="https://www.investing.com",
        capabilities=("earnings calendar", "published estimates"),
        requires_api_key=False,
        configurable=False,
        planned_detail="Tracked as a possible web/news evidence source. No first-party API connector is configured for this app yet.",
    ),
)


@dataclass(slots=True)
class StoredMarketDataSource:
    provider_id: str
    api_key: str | None
    enabled: bool
    updated_at: datetime


class MarketDataSourceService:
    """Persist provider-level API keys and enablement for future earnings intelligence."""

    def __init__(self, settings: DashboardSettings) -> None:
        self._settings = settings

    def source_status(self) -> MarketDataSourcesResponse:
        records = self._read_records()
        return MarketDataSourcesResponse(
            sources=[self._status_for(definition, records.get(definition.provider_id)) for definition in SOURCE_DEFINITIONS],
            statePath=str(self._settings.market_data_sources_state_path),
            generatedAt=datetime.now(UTC),
        )

    def configure(self, provider_id: str, request: MarketDataSourceConfigRequest) -> MarketDataSourceStatus:
        definition = self._definition(provider_id)
        if not definition.configurable:
            raise ValueError(f"{definition.display_name} is not configurable in this app yet.")

        records = self._read_records()
        existing = records.get(definition.provider_id)
        api_key = existing.api_key if existing is not None else None
        enabled = existing.enabled if existing is not None else True

        if request.clearApiKey:
            api_key = None
            enabled = False
        elif request.apiKey is not None:
            normalized_key = request.apiKey.strip()
            if normalized_key:
                api_key = normalized_key
                enabled = True if request.enabled is None else request.enabled
            else:
                api_key = None
                enabled = False

        if request.enabled is not None:
            enabled = request.enabled

        if enabled and definition.requires_api_key and not api_key:
            raise ValueError(f"Add an API key before enabling {definition.display_name}.")

        if api_key:
            records[definition.provider_id] = StoredMarketDataSource(
                provider_id=definition.provider_id,
                api_key=api_key,
                enabled=enabled,
                updated_at=datetime.now(UTC),
            )
        else:
            records.pop(definition.provider_id, None)

        self._write_records(records)
        return self._status_for(definition, records.get(definition.provider_id))

    def _status_for(
        self,
        definition: MarketDataSourceDefinition,
        record: StoredMarketDataSource | None,
    ) -> MarketDataSourceStatus:
        if not definition.configurable:
            return MarketDataSourceStatus(
                providerId=definition.provider_id,
                displayName=definition.display_name,
                category=definition.category,
                status="planned",
                available=False,
                configured=False,
                enabled=False,
                configurable=False,
                requiresApiKey=definition.requires_api_key,
                apiBaseUrl=definition.api_base_url,
                maskedApiKey=None,
                capabilities=list(definition.capabilities),
                detail=definition.planned_detail,
                updatedAt=None,
            )
        if record is None or (definition.requires_api_key and not record.api_key):
            return MarketDataSourceStatus(
                providerId=definition.provider_id,
                displayName=definition.display_name,
                category=definition.category,
                status="not_configured",
                available=False,
                configured=False,
                enabled=False,
                configurable=True,
                requiresApiKey=definition.requires_api_key,
                apiBaseUrl=definition.api_base_url,
                maskedApiKey=None,
                capabilities=list(definition.capabilities),
                detail=definition.unconfigured_detail,
                updatedAt=None,
            )
        if not record.enabled:
            return MarketDataSourceStatus(
                providerId=definition.provider_id,
                displayName=definition.display_name,
                category=definition.category,
                status="disabled",
                available=False,
                configured=True,
                enabled=False,
                configurable=True,
                requiresApiKey=definition.requires_api_key,
                apiBaseUrl=definition.api_base_url,
                maskedApiKey=_mask_api_key(record.api_key or ""),
                capabilities=list(definition.capabilities),
                detail=f"{definition.display_name} is configured but disabled.",
                updatedAt=record.updated_at,
            )
        return MarketDataSourceStatus(
            providerId=definition.provider_id,
            displayName=definition.display_name,
            category=definition.category,
            status="ready",
            available=True,
            configured=True,
            enabled=True,
            configurable=True,
            requiresApiKey=definition.requires_api_key,
            apiBaseUrl=definition.api_base_url,
            maskedApiKey=_mask_api_key(record.api_key or ""),
            capabilities=list(definition.capabilities),
            detail=f"{definition.display_name} is configured for market intelligence workflows.",
            updatedAt=record.updated_at,
        )

    def _definition(self, provider_id: str) -> MarketDataSourceDefinition:
        normalized = provider_id.strip().lower()
        for definition in SOURCE_DEFINITIONS:
            if definition.provider_id == normalized:
                return definition
        raise ValueError(f"Unknown market data source provider: {provider_id}.")

    def _read_records(self) -> dict[str, StoredMarketDataSource]:
        path = self._settings.market_data_sources_state_path
        if not path.exists():
            return {}
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        raw_sources = payload.get("sources") if isinstance(payload, dict) else None
        if not isinstance(raw_sources, dict):
            return {}

        records: dict[str, StoredMarketDataSource] = {}
        for provider_id, raw_record in raw_sources.items():
            if not isinstance(raw_record, dict):
                continue
            normalized_provider_id = str(provider_id).strip().lower()
            api_key = str(raw_record.get("apiKey") or "").strip() or None
            enabled = _parse_bool(raw_record.get("enabled"), default=True)
            updated_at = _parse_datetime(raw_record.get("updatedAt"))
            if normalized_provider_id and api_key:
                records[normalized_provider_id] = StoredMarketDataSource(
                    provider_id=normalized_provider_id,
                    api_key=api_key,
                    enabled=enabled,
                    updated_at=updated_at,
                )
        return records

    def _write_records(self, records: dict[str, StoredMarketDataSource]) -> None:
        path = self._settings.market_data_sources_state_path
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "sources": {
                provider_id: {
                    "apiKey": record.api_key,
                    "enabled": record.enabled,
                    "updatedAt": record.updated_at.isoformat(),
                }
                for provider_id, record in sorted(records.items())
            }
        }
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _parse_datetime(value: Any) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value)) if value else datetime.now(UTC)
    except ValueError:
        parsed = datetime.now(UTC)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed


def _parse_bool(value: Any, *, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _mask_api_key(value: str) -> str:
    trimmed = value.strip()
    if len(trimmed) <= 8:
        return "*" * len(trimmed)
    return f"{trimmed[:4]}...{trimmed[-4:]}"
