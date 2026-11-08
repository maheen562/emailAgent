"""IMAP provider (backup). Uses a Gmail App Password.

Gmail's IMAP supports the X-GM-RAW extension, so the same Gmail search query
(e.g. `label:"Job Alerts" newer_than:3d`) works here as with the Gmail API.
"""

import imaplib
from datetime import datetime

from app.models import Email
from app.parser import parse_email
from app.providers.base import ProviderNotConfigured, newest_first

IMAP_HOST = "imap.gmail.com"


def _imap_quote(value: str) -> str:
    """Wrap a value in an IMAP quoted string, escaping backslashes and quotes."""
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


class ImapProvider:
    name = "imap"

    def __init__(self, user: str | None, app_password: str | None, query: str, max_chars: int = 20_000):
        if not user or not app_password:
            raise ProviderNotConfigured(
                "IMAP needs GMAIL_USER and GMAIL_APP_PASSWORD in agent/.env."
            )
        self.user = user
        self.app_password = app_password
        self.query = query
        self.max_chars = max_chars

    def fetch(self, since: datetime | None, limit: int) -> list[Email]:
        query = self.query
        if since is not None:
            query += f" after:{int(since.timestamp())}"

        with imaplib.IMAP4_SSL(IMAP_HOST) as conn:
            try:
                conn.login(self.user, self.app_password)
            except imaplib.IMAP4.error as err:
                raise ProviderNotConfigured(f"IMAP login failed: {err}") from err
            conn.select('"[Gmail]/All Mail"', readonly=True)  # read-only: never marks as read
            status, data = conn.search(None, "X-GM-RAW", _imap_quote(query))
            if status != "OK":
                return []
            ids = data[0].split()[-limit:]  # IMAP returns oldest first
            emails = []
            for msg_id in ids:
                status, parts = conn.fetch(msg_id, "(BODY.PEEK[])")
                if status == "OK" and parts and isinstance(parts[0], tuple):
                    emails.append(parse_email(parts[0][1], max_chars=self.max_chars))

        return newest_first(emails, since, limit)
