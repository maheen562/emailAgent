"""Pick the email provider named by EMAIL_PROVIDER."""

from pathlib import Path

from app.config import Settings
from app.providers.base import EmailProvider, ProviderNotConfigured
from app.providers.demo import DemoProvider

__all__ = ["EmailProvider", "ProviderNotConfigured", "get_provider"]


def get_provider(settings: Settings) -> EmailProvider:
    if settings.email_provider == "gmail":
        from app.providers.gmail_api import GmailApiProvider  # Google libs load only when needed

        return GmailApiProvider(
            query=settings.gmail_query,
            token_file=Path(settings.gmail_token_file),
            max_chars=settings.max_email_chars,
        )
    if settings.email_provider == "imap":
        from app.providers.imap import ImapProvider

        return ImapProvider(
            user=settings.gmail_user,
            app_password=settings.gmail_app_password,
            query=settings.gmail_query,
            max_chars=settings.max_email_chars,
        )
    return DemoProvider(max_chars=settings.max_email_chars)
