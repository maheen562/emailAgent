"""Data shapes shared across the agent (and sent to the Node platform as JSON)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

Source = Literal["linkedin", "indeed", "rozee", "glassdoor", "other"]


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
