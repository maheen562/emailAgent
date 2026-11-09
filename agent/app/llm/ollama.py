"""Ollama provider: a free, local open-source model. Nothing leaves the laptop."""

from typing import Any

import httpx

from app.llm.base import LLMError, LLMResult, LLMUnavailable


class OllamaProvider:
    name = "ollama"

    def __init__(self, base_url: str, model: str, timeout: float = 300, transport=None):
        self.model = model
        self._http = httpx.Client(base_url=base_url, timeout=timeout, transport=transport)

    def generate_json(self, *, system: str, prompt: str, schema: dict[str, Any]) -> LLMResult:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "format": schema,  # Ollama constrains output to this JSON Schema
            "stream": False,
            "options": {"temperature": 0},
        }
        try:
            res = self._http.post("/api/chat", json=payload)
        except httpx.TransportError as err:
            raise LLMUnavailable(
                f"Can't reach Ollama at {self._http.base_url}. Is it running? (`ollama serve`)"
            ) from err

        if res.status_code == 404:
            raise LLMUnavailable(f"Ollama model '{self.model}' not found. Run `ollama pull {self.model}`.")
        if res.status_code >= 400:
            raise LLMError(f"Ollama error {res.status_code}: {res.text[:200]}")

        body = res.json()
        return LLMResult(
            text=body.get("message", {}).get("content", ""),
            model=self.model,
            input_tokens=body.get("prompt_eval_count"),
            output_tokens=body.get("eval_count"),
        )
