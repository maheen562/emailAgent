"""Pick the LLM provider named by LLM_PROVIDER."""

from app.config import Settings
from app.llm.base import LLMError, LLMProvider, LLMRateLimited, LLMResult, LLMUnavailable

__all__ = ["LLMError", "LLMProvider", "LLMRateLimited", "LLMResult", "LLMUnavailable", "get_llm"]


def get_llm(settings: Settings) -> LLMProvider:
    if settings.llm_provider == "ollama":
        from app.llm.ollama import OllamaProvider

        return OllamaProvider(base_url=settings.ollama_url, model=settings.ollama_model)

    from app.llm.gemini import GeminiProvider  # Google libs load only when needed

    return GeminiProvider(api_key=settings.gemini_api_key, model=settings.gemini_model)
