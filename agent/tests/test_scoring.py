import pytest

from app.models import ExtractedJob, Link, Profile, Weights
from app.scoring import (
    DEALBREAKER_CAP,
    one_line_summary,
    overall_score,
    resolve_apply_url,
    score_job,
)
from tests.fakes import make_job

LINKS = [Link(ref="L1", url="https://x.com/1", text="a"), Link(ref="L2", url="https://x.com/2", text="b")]


def job(scores=8, **overrides) -> ExtractedJob:
    return ExtractedJob.model_validate(make_job(scores, **overrides))


class TestOverallScore:
    def test_all_tens_is_100_and_all_zeros_is_0(self):
        assert overall_score(job(10), Profile()) == 100
        assert overall_score(job(0), Profile()) == 0

    def test_uses_weights(self):
        # Only experience matters: its score alone decides the result.
        weights = Weights(experience=1, skills=0, work_arrangement=0, terms_pay=0, career_value=0, eligibility=0)
        j = job({"experience": 9, "skills": 0})
        assert overall_score(j, Profile(weights=weights)) == 90

    def test_default_weights_example(self):
        # 25*8 + 25*6 + 15*10 + 15*4 + 10*9 + 10*7 = 720 -> 72
        j = job({"experience": 8, "skills": 6, "work_arrangement": 10, "terms_pay": 4, "career_value": 9, "eligibility": 7})
        assert overall_score(j, Profile()) == 72

    def test_dealbreaker_caps_score(self):
        profile = Profile(dealbreakers=["unpaid"])
        assert overall_score(job(10, dealbreakers_hit=["unpaid"]), profile) == DEALBREAKER_CAP

    def test_zero_weights_gives_zero(self):
        zero = Weights(experience=0, skills=0, work_arrangement=0, terms_pay=0, career_value=0, eligibility=0)
        assert overall_score(job(10), Profile(weights=zero)) == 0


class TestFactorClamp:
    @pytest.mark.parametrize(("raw", "expected"), [(11, 10), (-2, 0), (7.6, 8), ("6", 6)])
    def test_out_of_range_scores_are_clamped(self, raw, expected):
        j = job({"experience": 5})
        data = j.model_dump()
        data["factor_scores"]["experience"]["score"] = raw
        assert ExtractedJob.model_validate(data).factor_scores.experience.score == expected


class TestVerdicts:
    @pytest.mark.parametrize(("score", "verdict"), [(10, "apply_now"), (6, "worth_a_look"), (3, "skip")])
    def test_thresholds(self, score, verdict):
        assert score_job(job(score), Profile(), LINKS).verdict == verdict

    def test_threshold_boundaries_are_inclusive(self):
        profile = Profile(thresholds={"apply_now": 80, "worth_a_look": 60})
        assert score_job(job(8), profile, LINKS).verdict == "apply_now"
        assert score_job(job(6), profile, LINKS).verdict == "worth_a_look"

    def test_dealbreaker_forces_skip(self):
        profile = Profile(dealbreakers=["unpaid"])
        result = score_job(job(10, dealbreakers_hit=["unpaid"]), profile, LINKS)
        assert result.verdict == "skip"
        assert result.overall_score == DEALBREAKER_CAP

    def test_invented_dealbreakers_are_ignored(self):
        profile = Profile(dealbreakers=["unpaid"])
        result = score_job(job(10, dealbreakers_hit=["too far"]), profile, LINKS)
        assert result.dealbreakers_hit == []
        assert result.verdict == "apply_now"

    def test_dealbreaker_match_is_case_insensitive_and_canonical(self):
        profile = Profile(dealbreakers=["Unpaid"])
        result = score_job(job(10, dealbreakers_hit=["  unpaid "]), profile, LINKS)
        assert result.dealbreakers_hit == ["Unpaid"]


class TestApplyUrl:
    @pytest.mark.parametrize("ref", ["L2", "[L2]", "l2", " L2 "])
    def test_resolves_ref_formats(self, ref):
        assert resolve_apply_url(ref, LINKS) == "https://x.com/2"

    @pytest.mark.parametrize("ref", [None, "", "L9", "https://made-up.com"])
    def test_unknown_refs_give_none(self, ref):
        assert resolve_apply_url(ref, LINKS) is None


class TestOneLineSummary:
    def test_counts_and_names_top_matches(self):
        jobs = [
            score_job(job(10, title="Python Intern", company="Nimbus"), Profile(), LINKS),
            score_job(job(6, title="Junior Dev"), Profile(), LINKS),
            score_job(job(2, title="Senior Dev"), Profile(), LINKS),
            score_job(job(1, title="DevOps"), Profile(), LINKS),
        ]
        assert one_line_summary(jobs) == "4 jobs: 1 Apply now (Python Intern at Nimbus), 1 Worth a look, 2 Skip."

    def test_no_jobs(self):
        assert one_line_summary([]) == "No job postings found in this email."

    def test_singular_and_many_apply_now(self):
        one = [score_job(job(1), Profile(), LINKS)]
        assert one_line_summary(one) == "1 job: 1 Skip."
        many = [score_job(job(10, title=f"Job {i}", company=None), Profile(), LINKS) for i in range(3)]
        assert one_line_summary(many) == "3 jobs: 3 Apply now (Job 0, Job 1 +1 more)."
