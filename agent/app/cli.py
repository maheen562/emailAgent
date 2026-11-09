"""Try the agent from the terminal, without the Node platform:

    python -m app.cli               # judge the newest emails from EMAIL_PROVIDER
    python -m app.cli --limit 1     # just one email
    python -m app.cli --json        # raw JSON output

Uses ../profile.json if it exists, otherwise ../profile.example.json.
"""

import argparse
import sys
from pathlib import Path

from app.config import get_settings
from app.llm import LLMError, LLMRateLimited, get_llm
from app.models import Profile, SummarizeResponse
from app.providers import ProviderNotConfigured, get_provider
from app.summarizer import summarize

REPO_ROOT = Path(__file__).resolve().parents[2]
ICONS = {"apply_now": "[APPLY]", "worth_a_look": "[MAYBE]", "skip": "[SKIP] "}


def load_profile() -> tuple[Profile, Path]:
    for name in ("profile.json", "profile.example.json"):
        path = REPO_ROOT / name
        if path.exists():
            return Profile.model_validate_json(path.read_text(encoding="utf-8")), path
    return Profile(), Path("(built-in defaults)")


def print_result(subject: str, result: SummarizeResponse) -> None:
    print(f"\n=== {subject}")
    print(f"    {result.one_line_summary}")
    for job in result.jobs:
        where = ", ".join(x for x in (job.company, job.location) if x)
        print(f"\n  {ICONS[job.verdict]} {job.overall_score:>3}  {job.title}" + (f" - {where}" if where else ""))
        print(f"           {job.why_it_matters}")
        for issue in job.dealbreakers_hit:
            print(f"           ! dealbreaker: {issue}")
        for flag in job.red_flags:
            print(f"           ! red flag: {flag}")
        if job.apply_url:
            print(f"           {job.apply_url}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Judge job-alert emails against your profile.")
    parser.add_argument("--limit", type=int, default=5, help="max emails to process")
    parser.add_argument("--json", action="store_true", help="print raw JSON")
    args = parser.parse_args(argv)

    settings = get_settings()
    profile, profile_path = load_profile()
    try:
        provider = get_provider(settings)
        llm = get_llm(settings)
        emails = provider.fetch(since=None, limit=args.limit)
    except (ProviderNotConfigured, LLMError) as err:
        print(f"Setup problem: {err}", file=sys.stderr)
        return 1

    print(f"Profile: {profile_path} | email: {provider.name} | LLM: {llm.name} ({llm.model})", file=sys.stderr)
    print(f"Judging {len(emails)} email(s)...", file=sys.stderr)

    for email in emails:
        try:
            result = summarize(email, profile, llm)
        except LLMRateLimited as err:
            print(f"\nStopped: {err}", file=sys.stderr)
            return 2
        except LLMError as err:
            print(f"\nSkipped {email.subject!r}: {err}", file=sys.stderr)
            continue
        if args.json:
            print(result.model_dump_json(indent=2))
        else:
            print_result(email.subject, result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
