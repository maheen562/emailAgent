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
        if isinstance(node, dict):
            if "$ref" in node:
                name = node["$ref"].split("/")[-1]
                merged = {**defs[name], **{k: v for k, v in node.items() if k != "$ref"}}
                return resolve(merged)
            return {k: resolve(v) for k, v in node.items() if k != "title"}
        if isinstance(node, list):
            return [resolve(item) for item in node]
        return node

    return resolve(schema)
