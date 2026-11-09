import json
from types import SimpleNamespace

import httpx
import pytest
from google.genai import errors

from app.config import Settings
from app.llm import get_llm
from app.llm.base import LLMError, LLMRateLimited, LLMUnavailable, inline_schema
from app.llm.gemini import GeminiProvider
from app.llm.ollama import OllamaProvider

SCHEMA = {"type": "object", "properties": {"jobs": {"type": "array"}}}


class FakeGeminiModels:
    def __init__(self, result=None, error=None):
        self.result, self.error, self.calls = result, error, []

    def generate_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        if self.error:
            raise self.error
        return self.result


def gemini_with(result=None, error=None) -> tuple[GeminiProvider, FakeGeminiModels]:
    models = FakeGeminiModels(result, error)
    return GeminiProvider(api_key=None, model="gemini-test", client=SimpleNamespace(models=models)), models


def api_error(code: int) -> errors.APIError:
    cls = errors.ClientError if code < 500 else errors.ServerError
    return cls(code, {"error": {"code": code, "message": "nope", "status": "X"}})


class TestGemini:
    def test_sends_schema_and_returns_text_and_usage(self):
        response = SimpleNamespace(
            text='{"jobs": []}',
            usage_metadata=SimpleNamespace(prompt_token_count=120, candidates_token_count=30),
        )
        provider, models = gemini_with(result=response)
        result = provider.generate_json(system="sys", prompt="hi", schema=SCHEMA)

        assert result.text == '{"jobs": []}'
        assert (result.input_tokens, result.output_tokens) == (120, 30)
        config = models.calls[0]["config"]
        assert config.response_mime_type == "application/json"
        assert config.response_json_schema == SCHEMA
        assert config.system_instruction == "sys"
        assert config.temperature == 0

    def test_missing_key_is_unavailable(self):
        with pytest.raises(LLMUnavailable, match="aistudio.google.com"):
            GeminiProvider(api_key=None, model="m")

    @pytest.mark.parametrize(
        ("code", "expected"), [(429, LLMRateLimited), (403, LLMUnavailable), (500, LLMError)]
    )
    def test_maps_api_errors(self, code, expected):
        provider, _ = gemini_with(error=api_error(code))
        with pytest.raises(expected):
            provider.generate_json(system="s", prompt="p", schema=SCHEMA)

    def test_empty_response_is_an_error(self):
        provider, _ = gemini_with(result=SimpleNamespace(text=None, usage_metadata=None))
        with pytest.raises(LLMError, match="empty"):
            provider.generate_json(system="s", prompt="p", schema=SCHEMA)


def ollama_with(handler) -> OllamaProvider:
    return OllamaProvider("http://ollama", "qwen-test", transport=httpx.MockTransport(handler))


class TestOllama:
    def test_sends_schema_as_format_and_reads_message(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen.update(json.loads(request.content))
            return httpx.Response(
                200, json={"message": {"content": '{"jobs": []}'}, "prompt_eval_count": 90, "eval_count": 10}
            )

        result = ollama_with(handler).generate_json(system="sys", prompt="hi", schema=SCHEMA)
        assert result.text == '{"jobs": []}'
        assert (result.input_tokens, result.output_tokens) == (90, 10)
        assert seen["format"] == SCHEMA
        assert seen["stream"] is False
        assert seen["messages"][0] == {"role": "system", "content": "sys"}

    def test_not_running_is_unavailable(self):
        def handler(request):
            raise httpx.ConnectError("refused")

        with pytest.raises(LLMUnavailable, match="ollama serve"):
            ollama_with(handler).generate_json(system="s", prompt="p", schema=SCHEMA)

    def test_missing_model_says_how_to_pull(self):
        provider = ollama_with(lambda r: httpx.Response(404, json={"error": "model not found"}))
        with pytest.raises(LLMUnavailable, match="ollama pull qwen-test"):
            provider.generate_json(system="s", prompt="p", schema=SCHEMA)


class TestInlineSchema:
    def test_resolves_refs_and_drops_titles(self):
        schema = {
            "title": "Root",
            "type": "object",
            "properties": {"a": {"$ref": "#/$defs/A"}, "b": {"type": "array", "items": {"$ref": "#/$defs/A"}}},
            "$defs": {"A": {"title": "A", "type": "object", "properties": {"x": {"type": "integer"}}}},
        }
        flat = inline_schema(schema)
        assert flat["properties"]["a"] == {"type": "object", "properties": {"x": {"type": "integer"}}}
        assert flat["properties"]["b"]["items"] == flat["properties"]["a"]
        assert "$defs" not in flat and "title" not in flat


class TestGetLlm:
    def test_ollama(self):
        assert get_llm(Settings(_env_file=None, llm_provider="ollama")).name == "ollama"

    def test_gemini_needs_key(self):
        with pytest.raises(LLMUnavailable):
            get_llm(Settings(_env_file=None, llm_provider="gemini"))
        assert get_llm(Settings(_env_file=None, gemini_api_key="k")).name == "gemini"
