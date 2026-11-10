"""Series-scoped N-PORT storage, with original decimal strings and filing provenance."""
from __future__ import annotations

import json
import sqlite3
from typing import Any
from xml.etree import ElementTree

from investing_platform.services.edgar_common import WorkspacePaths


def build_fund_store(paths: WorkspacePaths, filings: list[dict[str, Any]]) -> None:
    scope_path = paths.metadata_dir / "fund-scope.json"
    if not scope_path.exists():
        return
    scope = json.loads(scope_path.read_text(encoding="utf-8"))
    root = paths.intelligence_dir / "fund"
    root.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(root / "fund.sqlite3") as connection:
        connection.executescript("""
            CREATE TABLE reports(accession TEXT PRIMARY KEY, cik TEXT, series_id TEXT, class_id TEXT,
                filing_date TEXT, report_date TEXT, series_name TEXT, total_assets TEXT,
                net_assets TEXT, source_url TEXT, source_path TEXT);
            CREATE TABLE positions(accession TEXT, position_number INTEGER, issuer_name TEXT,
                security_title TEXT, cusip TEXT, balance TEXT, units TEXT, currency TEXT,
                value_usd TEXT, percent_value TEXT, asset_category TEXT,
                PRIMARY KEY(accession, position_number));
            CREATE INDEX positions_cusip ON positions(cusip, accession);
            CREATE INDEX reports_period ON reports(series_id, report_date);
        """)
        for filing in filings:
            if filing.get("form") not in {"NPORT-P", "NPORT-P/A"}:
                continue
            folder = f"{filing['filingDate']}_{str(filing['form']).replace('/', '-')}_{filing['accessionNumberNoDashes']}"
            source = paths.stock_root / folder / "primary" / str(filing["primaryDocument"])
            if not source.is_file():
                continue
            tree = ElementTree.parse(source)
            for node in tree.iter():
                node.tag = node.tag.rsplit("}", 1)[-1]
            general = tree.find(".//genInfo")
            fund = tree.find(".//fundInfo")
            if general is None or fund is None or general.findtext("seriesId") != scope["seriesId"]:
                raise ValueError(f"N-PORT source {source.name} does not match the selected fund series")
            accession = filing["accessionNumber"]
            connection.execute("INSERT INTO reports VALUES (?,?,?,?,?,?,?,?,?,?,?)", (
                accession, scope["cik"], scope["seriesId"], scope["classId"], filing["filingDate"],
                general.findtext("repPdDate"), general.findtext("seriesName"), fund.findtext("totAssets"),
                fund.findtext("netAssets"), filing["primaryDocumentUrl"], str(source)))
            for index, position in enumerate(tree.findall(".//invstOrSec")):
                connection.execute("INSERT INTO positions VALUES (?,?,?,?,?,?,?,?,?,?,?)", (
                    accession, index, *(position.findtext(tag) for tag in
                    ("name", "title", "cusip", "balance", "units", "curCd", "valUSD", "pctVal", "assetCat"))))
        connection.commit()
