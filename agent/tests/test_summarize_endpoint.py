import pytest

from app.llm.base import LLMError, LLMRateLimited, LLMUnavailable
from app.main import app, llm_dependency
from tests.fakes import FakeLLM, extraction_json, make_email, make_job


@pytest.fixture
def use_llm():
    def install(llm):
        app.dependency_overrides[llm_dependency] = lambda: llm

    yield install
    app.dependency_overrides.pop(llm_dependency, None)


def body(**profile) -> dict:
    return {"email": make_email().model_dump(mode="json"), "profile": profile}


def test_returns_scored_jobs(client, use_llm):
    use_llm(FakeLLM(extraction_json(make_job(10))))
    res = client.post("/summarize", json=body())
    assert res.status_code == 200
    data = res.json()
    assert data["message_id"] == "<m1@example.com>"
    assert data["jobs"][0]["verdict"] == "apply_now"
    assert data["jobs"][0]["apply_url"] == "https://jobs.example.com/1"


def test_uses_the_profile_sent_in_the_request(client, use_llm):
    use_llm(FakeLLM(extraction_json(make_job(10, dealbreakers_hit=["unpaid"]))))
    res = client.post("/summarize", json=body(dealbreakers=["unpaid"]))
    assert res.json()["jobs"][0]["verdict"] == "skip"


def test_rejects_invalid_profile(client, use_llm):
    use_llm(FakeLLM())
    assert client.post("/summarize", json=body(remote_preference="moon")).status_code == 422


@pytest.mark.parametrize(
    ("error", "status"),
    [(LLMRateLimited("slow", retry_after_seconds=60), 429), (LLMUnavailable("down"), 503), (LLMError("bad"), 502)],
)
def test_maps_llm_errors_to_status_codes(client, use_llm, error, status):
    use_llm(FakeLLM(error))
    res = client.post("/summarize", json=body())
    assert res.status_code == status
    if status == 429:
        assert res.headers["retry-after"] == "60"


def test_missing_gemini_key_is_503(client):
    res = client.post("/summarize", json=body())  # real dependency; test settings have no key
    assert res.status_code == 503
    assert "GEMINI_API_KEY" in res.json()["detail"]


def test_validate_profile_fills_defaults(client):
    res = client.post("/profile/validate", json={"locations": ["Islamabad"]})
    assert res.status_code == 200
    assert res.json()["locations"] == ["Islamabad"]
    assert res.json()["weights"]["experience"] == 25


def test_validate_profile_rejects_bad_values(client):
    res = client.post("/profile/validate", json={"weights": {"skills": -5}})
    assert res.status_code == 422
