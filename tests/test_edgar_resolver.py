from __future__ import annotations

import json
from pathlib import Path
import sqlite3

from investing_platform.config import DashboardSettings
from investing_platform.services.edgar_common import COMPANY_TICKERS_URL, EdgarRuntimeOptions, SUBMISSIONS_URL_TEMPLATE
from investing_platform.services.edgar_resolver import EdgarResolverService


def test_resolver_writes_normalized_issuer_registry_sqlite(tmp_path: Path) -> None:
    research_root = tmp_path / "research-root"
    settings = DashboardSettings(
        research_root=research_root,
        edgar_user_agent="Investing Platform tests@example.com",
    )
    requested_urls: list[str] = []

    def fake_get_json(url: str, options: EdgarRuntimeOptions) -> dict:
        del options
        requested_urls.append(url)
        if url == COMPANY_TICKERS_URL:
            return {
                "0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."},
                "1": {"cik_str": 1045810, "ticker": "NVDA", "title": "NVIDIA CORP"},
            }
        if url == SUBMISSIONS_URL_TEMPLATE.format(cik10="0000320193"):
            return {"cik": "0000320193", "name": "Apple Inc.", "tickers": ["AAPL"]}
        raise AssertionError(f"Unexpected URL {url}")

    resolver = EdgarResolverService(settings, get_json=fake_get_json)
    options = EdgarRuntimeOptions(
        user_agent="Investing Platform tests@example.com",
        max_requests_per_second=5.0,
        timeout_seconds=30.0,
        retry_limit=1,
    )

    resolved = resolver.resolve_issuer_query("aapl", options)

    sqlite_path = research_root / ".sec" / "issuer-registry" / "issuer-registry.sqlite3"
    json_path = research_root / ".sec" / "issuer-registry" / "company_tickers.json"
    assert resolved.ticker == "AAPL"
    assert json.loads(json_path.read_text(encoding="utf-8"))["0"]["ticker"] == "AAPL"
    with sqlite3.connect(sqlite_path) as connection:
        row = connection.execute(
            "SELECT cik10, ticker, company_name, normalized_company_name FROM issuers WHERE ticker = ?",
            ("AAPL",),
        ).fetchone()
    assert row == ("0000320193", "AAPL", "Apple Inc.", "APPLEINC")
    assert requested_urls == [COMPANY_TICKERS_URL, SUBMISSIONS_URL_TEMPLATE.format(cik10="0000320193")]
