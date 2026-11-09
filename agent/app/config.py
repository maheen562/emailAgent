"""Settings for the Python agent, loaded from environment variables / agent/.env."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Where emails come from: sample files, the Gmail API, or IMAP (backup).
    email_provider: Literal["demo", "gmail", "imap"] = "demo"
    gmail_query: str = 'label:"Job Alerts" newer_than:3d'
    gmail_credentials_file: str = "credentials.json"
    gmail_token_file: str = "token.json"
    gmail_user: str | None = None          # IMAP only
    gmail_app_password: str | None = None  # IMAP only

    # Which LLM judges the jobs.
    llm_provider: Literal["gemini", "ollama"] = "gemini"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.5-flash"
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:7b"

    # Safety limits.
    max_email_chars: int = 20_000


@lru_cache
def get_settings() -> Settings:
    return Settings()
