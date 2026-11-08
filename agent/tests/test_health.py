def test_health_reports_providers(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["email_provider"] == "demo"
    assert body["llm_provider"] == "gemini"


def test_health_flags_missing_gemini_key(client, settings):
    settings.gemini_api_key = None
    assert client.get("/health").json()["llm_configured"] is False


def test_health_ok_when_gemini_key_set(client, settings):
    settings.gemini_api_key = "test-key"
    assert client.get("/health").json()["llm_configured"] is True
