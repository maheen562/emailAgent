"""Google Gemini provider (default). Works on the free tier from aistudio.google.com."""

from typing import Any

from google import genai
from google.genai import errors, types

from app.llm.base import LLMError, LLMOverloaded, LLMRateLimited, LLMResult, LLMUnavailable

# Temporary server-side problems ("model is experiencing high demand") are retried
# with exponential backoff inside the SDK. 429 is not: on the free tier it usually
# means a quota is used up, so we stop and let the next scheduled run try again.
TRANSIENT_STATUS_CODES = [500, 502, 503, 504]


def default_http_options(timeout_seconds: float = 120) -> types.HttpOptions:
    return types.HttpOptions(
        timeout=int(timeout_seconds * 1000),  # the SDK expects milliseconds
        retry_options=types.HttpRetryOptions(
            attempts=3, initial_delay=2, max_delay=20, http_status_codes=TRANSIENT_STATUS_CODES
        ),
    )


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: str | None, model: str, client: Any = None, timeout_seconds: float = 120):
        if client is None and not api_key:
            raise LLMUnavailable(
                "GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com "
                "and add it to agent/.env."
            )
        self.model = model
        self._client = client or genai.Client(
            api_key=api_key, http_options=default_http_options(timeout_seconds)
        )

    def generate_json(self, *, system: str, prompt: str, schema: dict[str, Any]) -> LLMResult:
        config = types.GenerateContentConfig(
            system_instruction=system,
            response_mime_type="application/json",
            response_json_schema=schema,
            temperature=0,  # same email in, same judgement out
        )
        try:
            response = self._client.models.generate_content(
                model=self.model, contents=prompt, config=config
            )
        except errors.APIError as err:
            if err.code == 429:
                raise LLMRateLimited(
                    "Gemini rate limit reached (free tier). Will retry on the next run.",
                    retry_after_seconds=60,
                ) from err
            if err.code in TRANSIENT_STATUS_CODES:
                raise LLMOverloaded(
                    f"Gemini is temporarily unavailable ({err.code}) after 3 attempts. "
                    "Will retry on the next run.",
                    retry_after_seconds=300,
                ) from err
            if err.code in (401, 403):
                raise LLMUnavailable(f"Gemini rejected the API key: {err.message}") from err
            if err.code == 404:
                raise LLMUnavailable(
                    f"Gemini model '{self.model}' not found. Check GEMINI_MODEL in agent/.env."
                ) from err
            raise LLMError(f"Gemini error {err.code}: {err.message}") from err

        text = response.text
        if not text:
            raise LLMError("Gemini returned an empty response (possibly blocked by a safety filter).")
        usage = response.usage_metadata
        return LLMResult(
            text=text,
            model=self.model,
            input_tokens=getattr(usage, "prompt_token_count", None),
            output_tokens=getattr(usage, "candidates_token_count", None),
        )
