def test_lists_demo_emails(client):
    res = client.get("/emails")
    assert res.status_code == 200
    body = res.json()
    assert body["provider"] == "demo"
    assert len(body["emails"]) >= 4
    first = body["emails"][0]
    assert {"message_id", "source", "subject", "received_at", "text", "links"} <= first.keys()


def test_since_accepts_naive_and_aware_times(client):
    naive = client.get("/emails", params={"since": "2026-11-06T12:00:00"})
    aware = client.get("/emails", params={"since": "2026-11-06T12:00:00+00:00"})
    assert naive.status_code == aware.status_code == 200
    assert naive.json() == aware.json()
    assert 0 < len(aware.json()["emails"]) < 4


def test_limit_is_validated(client):
    assert client.get("/emails", params={"limit": 0}).status_code == 422
    assert len(client.get("/emails", params={"limit": 1}).json()["emails"]) == 1


def test_unconfigured_provider_returns_503_with_reason(client, settings):
    settings.email_provider = "imap"  # no GMAIL_USER / GMAIL_APP_PASSWORD
    res = client.get("/emails")
    assert res.status_code == 503
    assert "GMAIL_APP_PASSWORD" in res.json()["detail"]


def test_expired_gmail_sign_in_returns_503(client, settings, tmp_path):
    settings.email_provider = "gmail"
    settings.gmail_token_file = str(tmp_path / "missing-token.json")
    res = client.get("/emails")
    assert res.status_code == 503
    assert "app.auth_gmail" in res.json()["detail"]
