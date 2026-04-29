"""Small oMLX HTTP client used by local intelligence services."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import requests

from investing_platform.config import DashboardSettings


class OmlxClientError(RuntimeError):
    """Raised when the local oMLX server cannot satisfy a request."""


@dataclass(slots=True)
class OmlxModel:
    id: str


class OmlxClient:
    """OpenAI-compatible client for the local oMLX server."""

    def __init__(self, settings: DashboardSettings) -> None:
        self._settings = settings
        self._base_url = settings.llm_base_url.rstrip("/")

    @property
    def base_url(self) -> str:
        return self._base_url

    def list_models(self) -> list[OmlxModel]:
        payload = self._request("GET", "/models")
        data = payload.get("data")
        if not isinstance(data, list):
            raise OmlxClientError("oMLX returned an invalid model list.")
        models: list[OmlxModel] = []
        for item in data:
            if isinstance(item, dict) and isinstance(item.get("id"), str):
                models.append(OmlxModel(id=item["id"]))
        return models

    def has_model(self, model_id: str) -> bool:
        return any(model.id == model_id for model in self.list_models())

    def embed_texts(self, *, model: str, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        payload = self._request(
            "POST",
            "/embeddings",
            json={
                "model": model,
                "input": texts,
                "encoding_format": "float",
            },
            timeout=max(self._settings.llm_request_timeout_seconds, 30.0),
        )
        data = payload.get("data")
        if not isinstance(data, list):
            raise OmlxClientError("oMLX returned an invalid embeddings response.")
        ordered = sorted((item for item in data if isinstance(item, dict)), key=lambda item: int(item.get("index") or 0))
        embeddings: list[list[float]] = []
        for item in ordered:
            embedding = item.get("embedding")
            if not isinstance(embedding, list):
                raise OmlxClientError("oMLX returned an embedding without float values.")
            embeddings.append([float(value) for value in embedding])
        if len(embeddings) != len(texts):
            raise OmlxClientError("oMLX returned a different number of embeddings than requested.")
        return embeddings

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        if not self._base_url:
            raise OmlxClientError("No oMLX base URL is configured.")
        headers = {"Authorization": f"Bearer {self._settings.llm_api_key}"} if self._settings.llm_api_key else None
        try:
            response = requests.request(
                method,
                f"{self._base_url}{path}",
                json=json,
                headers=headers,
                timeout=timeout or self._settings.llm_request_timeout_seconds,
            )
        except requests.RequestException as exc:
            raise OmlxClientError(f"oMLX is unreachable at {self._base_url}. {exc}") from exc
        if response.status_code >= 400:
            raise OmlxClientError(f"oMLX returned HTTP {response.status_code} for {path}: {response.text[:300]}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise OmlxClientError(f"oMLX returned non-JSON response for {path}.") from exc
        if not isinstance(payload, dict):
            raise OmlxClientError(f"oMLX returned invalid JSON response for {path}.")
        return payload
