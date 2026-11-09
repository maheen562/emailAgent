import json
from datetime import date

import pytest

from app.llm.base import LLMError, LLMRateLimited
from app.models import Profile
from app.summarizer import SCHEMA, summarize
from tests.fakes import FakeLLM, extraction_json, make_email, make_job


def test_scores_sorts_and_summarises():
    llm = FakeLLM(extraction_json(make_job(3, title="Senior Dev", apply_ref=None), make_job(10)))
    result = summarize(make_email(), Profile(), llm)

    assert result.job_count == 2
    assert [j.title for j in result.jobs] == ["Python Intern", "Senior Dev"]  # best first
    assert result.counts.apply_now == 1 and result.counts.skip == 1
    assert result.jobs[0].apply_url == "https://jobs.example.com/1"
    assert result.jobs[1].apply_url is None
    assert result.one_line_summary.startswith("2 jobs: 1 Apply now")
    assert result.usage.model == "fake-model"


def test_prompt_contains_profile_email_and_date():
    llm = FakeLLM(extraction_json())
    profile = Profile(dealbreakers=["unpaid"], locations=["Islamabad"])
    summarize(make_email(text="Unique posting text"), profile, llm, today=date(2026, 11, 9))

    prompt = llm.prompts[0]
    assert "2026-11-09" in prompt
    assert "Unique posting text" in prompt
    assert '"unpaid"' in prompt and "Islamabad" in prompt
    assert llm.schemas[0] is SCHEMA


def test_retries_once_on_invalid_json_and_adds_up_tokens():
    llm = FakeLLM('{"jobs": [{"title": "missing fields"}]}', extraction_json(make_job()))
    result = summarize(make_email(), Profile(), llm)

    assert result.job_count == 1
    assert len(llm.prompts) == 2
    assert "not valid" in llm.prompts[1]
    assert result.usage.input_tokens == 200 and result.usage.output_tokens == 100


def test_retries_on_non_json_text():
    llm = FakeLLM("Sure! Here are the jobs:", extraction_json(make_job()))
    assert summarize(make_email(), Profile(), llm).job_count == 1


def test_gives_up_after_two_invalid_answers():
    llm = FakeLLM("not json", "still not json")
    with pytest.raises(LLMError, match="invalid JSON twice"):
        summarize(make_email(), Profile(), llm)


def test_rate_limit_is_not_retried():
    llm = FakeLLM(LLMRateLimited("slow down"))
    with pytest.raises(LLMRateLimited):
        summarize(make_email(), Profile(), llm)
    assert len(llm.prompts) == 1


def test_email_with_no_jobs():
    result = summarize(make_email(), Profile(), FakeLLM(extraction_json()))
    assert result.job_count == 0
    assert result.one_line_summary == "No job postings found in this email."


def _objects(node):
    if isinstance(node, dict):
        if node.get("type") == "object":
            yield node
        for value in node.values():
            yield from _objects(value)
    elif isinstance(node, list):
        for item in node:
            yield from _objects(item)


def test_every_required_field_is_defined():
    # Gemini rejects a schema whose `required` names a property it doesn't define.
    for obj in _objects(SCHEMA):
        missing = set(obj.get("required", [])) - set(obj.get("properties", {}))
        assert not missing, f"required but undefined: {missing}"


def test_schema_is_flat_json_schema():
    text = json.dumps(SCHEMA)
    assert "$ref" not in text and "$defs" not in text
    job_schema = SCHEMA["properties"]["jobs"]["items"]
    # Python decides these; the model must not be asked for them.
    for field in ("overall_score", "verdict", "apply_url"):
        assert field not in job_schema["properties"]
