"""Small oMLX HTTP client used by local intelligence services."""

from __future__ import annotations

from dataclasses import dataclass
import json as json_module
import math
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
            vector: list[float] = []
            for value in embedding:
                if isinstance(value, bool) or not isinstance(value, int | float):
                    raise OmlxClientError("oMLX returned an embedding with non-numeric values.")
                numeric_value = float(value)
                if not math.isfinite(numeric_value):
                    raise OmlxClientError("oMLX returned an embedding with non-finite values.")
                vector.append(numeric_value)
            embeddings.append(vector)
        if len(embeddings) != len(texts):
            raise OmlxClientError("oMLX returned a different number of embeddings than requested.")
        return embeddings

    def chat_json(self, *, model: str, messages: list[dict[str, str]], max_tokens: int) -> dict[str, Any]:
        payload = self._request(
            "POST",
            "/chat/completions",
            json={
                "model": model,
                "messages": messages,
                "temperature": 0,
                "max_tokens": max_tokens,
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "edgar_answer",
                        "strict": True,
                        "schema": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["answer", "confidence", "citations", "limitations"],
                            "properties": {
                                "answer": {"type": "string"},
                                "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
                                "citations": {
                                    "type": "array",
                                    "items": {"type": "string", "pattern": "^C[0-9]+$"},
                                },
                                "limitations": {"type": "array", "items": {"type": "string"}},
                            },
                        },
                    },
                },
                "chat_template_kwargs": {
                    "enable_thinking": False,
                    "preserve_thinking": False,
                },
                "thinking_budget": 0,
            },
            timeout=max(self._settings.llm_request_timeout_seconds, 120.0),
        )
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices:
            raise OmlxClientError("oMLX returned no chat completion choices.")
        first_choice = choices[0]
        if not isinstance(first_choice, dict):
            raise OmlxClientError("oMLX returned an invalid chat completion choice.")
        message = first_choice.get("message")
        if not isinstance(message, dict):
            raise OmlxClientError("oMLX returned a chat completion without a message.")
        content = message.get("content")
        if isinstance(content, list):
            content = "".join(str(part.get("text") or "") if isinstance(part, dict) else str(part) for part in content)
        if not isinstance(content, str) or not content.strip():
            raise OmlxClientError("oMLX returned an empty chat completion.")
        return self._decode_json_object(content)

    def _decode_json_object(self, content: str) -> dict[str, Any]:
        try:
            decoded = json_module.loads(content)
        except ValueError:
            decoded = self._extract_json_object(content)
        if not isinstance(decoded, dict):
            raise OmlxClientError("oMLX returned JSON answer content that was not an object.")
        return decoded

    def _extract_json_object(self, content: str) -> dict[str, Any]:
        decoder = json_module.JSONDecoder()
        for index, char in enumerate(content):
            if char != "{":
                continue
            try:
                decoded, _end = decoder.raw_decode(content[index:])
            except ValueError:
                continue
            if isinstance(decoded, dict):
                return decoded
        snippet = content.strip().replace("\n", " ")[:300]
        raise OmlxClientError(f"oMLX returned non-JSON answer content: {snippet}")

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
