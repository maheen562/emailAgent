"""Test helpers: a fake LLM and builders for valid model output."""

import json
from datetime import datetime, timezone

from app.llm.base import LLMResult
from app.models import Email, Link


def factor(score: int, reason: str = "because") -> dict:
    return {"score": score, "reason": reason}


def make_job(scores: int | dict | None = 8, **overrides) -> dict:
    """A valid ExtractedJob dict. `scores` is one score for all factors, or a dict per factor."""
    names = ("experience", "skills", "work_arrangement", "terms_pay", "career_value", "eligibility")
    if isinstance(scores, dict):
        factor_scores = {n: factor(scores.get(n, 5)) for n in names}
    else:
        factor_scores = {n: factor(scores) for n in names}
    job = {
        "title": "Python Intern",
        "company": "Nimbus Labs",
        "location": "Islamabad",
        "work_mode": "remote",
        "employment_type": "internship",
        "experience_required": "0-1 years",
        "salary": "PKR 60,000/month",
        "hours": "40/week",
        "summary": "Build Python automations.",
        "apply_ref": "L1",
        "deadline": None,
        "factor_scores": factor_scores,
        "skills_matched": ["Python"],
        "skills_missing": [],
        "dealbreakers_hit": [],
        "red_flags": [],
        "why_it_matters": "Strong match.",
    }
    job.update(overrides)
    return job


def extraction_json(*jobs: dict) -> str:
    return json.dumps({"jobs": list(jobs)})


def make_email(**overrides) -> Email:
    data = {
        "message_id": "<m1@example.com>",
        "source": "linkedin",
        "sender": "jobalerts-noreply@linkedin.com",
        "subject": "New jobs",
        "received_at": datetime(2026, 11, 7, tzinfo=timezone.utc),
        "text": "Python Intern [L1]\nNimbus Labs, Remote",
        "links": [Link(ref="L1", url="https://jobs.example.com/1", text="Python Intern")],
    }
    data.update(overrides)
    return Email(**data)


class FakeLLM:
    """Returns queued responses (strings, or exceptions to raise) and records prompts."""

    name = "fake"
    model = "fake-model"

    def __init__(self, *responses):
        self.responses = list(responses)
        self.prompts: list[str] = []
        self.schemas: list[dict] = []

    def generate_json(self, *, system: str, prompt: str, schema: dict) -> LLMResult:
        self.prompts.append(prompt)
        self.schemas.append(schema)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return LLMResult(text=response, model=self.model, input_tokens=100, output_tokens=50)
