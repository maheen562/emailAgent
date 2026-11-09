"""The interface every LLM provider implements, plus shared errors."""

import copy
from dataclasses import dataclass
from typing import Any, Protocol


class LLMError(RuntimeError):
    """The LLM call failed or returned something unusable."""


class LLMRateLimited(LLMError):
    """The provider's (free-tier) rate limit was hit. Safe to retry later."""

    def __init__(self, message: str, retry_after_seconds: int | None = None):
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


class LLMOverloaded(LLMRateLimited):
    """The provider is temporarily overloaded (e.g. Gemini 503). Also safe to retry later."""


class LLMUnavailable(LLMError):
    """The provider can't be reached or isn't configured (no key, Ollama not running)."""


@dataclass
class LLMResult:
    text: str  # the raw JSON text returned by the model
    model: str
    input_tokens: int | None = None
    output_tokens: int | None = None


class LLMProvider(Protocol):
    name: str
    model: str

    def generate_json(self, *, system: str, prompt: str, schema: dict[str, Any]) -> LLMResult:
        """Ask the model for JSON that matches `schema`."""
        ...


def inline_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Resolve $ref/$defs and drop `title`s so every provider gets a flat JSON Schema.

    Pydantic emits $defs/$ref for nested models; not every structured-output
    backend handles references, but all of them handle a plain inlined schema.
    """
    schema = copy.deepcopy(schema)
    defs = schema.pop("$defs", {})

    def resolve(node: Any) -> Any:
        if isinstance(node, list):
            return [resolve(item) for item in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node:
            name = node["$ref"].split("/")[-1]
            merged = {**defs[name], **{k: v for k, v in node.items() if k != "$ref"}}
            return resolve(merged)
        out = {}
        for key, value in node.items():
            if key == "title":
                continue  # a schema annotation, not data
            if key == "properties":
                # Keys here are field names: a field may itself be called "title".
                out[key] = {name: resolve(sub) for name, sub in value.items()}
            else:
                out[key] = resolve(value)
        return out

    return resolve(schema)
