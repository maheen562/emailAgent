"""Turn the LLM's per-factor ratings into an overall score and verdict.

This is deliberately plain Python, not the LLM: the maths is explainable,
testable, and tunable from the profile's weights and thresholds.
"""

from app.models import FACTORS, ExtractedJob, Job, Link, Profile, Verdict, VerdictCounts

DEALBREAKER_CAP = 20  # a job that hits a dealbreaker can never score above this

_VERDICT_LABELS = {"apply_now": "Apply now", "worth_a_look": "Worth a look", "skip": "Skip"}


def overall_score(job: ExtractedJob, profile: Profile) -> int:
    weights = profile.weights.model_dump()
    total_weight = sum(weights[f] for f in FACTORS)
    if total_weight == 0:
        return 0
    weighted = sum(getattr(job.factor_scores, f).score * weights[f] for f in FACTORS)
    score = round(weighted / total_weight * 10)  # factor scores are 0-10; overall is 0-100
    if job.dealbreakers_hit:
        score = min(score, DEALBREAKER_CAP)
    return score


def verdict_for(score: int, job: ExtractedJob, profile: Profile) -> Verdict:
    if job.dealbreakers_hit:
        return "skip"
    if score >= profile.thresholds.apply_now:
        return "apply_now"
    if score >= profile.thresholds.worth_a_look:
        return "worth_a_look"
    return "skip"


def resolve_apply_url(apply_ref: str | None, links: list[Link]) -> str | None:
    """Map the model's [Ln] ref back to the real URL. Unknown refs give None, never a guess."""
    if not apply_ref:
        return None
    ref = apply_ref.strip().strip("[]").upper()
    return next((link.url for link in links if link.ref.upper() == ref), None)


def only_known_dealbreakers(hit: list[str], profile: Profile) -> list[str]:
    """Keep only dealbreakers that are really in the profile (case-insensitive)."""
    known = {d.strip().lower(): d for d in profile.dealbreakers}
    return [known[h.strip().lower()] for h in hit if h.strip().lower() in known]


def score_job(extracted: ExtractedJob, profile: Profile, links: list[Link]) -> Job:
    extracted = extracted.model_copy(
        update={"dealbreakers_hit": only_known_dealbreakers(extracted.dealbreakers_hit, profile)}
    )
    score = overall_score(extracted, profile)
    return Job(
        **extracted.model_dump(),
        apply_url=resolve_apply_url(extracted.apply_ref, links),
        overall_score=score,
        verdict=verdict_for(score, extracted, profile),
    )


def count_verdicts(jobs: list[Job]) -> VerdictCounts:
    counts = VerdictCounts()
    for job in jobs:
        setattr(counts, job.verdict, getattr(counts, job.verdict) + 1)
    return counts


def _label(job: Job) -> str:
    return f"{job.title} at {job.company}" if job.company else job.title


def one_line_summary(jobs: list[Job]) -> str:
    """e.g. '4 jobs: 1 Apply now (Python Intern at Nimbus Labs), 1 Worth a look, 2 Skip.'"""
    if not jobs:
        return "No job postings found in this email."
    ranked = sorted(jobs, key=lambda j: j.overall_score, reverse=True)
    parts = []
    for verdict, label in _VERDICT_LABELS.items():
        group = [j for j in ranked if j.verdict == verdict]
        if not group:
            continue
        part = f"{len(group)} {label}"
        if verdict == "apply_now":
            names = ", ".join(_label(j) for j in group[:2])
            more = f" +{len(group) - 2} more" if len(group) > 2 else ""
            part += f" ({names}{more})"
        parts.append(part)
    noun = "job" if len(jobs) == 1 else "jobs"
    return f"{len(jobs)} {noun}: " + ", ".join(parts) + "."
