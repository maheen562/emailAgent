"""FastAPI entry point for the Python automation layer."""

from fastapi import Depends, FastAPI

from app import __version__
from app.config import Settings, get_settings

app = FastAPI(
    title="Job Alert Agent",
    description="Fetches job-alert emails and judges how useful each job is.",
    version=__version__,
)


@app.get("/health")
def health(settings: Settings = Depends(get_settings)) -> dict:
    """Liveness check. Also reports which email and LLM providers are active."""
    llm_ready = settings.llm_provider == "ollama" or bool(settings.gemini_api_key)
    return {
        "status": "ok",
        "version": __version__,
        "email_provider": settings.email_provider,
        "llm_provider": settings.llm_provider,
        "llm_configured": llm_ready,
    }
