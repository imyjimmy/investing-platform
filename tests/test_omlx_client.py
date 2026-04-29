from __future__ import annotations

import math

import pytest

from investing_platform.config import DashboardSettings
from investing_platform.services.omlx_client import OmlxClient, OmlxClientError


def test_embed_texts_rejects_non_numeric_vector_values() -> None:
    client = OmlxClient(DashboardSettings())
    client._request = lambda *args, **kwargs: {  # type: ignore[method-assign]
        "data": [{"index": 0, "embedding": [0.1, None, 0.3]}],
    }

    with pytest.raises(OmlxClientError, match="non-numeric"):
        client.embed_texts(model="nomicai-modernbert-embed-base-4bit", texts=["hello"])


def test_embed_texts_rejects_non_finite_vector_values() -> None:
    client = OmlxClient(DashboardSettings())
    client._request = lambda *args, **kwargs: {  # type: ignore[method-assign]
        "data": [{"index": 0, "embedding": [0.1, math.nan, 0.3]}],
    }

    with pytest.raises(OmlxClientError, match="non-finite"):
        client.embed_texts(model="nomicai-modernbert-embed-base-4bit", texts=["hello"])


def test_chat_json_extracts_json_object_from_wrapped_content() -> None:
    client = OmlxClient(DashboardSettings())
    client._request = lambda *args, **kwargs: {  # type: ignore[method-assign]
        "choices": [
            {
                "message": {
                    "content": "Here is the answer:\\n```json\\n{\"answer\":\"Revenue decreased [C1]\",\"citations\":[\"C1\"]}\\n```",
                }
            }
        ],
    }

    payload = client.chat_json(model="Qwen3.6-35B-A3B-4bit", messages=[], max_tokens=128)

    assert payload["answer"] == "Revenue decreased [C1]"


def test_chat_json_disables_thinking_for_structured_answers() -> None:
    client = OmlxClient(DashboardSettings())
    captured: dict = {}

    def fake_request(*args, **kwargs):
        captured.update(kwargs["json"])
        return {
            "choices": [
                {
                    "message": {
                        "content": "{\"answer\":\"Revenue decreased [C1]\",\"citations\":[\"C1\"]}",
                    }
                }
            ],
        }

    client._request = fake_request  # type: ignore[method-assign]

    client.chat_json(model="Qwen3.6-35B-A3B-4bit", messages=[], max_tokens=128)

    assert captured["chat_template_kwargs"]["enable_thinking"] is False
    assert captured["chat_template_kwargs"]["preserve_thinking"] is False
    assert captured["thinking_budget"] == 0
    assert captured["response_format"]["type"] == "json_schema"
    assert captured["response_format"]["json_schema"]["schema"]["properties"]["confidence"]["enum"] == ["low", "medium", "high"]
