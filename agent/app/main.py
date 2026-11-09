"""FastAPI entry point for the Python automation layer."""

from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException, Query

from app import __version__
from app.config import Settings, get_settings
from app.llm import LLMError, LLMProvider, LLMRateLimited, LLMUnavailable, get_llm
from app.models import EmailsResponse, SummarizeRequest, SummarizeResponse
from app.providers import EmailProvider, ProviderNotConfigured, get_provider
from app.summarizer import summarize

app = FastAPI(
    title="Job Alert Agent",
    description="Fetches job-alert emails and judges how useful each job is.",
    version=__version__,
)


def provider_dependency(settings: Settings = Depends(get_settings)) -> EmailProvider:
    try:
        return get_provider(settings)
    except ProviderNotConfigured as err:
        raise HTTPException(status_code=503, detail=str(err)) from err


def llm_dependency(settings: Settings = Depends(get_settings)) -> LLMProvider:
    try:
        return get_llm(settings)
    except LLMUnavailable as err:
        raise HTTPException(status_code=503, detail=str(err)) from err


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


@app.get("/emails", response_model=EmailsResponse)
def list_emails(
    since: datetime | None = Query(None, description="Only emails received after this time (ISO 8601)"),
    limit: int = Query(25, ge=1, le=100),
    provider: EmailProvider = Depends(provider_dependency),
) -> EmailsResponse:
    """Fetch job-alert emails from the configured provider, cleaned for the LLM."""
    if since is not None and since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)  # treat naive times as UTC
    try:
        emails = provider.fetch(since=since, limit=limit)
    except ProviderNotConfigured as err:
        # e.g. Gmail sign-in expired: a setup problem, not a server bug.
        raise HTTPException(status_code=503, detail=str(err)) from err
    return EmailsResponse(provider=provider.name, emails=emails)


@app.post("/summarize", response_model=SummarizeResponse)
def summarize_email(
    request: SummarizeRequest, llm: LLMProvider = Depends(llm_dependency)
) -> SummarizeResponse:
    """Extract every job in one email and judge how useful each is for the profile.

    Errors tell the caller what to do: 429 = retry later, 503 = fix the setup,
    502 = the model misbehaved for this email (skip it and record the error).
    """
    try:
        return summarize(request.email, request.profile, llm)
    except LLMRateLimited as err:
        headers = {"Retry-After": str(err.retry_after_seconds)} if err.retry_after_seconds else None
        raise HTTPException(status_code=429, detail=str(err), headers=headers) from err
    except LLMUnavailable as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except LLMError as err:
        raise HTTPException(status_code=502, detail=str(err)) from err
