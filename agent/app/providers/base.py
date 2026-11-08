"""The interface every email source implements."""

from datetime import datetime
from typing import Protocol

from app.models import Email


class ProviderNotConfigured(RuntimeError):
    """Raised when a provider is selected but its credentials are missing."""


class EmailProvider(Protocol):
    name: str

    def fetch(self, since: datetime | None, limit: int) -> list[Email]:
        """Return up to `limit` job-alert emails received after `since`, newest first."""
        ...


def newest_first(emails: list[Email], since: datetime | None, limit: int) -> list[Email]:
    """Shared filtering: drop emails older than `since`, sort newest first, apply `limit`."""
    if since is not None:
        emails = [e for e in emails if e.received_at > since]
    return sorted(emails, key=lambda e: e.received_at, reverse=True)[:limit]
