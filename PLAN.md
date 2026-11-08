# Job Alert Email Agent: Build Plan

I get a lot of job-alert emails (LinkedIn, Indeed, Rozee.pk, Glassdoor, etc.) and don't have time to open every one. This agent reads each alert email, pulls out every job in it, and tells me **how useful each job is to me**. It checks my experience, skills, location, work requirements, pay, career value and dealbreakers, then gives each job a verdict: **Apply now / Worth a look / Skip**, with the reasons.

**The core question it answers for every email:** *"Is anything in here worth my time, and why?"*

**Why this project:** It uses a **Node.js core platform** with a **Python automation layer**, a common split for production AI automation systems. It shows REST APIs, multi-system integration (Gmail ↔ Python ↔ Gemini ↔ Node ↔ DB), clean code, tests, and AI-assisted development.

---

## 1. Goals

| # | Goal | Done when |
|---|------|-----------|
| G1 | Fetch job-alert emails automatically | Agent pulls new alert emails from Gmail since the last run |
| G2 | Extract and summarise each job | Each email becomes structured jobs: title, company, location, remote/onsite, type, salary, skills, 2-line summary, apply link |
| G3 | Judge how useful each job is to me | Each job gets a score per factor (see §4a), a 0–100 overall score, a verdict (Apply now / Worth a look / Skip), dealbreakers, red flags, and the skill gaps I'd need to close |
| G3b | Summarise each email in one line | e.g. *"8 jobs: 1 Apply now (Remote Python intern, Islamabad), 2 Worth a look, 5 Skip (senior roles / onsite Karachi)"* |
| G4 | Dedupe and store | The same job seen in 3 alerts is stored once |
| G5 | Review on a dashboard | **Inbox view** (one row per alert email with its one-line summary) and **Jobs view** (filter by verdict/score, expand to see factor breakdown, mark applied/ignored), plus a daily digest |
| G6 | Easy for a reviewer to run | `demo` mode works with sample emails and no Gmail credentials |

**Out of scope for v1:** auto-applying, multi-user accounts, a web-based sign-in UI (the one-time Google sign-in runs from the command line).

---

## 2. Architecture

```
            ┌──────────────────────── Node.js core platform (server/) ───────────────────────┐
 Browser ──▶│ Express REST API ── Scheduler (every N min) ── SQLite (node:sqlite) ── Dashboard │
            └──────────────┬─────────────────────────────────────────────────────────────────┘
                           │ HTTP (JSON)
            ┌──────────────▼────────── Python automation layer (agent/) ──────────────────────┐
            │ FastAPI ── Gmail API fetcher ─── HTML→text parser ── LLM summariser/scorer      │
            └──────────────┬───────────────────────────────────────────┬──────────────────────┘
                           ▼                                           ▼
              Gmail API (read-only)                 Gemini API (free tier) │ Ollama (local)
```

**Responsibilities**
- **Python (`agent/`)**: talks to the outside world and the LLM. It does not store anything, so it can be scaled or replaced on its own.
- **Node (`server/`)**: runs the overall flow, stores data, dedupes, runs the schedule, serves the UI. This is the "platform".

**Run flow**
1. The scheduler (or the "Run now" button) calls `POST /api/runs` on Node.
2. Node calls Python `GET /emails?since=<last_run>` and gets the raw alert emails (filtered by sender/subject rules).
3. Node skips emails whose `message_id` is already stored.
4. For each new email, Node calls Python `POST /summarize` with `{email, profile}`.
5. Python cleans the HTML, calls the LLM (Gemini by default) with a JSON schema, and returns validated jobs.
6. Node dedupes jobs by a hash of `company + title + location` (or canonical URL), saves them, and records run stats.
7. The dashboard reads from `GET /api/jobs`.

---

## 3. Tech choices

| Area | Choice | Reason |
|------|--------|--------|
| Python API | FastAPI + Pydantic | Typed request/response models, automatic OpenAPI docs |
| Email | **Gmail API** (`google-api-python-client`, `google-auth-oauthlib`) with Google sign-in, read-only access (`gmail.readonly`) | Read-only by design; uses Gmail search syntax and labels; access can be revoked any time. **Backup:** IMAP + App Password via `EMAIL_PROVIDER=imap` |
| Parsing | BeautifulSoup | Alert emails are heavy HTML |
| LLM | **Google Gemini API, free tier** (`google-genai` SDK, a Gemini *Flash* model, set by `GEMINI_MODEL`) with structured output (`response_schema`) | Free, no credit card, fast, good quality; schema-shaped JSON means no fragile regex parsing |
| LLM (option) | **Ollama** (local open-source model, e.g. Qwen/Llama 7–8B) with JSON-schema `format` | Fully private and offline; selected with `LLM_PROVIDER=ollama` |
| Node API | Express 5 | Common, simple, matches "Node.js core platform" |
| DB | Built-in `node:sqlite` (Node 24) | No native build step, so it is easy for reviewers to run |
| Scheduler | `setInterval` plus a lock that stops two runs overlapping | No extra dependency |
| UI | Plain HTML/CSS/JS served by Express | No build step; can move to React later |
| Tests | `pytest` (Python), `node:test` (Node) | Built-in or standard tools |
| Config | `.env` files, plus `.env.example` committed | Secrets never committed |

---

## 4. Data model

### 4a. How "usefulness to me" is judged

The LLM rates each job on the factors below (0–10 each, with a one-line reason). **The overall score is then calculated in Python from weights I control**, not guessed by the LLM, so it is explainable and I can tune it.

| Factor | Default weight | What it checks |
|--------|---------------:|----------------|
| **Experience match** | 25 | Years and seniority asked for vs. mine (intern/junior/mid/senior); "3+ years" for a junior is a mismatch |
| **Skills match** | 25 | Must-have vs. nice-to-have skills; which ones I **have**, which I'm **missing** |
| **Work arrangement & location** | 15 | Remote / hybrid / onsite, city, relocation, timezone and working hours (e.g. a US-shift night job) |
| **Terms & pay** | 15 | Paid or unpaid, salary and currency, full-time vs. part-time hours, contractor vs. employee, contract length |
| **Career value** | 10 | Path to full-time, mentorship, tech stack relevance (e.g. AI/automation), company quality, learning |
| **Eligibility & logistics** | 10 | Degree requirement, citizenship/visa, language, application deadline, own-laptop requirement |

**Dealbreakers** (from my profile) override the score. Examples: unpaid, onsite outside my city, needs 5+ years, citizenship I don't have. If one is hit, the score is capped at 20 and the verdict is forced to **Skip**, with the reason shown.

**Red flags** are surfaced separately: vague description, fees to apply, unrealistic pay, scam signs, very strict IP/non-compete terms, a 40-hour week for an "internship" with no pay listed.

**Verdict:** `≥ 75` → **Apply now**, `50–74` → **Worth a look**, `< 50` → **Skip** (thresholds configurable).

### 4b. My profile (`profile.json`, editable from the dashboard)
```json
{
  "experience_level": "student | fresh_grad | junior",
  "years_experience": 0.5,
  "education": "BS Computer Science (in progress)",
  "skills": { "strong": ["Python", "JavaScript"], "familiar": ["Node.js", "SQL"], "learning": ["Docker"] },
  "target_roles": ["Software Engineering Intern", "Junior Backend Developer", "AI/Automation Engineer"],
  "locations": ["Islamabad", "Rawalpindi"],
  "remote_preference": "remote_only | remote_or_hybrid | any",
  "min_pay": { "amount": 0, "currency": "PKR", "period": "month" },
  "available_hours_per_week": 40,
  "interests": ["AI agents", "automation", "backend"],
  "dealbreakers": ["unpaid", "onsite outside Islamabad/Rawalpindi", "requires 3+ years"],
  "weights": { "experience": 25, "skills": 25, "work_arrangement": 15, "terms_pay": 15, "career_value": 10, "eligibility": 10 }
}
```

### 4c. Output per job (from the LLM, validated by Pydantic)
```json
{
  "title": "Software Engineering Intern",
  "company": "Acme AI",
  "location": "Islamabad, Pakistan",
  "work_mode": "remote | hybrid | onsite | unknown",
  "employment_type": "internship | full_time | part_time | contract | unknown",
  "experience_required": "0-1 years / student",
  "salary": "string or null",
  "hours": "40/week",
  "summary": "Two sentences max: what the job actually is.",
  "apply_url": "https://... or null",
  "deadline": "ISO date or null",
  "factor_scores": {
    "experience":       { "score": 9, "reason": "Open to students; I'm in my final year" },
    "skills":           { "score": 7, "reason": "Have Python & JS; missing production Node.js" },
    "work_arrangement": { "score": 10, "reason": "100% remote" },
    "terms_pay":        { "score": 6, "reason": "Paid in USD but contractor; amount not stated" },
    "career_value":     { "score": 9, "reason": "90-day path to full-time, AI agents work" },
    "eligibility":      { "score": 8, "reason": "Needs own laptop; degree in progress is OK" }
  },
  "skills_matched": ["Python", "JavaScript", "REST APIs"],
  "skills_missing": ["Node.js in production"],
  "dealbreakers_hit": [],
  "red_flags": [],
  "why_it_matters": "One sentence: why this is (or isn't) worth my time.",
  "overall_score": 82,
  "verdict": "apply_now | worth_a_look | skip"
}
```
`overall_score` and `verdict` are calculated in Python (not by the LLM) from `factor_scores`, `weights` and `dealbreakers_hit`.

### 4d. Output per email
```json
{
  "source": "LinkedIn",
  "job_count": 8,
  "counts": { "apply_now": 1, "worth_a_look": 2, "skip": 5 },
  "one_line_summary": "1 strong match (Remote Python intern), 2 maybes, 5 skips: mostly senior or onsite Karachi.",
  "jobs": [ "...Job objects above..." ]
}
```

**SQLite tables (Node):**
- `emails`: `message_id` (PK), `sender`, `source`, `subject`, `received_at`, `one_line_summary`, `counts_json`, `processed_at`, `status`, `error`
- `jobs`: `id`, `dedupe_key` (unique), `email_id`, every field above, `status` (`new | saved | applied | ignored`), `created_at`
- `runs`: `id`, `started_at`, `finished_at`, `emails_seen`, `emails_new`, `jobs_new`, `status`, `error`

---

## 5. API contracts

**Python agent (`:8000`)**
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness check, plus whether it is in demo or live mode |
| GET | `/emails?since=ISO&limit=N` | Fetch job-alert emails (Gmail API by default, IMAP as backup, or sample files in demo mode) |
| POST | `/summarize` | `{email, profile}` → `{jobs: Job[], usage}` |

**Node platform (`:3000`)**
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/runs` | Start a run now (returns 409 if one is already running) |
| GET | `/api/runs` | Run history |
| GET | `/api/jobs?status=&minScore=&q=&sort=` | List and filter jobs |
| PATCH | `/api/jobs/:id` | Change status (applied/ignored/saved) |
| GET | `/api/digest?date=` | Today's top jobs, grouped |
| GET/PUT | `/api/profile` | My skills and preferences, used for fit scoring |

---

## 6. Folder structure

```
emailAgent/
├── PLAN.md
├── README.md                 # setup, demo GIF/screenshot, architecture
├── .env.example
├── agent/                    # Python automation layer
│   ├── app/
│   │   ├── main.py           # FastAPI routes
│   │   ├── config.py         # env settings
│   │   ├── models.py         # Pydantic: Email, Job, SummarizeRequest/Response
│   │   ├── providers/
│   │   │   ├── base.py       # EmailProvider interface: fetch(since, limit) -> list[Email]
│   │   │   ├── gmail_api.py  # Gmail API (default)
│   │   │   ├── imap.py       # IMAP + App Password (backup)
│   │   │   └── demo.py       # sample emails, no credentials
│   │   ├── auth_gmail.py     # one-time Google sign-in: `python -m app.auth_gmail`
│   │   ├── parser.py         # HTML → clean text, link extraction
│   │   ├── llm/
│   │   │   ├── base.py       # LLMProvider interface: generate_json(prompt, schema) -> dict
│   │   │   ├── gemini.py     # Gemini API (default)
│   │   │   └── ollama.py     # local model (option)
│   │   └── summarizer.py     # prompt, schema, validation, retry on bad JSON, scoring maths
│   ├── samples/              # sample alert emails for demo mode
│   ├── tests/
│   └── requirements.txt
└── server/                   # Node.js core platform
    ├── src/
    │   ├── index.js          # Express app bootstrap
    │   ├── db.js             # schema + queries
    │   ├── agentClient.js    # HTTP client for Python agent (timeouts, retries)
    │   ├── pipeline.js       # run flow + dedupe
    │   ├── scheduler.js
    │   └── routes/           # jobs, runs, digest, profile
    ├── public/               # dashboard (index.html, app.js, styles.css)
    ├── test/
    └── package.json
```

---

## 7. Milestones

| # | Milestone | Deliverable |
|---|-----------|-------------|
| M1 | Scaffolding | Folders, venv, `package.json`, `.env.example`, health endpoints for both services |
| M2 | Email ingestion (Python) | `/emails` working in demo mode and with the Gmail API (one-time sign-in script, label/search-query filtering, token refresh); IMAP backup; parser tests |
| M3 | Summariser (Python) | `/summarize` using the Gemini provider with structured output; Ollama provider; rate-limit handling (back off and retry next run); tests with the LLM mocked |
| M4 | Platform (Node) | SQLite schema, agent client, pipeline with dedupe, `/api/runs`, `/api/jobs`; tests |
| M5 | Dashboard | Job list with filters, score badges, status buttons, run history, digest view |
| M6 | Scheduler and hardening | Periodic runs, overlap lock, retries, per-email error isolation, logging |
| M7 | Portfolio polish | Public GitHub repo; README with screenshots, a short demo GIF or video, architecture diagram, setup guide, "how I used Claude Code" section; GitHub Actions CI running both test suites (green badge) |

---

## 8. What I'll have for the job application ("GitHub profile, live project URL, or portfolio"; any one is enough)

| Requirement | What covers it |
|-------------|----------------|
| **GitHub profile** | Public repo with a clean commit history, tests, CI badge, and a detailed README. Anyone can clone it and run demo mode in a few commands, with no Gmail needed |
| **Portfolio / real, functional code** | I use it daily on my own Gmail. The README shows the architecture, a demo GIF, and real (anonymised) results |

## 8b. Quality and engineering practices (what reviewers will look for)
- **One bad email never breaks a run.** Each email is processed on its own, and failures are recorded in `emails.error`.
- **Idempotent runs.** Dedupe happens at both the email level and the job level.
- **Least-privilege access.** Only the read-only Gmail permission is requested. `credentials.json` and `token.json` are git-ignored, secrets stay in `.env`, and email bodies are never logged.
- **Typed boundaries.** Pydantic on the Python side; request validation on the Node side.
- **Tests** for the parser, summariser (mocked LLM), dedupe logic and API routes.
- **Stays within the free tier.** HTML is stripped before sending to the LLM, input is length-capped, emails already processed are never re-sent, requests are spaced out, and token usage per run is logged.
- **Swappable providers.** Email (Gmail API / IMAP / demo) and LLM (Gemini / Ollama) both sit behind small interfaces, so switching is one line in `.env`.
- **Small, readable commits** with clear messages (git history is part of the portfolio).

---

## 9. Prerequisites (from me)
1. **Gemini API key (free)**: sign in at aistudio.google.com → *Get API key* → put it in `agent/.env` as `GEMINI_API_KEY`. No credit card needed. *Note:* on the free tier Google may use requests to improve its products. Use `LLM_PROVIDER=ollama` if I want everything to stay on my laptop.
2. **Gmail API access** (for live mode, about 15 minutes, one time):
   1. Create a project at console.cloud.google.com and enable the **Gmail API**.
   2. Set up the **OAuth consent screen** (External), add the `gmail.readonly` scope, and add myself as a test user.
   3. Create an **OAuth client ID** of type *Desktop app*, download it as `agent/credentials.json`.
   4. Run `python -m app.auth_gmail`. A browser opens; I sign in and approve read-only access, and `agent/token.json` is saved.
   5. *Note:* while the app is in **Testing** mode, Google expires the sign-in every 7 days. Switching it to **In production** (unverified is fine for personal use) avoids this; I'll see a one-time "unverified app" warning.
   6. *Recommended:* create a Gmail filter that puts job alerts under the label `Job Alerts`, and set `GMAIL_QUERY=label:"Job Alerts" newer_than:3d`.
   - *Backup (IMAP):* turn on 2-Step Verification, create an App Password, and set `EMAIL_PROVIDER=imap`, `GMAIL_USER` and `GMAIL_APP_PASSWORD`.
3. **Alert sources**: which senders/subjects count as job alerts (defaults: LinkedIn, Indeed, Rozee, Glassdoor, "job alert" in the subject)
4. **My profile**: experience level, skills (strong/familiar/learning), target roles, locations, remote preference, minimum pay, hours available, dealbreakers. See §4b. Pasting my CV is enough, and the agent can draft `profile.json` from it.

---

## 10. Stretch ideas (after v1)
- Live public demo URL (Docker + Render, rate-limited "try it yourself" box)
- Gmail push notifications (Pub/Sub `watch`) instead of polling, so alerts are processed seconds after they arrive
- Daily digest sent back to my inbox, or to WhatsApp/Telegram
- LLM-drafted cover-letter starter for high-fit jobs
- Extra LLM providers (e.g. Claude, OpenAI) as more plug-ins behind the same interface
- GitHub Actions CI running both test suites
