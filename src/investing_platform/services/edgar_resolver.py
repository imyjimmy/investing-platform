"""Issuer resolution backed by the app-global EDGAR registry cache."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
import re
import threading
from typing import Any, Callable

from investing_platform.config import DashboardSettings
from investing_platform.models import EdgarDownloadRequest
from investing_platform.services.edgar_common import COMPANY_TICKERS_URL, EdgarRuntimeOptions, ResolvedCompany, SUBMISSIONS_URL_TEMPLATE


class EdgarResolverService:
    """Resolve tickers, company names, and CIKs through the app-global registry cache."""

    def __init__(
        self,
        settings: DashboardSettings,
        *,
        get_json: Callable[[str, EdgarRuntimeOptions], dict[str, Any]],
    ) -> None:
        self._settings = settings
        self._get_json = get_json
        self._company_lookup_cache: list[dict[str, Any]] | None = None
        self._company_lookup_lock = threading.Lock()

    def resolve_issuer_query(
        self,
        issuer_query: str,
        options: EdgarRuntimeOptions,
        *,
        force_refresh: bool = False,
    ) -> ResolvedCompany:
        normalized = issuer_query.strip()
        if normalized.isdigit():
            return self.resolve_download_request(EdgarDownloadRequest(cik=normalized), options, force_refresh=force_refresh)

        if re.fullmatch(r"[A-Za-z][A-Za-z0-9.\-]{0,9}", normalized):
            try:
                return self.resolve_download_request(
                    EdgarDownloadRequest(ticker=normalized.upper()),
                    options,
                    force_refresh=force_refresh,
                )
            except ValueError:
                pass

        return self.resolve_download_request(
            EdgarDownloadRequest(companyName=normalized),
            options,
            force_refresh=force_refresh,
        )

    def resolve_download_request(
        self,
        request: EdgarDownloadRequest,
        options: EdgarRuntimeOptions,
        *,
        force_refresh: bool = False,
    ) -> ResolvedCompany:
        if request.cik:
            cik10 = request.cik.zfill(10)
            submissions_payload = self._get_json(SUBMISSIONS_URL_TEMPLATE.format(cik10=cik10), options)
            return self._resolved_company_from_payload(submissions_payload, fallback_ticker=request.ticker)

        company_lookup = self._load_company_lookup(options, force_refresh=force_refresh)
        if request.ticker:
            matches = [item for item in company_lookup if str(item.get("ticker", "")).upper() == request.ticker]
            if not matches:
                raise ValueError(f"Unable to resolve ticker '{request.ticker}' through SEC company_tickers.json.")
            cik10 = str(matches[0]["cik_str"]).zfill(10)
            submissions_payload = self._get_json(SUBMISSIONS_URL_TEMPLATE.format(cik10=cik10), options)
            return self._resolved_company_from_payload(submissions_payload, fallback_ticker=request.ticker)

        normalized_target = self._normalize_company_name(str(request.companyName))
        exact_matches = [
            item for item in company_lookup if self._normalize_company_name(str(item.get("title", ""))) == normalized_target
        ]
        if len(exact_matches) == 1:
            cik10 = str(exact_matches[0]["cik_str"]).zfill(10)
            submissions_payload = self._get_json(SUBMISSIONS_URL_TEMPLATE.format(cik10=cik10), options)
            return self._resolved_company_from_payload(submissions_payload, fallback_ticker=str(exact_matches[0]["ticker"]))

        partial_matches = [
            item for item in company_lookup if normalized_target in self._normalize_company_name(str(item.get("title", "")))
        ]
        if len(partial_matches) == 1:
            cik10 = str(partial_matches[0]["cik_str"]).zfill(10)
            submissions_payload = self._get_json(SUBMISSIONS_URL_TEMPLATE.format(cik10=cik10), options)
            return self._resolved_company_from_payload(submissions_payload, fallback_ticker=str(partial_matches[0]["ticker"]))

        if partial_matches:
            sample = ", ".join(f"{item['ticker']} ({item['title']})" for item in partial_matches[:5])
            raise ValueError(
                f"Company name '{request.companyName}' matched multiple SEC issuers. Narrow it with a ticker or CIK. Candidates: {sample}"
            )
        raise ValueError(f"Unable to resolve company name '{request.companyName}' through SEC company_tickers.json.")

    def _app_global_cache_root(self) -> Path:
        return self._settings.research_root

    def _issuer_registry_json_path(self) -> Path:
        return self._app_global_cache_root() / ".sec" / "issuer-registry" / "company_tickers.json"

    def _issuer_registry_freshness_path(self) -> Path:
        return self._app_global_cache_root() / ".sec" / "issuer-registry" / "freshness.json"

    def _resolved_company_from_payload(self, payload: dict[str, Any], fallback_ticker: str | None = None) -> ResolvedCompany:
        cik10 = str(payload.get("cik") or "").zfill(10)
        if not cik10.strip("0"):
            raise ValueError("SEC submissions payload did not include a valid CIK.")
        tickers = payload.get("tickers") or []
        ticker = str(tickers[0]).upper() if tickers else (fallback_ticker or cik10).upper()
        company_name = str(payload.get("name") or ticker).strip()
        return ResolvedCompany(
            cik=cik10.lstrip("0") or "0",
            cik10=cik10,
            ticker=ticker,
            company_name=company_name,
            submissions_payload=payload,
        )

    def _load_company_lookup(self, options: EdgarRuntimeOptions, *, force_refresh: bool = False) -> list[dict[str, Any]]:
        registry_json_path = self._issuer_registry_json_path()
        freshness_path = self._issuer_registry_freshness_path()
        with self._company_lookup_lock:
            if self._company_lookup_cache is not None and not force_refresh:
                return self._company_lookup_cache

            cached_payload = self._load_json_document(registry_json_path)
            cached_is_fresh = self._freshness_is_usable(freshness_path, max_age=timedelta(hours=24))
            if cached_payload and cached_is_fresh and not force_refresh:
                self._company_lookup_cache = list(cached_payload.values()) if isinstance(cached_payload, dict) else None
                if self._company_lookup_cache is not None:
                    return self._company_lookup_cache

            try:
                payload = self._get_json(COMPANY_TICKERS_URL, options)
            except RuntimeError:
                if cached_payload and isinstance(cached_payload, dict):
                    self._company_lookup_cache = list(cached_payload.values())
                    return self._company_lookup_cache
                raise
            if not isinstance(payload, dict):
                raise ValueError("Unexpected SEC company_tickers.json payload.")
            registry_json_path.parent.mkdir(parents=True, exist_ok=True)
            registry_json_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
            freshness_path.parent.mkdir(parents=True, exist_ok=True)
            freshness_path.write_text(
                json.dumps(
                    {
                        "lastRefreshedAt": datetime.now(UTC).isoformat(),
                        "sourceUrl": COMPANY_TICKERS_URL,
                    },
                    indent=2,
                    sort_keys=True,
                ),
                encoding="utf-8",
            )
            self._company_lookup_cache = list(payload.values())
            return self._company_lookup_cache

    def _load_json_document(self, path: Path) -> dict[str, Any] | None:
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return payload if isinstance(payload, dict) else None

    def _parse_datetime(self, value: Any) -> datetime | None:
        if not isinstance(value, str) or not value.strip():
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None

    def _freshness_is_usable(self, freshness_path: Path, *, max_age: timedelta) -> bool:
        payload = self._load_json_document(freshness_path)
        if payload is None:
            return False
        refreshed_at = self._parse_datetime(payload.get("lastRefreshedAt"))
        if refreshed_at is None:
            return False
        return datetime.now(UTC) - refreshed_at <= max_age

    def _normalize_company_name(self, value: str) -> str:
        return re.sub(r"[^A-Z0-9]+", "", value.upper())
