from __future__ import annotations

import gzip
import json
from pathlib import Path
import sqlite3

import numpy as np
import pytest

from investing_platform.config import DashboardSettings
from investing_platform.models import EdgarIntelligenceIndexRequest
from investing_platform.services.edgar import EdgarDownloader
from investing_platform.services.edgar_common import ResolvedCompany
from investing_platform.services.edgar_intelligence import EdgarIntelligenceService
from investing_platform.services.omlx_client import OmlxClientError
from investing_platform.services.edgar_fund_facts import build_fund_store
from investing_platform.services.edgar_xbrl_facts import EdgarXbrlFactService


class Embeddings:
    def __init__(self):
        self.texts = []
        self.fail = False

    def has_model(self, model):
        return True

    def embed_texts(self, *, model, texts):
        if self.fail:
            raise OmlxClientError("temporary model outage")
        self.texts.extend(texts)
        return [[1., 2., 3.] for _ in texts]


def test_issuer_facts_are_compressed_and_failed_refresh_preserves_source(tmp_path):
    settings = DashboardSettings(research_root=tmp_path)
    downloader = EdgarDownloader(settings)
    resolved = ResolvedCompany(cik="1", cik10="0000000001", ticker="ONE", company_name="One", submissions_payload={})
    requested = []

    class Response:
        headers = {}
        content = b'{"cik":1, "facts": {"us-gaap": {}}}\n'
        def json(self):
            return {"cik": 1, "facts": {"us-gaap": {}}}
        def close(self):
            pass

    def request(method, url, options, stream):
        requested.append(url)
        return Response()

    cache = downloader._metadata_cache_service
    cache._request = request
    state = cache.refresh_issuer_facts(resolved, downloader._default_runtime_options())
    source = tmp_path / ".sec/filing-metadata/companyfacts/CIK0000000001.json.gz"
    before = source.read_bytes()
    assert gzip.decompress(before) == Response.content
    assert json.loads(gzip.decompress(before))["cik"] == 1
    assert state["status"] == "ready"
    assert requested == ["https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json"]
    def fail(*args):
        raise RuntimeError("SEC unavailable")
    cache._request = fail
    assert cache.refresh_issuer_facts(resolved, downloader._default_runtime_options())["status"] == "stale"
    assert source.read_bytes() == before


def test_index_covers_cached_filings_reuses_vectors_and_preserves_last_good_generation(tmp_path):
    settings = DashboardSettings(research_root=tmp_path)
    downloader = EdgarDownloader(settings)
    client = Embeddings()
    service = EdgarIntelligenceService(settings, omlx_client=client)
    paths = downloader._workspace_paths(tmp_path, "ONE")
    paths.exports_dir.mkdir(parents=True)
    filings = []
    for i in range(2):
        filing = {"ticker": "ONE", "form": "10-K" if i == 0 else "10-Q", "filingDate": f"202{i}-01-01", "accessionNumber": f"a{i}", "accessionNumberNoDashes": f"a{i}", "primaryDocument": "report.htm", "primaryDocumentUrl": f"https://www.sec.gov/Archives/a{i}/report.htm"}
        filings.append(filing)
        path = paths.stock_root / downloader._filing_folder_name(filing) / "primary/report.htm"
        path.parent.mkdir(parents=True)
        path.write_text(f"<html><p>Unique disclosure number {i} about revenue.</p></html>")
    (paths.exports_dir / "matched-filings.json").write_text(json.dumps(filings[:1]))
    (paths.exports_dir / "all-filings.json").write_text(json.dumps(filings))
    request = EdgarIntelligenceIndexRequest(ticker="ONE")
    first = service.index_workspace(paths=paths, workspace=object(), request=request)
    assert first.indexState.indexedAccessions == 2
    count = len(client.texts)
    second = service.index_workspace(paths=paths, workspace=object(), request=request)
    assert second.indexState.status == "ready"
    assert len(client.texts) == count
    database = paths.intelligence_dir / "index/retrieval.sqlite3"
    before = database.read_bytes()
    bounded = service.index_workspace(paths=paths, workspace=object(), request=request, max_documents=1, job_kind="ask_maintenance")
    assert bounded.job.status == "deferred"
    assert database.read_bytes() == before
    narrowed = service.index_workspace(paths=paths, workspace=object(), request=EdgarIntelligenceIndexRequest(ticker="ONE", forms=["10-K"]))
    assert narrowed.job.status == "deferred"
    assert database.read_bytes() == before
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM chunks_fts WHERE chunks_fts MATCH 'revenue'").fetchone()[0] == 2
    changed = paths.stock_root / downloader._filing_folder_name(filings[0]) / "primary/report.htm"
    changed.write_text("<html><p>Changed disclosure requiring a new embedding.</p></html>")
    client.fail = True
    failure = service.index_workspace(paths=paths, workspace=object(), request=request)
    assert failure.status == "failed"
    assert "preserved" in failure.message
    assert database.read_bytes() == before
    assert service._index_state(paths).status == "ready"
    client.fail = False
    service.index_workspace(paths=paths, workspace=object(), request=request)
    assert len(client.texts) == count + 1
    assert np.load(paths.intelligence_dir / "index/embeddings.f16.npy").shape == (2, 3)


def test_chunks_cover_tail_and_respect_embedding_token_limit(tmp_path):
    service = EdgarIntelligenceService(DashboardSettings(research_root=tmp_path), omlx_client=Embeddings())
    text = ("Revenue was $1,234,567.89; risks include supply constraints. " * 200) + "THE FINAL DISCLOSURE"
    chunks = service._chunk_text(text)
    assert len(chunks) > 1
    assert chunks[-1]["text"].endswith("THE FINAL DISCLOSURE")
    covered = set()
    for chunk in chunks:
        assert text[chunk["startChar"]:chunk["endChar"]] == chunk["text"]
        covered.update(range(chunk["startChar"], chunk["endChar"]))
        if service._tokenizer:
            assert len(service._tokenizer.encode(chunk["text"]).ids) <= 512
        else:
            assert len(chunk["text"].encode("utf-8")) <= 484
    assert all(i in covered for i, char in enumerate(text) if not char.isspace())


def test_nport_store_checks_series_and_preserves_decimal_values(tmp_path):
    import pytest
    service = EdgarDownloader(DashboardSettings(research_root=tmp_path))
    paths = service._workspace_paths(tmp_path, "VOO")
    paths.metadata_dir.mkdir(parents=True)
    (paths.metadata_dir / "fund-scope.json").write_text(json.dumps({"cik": "0000036405", "seriesId": "S000002839", "classId": "C000092055"}))
    filing = {"form": "NPORT-P", "filingDate": "2026-08-28", "accessionNumberNoDashes": "a1", "accessionNumber": "a-1", "primaryDocument": "primary_doc.xml", "primaryDocumentUrl": "https://www.sec.gov/Archives/primary_doc.xml"}
    source = paths.stock_root / service._filing_folder_name(filing) / "primary/primary_doc.xml"
    source.parent.mkdir(parents=True)
    source.write_text('<edgarSubmission xmlns="http://www.sec.gov/edgar/nport"><genInfo><seriesId>S000002839</seriesId><repPdDate>2026-06-30</repPdDate></genInfo><fundInfo><netAssets>1234567890123.45</netAssets></fundInfo><invstOrSec><name>Example</name><valUSD>123.00000001</valUSD></invstOrSec></edgarSubmission>')
    build_fund_store(paths, [filing])
    database = paths.intelligence_dir / "fund/fund.sqlite3"
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT series_id, report_date, net_assets FROM reports").fetchone() == ("S000002839", "2026-06-30", "1234567890123.45")
        assert connection.execute("SELECT value_usd FROM positions").fetchone()[0] == "123.00000001"
    database.unlink()
    source.write_text(source.read_text().replace("S000002839", "S999999999"))
    with pytest.raises(ValueError, match="selected fund series"):
        build_fund_store(paths, [filing])


def test_metadata_compaction_retains_used_issuers_and_live_changes(tmp_path):
    import importlib.util
    module_path = Path(__file__).resolve().parents[1] / "scripts/rebuild_sec_holdings.py"
    spec = importlib.util.spec_from_file_location("sec_rebuild_test", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    service = EdgarDownloader(DashboardSettings(research_root=tmp_path))
    cache = service._metadata_cache_service
    for number, origin in [(1, "bulk"), (2, "live"), (3, "bulk")]:
        issuer = ResolvedCompany(cik=str(number), cik10=str(number).zfill(10), ticker=f"T{number}", company_name=f"Issuer {number}", submissions_payload={})
        filing = {"accessionNumber": f"a{number}", "cik10": issuer.cik10, "cik": issuer.cik, "ticker": issuer.ticker, "companyName": issuer.company_name, "form": "10-K"}
        cache.upsert_issuer_filings(issuer, [filing], discovered_via=origin)
        if number == 1:
            path = cache._global_metadata_snapshot_path(issuer.cik10)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"cik": issuer.cik10, "filings": [filing]}))
    archive = cache._submissions_sqlite_path().with_name("submissions.zip")
    import zipfile
    with zipfile.ZipFile(archive, "w") as handle:
        handle.writestr("CIK0000000003.json", "{}")
    original_archive = archive.read_bytes()
    result = module.compact_metadata(service)
    assert result["status"] == "compacted"
    with sqlite3.connect(cache._submissions_sqlite_path()) as connection:
        assert connection.execute("SELECT accession_number FROM filing_metadata ORDER BY accession_number").fetchall() == [("a1",), ("a2",)]
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert archive.read_bytes() == original_archive


def test_fidelity_scope_uses_filename_date_and_option_underlyings(tmp_path):
    import importlib.util
    spec = importlib.util.spec_from_file_location("sec_rebuild_symbols", Path(__file__).resolve().parents[1] / "scripts/rebuild_sec_holdings.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for name in ["Portfolio_Positions_Sep-30-2026.csv", "Portfolio_Positions_Nov-09-2026.csv"]:
        (tmp_path / name).write_text('Symbol,Description\nSPAXX**,Cash\nNVDA,Stock\n -NVDA261120C200,Option\nVOO,Fund\nPending activity,Pending\n')
    selected = module.latest_positions(tmp_path)
    assert selected.name == "Portfolio_Positions_Nov-09-2026.csv"
    assert module.holding_symbols(selected) == ["NVDA", "VOO"]
    (tmp_path / "AAPL").mkdir()
    (tmp_path / "KRKNF").mkdir()
    (tmp_path / "londonlink").mkdir()
    assert module.research_symbols(tmp_path) == (["AAPL", "KRKNF"], ["londonlink"])


def test_verified_cik_override_preserves_ticker_for_non_registry_issuer(tmp_path, monkeypatch):
    from investing_platform.models import EdgarDownloadRequest
    service = EdgarDownloader(DashboardSettings(research_root=tmp_path))
    resolver = service._resolver_service
    aliases = tmp_path / ".sec/issuer-registry/ticker-overrides.json"
    aliases.parent.mkdir(parents=True)
    aliases.write_text(json.dumps({"KRKNF": {"cik": "0001499289"}}))
    monkeypatch.setattr(resolver, "_load_company_lookup", lambda *a, **kw: [])
    requested = []
    def fetch(url, options):
        requested.append(url)
        return {"cik": "1499289", "name": "Kraken Robotics Inc.", "tickers": [], "filings": {"recent": {"form": ["D"]}}}
    resolver._get_json = fetch
    issuer = resolver.resolve_download_request(EdgarDownloadRequest(ticker="KRKNF"), service._default_runtime_options())
    assert issuer.ticker == "KRKNF" and issuer.cik10 == "0001499289"
    assert requested == ["https://data.sec.gov/submissions/CIK0001499289.json"]


@pytest.mark.parametrize("form", ["10-K", "10-KT", "8-K12B"])
def test_legacy_submission_backfill_without_primary_document_excludes_binary_attachments(tmp_path, form):
    service = EdgarDownloader(DashboardSettings(research_root=tmp_path))
    issuer = ResolvedCompany(cik="320193", cik10="0000320193", ticker="AAPL", company_name="Apple", submissions_payload={})
    filings = service._build_filing_rows([{"accessionNumber": ["0000320193-94-000016"], "form": [form], "filingDate": ["1994-12-13"], "primaryDocument": [""]}], issuer)
    assert filings[0]["primaryDocument"] == "0000320193-94-000016.txt"
    assert filings[0]["primaryDocumentUrl"] == "https://www.sec.gov/Archives/edgar/data/320193/0000320193-94-000016.txt"
    source = tmp_path / filings[0]["primaryDocument"]
    source.write_text(f'<SEC-DOCUMENT><DOCUMENT>\n<TYPE>{form}\n<TEXT>Historical annual revenue disclosure.</TEXT></DOCUMENT><DOCUMENT>\n<TYPE>GRAPHIC\n<TEXT>UUENCODED_BINARY_PAYLOAD</TEXT></DOCUMENT><DOCUMENT>\n<TYPE>EX-99.1\n<TEXT>Historical earnings exhibit.</TEXT></DOCUMENT></SEC-DOCUMENT>')
    text = service._intelligence_service._extract_structured_text(source)
    assert "Historical annual revenue disclosure" in text
    assert "Historical earnings exhibit" in text
    assert "UUENCODED_BINARY_PAYLOAD" not in text


def test_companyfacts_retains_decimal_precision_from_original_json(tmp_path):
    settings = DashboardSettings(research_root=tmp_path)
    service = EdgarDownloader(settings)
    paths = service._workspace_paths(tmp_path, "ONE")
    source = tmp_path / ".sec/filing-metadata/companyfacts/CIK0000000001.json.gz"
    source.parent.mkdir(parents=True)
    raw = b'{"cik":1,"facts":{"us-gaap":{"Revenues":{"units":{"USD":[{"val":123456789012345.6789,"accn":"a1","form":"10-K","filed":"2026-01-01","start":"2025-01-01","end":"2025-12-31"}]}}}}}'
    source.write_bytes(gzip.compress(raw))
    result = EdgarXbrlFactService(settings).build_issuer_facts(paths=paths, filings=[{"cik": "1", "accessionNumber": "a1"}])
    assert result.facts_count == 1
    with sqlite3.connect(paths.intelligence_dir / "xbrl/facts.sqlite3") as connection:
        assert connection.execute("SELECT value_text FROM facts").fetchone()[0] == "123456789012345.6789"


def test_metadata_migrates_legacy_identity_and_retains_shared_filing_associations(tmp_path):
    service = EdgarDownloader(DashboardSettings(research_root=tmp_path))
    cache = service._metadata_cache_service
    database = cache._submissions_sqlite_path()
    database.parent.mkdir(parents=True)
    with sqlite3.connect(database) as connection:
        connection.execute("""CREATE TABLE filing_metadata (
            accession_number TEXT PRIMARY KEY, cik10 TEXT NOT NULL, ticker TEXT,
            company_name TEXT, form TEXT, filing_date TEXT, report_date TEXT,
            acceptance_date_time TEXT, accession_number_no_dashes TEXT,
            primary_document TEXT, primary_doc_description TEXT, items TEXT, act TEXT,
            file_number TEXT, film_number TEXT, size INTEGER, is_xbrl INTEGER,
            is_inline_xbrl INTEGER, archive_base_url TEXT, primary_document_url TEXT,
            discovered_via TEXT, source_file TEXT, imported_at TEXT NOT NULL)""")
        connection.execute("INSERT INTO filing_metadata(accession_number,cik10,ticker,form,discovered_via,imported_at) VALUES ('shared','0000000001','ONE','SC 13G','bulk','2026-01-01')")
        connection.execute("CREATE INDEX idx_filing_metadata_cik_date ON filing_metadata(cik10,filing_date DESC,accession_number DESC)")
    for number, ticker in [(2, "TWO"), (1, "ONE")]:
        issuer = ResolvedCompany(cik=str(number), cik10=str(number).zfill(10), ticker=ticker, company_name=ticker, submissions_payload={})
        cache.upsert_issuer_filings(issuer, [{"accessionNumber": "shared", "cik10": issuer.cik10, "ticker": ticker, "form": "SC 13G"}], discovered_via="live")
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT cik10,accession_number,discovered_via FROM filing_metadata ORDER BY cik10").fetchall() == [
            ("0000000001", "shared", "bulk"), ("0000000002", "shared", "live")]
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert connection.execute("SELECT tbl_name FROM sqlite_master WHERE name='idx_filing_metadata_cik_date'").fetchone()[0] == "filing_metadata"


def test_metadata_verification_detects_a_missing_historical_association(tmp_path):
    import importlib.util
    import pytest
    spec = importlib.util.spec_from_file_location("sec_metadata_verify", Path(__file__).resolve().parents[1] / "scripts/rebuild_sec_holdings.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    service = EdgarDownloader(DashboardSettings(research_root=tmp_path))
    paths = service._workspace_paths(tmp_path, "ONE")
    paths.submissions_dir.mkdir(parents=True)
    (paths.submissions_dir / "CIK0000000001.json").write_text(json.dumps({"cik": 1, "filings": {
        "recent": {"accessionNumber": ["current"]},
        "files": [{"name": "older.json", "filingCount": 1}]}}))
    (paths.submissions_dir / "older.json").write_text(json.dumps({"accessionNumber": ["historical"]}))
    issuer = ResolvedCompany(cik="1", cik10="0000000001", ticker="ONE", company_name="One", submissions_payload={})
    service._metadata_cache_service.upsert_issuer_filings(issuer, [{"cik10": issuer.cik10, "accessionNumber": "current"}], discovered_via="live")
    with pytest.raises(RuntimeError, match="missing 1 issuer-filing associations"):
        module.verify_metadata(service, "ONE")
    service._metadata_cache_service.upsert_issuer_filings(issuer, [{"cik10": issuer.cik10, "accessionNumber": "historical"}], discovered_via="live")
    result = module.verify_metadata(service, "ONE")
    assert result["status"] == "verified" and result["sourceAccessions"] == 2
