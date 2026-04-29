from __future__ import annotations

import json
import numpy as np
import sqlite3

from investing_platform.config import DashboardSettings
from investing_platform.models import EdgarIntelligenceIndexRequest
from investing_platform.services.edgar_intelligence import EdgarIntelligenceService
from investing_platform.services.edgar import EdgarDownloader
from investing_platform.services.omlx_client import OmlxModel


class FakeOmlxClient:
    def list_models(self) -> list[OmlxModel]:
        return [OmlxModel(id="nomicai-modernbert-embed-base-4bit")]

    def has_model(self, model_id: str) -> bool:
        return model_id == "nomicai-modernbert-embed-base-4bit"

    def embed_texts(self, *, model: str, texts: list[str]) -> list[list[float]]:
        return [[1.0, 0.0, float(index + 1)] for index, _text in enumerate(texts)]


class MissingEmbeddingOmlxClient:
    def list_models(self) -> list[OmlxModel]:
        return []

    def has_model(self, model_id: str) -> bool:
        return False

    def embed_texts(self, *, model: str, texts: list[str]) -> list[list[float]]:
        raise AssertionError("Embedding should not run when the model is unavailable.")


def test_intelligence_index_builds_ticker_scoped_corpus_scaffold(tmp_path) -> None:
    settings = DashboardSettings(
        research_root=tmp_path / "research-root",
        edgar_user_agent="Investing Platform tests@example.com",
    )
    artifact_store = EdgarDownloader(settings)
    artifact_store._intelligence_service = EdgarIntelligenceService(settings, omlx_client=FakeOmlxClient())
    paths = artifact_store._workspace_paths(settings.research_root, "AAPL")
    paths.exports_dir.mkdir(parents=True, exist_ok=True)

    filing = {
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
    (paths.exports_dir / "matched-filings.json").write_text(json.dumps([filing]), encoding="utf-8")
    primary_path = paths.stock_root / artifact_store._filing_folder_name(filing) / "primary" / "a10-k2025.htm"
    primary_path.parent.mkdir(parents=True, exist_ok=True)
    primary_path.write_text(
        "<html><body><h1>Risk Factors</h1><p>Competition and supply chain risk may affect margins.</p></body></html>",
        encoding="utf-8",
    )

    response = artifact_store._intelligence_service.index_workspace(
        workspace=object(),
        request=EdgarIntelligenceIndexRequest(ticker="AAPL"),
        paths=paths,
    )

    assert response.status == "completed"
    assert response.indexState.status == "ready"
    assert response.indexState.indexedAccessions == 1
    assert response.indexState.indexedChunks == 1
    assert (paths.intelligence_dir / "corpus" / "filing-corpus.json").exists()
    assert (paths.intelligence_dir / "corpus" / "chunks.jsonl").exists()
    assert (paths.intelligence_dir / "index" / "embeddings.f16.npy").exists()
    assert (paths.intelligence_dir / "index" / "embeddings.meta.json").exists()
    assert (paths.intelligence_dir / "index" / "retrieval.sqlite3").exists()
    assert (paths.intelligence_dir / "jobs" / "last-index.json").exists()

    embeddings = np.load(paths.intelligence_dir / "index" / "embeddings.f16.npy")
    assert embeddings.shape == (1, 3)

    embedding_meta = json.loads((paths.intelligence_dir / "index" / "embeddings.meta.json").read_text(encoding="utf-8"))
    assert embedding_meta["status"] == "ready"
    assert embedding_meta["chunksEmbedded"] == 1

    with sqlite3.connect(paths.intelligence_dir / "index" / "retrieval.sqlite3") as connection:
        chunk_count = connection.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    assert chunk_count == 1


def test_intelligence_index_removes_stale_embeddings_when_embedding_model_is_missing(tmp_path) -> None:
    settings = DashboardSettings(
        research_root=tmp_path / "research-root",
        edgar_user_agent="Investing Platform tests@example.com",
    )
    artifact_store = EdgarDownloader(settings)
    artifact_store._intelligence_service = EdgarIntelligenceService(settings, omlx_client=MissingEmbeddingOmlxClient())
    paths = artifact_store._workspace_paths(settings.research_root, "AAPL")
    paths.exports_dir.mkdir(parents=True, exist_ok=True)
    embeddings_path = paths.intelligence_dir / "index" / "embeddings.f16.npy"
    embeddings_path.parent.mkdir(parents=True, exist_ok=True)
    np.save(embeddings_path, np.asarray([[1.0, 0.0, 0.0]], dtype=np.float16))

    filing = {
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
    (paths.exports_dir / "matched-filings.json").write_text(json.dumps([filing]), encoding="utf-8")
    primary_path = paths.stock_root / artifact_store._filing_folder_name(filing) / "primary" / "a10-k2025.htm"
    primary_path.parent.mkdir(parents=True, exist_ok=True)
    primary_path.write_text(
        "<html><body><p>Competition and supply chain risk may affect margins.</p></body></html>",
        encoding="utf-8",
    )

    response = artifact_store._intelligence_service.index_workspace(
        workspace=object(),
        request=EdgarIntelligenceIndexRequest(ticker="AAPL"),
        paths=paths,
    )

    assert response.indexState.status == "degraded"
    assert not embeddings_path.exists()
    embedding_meta = json.loads((paths.intelligence_dir / "index" / "embeddings.meta.json").read_text(encoding="utf-8"))
    assert embedding_meta["status"] == "missing"
