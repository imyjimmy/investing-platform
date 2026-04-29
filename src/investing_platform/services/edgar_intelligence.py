"""Ticker-scoped EDGAR intelligence architecture services."""

from __future__ import annotations

from bs4 import BeautifulSoup
from datetime import UTC, datetime
import json
import numpy as np
from pathlib import Path
import re
import sqlite3
import time
from typing import Any
from urllib.parse import quote

from investing_platform.config import DashboardSettings
from investing_platform.models import (
    EdgarAnswerModelInfo,
    EdgarComparisonRequest,
    EdgarComparisonResponse,
    EdgarFreshnessState,
    EdgarIndexState,
    EdgarIntelligenceErrorDetail,
    EdgarIntelligenceIndexRequest,
    EdgarIntelligenceIndexResponse,
    EdgarIntelligenceJob,
    EdgarIntelligenceJobProgress,
    EdgarIntelligenceModelState,
    EdgarIntelligenceState,
    EdgarIntelligenceStatus,
    EdgarMaintenanceState,
    EdgarPollSelector,
    EdgarQuestionRequest,
    EdgarQuestionResponse,
    EdgarRetrievalState,
    EdgarWorkspaceRequest,
)
from investing_platform.services.edgar_common import CHUNKING_VERSION, EMBEDDING_MODEL_VERSION, INDEX_SCHEMA_VERSION, WorkspacePaths
from investing_platform.services.omlx_client import OmlxClient, OmlxClientError


CORPUS_VERSION = "primary-documents-v1"
EMBEDDING_BATCH_SIZE = 16


class EdgarIntelligenceApiError(RuntimeError):
    """Structured error raised by EDGAR intelligence API operations."""

    def __init__(
        self,
        *,
        status_code: int,
        code: str,
        message: str,
        ticker: str | None = None,
        job_id: str | None = None,
        retry_after_seconds: int | None = None,
        limitations: list[str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.detail = EdgarIntelligenceErrorDetail(
            code=code,
            message=message,
            ticker=ticker,
            jobId=job_id,
            retryAfterSeconds=retry_after_seconds,
            limitations=limitations or [],
        )


class EdgarIntelligenceService:
    """Manage ticker-scoped EDGAR intelligence state and first-pass corpus artifacts."""

    def __init__(self, settings: DashboardSettings, *, omlx_client: OmlxClient | None = None) -> None:
        self._settings = settings
        self._omlx_client = omlx_client or OmlxClient(settings)

    def status_for_paths(self, paths: WorkspacePaths, *, job_id: str | None = None) -> EdgarIntelligenceState:
        index_state = self._index_state(paths)
        active_job = self._job_state(paths, job_id=job_id)
        if index_state.indexedAccessions > 0:
            return EdgarIntelligenceState(
                status="ready" if index_state.status == "ready" else "not-ready",
                questionAnsweringEnabled=index_state.status == "ready",
                detail="EDGAR intelligence artifacts are present." if index_state.status == "ready" else "; ".join(index_state.limitations),
                lastIndexedAt=index_state.lastIndexedAt,
                indexedFilings=index_state.indexedAccessions,
                jobId=active_job.jobId,
            )
        return EdgarIntelligenceState(
            status="unavailable",
            questionAnsweringEnabled=False,
            detail="Local filing Q&A will be enabled after the EDGAR intelligence index is built.",
            lastIndexedAt=index_state.lastIndexedAt,
            indexedFilings=index_state.indexedAccessions,
            jobId=job_id,
        )

    def status_for_workspace(
        self,
        *,
        workspace: Any,
        request: EdgarWorkspaceRequest,
        paths: WorkspacePaths,
        job_id: str | None = None,
    ) -> EdgarIntelligenceState:
        if workspace is None:
            return EdgarIntelligenceState(
                status="unavailable",
                questionAnsweringEnabled=False,
                detail="No EDGAR workspace exists for this ticker yet.",
                jobId=job_id,
            )
        intelligence_state = workspace.intelligenceState.model_copy()
        if job_id and not intelligence_state.jobId:
            intelligence_state.jobId = job_id
        if not intelligence_state.polledVia and intelligence_state.jobId:
            output_dir = request.outputDir
            output_param = f"&outputDir={quote(output_dir, safe='')}" if output_dir else ""
            intelligence_state.polledVia = (
                f"/api/sources/edgar/intelligence/status?ticker={quote(request.ticker, safe='')}"
                f"{output_param}&jobId={quote(intelligence_state.jobId, safe='')}"
            )
        return intelligence_state

    def api_status_for_workspace(
        self,
        *,
        workspace: Any,
        request: EdgarWorkspaceRequest,
        paths: WorkspacePaths,
        job_id: str | None = None,
    ) -> EdgarIntelligenceStatus:
        now = datetime.now(UTC)
        index_state = self._index_state(paths)
        model_state = self._model_state(now)
        job = self._job_state(paths, job_id=job_id)
        freshness_state = self._freshness_state(workspace)
        limitations: list[str] = []
        if workspace is None:
            limitations.append("No EDGAR workspace exists for this ticker yet.")
        limitations.extend(index_state.limitations)
        if model_state.status != "ready" and model_state.message:
            limitations.append(model_state.message)
        return EdgarIntelligenceStatus(
            ticker=request.ticker,
            outputDir=request.outputDir,
            workspaceRoot=str(paths.output_root),
            generatedAt=now,
            readyForAsk=workspace is not None and index_state.status == "ready" and model_state.status == "ready",
            modelState=model_state,
            freshnessState=freshness_state,
            indexState=index_state,
            job=job,
            limitations=limitations,
        )

    def index_workspace(
        self,
        *,
        workspace: Any,
        request: EdgarIntelligenceIndexRequest,
        paths: WorkspacePaths,
    ) -> EdgarIntelligenceIndexResponse:
        if request.includeExhibits:
            raise EdgarIntelligenceApiError(
                status_code=400,
                code="exhibits_not_supported",
                message="Curated exhibit indexing is deferred beyond phase 1.",
                ticker=request.ticker,
            )
        if workspace is None:
            raise EdgarIntelligenceApiError(
                status_code=404,
                code="workspace_not_found",
                message="Sync this ticker before building an EDGAR intelligence index.",
                ticker=request.ticker,
            )

        started_at = datetime.now(UTC)
        job_id = f"edgar-index-{request.ticker}-{started_at.strftime('%Y%m%dT%H%M%SZ')}"
        filings = self._load_selected_filings(paths, request.forms)
        documents, chunks, sections = self._build_corpus_documents(paths, filings)
        embeddings, embedding_limitations = self._build_embeddings(chunks)
        self._write_corpus_artifacts(paths, documents=documents, chunks=chunks, sections=sections, embeddings=embeddings)
        completed_at = datetime.now(UTC)
        has_embeddings = embeddings is not None and len(embeddings) == len(chunks) and len(chunks) > 0
        index_state = EdgarIndexState(
            status="ready" if has_embeddings else "degraded" if chunks else "missing",
            indexVersion=INDEX_SCHEMA_VERSION,
            corpusVersion=CORPUS_VERSION,
            chunkingVersion=CHUNKING_VERSION,
            embeddingModel=self._settings.llm_embed_model or EMBEDDING_MODEL_VERSION,
            eligibleAccessions=len(filings),
            indexedAccessions=len(documents),
            indexedChunks=len(chunks),
            staleAccessions=[],
            lastIndexedAt=completed_at if documents else None,
            limitations=embedding_limitations if chunks else ["No parseable primary filing documents were found."],
        )
        job = EdgarIntelligenceJob(
            jobId=job_id,
            kind="index",
            status="completed" if documents else "failed",
            startedAt=started_at,
            updatedAt=completed_at,
            completedAt=completed_at,
            progress=EdgarIntelligenceJobProgress(
                documentsTotal=len(filings),
                documentsCompleted=len(documents),
                chunksTotal=len(chunks),
                chunksCompleted=len(chunks),
            ),
            message="EDGAR intelligence index built." if has_embeddings else "Corpus scaffold built, but embeddings are not ready.",
        )
        self._write_last_index(paths, index_state=index_state, job=job)
        return EdgarIntelligenceIndexResponse(
            ticker=request.ticker,
            outputDir=request.outputDir,
            status="completed" if documents else "failed",
            mode="inline",
            jobId=job_id,
            pollSelector=EdgarPollSelector(ticker=request.ticker, outputDir=request.outputDir, jobId=job_id),
            indexState=index_state,
            job=job,
            message=job.message or "Index request completed.",
        )

    def answer_question(
        self,
        *,
        workspace: Any,
        request: EdgarQuestionRequest,
        paths: WorkspacePaths,
    ) -> EdgarQuestionResponse:
        if workspace is None:
            raise EdgarIntelligenceApiError(
                status_code=404,
                code="workspace_not_found",
                message="Sync this ticker before asking EDGAR filing questions.",
                ticker=request.ticker,
            )
        index_state = self._index_state(paths)
        if index_state.status != "ready":
            raise EdgarIntelligenceApiError(
                status_code=409,
                code="index_not_ready",
                message="The EDGAR intelligence index is not ready for question answering yet.",
                ticker=request.ticker,
                retry_after_seconds=10,
                limitations=index_state.limitations,
            )
        model_state = self._model_state(datetime.now(UTC))
        if model_state.status != "ready":
            raise EdgarIntelligenceApiError(
                status_code=502,
                code="model_unavailable",
                message=model_state.message or "The configured local model server is unavailable.",
                ticker=request.ticker,
            )
        started = time.monotonic()
        generated_at = datetime.now(UTC)
        return EdgarQuestionResponse(
            ticker=request.ticker,
            outputDir=request.outputDir,
            question=request.question,
            answer="Answer generation is not implemented in this first intelligence architecture pass.",
            confidence="low",
            generatedAt=generated_at,
            model=self._answer_model_info(),
            freshnessState=self._freshness_state(workspace),
            maintenanceState=EdgarMaintenanceState(status="none", elapsedMs=int((time.monotonic() - started) * 1000)),
            retrievalState=EdgarRetrievalState(chunksRetrieved=0, chunksUsed=0, eligibleAccessionsSearched=0, indexVersion=index_state.indexVersion),
            citations=[],
            limitations=["Generation and vector retrieval are intentionally deferred beyond this first architecture pass."],
        )

    def compare_filings(
        self,
        *,
        workspace: Any,
        request: EdgarComparisonRequest,
        paths: WorkspacePaths,
    ) -> EdgarComparisonResponse:
        filings = self._load_selected_filings(paths, request.forms)
        target_accessions = self._resolve_comparison_targets(filings, request.comparisonMode)
        resolved_question = self._comparison_question(request, target_accessions)
        question_response = self.answer_question(
            workspace=workspace,
            request=EdgarQuestionRequest(
                ticker=request.ticker,
                outputDir=request.outputDir,
                question=resolved_question,
                forms=request.forms,
                startDate=request.startDate,
                endDate=request.endDate,
                maxChunks=request.maxChunks,
                maxAnswerTokens=request.maxAnswerTokens,
                allowStale=request.allowStale,
            ),
            paths=paths,
        )
        return EdgarComparisonResponse(
            ticker=request.ticker,
            outputDir=request.outputDir,
            comparisonMode=request.comparisonMode,
            resolvedQuestion=resolved_question,
            targetAccessions=target_accessions,
            answer=question_response.answer,
            confidence=question_response.confidence,
            generatedAt=question_response.generatedAt,
            freshnessState=question_response.freshnessState,
            maintenanceState=question_response.maintenanceState,
            retrievalState=question_response.retrievalState,
            citations=question_response.citations,
            limitations=question_response.limitations,
        )

    def _model_state(self, now: datetime) -> EdgarIntelligenceModelState:
        base_url = self._settings.llm_base_url.rstrip("/")
        message: str | None = None
        status = "unavailable"
        if base_url:
            try:
                model_ids = {model.id for model in self._omlx_client.list_models()}
                if self._settings.llm_chat_model in model_ids:
                    status = "ready"
                elif model_ids:
                    message = f"oMLX is reachable, but chat model '{self._settings.llm_chat_model}' is not loaded."
                else:
                    message = "oMLX is reachable, but no models are loaded."
            except OmlxClientError as exc:
                message = str(exc)
        else:
            message = "No local model server base URL is configured."
        return EdgarIntelligenceModelState(
            status=status,  # type: ignore[arg-type]
            provider=self._settings.llm_provider,
            baseUrl=base_url,
            chatModel=self._settings.llm_chat_model,
            embeddingModel=self._settings.llm_embed_model,
            rerankerModel=self._settings.llm_rerank_model,
            lastCheckedAt=now,
            message=message,
        )

    def _freshness_state(self, workspace: Any) -> EdgarFreshnessState:
        metadata_state = getattr(workspace, "metadataState", None)
        if metadata_state is None:
            return EdgarFreshnessState(status="unknown", liveCheckStatus="not_needed", message="No EDGAR workspace metadata is available.")
        live_check_status = "succeeded" if metadata_state.status == "fresh" else "failed" if metadata_state.status == "degraded" else "skipped"
        return EdgarFreshnessState(
            status=metadata_state.status,
            liveCheckStatus=live_check_status,  # type: ignore[arg-type]
            lastMetadataRefreshAt=metadata_state.lastRefreshedAt,
            lastLiveCheckAt=metadata_state.lastLiveCheckedAt,
            message=metadata_state.message,
        )

    def _index_state(self, paths: WorkspacePaths) -> EdgarIndexState:
        last_index_payload = self._load_json_document(self._last_index_path(paths))
        if not last_index_payload:
            return EdgarIndexState(
                status="missing",
                indexVersion=INDEX_SCHEMA_VERSION,
                corpusVersion=CORPUS_VERSION,
                chunkingVersion=CHUNKING_VERSION,
                embeddingModel=self._settings.llm_embed_model or EMBEDDING_MODEL_VERSION,
                limitations=["No EDGAR intelligence index has been built for this workspace."],
            )
        raw_index_state = last_index_payload.get("indexState")
        if isinstance(raw_index_state, dict):
            try:
                return EdgarIndexState.model_validate(raw_index_state)
            except ValueError:
                pass
        return EdgarIndexState(
            status="failed",
            indexVersion=INDEX_SCHEMA_VERSION,
            corpusVersion=CORPUS_VERSION,
            chunkingVersion=CHUNKING_VERSION,
            embeddingModel=self._settings.llm_embed_model or EMBEDDING_MODEL_VERSION,
            limitations=["The saved EDGAR intelligence index state could not be parsed."],
        )

    def _job_state(self, paths: WorkspacePaths, *, job_id: str | None = None) -> EdgarIntelligenceJob:
        now = datetime.now(UTC)
        last_index_payload = self._load_json_document(self._last_index_path(paths))
        raw_job = last_index_payload.get("job") if last_index_payload else None
        if isinstance(raw_job, dict):
            try:
                job = EdgarIntelligenceJob.model_validate(raw_job)
                if job_id and job.jobId != job_id:
                    return EdgarIntelligenceJob(jobId=job_id, kind="none", status="idle", updatedAt=now, message="No active job matched the supplied jobId.")
                return job
            except ValueError:
                pass
        return EdgarIntelligenceJob(jobId=job_id, kind="none", status="idle", updatedAt=now)

    def _load_selected_filings(self, paths: WorkspacePaths, forms: list[str]) -> list[dict[str, Any]]:
        payload = self._load_json_document(paths.exports_dir / "matched-filings.json")
        if not isinstance(payload, list):
            return []
        allowed_forms = {form.upper() for form in forms if form.strip()}
        filings = [filing for filing in payload if isinstance(filing, dict)]
        if allowed_forms:
            filings = [filing for filing in filings if str(filing.get("form") or "").upper() in allowed_forms]
        return filings

    def _build_corpus_documents(self, paths: WorkspacePaths, filings: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
        documents: list[dict[str, Any]] = []
        chunks: list[dict[str, Any]] = []
        sections: list[dict[str, Any]] = []
        for filing in filings:
            primary_document = str(filing.get("primaryDocument") or "").strip()
            if not primary_document:
                continue
            source_path = paths.stock_root / self._filing_folder_name(filing) / "primary" / primary_document
            if not source_path.exists():
                continue
            text = self._extract_text(source_path)
            if not text:
                continue
            accession = str(filing.get("accessionNumber") or "")
            document = {
                "ticker": filing.get("ticker"),
                "accessionNumber": accession,
                "form": filing.get("form"),
                "filingDate": filing.get("filingDate"),
                "documentName": primary_document,
                "sourcePath": str(source_path),
                "secUrl": filing.get("primaryDocumentUrl"),
                "textLength": len(text),
            }
            documents.append(document)
            sections.append({**document, "section": "Primary Document", "startChar": 0, "endChar": len(text)})
            for chunk_index, chunk in enumerate(self._chunk_text(text), start=1):
                chunk_id = f"{accession}:primary:{chunk_index:04d}"
                chunks.append(
                    {
                        **document,
                        "chunkId": chunk_id,
                        "section": "Primary Document",
                        "startChar": chunk["startChar"],
                        "endChar": chunk["endChar"],
                        "text": chunk["text"],
                    }
                )
        return documents, chunks, sections

    def _write_corpus_artifacts(
        self,
        paths: WorkspacePaths,
        *,
        documents: list[dict[str, Any]],
        chunks: list[dict[str, Any]],
        sections: list[dict[str, Any]],
        embeddings: np.ndarray | None,
    ) -> None:
        corpus_dir = paths.intelligence_dir / "corpus"
        index_dir = paths.intelligence_dir / "index"
        corpus_dir.mkdir(parents=True, exist_ok=True)
        index_dir.mkdir(parents=True, exist_ok=True)
        (corpus_dir / "filing-corpus.json").write_text(json.dumps({"documents": documents}, indent=2, sort_keys=True), encoding="utf-8")
        self._write_jsonl(corpus_dir / "chunks.jsonl", chunks)
        self._write_jsonl(corpus_dir / "sections.jsonl", sections)
        embeddings_path = index_dir / "embeddings.f16.npy"
        if embeddings is not None:
            np.save(embeddings_path, embeddings.astype(np.float16))
        elif embeddings_path.exists():
            embeddings_path.unlink()
        embedding_meta = {
            "status": "ready" if embeddings is not None else "missing",
            "embeddingModel": self._settings.llm_embed_model,
            "dimensions": int(embeddings.shape[1]) if embeddings is not None and embeddings.ndim == 2 else 0,
            "chunksEmbedded": int(embeddings.shape[0]) if embeddings is not None and embeddings.ndim == 2 else 0,
            "dtype": "float16" if embeddings is not None else None,
        }
        (index_dir / "embeddings.meta.json").write_text(
            json.dumps(
                embedding_meta,
                indent=2,
                sort_keys=True,
            ),
            encoding="utf-8",
        )
        self._write_retrieval_sqlite(index_dir / "retrieval.sqlite3", chunks)

    def _build_embeddings(self, chunks: list[dict[str, Any]]) -> tuple[np.ndarray | None, list[str]]:
        if not chunks:
            return None, []
        try:
            if not self._omlx_client.has_model(self._settings.llm_embed_model):
                return None, [f"Embedding model '{self._settings.llm_embed_model}' is not available in oMLX."]
            vectors: list[list[float]] = []
            texts = [str(chunk.get("text") or "") for chunk in chunks]
            for start in range(0, len(texts), EMBEDDING_BATCH_SIZE):
                vectors.extend(
                    self._omlx_client.embed_texts(
                        model=self._settings.llm_embed_model,
                        texts=texts[start : start + EMBEDDING_BATCH_SIZE],
                    )
                )
        except OmlxClientError as exc:
            return None, [str(exc)]
        if not vectors:
            return None, ["Embedding model returned no vectors."]
        dimensions = {len(vector) for vector in vectors}
        if len(dimensions) != 1 or 0 in dimensions:
            return None, ["Embedding model returned inconsistent vector dimensions."]
        matrix = np.asarray(vectors, dtype=np.float32)
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        matrix = np.divide(matrix, np.maximum(norms, 1e-12))
        if not np.all(np.isfinite(matrix)):
            return None, ["Embedding model returned non-finite vector values."]
        return matrix.astype(np.float16), []

    def _write_last_index(self, paths: WorkspacePaths, *, index_state: EdgarIndexState, job: EdgarIntelligenceJob) -> None:
        last_index_path = self._last_index_path(paths)
        last_index_path.parent.mkdir(parents=True, exist_ok=True)
        last_index_path.write_text(
            json.dumps(
                {
                    "lastIndexedAt": index_state.lastIndexedAt.isoformat() if index_state.lastIndexedAt else None,
                    "indexedFilings": index_state.indexedAccessions,
                    "jobId": job.jobId,
                    "indexState": index_state.model_dump(mode="json"),
                    "job": job.model_dump(mode="json"),
                },
                indent=2,
                sort_keys=True,
            ),
            encoding="utf-8",
        )

    def _write_retrieval_sqlite(self, destination: Path, chunks: list[dict[str, Any]]) -> None:
        if destination.exists():
            destination.unlink()
        with sqlite3.connect(destination) as connection:
            connection.execute(
                """
                CREATE TABLE chunks (
                    chunk_id TEXT PRIMARY KEY,
                    accession_number TEXT NOT NULL,
                    form TEXT,
                    filing_date TEXT,
                    section TEXT,
                    source_path TEXT,
                    sec_url TEXT,
                    text TEXT NOT NULL
                )
                """
            )
            connection.executemany(
                """
                INSERT INTO chunks (
                    chunk_id, accession_number, form, filing_date, section, source_path, sec_url, text
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        str(chunk.get("chunkId") or ""),
                        str(chunk.get("accessionNumber") or ""),
                        str(chunk.get("form") or ""),
                        str(chunk.get("filingDate") or ""),
                        str(chunk.get("section") or ""),
                        str(chunk.get("sourcePath") or ""),
                        str(chunk.get("secUrl") or ""),
                        str(chunk.get("text") or ""),
                    )
                    for chunk in chunks
                ],
            )
            connection.commit()

    def _write_jsonl(self, destination: Path, rows: list[dict[str, Any]]) -> None:
        with destination.open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, sort_keys=True))
                handle.write("\n")

    def _extract_text(self, path: Path) -> str:
        try:
            raw_text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return ""
        if path.suffix.lower() in {".htm", ".html", ".xhtml", ".xml"}:
            soup = BeautifulSoup(raw_text, "html.parser")
            for tag in soup(["script", "style"]):
                tag.decompose()
            raw_text = soup.get_text(" ")
        return re.sub(r"\s+", " ", raw_text).strip()

    def _chunk_text(self, text: str) -> list[dict[str, Any]]:
        words = text.split()
        if not words:
            return []
        target_words = max(200, min(self._settings.llm_chunk_target_tokens, 1600))
        overlap_words = max(0, min(self._settings.llm_chunk_overlap_tokens, target_words // 2))
        chunks: list[dict[str, Any]] = []
        offset = 0
        start_word = 0
        while start_word < len(words):
            end_word = min(start_word + target_words, len(words))
            chunk_words = words[start_word:end_word]
            chunk_text = " ".join(chunk_words)
            start_char = offset
            end_char = start_char + len(chunk_text)
            chunks.append({"text": chunk_text, "startChar": start_char, "endChar": end_char})
            if end_word == len(words):
                break
            start_word = max(end_word - overlap_words, start_word + 1)
            offset = max(0, end_char - len(" ".join(words[start_word:end_word])))
        return chunks

    def _resolve_comparison_targets(self, filings: list[dict[str, Any]], comparison_mode: str) -> list[str]:
        if comparison_mode == "latest-annual-vs-prior-annual":
            forms = {"10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"}
            limit = 2
        elif comparison_mode == "latest-quarter-vs-prior-quarter":
            forms = {"10-Q", "10-Q/A"}
            limit = 2
        else:
            forms = {"8-K", "8-K/A", "6-K", "6-K/A"}
            limit = 8
        matching = [filing for filing in filings if str(filing.get("form") or "").upper() in forms]
        matching.sort(key=lambda filing: (str(filing.get("filingDate") or ""), str(filing.get("accessionNumber") or "")), reverse=True)
        return [str(filing.get("accessionNumber") or "") for filing in matching[:limit] if str(filing.get("accessionNumber") or "")]

    def _comparison_question(self, request: EdgarComparisonRequest, target_accessions: list[str]) -> str:
        target_text = ", ".join(target_accessions) if target_accessions else "the selected comparison filings"
        return f"Compare {target_text} for {request.ticker}. User question: {request.question}"

    def _answer_model_info(self) -> EdgarAnswerModelInfo:
        return EdgarAnswerModelInfo(
            provider=self._settings.llm_provider,
            chatModel=self._settings.llm_chat_model,
            embeddingModel=self._settings.llm_embed_model,
            rerankerModel=self._settings.llm_rerank_model,
        )

    def _last_index_path(self, paths: WorkspacePaths) -> Path:
        return paths.intelligence_dir / "jobs" / "last-index.json"

    def _load_json_document(self, path: Path) -> Any:
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def _parse_datetime(self, value: Any):
        if not isinstance(value, str) or not value.strip():
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None

    def _filing_folder_name(self, filing: dict[str, Any]) -> str:
        filing_date = str(filing.get("filingDate") or "undated")
        form = str(filing.get("form") or "filing").replace("/", "-").replace(" ", "-")
        accession = str(filing.get("accessionNumberNoDashes") or "")
        return f"{filing_date}_{form}_{accession}"
