import base64
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.config import Settings
from app.providers import ProviderNotConfigured, get_provider
from app.providers.demo import DemoProvider
from app.providers.gmail_api import GmailApiProvider, load_credentials
from app.providers.imap import ImapProvider, _imap_quote

SAMPLES = Path(__file__).resolve().parents[1] / "samples"


class TestDemoProvider:
    def test_reads_all_samples_newest_first(self):
        emails = DemoProvider().fetch(since=None, limit=10)
        assert len(emails) == len(list(SAMPLES.glob("*.eml")))
        dates = [e.received_at for e in emails]
        assert dates == sorted(dates, reverse=True)

    def test_since_filters_older_emails(self):
        since = datetime(2026, 11, 6, 12, 0, tzinfo=timezone.utc)
        emails = DemoProvider().fetch(since=since, limit=10)
        assert emails and all(e.received_at > since for e in emails)

    def test_limit(self):
        assert len(DemoProvider().fetch(since=None, limit=2)) == 2

    def test_samples_cover_several_sources(self):
        sources = {e.source for e in DemoProvider().fetch(since=None, limit=10)}
        assert {"linkedin", "indeed", "rozee", "other"} <= sources


class FakeGmailService:
    """Mimics the chained googleapiclient calls: service.users().messages().list(...).execute()."""

    def __init__(self, raw_by_id: dict[str, bytes], page_size: int = 2):
        self.raw_by_id = raw_by_id
        self.page_size = page_size
        self.queries: list[str] = []

    def users(self):
        return self

    def messages(self):
        return self

    def list(self, userId, q, maxResults, pageToken=None):
        self.queries.append(q)
        ids = list(self.raw_by_id)
        start = int(pageToken or 0)
        page = ids[start : start + min(self.page_size, maxResults)]
        resp = {"messages": [{"id": i} for i in page]}
        if start + len(page) < len(ids):
            resp["nextPageToken"] = str(start + len(page))
        return _Exec(resp)

    def get(self, userId, id, format):
        assert format == "raw"
        return _Exec({"raw": base64.urlsafe_b64encode(self.raw_by_id[id]).decode()})


class _Exec:
    def __init__(self, value):
        self.value = value

    def execute(self):
        return self.value


class TestGmailApiProvider:
    @pytest.fixture
    def service(self):
        raws = {p.stem: p.read_bytes() for p in sorted(SAMPLES.glob("*.eml"))}
        return FakeGmailService(raws)

    def test_fetches_and_parses_across_pages(self, service):
        provider = GmailApiProvider(query="label:jobs", token_file=Path("unused"), service=service)
        emails = provider.fetch(since=None, limit=10)
        assert len(emails) == len(service.raw_by_id)
        assert len(service.queries) > 1  # paginated

    def test_adds_after_filter_for_since(self, service):
        provider = GmailApiProvider(query="label:jobs", token_file=Path("unused"), service=service)
        since = datetime(2026, 11, 6, tzinfo=timezone.utc)
        provider.fetch(since=since, limit=10)
        assert service.queries[0] == f"label:jobs after:{int(since.timestamp())}"

    def test_respects_limit(self, service):
        provider = GmailApiProvider(query="q", token_file=Path("unused"), service=service)
        assert len(provider.fetch(since=None, limit=1)) == 1

    def test_missing_token_explains_how_to_sign_in(self, tmp_path):
        with pytest.raises(ProviderNotConfigured, match="app.auth_gmail"):
            load_credentials(tmp_path / "token.json")


class TestImapProvider:
    def test_requires_credentials(self):
        with pytest.raises(ProviderNotConfigured, match="GMAIL_APP_PASSWORD"):
            ImapProvider(user=None, app_password=None, query="q")

    def test_quotes_gmail_query(self):
        assert _imap_quote('label:"Job Alerts"') == '"label:\\"Job Alerts\\""'


class TestGetProvider:
    def test_default_is_demo(self):
        assert get_provider(Settings(_env_file=None)).name == "demo"

    def test_selects_gmail(self):
        assert get_provider(Settings(_env_file=None, email_provider="gmail")).name == "gmail"

    def test_imap_without_credentials_raises(self):
        with pytest.raises(ProviderNotConfigured):
            get_provider(Settings(_env_file=None, email_provider="imap"))
