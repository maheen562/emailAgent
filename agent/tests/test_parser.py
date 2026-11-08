from email.message import EmailMessage

from app.parser import detect_source, html_to_text, parse_email, plain_text_links, strip_footer


def make_raw(*, html: str | None = None, text: str | None = None, **headers) -> bytes:
    msg = EmailMessage()
    msg["From"] = headers.get("sender", "LinkedIn <jobalerts-noreply@linkedin.com>")
    msg["Subject"] = headers.get("subject", "New jobs")
    msg["Date"] = headers.get("date", "Sat, 07 Nov 2026 08:15:00 +0500")
    if "message_id" in headers:
        msg["Message-ID"] = headers["message_id"]
    if text is not None:
        msg.set_content(text)
    if html is not None:
        if text is not None:
            msg.add_alternative(html, subtype="html")
        else:
            msg.set_content(html, subtype="html")
    return msg.as_bytes()


class TestHtmlToText:
    def test_drops_scripts_and_styles(self):
        text, _ = html_to_text("<style>.x{}</style><script>track()</script><p>Python Intern</p>")
        assert text == "Python Intern"

    def test_replaces_links_with_refs(self):
        html = '<a href="https://jobs.example.com/1?track=abc">Python Intern</a>'
        text, links = html_to_text(html)
        assert text == "Python Intern [L1]"
        assert links[0].ref == "L1"
        assert links[0].url == "https://jobs.example.com/1?track=abc"
        assert links[0].text == "Python Intern"

    def test_same_url_reuses_ref(self):
        html = '<a href="https://x.com/1">Apply</a> <a href="https://x.com/1">Apply now</a>'
        text, links = html_to_text(html)
        assert len(links) == 1
        assert text.count("[L1]") == 2

    def test_skips_image_only_and_non_http_links(self):
        html = '<a href="https://x.com"><img src="p.gif"></a><a href="mailto:a@b.com">Email us</a>'
        text, links = html_to_text(html)
        assert links == []
        assert "Email us" in text

    def test_block_tags_become_lines(self):
        text, _ = html_to_text("<div>Title</div><div>Company</div>")
        assert [line for line in text.splitlines() if line] == ["Title", "Company"]


class TestPlainTextLinks:
    def test_replaces_urls_and_keeps_punctuation(self):
        text, links = plain_text_links("Apply: https://x.com/job/1. Thanks")
        assert text == "Apply: [L1]. Thanks"
        assert links[0].url == "https://x.com/job/1"


class TestStripFooter:
    def test_cuts_footer_near_the_end(self):
        body = "Job one\n" * 20 + "You are receiving this because you subscribed.\nUnsubscribe"
        assert strip_footer(body) == ("Job one\n" * 20).rstrip()

    def test_keeps_marker_that_appears_early(self):
        body = "Manage your alerts below\n" + "Job details\n" * 20
        assert strip_footer(body) == body


class TestDetectSource:
    def test_known_boards(self):
        assert detect_source("jobalerts-noreply@linkedin.com") == "linkedin"
        assert detect_source("alert@indeed.com") == "indeed"
        assert detect_source("jobs@rozee.pk") == "rozee"
        assert detect_source("noreply@glassdoor.com") == "glassdoor"

    def test_unknown_sender(self):
        assert detect_source("digest@techtalent.example.com") == "other"


class TestParseEmail:
    def test_prefers_html_over_plain_text(self):
        raw = make_raw(text="plain version", html="<p>html version</p>")
        assert parse_email(raw).text == "html version"

    def test_falls_back_to_plain_text(self):
        raw = make_raw(text="Apply at https://x.com/1")
        email = parse_email(raw)
        assert email.text == "Apply at [L1]"
        assert email.links[0].url == "https://x.com/1"

    def test_reads_headers(self):
        raw = make_raw(html="<p>x</p>", subject="4 new jobs", message_id="<abc@x>")
        email = parse_email(raw)
        assert email.subject == "4 new jobs"
        assert email.sender == "jobalerts-noreply@linkedin.com"
        assert email.source == "linkedin"
        assert email.message_id == "<abc@x>"
        assert email.received_at.utcoffset().total_seconds() == 5 * 3600

    def test_hashes_content_when_message_id_missing(self):
        raw = make_raw(html="<p>x</p>")
        assert parse_email(raw).message_id.startswith("sha256:")
        assert parse_email(raw).message_id == parse_email(raw).message_id

    def test_drops_links_that_were_only_in_the_footer(self):
        jobs = "".join(f"<p>Job {i} details here</p>" for i in range(20))
        html = (
            f'<a href="https://x.com/job">Python Intern</a>{jobs}'
            '<p>You are receiving this email. <a href="https://x.com/unsub">Unsubscribe</a></p>'
        )
        email = parse_email(make_raw(html=html))
        assert [link.text for link in email.links] == ["Python Intern"]
        assert "Unsubscribe" not in email.text

    def test_truncates_long_emails(self):
        email = parse_email(make_raw(html="<p>" + "word " * 1000 + "</p>"), max_chars=100)
        assert email.truncated is True
        assert len(email.text) == 100
