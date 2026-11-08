"""Gmail API provider (default for live use). Read-only access via OAuth."""

import base64
from datetime import datetime
from pathlib import Path

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from app.models import Email
from app.parser import parse_email
from app.providers.base import ProviderNotConfigured, newest_first

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
SIGN_IN_HINT = "Run `python -m app.auth_gmail` in the agent folder to sign in."


def load_credentials(token_file: Path) -> Credentials:
    """Load saved OAuth credentials, refreshing (and re-saving) them if expired."""
    if not token_file.exists():
        raise ProviderNotConfigured(f"No Gmail token found at {token_file}. {SIGN_IN_HINT}")
    creds = Credentials.from_authorized_user_file(str(token_file), SCOPES)
    if creds.valid:
        return creds
    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
        except RefreshError as err:
            # In "Testing" mode Google expires sign-ins after 7 days.
            raise ProviderNotConfigured(f"Gmail sign-in has expired. {SIGN_IN_HINT}") from err
        token_file.write_text(creds.to_json())
        return creds
    raise ProviderNotConfigured(f"Gmail token is invalid. {SIGN_IN_HINT}")


class GmailApiProvider:
    name = "gmail"

    def __init__(self, query: str, token_file: Path, max_chars: int = 20_000, service=None):
        self.query = query
        self.token_file = token_file
        self.max_chars = max_chars
        self._service = service  # injectable for tests

    @property
    def service(self):
        if self._service is None:
            creds = load_credentials(self.token_file)
            self._service = build("gmail", "v1", credentials=creds, cache_discovery=False)
        return self._service

    def _build_query(self, since: datetime | None) -> str:
        if since is None:
            return self.query
        # Gmail's `after:` accepts a Unix timestamp in seconds.
        return f"{self.query} after:{int(since.timestamp())}"

    def _list_ids(self, query: str, limit: int) -> list[str]:
        ids: list[str] = []
        page_token = None
        while len(ids) < limit:
            resp = (
                self.service.users()
                .messages()
                .list(userId="me", q=query, maxResults=min(100, limit - len(ids)), pageToken=page_token)
                .execute()
            )
            ids += [m["id"] for m in resp.get("messages", [])]
            page_token = resp.get("nextPageToken")
            if not page_token:
                break
        return ids[:limit]

    def fetch(self, since: datetime | None, limit: int) -> list[Email]:
        emails = []
        for msg_id in self._list_ids(self._build_query(since), limit):
            msg = self.service.users().messages().get(userId="me", id=msg_id, format="raw").execute()
            raw = base64.urlsafe_b64decode(msg["raw"])
            emails.append(parse_email(raw, max_chars=self.max_chars))
        # `after:` is day-granular on some accounts, so filter precisely here too.
        return newest_first(emails, since, limit)
