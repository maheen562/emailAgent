"""Demo provider: reads sample .eml files so the project runs with no credentials."""

from datetime import datetime
from pathlib import Path

from app.models import Email
from app.parser import parse_email
from app.providers.base import newest_first

SAMPLES_DIR = Path(__file__).resolve().parents[2] / "samples"


class DemoProvider:
    name = "demo"

    def __init__(self, samples_dir: Path = SAMPLES_DIR, max_chars: int = 20_000):
        self.samples_dir = samples_dir
        self.max_chars = max_chars

    def fetch(self, since: datetime | None, limit: int) -> list[Email]:
        emails = [
            parse_email(path.read_bytes(), max_chars=self.max_chars)
            for path in sorted(self.samples_dir.glob("*.eml"))
        ]
        return newest_first(emails, since, limit)
