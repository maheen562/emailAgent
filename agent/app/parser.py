"""Turn a raw RFC 822 email into a clean `Email`.

Gmail API (format=raw), IMAP and the demo samples all produce RFC 822 bytes,
so every provider goes through this one parser.
"""

import hashlib
import re
from datetime import datetime, timezone
from email import message_from_bytes, policy
from email.message import EmailMessage
from email.utils import parseaddr, parsedate_to_datetime

from bs4 import BeautifulSoup

from app.models import Email, Link, Source

# Tags whose contents are never useful to the LLM.
_DROP_TAGS = ("script", "style", "head", "title", "meta", "noscript", "svg")
# Block-level tags that should start a new line in the plain-text output.
_BLOCK_TAGS = ("p", "div", "br", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "section")
# Phrases that usually start an email footer (legal text, unsubscribe links).
_FOOTER_MARKERS = re.compile(
    r"(unsubscribe|you are receiving this|you received this|this email was (sent|intended)"
    r"|manage (your )?(alerts|notifications|email preferences)|privacy policy)",
    re.IGNORECASE,
)
_SOURCES: dict[Source, tuple[str, ...]] = {
    "linkedin": ("linkedin.com",),
    "indeed": ("indeed.com",),
    "rozee": ("rozee.pk",),
    "glassdoor": ("glassdoor.com",),
}


def detect_source(sender: str) -> Source:
    """Guess which job board sent the email from the sender address."""
    sender = sender.lower()
    for source, domains in _SOURCES.items():
        if any(domain in sender for domain in domains):
            return source
    return "other"


def html_to_text(html: str) -> tuple[str, list[Link]]:
    """Convert HTML to plain text, replacing each link with a short [Ln] ref.

    Job-alert links are long tracking URLs. Short refs save LLM tokens and
    stop the model inventing URLs; the refs are mapped back afterwards.
    """
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(_DROP_TAGS):
        tag.decompose()

    links: list[Link] = []
    ref_by_url: dict[str, str] = {}
    for a in soup.find_all("a"):
        url = (a.get("href") or "").strip()
        text = " ".join(a.get_text(" ", strip=True).split())
        if not text or not url.startswith(("http://", "https://")):
            a.unwrap()  # keep any text, drop the link
            continue
        ref = ref_by_url.get(url)
        if ref is None:
            ref = f"L{len(links) + 1}"
            ref_by_url[url] = ref
            links.append(Link(ref=ref, url=url, text=text))
        a.replace_with(f"{text} [{ref}]")

    for tag in soup.find_all(_BLOCK_TAGS):
        tag.insert_before("\n")
        tag.insert_after("\n")

    return normalize_whitespace(soup.get_text()), links


_URL_RE = re.compile(r"https?://[^\s<>\"')\]]+")


def plain_text_links(text: str) -> tuple[str, list[Link]]:
    """Replace bare URLs in plain text with [Ln] refs, like html_to_text does."""
    links: list[Link] = []
    ref_by_url: dict[str, str] = {}

    def replace(match: re.Match) -> str:
        url = match.group(0).rstrip(".,;:")
        trailing = match.group(0)[len(url):]
        ref = ref_by_url.get(url)
        if ref is None:
            ref = f"L{len(links) + 1}"
            ref_by_url[url] = ref
            links.append(Link(ref=ref, url=url, text=url))
        return f"[{ref}]{trailing}"

    return _URL_RE.sub(replace, text), links


def normalize_whitespace(text: str) -> str:
    lines = (" ".join(line.split()) for line in text.splitlines())
    text = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def strip_footer(text: str) -> str:
    """Cut a trailing footer, but only if the marker is in the last 40% of the text."""
    for match in _FOOTER_MARKERS.finditer(text):
        if match.start() >= len(text) * 0.6:
            line_start = text.rfind("\n", 0, match.start()) + 1
            return text[:line_start].rstrip()
    return text


def _body(msg: EmailMessage) -> tuple[str, list[Link]]:
    """Prefer the HTML part (richer, has links); fall back to plain text."""
    html_part = msg.get_body(preferencelist=("html",))
    if html_part is not None:
        return html_to_text(html_part.get_content())
    text_part = msg.get_body(preferencelist=("plain",))
    if text_part is not None:
        return plain_text_links(normalize_whitespace(text_part.get_content()))
    return "", []


def _received_at(msg: EmailMessage) -> datetime:
    try:
        dt = parsedate_to_datetime(msg["Date"])
    except (TypeError, ValueError):
        return datetime.now(timezone.utc)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def parse_email(raw: bytes, *, max_chars: int = 20_000) -> Email:
    """Parse raw RFC 822 bytes into an `Email`."""
    msg = message_from_bytes(raw, policy=policy.default)
    _, sender = parseaddr(str(msg.get("From", "")))
    text, links = _body(msg)
    text = strip_footer(text)

    truncated = len(text) > max_chars
    if truncated:
        text = text[:max_chars]
    # Drop links that only appeared in the removed footer or truncated tail.
    links = [link for link in links if f"[{link.ref}]" in text]

    # Message-ID is stable across Gmail API and IMAP; hash the content if it's missing.
    message_id = str(msg.get("Message-ID", "")).strip() or (
        "sha256:" + hashlib.sha256(raw).hexdigest()[:32]
    )

    return Email(
        message_id=message_id,
        source=detect_source(sender),
        sender=sender,
        subject=str(msg.get("Subject", "")).strip(),
        received_at=_received_at(msg),
        text=text,
        links=links,
        truncated=truncated,
    )
