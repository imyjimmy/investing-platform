#!/usr/bin/env python3
"""Rebuild the local SEC library for the latest Fidelity positions (no account data exported)."""
from __future__ import annotations

import argparse
import calendar
import csv
from dataclasses import replace
from datetime import date, datetime, UTC
import json
from pathlib import Path
import re
import sqlite3
import shutil
import sys
import tempfile
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from investing_platform.config import DashboardSettings
from investing_platform.models import EdgarSyncRequest, EdgarIntelligenceIndexRequest, EdgarWorkspaceRequest
from investing_platform.services.edgar import EdgarDownloader
import numpy as np

REPORT_FORMS = ["10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "8-K/A", "20-F", "20-F/A", "40-F", "40-F/A", "6-K", "6-K/A"]
REPORT_FORMS += ["NPORT-P", "NPORT-P/A", "N-CSR", "N-CSR/A", "N-CSRS", "N-CSRS/A", "497", "497K", "485BPOS"]
REPORT_FORMS += ["10-K405", "10-K405/A", "10-KSB", "10-KSB/A", "10-QSB", "10-QSB/A", "N-30D"]
REPORT_FORMS += [form + amendment for form in ("10-KT", "10-KT405", "10-QT", "8-K12B", "8-K12G3", "8-K15D5") for amendment in ("", "/A")]


def latest_positions(directory: Path) -> Path:
    candidates = []
    for path in directory.glob("Portfolio_Positions_*.csv"):
        try:
            captured = datetime.strptime(path.stem.removeprefix("Portfolio_Positions_"), "%b-%d-%Y").date()
        except ValueError:
            continue
        candidates.append((captured, path))
    if not candidates:
        raise ValueError(f"No dated Fidelity positions exports in {directory}")
    return max(candidates)[1]


def holding_symbols(path: Path) -> list[str]:
    symbols = set()
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            symbol = str(row.get("Symbol") or "").strip().upper()
            if symbol.endswith("**"):
                continue  # Fidelity's cash/core position marker.
            option = re.fullmatch(r"-([A-Z.]+)\d{6}[CP]\d+(?:\.\d+)?", symbol)
            if option:
                symbol = option.group(1)
            if re.fullmatch(r"[A-Z][A-Z.\-]{0,9}", symbol):
                symbols.add(symbol)
    return sorted(symbols)


def research_symbols(root: Path) -> tuple[list[str], list[str]]:
    tickers, other = [], []
    for path in root.iterdir():
        if not path.is_dir() or path.name.startswith("."):
            continue
        if re.fullmatch(r"[A-Z][A-Z.\-]{0,9}", path.name):
            tickers.append(path.name)
        else:
            other.append(path.name)
    return sorted(tickers), sorted(other)


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".part")
    temporary.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    temporary.replace(path)


def compact_metadata(service: EdgarDownloader) -> dict:
    """Discard rebuildable market-wide SQL rows, retaining every locally used issuer and live overlay."""
    cache = service._metadata_cache_service
    source = cache._submissions_sqlite_path()
    if not source.exists():
        return {"status": "absent"}
    # The compressed SEC source remains available for rollback/reimport.
    if not source.with_name("submissions.zip").exists() or not zipfile.is_zipfile(source.with_name("submissions.zip")):
        return {"status": "skipped", "reason": "No readable compressed bulk source to retain for rollback"}
    keep = set()
    for path in source.parent.joinpath("issuers").glob("*.json"):
        payload = json.loads(path.read_text())
        if payload.get("cik"):
            keep.add(str(payload["cik"]).zfill(10))
    temporary = source.with_name("submissions.compact.sqlite3")
    temporary.unlink(missing_ok=True)
    before = source.stat().st_size
    with sqlite3.connect(temporary) as connection:
        cache._create_submissions_schema(connection)
        connection.execute("ATTACH DATABASE ? AS legacy", (str(source),))
        # Preserve all non-bulk changes, even for issuers outside this holdings list.
        keep.update(row[0] for row in connection.execute("SELECT DISTINCT cik10 FROM legacy.filing_metadata WHERE discovered_via IS NULL OR discovered_via != 'bulk'"))
        connection.execute("CREATE TEMP TABLE keep_ciks(cik10 TEXT PRIMARY KEY)")
        connection.executemany("INSERT INTO keep_ciks VALUES (?)", [(cik,) for cik in sorted(keep)])
        counts = {}
        for table in ("issuer_submissions", "filing_metadata"):
            connection.execute(f"INSERT INTO main.{table} SELECT * FROM legacy.{table} WHERE cik10 IN (SELECT cik10 FROM keep_ciks)")
            expected = connection.execute(f"SELECT COUNT(*) FROM legacy.{table} WHERE cik10 IN (SELECT cik10 FROM keep_ciks)").fetchone()[0]
            actual = connection.execute(f"SELECT COUNT(*) FROM main.{table}").fetchone()[0]
            counts[table] = actual
            if actual != expected:
                raise RuntimeError(f"Compaction verification failed for {table}")
            columns = ",".join(row[1] for row in connection.execute(f"PRAGMA main.table_info({table})"))
            if connection.execute(f"SELECT {columns} FROM legacy.{table} WHERE cik10 IN (SELECT cik10 FROM keep_ciks) EXCEPT SELECT {columns} FROM main.{table} LIMIT 1").fetchone():
                raise RuntimeError(f"Compaction changed rows in {table}")
        if connection.execute("PRAGMA main.integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Compact metadata integrity check failed")
        connection.commit()
    temporary.replace(source)
    bulk_state_path = source.with_name("bulk-state.json")
    if bulk_state_path.exists():
        bulk_state = json.loads(bulk_state_path.read_text())
        bulk_state["status"] = "scoped"
        bulk_state.setdefault("normalizedStores", {}).setdefault("submissions.sqlite3", {}).update({"status": "scoped", "scope": "local-issuers", "issuersImported": counts["issuer_submissions"], "filingsImported": counts["filing_metadata"]})
        write_json(bulk_state_path, bulk_state)
    return {"status": "compacted", "beforeBytes": before, "afterBytes": source.stat().st_size, "preservedCiks": sorted(keep), "counts": counts, "rollbackSource": str(source.with_name("submissions.zip"))}


def verify_metadata(service: EdgarDownloader, symbol: str) -> dict:
    """Check every accession in the issuer's recent and historical SEC sources."""
    paths = service._workspace_paths(service._settings.research_root, symbol)
    sources = [path for path in paths.submissions_dir.glob("CIK*.json") if path.stem[3:].isdigit()]
    if len(sources) != 1:
        raise RuntimeError("Expected exactly one issuer submissions source")
    issuer = json.loads(sources[0].read_text())
    cik10 = str(issuer["cik"]).zfill(10)
    accessions = set(issuer["filings"]["recent"]["accessionNumber"])
    history = issuer["filings"].get("files", [])
    for reference in history:
        payload = json.loads((paths.submissions_dir / reference["name"]).read_text())
        if len(payload["accessionNumber"]) != reference["filingCount"]:
            raise RuntimeError(f"Historical metadata count differs from SEC reference: {reference['name']}")
        accessions.update(payload["accessionNumber"])
    with sqlite3.connect(f"file:{service._metadata_cache_service._submissions_sqlite_path()}?mode=ro", uri=True) as connection:
        stored = {row[0] for row in connection.execute("SELECT accession_number FROM filing_metadata WHERE cik10=?", (cik10,))}
    if missing := accessions - stored:
        raise RuntimeError(f"Metadata catalog is missing {len(missing)} issuer-filing associations")
    return {"status": "verified", "cik": cik10, "sourceAccessions": len(accessions),
            "historicalSourceFiles": len(history), "checkedAt": datetime.now(UTC).isoformat()}


def verify_index(service: EdgarDownloader, symbol: str) -> dict:
    paths = service._workspace_paths(service._settings.research_root, symbol)
    state = service._intelligence_service._index_state(paths)
    if state.status != "ready":
        raise RuntimeError(f"Index is {state.status}: {'; '.join(state.limitations)}")
    database = paths.intelligence_dir / "index/retrieval.sqlite3"
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as connection:
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Search database integrity check failed")
        count, accessions = connection.execute("SELECT COUNT(*), COUNT(DISTINCT accession_number) FROM chunks").fetchone()
        sources = connection.execute("SELECT DISTINCT source_path, sec_url FROM chunks").fetchall()
        connection.execute("SELECT COUNT(*) FROM chunks_fts WHERE chunks_fts MATCH 'report'").fetchone()
    vectors = np.load(paths.intelligence_dir / "index/embeddings.f16.npy", mmap_mode="r")
    if len(vectors) != count or not np.isfinite(vectors).all() or accessions != state.eligibleAccessions:
        raise RuntimeError("Filing/vector coverage verification failed")
    if not all(Path(path).is_file() and url.startswith("https://www.sec.gov/Archives/") for path, url in sources):
        raise RuntimeError("Source document or SEC provenance verification failed")
    return {"status": "verified", "filings": accessions, "documents": len(sources), "chunks": count,
            "xbrlFacts": state.indexedXbrlFacts, "dimensions": vectors.shape[1], "checkedAt": datetime.now(UTC).isoformat()}


def refresh_facts_only(service: EdgarDownloader, symbol: str) -> dict:
    """Financial facts can refresh independently of costly narrative embeddings."""
    paths = service._workspace_paths(service._settings.research_root, symbol)
    if (paths.metadata_dir / "fund-scope.json").exists():
        return {"status": "fund-series", "message": "Fund data is maintained from its N-PORT reports."}
    resolved = service._resolver_service.resolve_issuer_query(symbol, service._default_runtime_options())
    state = service._metadata_cache_service.refresh_issuer_facts(resolved, service._default_runtime_options(), force_refresh=True)
    if state.get("status") != "ready":
        raise RuntimeError(f"Financial facts refresh failed: {state.get('lastError')}")
    filings = json.loads((paths.exports_dir / "all-filings.json").read_text())
    with tempfile.TemporaryDirectory(prefix=".facts-build-", dir=paths.edgar_root) as directory:
        staged_paths = replace(paths, intelligence_dir=Path(directory))
        facts = service._intelligence_service._xbrl_fact_service.build_issuer_facts(paths=staged_paths, filings=filings)
        if not facts.facts_count:
            raise RuntimeError("No structured facts were extracted; prior fact store retained")
        destination = paths.intelligence_dir / "xbrl"
        previous = paths.intelligence_dir / ".xbrl.previous"
        if previous.exists() and not destination.exists():
            previous.replace(destination)
        if previous.exists():
            shutil.rmtree(previous)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            destination.replace(previous)
        try:
            (staged_paths.intelligence_dir / "xbrl").replace(destination)
        except OSError:
            if previous.exists():
                previous.replace(destination)
            raise
        if previous.exists():
            shutil.rmtree(previous)
    last_index = paths.intelligence_dir / "jobs/last-index.json"
    if last_index.exists():
        payload = json.loads(last_index.read_text())
        payload["indexState"]["indexedXbrlFacts"] = facts.facts_count
        write_json(last_index, payload)
    return {"status": "ready", "facts": facts.facts_count, "concepts": facts.concepts_count, "sourceSha256": state["sha256"], "checkedAt": state["lastRefreshedAt"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--positions-dir", type=Path, required=True)
    today = date.today()
    default_start = date(today.year - 5, today.month, min(today.day, calendar.monthrange(today.year - 5, today.month)[1]))
    parser.add_argument("--start-date", type=date.fromisoformat, default=default_start)
    parser.add_argument("--end-date", type=date.fromisoformat)
    parser.add_argument("--include-research-stocks", action="store_true")
    parser.add_argument("--add-symbols", nargs="*", default=[])
    parser.add_argument("--report-name", default="holdings-rebuild.json", help="Separate result file for independently managed research universes")
    parser.add_argument("--phase", choices=["sync", "index", "all", "compact", "verify", "facts"], default="all")
    parser.add_argument("--exhibits", action="store_true", help="Include textual EX-99 exhibits for current reports")
    parser.add_argument("--only", nargs="*")
    args = parser.parse_args()
    source = latest_positions(args.positions_dir)
    holdings = holding_symbols(source)
    settings = DashboardSettings.load()
    folders, unmapped = research_symbols(settings.stocks_root) if args.include_research_stocks else ([], [])
    symbols = sorted(set(holdings + folders + [symbol.upper() for symbol in args.add_symbols]))
    service = EdgarDownloader(settings)
    if Path(args.report_name).name != args.report_name:
        parser.error("--report-name must be a filename within the SEC cache")
    report_path = settings.research_root / ".sec" / args.report_name
    report = json.loads(report_path.read_text()) if report_path.exists() else {"results": {}}
    report.update({"positionsSource": str(source), "holdings": holdings, "universe": symbols, "researchFolders": folders,
                   "unmappedResearchFolders": unmapped, "addedSymbols": args.add_symbols,
                   "documentStartDate": args.start_date.isoformat(), "documentEndDate": str(args.end_date) if args.end_date else None,
                   "forms": REPORT_FORMS, "updatedAt": datetime.now(UTC).isoformat()})
    if args.phase == "compact":
        report["compaction"] = compact_metadata(service)
        write_json(report_path, report)
        print(json.dumps(report["compaction"]), flush=True)
        return 0
    for symbol in symbols:
        if args.only and symbol not in args.only:
            continue
        result = report["results"].setdefault(symbol, {})
        try:
            if args.phase == "verify":
                result["metadataVerification"] = verify_metadata(service, symbol)
            if args.phase == "facts":
                if not result.get("coverage", "").startswith("metadata-only"):
                    result["factsRefresh"] = refresh_facts_only(service, symbol)
                    print(json.dumps({"ticker": symbol, "factsRefresh": result["factsRefresh"]}), flush=True)
            if args.phase in {"sync", "all"}:
                print(json.dumps({"ticker": symbol, "stage": "syncing"}), flush=True)
                sync = service.sync(EdgarSyncRequest(issuerQuery=symbol, startDate=args.start_date, endDate=args.end_date, formTypes=REPORT_FORMS, includeExhibits=args.exhibits))
                result["sync"] = sync.model_dump(mode="json")
                result.update({"documentStartDate": args.start_date.isoformat(), "documentEndDate": str(args.end_date) if args.end_date else None})
                result.pop("coverage", None)
                print(json.dumps({"ticker": symbol, "stage": "synced", "bodyCache": sync.bodyCacheState.model_dump(mode="json")}), flush=True)
                if sync.bodyCacheState.failedFilings or sync.metadataState.status != "fresh":
                    raise RuntimeError("SEC refresh was incomplete; see saved sync details")
                if sync.bodyCacheState.matchedFilings == 0:
                    result["coverage"] = "metadata-only: no selected report forms in the requested date range"
                    result.pop("error", None)
                    write_json(report_path, report)
                    continue
            if args.phase in {"index", "all"}:
                if result.get("coverage", "").startswith("metadata-only"):
                    print(json.dumps({"ticker": symbol, "coverage": result["coverage"]}), flush=True)
                    result.pop("error", None)
                    write_json(report_path, report)
                    continue
                paths = service._workspace_paths(settings.research_root, symbol)
                workspace = service.workspace(EdgarWorkspaceRequest(ticker=symbol))
                print(json.dumps({"ticker": symbol, "stage": "indexing"}), flush=True)
                indexed = service._intelligence_service.index_workspace(workspace=workspace, request=EdgarIntelligenceIndexRequest(ticker=symbol), paths=paths)
                result["index"] = indexed.model_dump(mode="json")
                print(json.dumps({"ticker": symbol, "stage": "indexed", "state": indexed.indexState.model_dump(mode="json")}), flush=True)
                if indexed.status == "failed" or indexed.indexState.status != "ready":
                    raise RuntimeError(indexed.message)
            if args.phase in {"index", "all", "verify"}:
                if result.get("coverage", "").startswith("metadata-only"):
                    print(json.dumps({"ticker": symbol, "coverage": result["coverage"]}), flush=True)
                    result.pop("error", None)
                    write_json(report_path, report)
                    continue
                result["verification"] = verify_index(service, symbol)
                print(json.dumps({"ticker": symbol, "verification": result["verification"]}), flush=True)
            result.pop("error", None)
        except Exception as exc:
            result["error"] = str(exc)
            print(json.dumps({"ticker": symbol, "error": str(exc)}), flush=True)
        write_json(report_path, report)
    return 1 if any(row.get("error") for row in report["results"].values()) else 0


if __name__ == "__main__":
    raise SystemExit(main())
