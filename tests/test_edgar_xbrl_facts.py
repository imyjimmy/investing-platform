from __future__ import annotations

import json
import sqlite3
import zipfile

from investing_platform.config import DashboardSettings
from investing_platform.models import EdgarQuestionRequest
from investing_platform.services.edgar import EdgarDownloader
from investing_platform.services.edgar_xbrl_facts import CONCEPT_ALIASES, EdgarXbrlFactService


def test_xbrl_fact_service_extracts_companyfacts_into_ticker_artifacts(tmp_path) -> None:
    settings = DashboardSettings(
        research_root=tmp_path / "research-root",
        edgar_user_agent="Investing Platform tests@example.com",
    )
    paths, filings = _paths_and_filings(settings)
    _write_companyfacts_zip(settings, _companyfacts_payload())

    result = EdgarXbrlFactService(settings).build_issuer_facts(paths=paths, filings=filings)

    assert result.limitations == []
    assert result.facts_count == 5
    assert result.concepts_count == 4
    assert (paths.intelligence_dir / "xbrl" / "facts.jsonl").exists()
    assert (paths.intelligence_dir / "xbrl" / "concepts.json").exists()
    sqlite_path = paths.intelligence_dir / "xbrl" / "facts.sqlite3"
    assert sqlite_path.exists()
    with sqlite3.connect(sqlite_path) as connection:
        row = connection.execute(
            "SELECT accession_number, form, filing_date, concept, unit, value_text, period_start, period_end FROM facts WHERE concept = ?",
            ("us-gaap:Revenues",),
        ).fetchone()
    assert row == ("0000320193-26-000001", "10-K", "2026-01-30", "us-gaap:Revenues", "USD", "391035000000", "2025-01-01", "2025-12-31")


def test_xbrl_fact_service_degrades_when_companyfacts_zip_is_missing(tmp_path) -> None:
    settings = DashboardSettings(
        research_root=tmp_path / "research-root",
        edgar_user_agent="Investing Platform tests@example.com",
    )
    paths, filings = _paths_and_filings(settings)
    stale_sqlite = paths.intelligence_dir / "xbrl" / "facts.sqlite3"
    stale_sqlite.parent.mkdir(parents=True, exist_ok=True)
    stale_sqlite.write_text("stale", encoding="utf-8")

    result = EdgarXbrlFactService(settings).build_issuer_facts(paths=paths, filings=filings)

    assert result.facts_count == 0
    assert result.limitations
    assert "companyfacts.zip was not found" in result.limitations[0]
    assert not stale_sqlite.exists()


def test_xbrl_fact_retrieval_uses_aliases_units_periods_and_dedupes(tmp_path) -> None:
    settings = DashboardSettings(
        research_root=tmp_path / "research-root",
        edgar_user_agent="Investing Platform tests@example.com",
    )
    paths, filings = _paths_and_filings(settings)
    _write_companyfacts_zip(settings, _companyfacts_payload())
    service = EdgarXbrlFactService(settings)
    service.build_issuer_facts(paths=paths, filings=filings)

    revenue_facts, limitations = service.retrieve_facts(
        paths=paths,
        request=EdgarQuestionRequest(ticker="AAPL", question="What was revenue in the latest 10-K?"),
        active_accessions={"0000320193-26-000001"},
    )
    margin_facts, _margin_limitations = service.retrieve_facts(
        paths=paths,
        request=EdgarQuestionRequest(ticker="AAPL", question="What was gross margin?"),
        active_accessions={"0000320193-26-000001"},
    )
    shares_facts, _shares_limitations = service.retrieve_facts(
        paths=paths,
        request=EdgarQuestionRequest(ticker="AAPL", question="How many shares were outstanding?"),
        active_accessions={"0000320193-26-000001"},
    )

    assert limitations == []
    assert revenue_facts[0].concept == "us-gaap:Revenues"
    assert revenue_facts[0].accession_number == "0000320193-26-000001"
    assert revenue_facts[0].period_start == "2025-01-01"
    assert [fact.value_text for fact in revenue_facts if fact.concept == "us-gaap:Revenues"].count("391035000000") == 1
    assert {"us-gaap:GrossProfit", "us-gaap:Revenues"} <= {fact.concept for fact in margin_facts}
    assert shares_facts[0].concept == "dei:EntityCommonStockSharesOutstanding"
    assert "us-gaap:CommonStocksIncludingAdditionalPaidInCapital" not in CONCEPT_ALIASES["shares"]


def _paths_and_filings(settings: DashboardSettings):
    downloader = EdgarDownloader(settings)
    paths = downloader._workspace_paths(settings.research_root, "AAPL")
    filings = [
        {
            "ticker": "AAPL",
            "companyName": "Apple Inc.",
            "cik": "320193",
            "cik10": "0000320193",
            "form": "10-K",
            "filingDate": "2026-01-30",
            "accessionNumber": "0000320193-26-000001",
            "accessionNumberNoDashes": "000032019326000001",
            "primaryDocument": "a10-k2025.htm",
            "primaryDocumentUrl": "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/a10-k2025.htm",
        }
    ]
    return paths, filings


def _write_companyfacts_zip(settings: DashboardSettings, payload: dict) -> None:
    metadata_root = settings.research_root / ".sec" / "filing-metadata"
    metadata_root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(metadata_root / "companyfacts.zip", "w") as archive:
        archive.writestr("CIK0000320193.json", json.dumps(payload))


def _companyfacts_payload() -> dict:
    duplicate_revenue = {
        "start": "2025-01-01",
        "end": "2025-12-31",
        "val": 391035000000,
        "accn": "0000320193-26-000001",
        "fy": 2025,
        "fp": "FY",
        "form": "10-K",
        "filed": "2026-01-30",
        "frame": "CY2025",
    }
    return {
        "cik": 320193,
        "entityName": "Apple Inc.",
        "facts": {
            "us-gaap": {
                "Revenues": {
                    "label": "Revenue",
                    "units": {
                        "USD": [
                            duplicate_revenue,
                            duplicate_revenue,
                            {
                                "start": "2024-01-01",
                                "end": "2024-12-31",
                                "val": 365817000000,
                                "accn": "0000320193-25-000001",
                                "fy": 2024,
                                "fp": "FY",
                                "form": "10-K",
                                "filed": "2025-01-31",
                            },
                        ]
                    },
                },
                "GrossProfit": {
                    "label": "Gross Profit",
                    "units": {
                        "USD": [
                            {
                                "start": "2025-01-01",
                                "end": "2025-12-31",
                                "val": 180683000000,
                                "accn": "0000320193-26-000001",
                                "fy": 2025,
                                "fp": "FY",
                                "form": "10-K",
                                "filed": "2026-01-30",
                            }
                        ]
                    },
                },
                "CommonStocksIncludingAdditionalPaidInCapital": {
                    "label": "Common Stocks Including Additional Paid In Capital",
                    "units": {
                        "USD": [
                            {
                                "end": "2025-12-31",
                                "val": 83276000000,
                                "accn": "0000320193-26-000001",
                                "fy": 2025,
                                "fp": "FY",
                                "form": "10-K",
                                "filed": "2026-01-30",
                            }
                        ]
                    },
                },
            },
            "dei": {
                "EntityCommonStockSharesOutstanding": {
                    "label": "Entity Common Stock Shares Outstanding",
                    "units": {
                        "shares": [
                            {
                                "end": "2026-01-15",
                                "val": 15000000000,
                                "accn": "0000320193-26-000001",
                                "fy": 2025,
                                "fp": "FY",
                                "form": "10-K",
                                "filed": "2026-01-30",
                            }
                        ]
                    },
                }
            },
        },
    }
