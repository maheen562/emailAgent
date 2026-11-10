"""Data shapes shared across the agent (and sent to the Node platform as JSON)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

Source = Literal["linkedin", "indeed", "rozee", "glassdoor", "other"]
WorkMode = Literal["remote", "hybrid", "onsite", "unknown"]
EmploymentType = Literal["internship", "full_time", "part_time", "contract", "unknown"]
Verdict = Literal["apply_now", "worth_a_look", "skip"]
FACTORS = ("experience", "skills", "work_arrangement", "terms_pay", "career_value", "eligibility")


class Link(BaseModel):
    """A link found in an email, replaced in the text by a short ref like [L3]."""

    ref: str
    url: str
    text: str


class Email(BaseModel):
    """A job-alert email, cleaned and ready to send to the LLM."""

    message_id: str
    source: Source
    sender: str
    subject: str
    received_at: datetime
    text: str
    links: list[Link]
    truncated: bool = False


class EmailsResponse(BaseModel):
    provider: str
    emails: list[Email]


# ---------------------------------------------------------------------------
# Profile: who I am and what I want. Used to judge every job.
# ---------------------------------------------------------------------------


class Skills(BaseModel):
    strong: list[str] = []
    familiar: list[str] = []
    learning: list[str] = []


class MinPay(BaseModel):
    amount: float = 0
    currency: str = "PKR"
    period: Literal["hour", "month", "year"] = "month"


class Weights(BaseModel):
    """How much each factor counts towards the overall score (any scale; normalised)."""

    experience: float = Field(25, ge=0)
    skills: float = Field(25, ge=0)
    work_arrangement: float = Field(15, ge=0)
    terms_pay: float = Field(15, ge=0)
    career_value: float = Field(10, ge=0)
    eligibility: float = Field(10, ge=0)


class Thresholds(BaseModel):
    apply_now: int = Field(75, ge=0, le=100)
    worth_a_look: int = Field(50, ge=0, le=100)


class Profile(BaseModel):
    experience_level: Literal["student", "fresh_grad", "junior", "mid", "senior"] = "student"
    years_experience: float = 0
    education: str = ""
    skills: Skills = Skills()
    target_roles: list[str] = []
    locations: list[str] = []
    remote_preference: Literal["remote_only", "remote_or_hybrid", "any"] = "any"
    min_pay: MinPay = MinPay()
    available_hours_per_week: int = 40
    interests: list[str] = []
    dealbreakers: list[str] = []
    weights: Weights = Weights()
    thresholds: Thresholds = Thresholds()


# ---------------------------------------------------------------------------
# What the LLM fills in. Kept free of anything Python should decide (scores,
# verdicts, URLs) so the model can't get those wrong.
# ---------------------------------------------------------------------------


class FactorScore(BaseModel):
    score: int = Field(description="0 (terrible fit) to 10 (perfect fit)")
    reason: str = Field(description="Under 15 words, citing the posting and the profile")

    @field_validator("score", mode="before")
    @classmethod
    def clamp(cls, value):
        # Small models occasionally answer 11 or -1; clamp rather than fail.
        return max(0, min(10, int(round(float(value)))))


class FactorScores(BaseModel):
    experience: FactorScore
    skills: FactorScore
    work_arrangement: FactorScore
    terms_pay: FactorScore
    career_value: FactorScore
    eligibility: FactorScore


class ExtractedJob(BaseModel):
    title: str
    company: str | None
    location: str | None
    country: str | None = Field(
        description=(
            "Full English country name where the job is based (e.g. Pakistan, Australia). "
            "For remote jobs, the country you must live in, or 'Worldwide' if any country is "
            "accepted. Null if it can't be told from the email."
        )
    )
    work_mode: WorkMode
    employment_type: EmploymentType
    experience_required: str | None
    salary: str | None
    hours: str | None
    summary: str = Field(description="At most two sentences: what the job actually is")
    apply_ref: str | None = Field(description="The [Ln] link ref for this job, e.g. L3, or null")
    deadline: str | None = Field(description="Application deadline as YYYY-MM-DD, or null")
    factor_scores: FactorScores
    skills_matched: list[str]
    skills_missing: list[str]
    dealbreakers_hit: list[str] = Field(description="Copied exactly from the profile's dealbreakers")
    red_flags: list[str]
    why_it_matters: str = Field(description="One sentence: why this is or isn't worth my time")


class ExtractionResult(BaseModel):
    jobs: list[ExtractedJob]


# ---------------------------------------------------------------------------
# Final output, after Python has scored each job.
# ---------------------------------------------------------------------------


class Job(ExtractedJob):
    apply_url: str | None
    overall_score: int
    verdict: Verdict


class VerdictCounts(BaseModel):
    apply_now: int = 0
    worth_a_look: int = 0
    skip: int = 0


class Usage(BaseModel):
    model: str
    input_tokens: int | None = None
    output_tokens: int | None = None


class SummarizeRequest(BaseModel):
    email: Email
    profile: Profile


class SummarizeResponse(BaseModel):
    message_id: str
    source: Source
    job_count: int
    counts: VerdictCounts
    one_line_summary: str
    jobs: list[Job]
    usage: Usage
