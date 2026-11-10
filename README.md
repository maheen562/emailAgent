# Job Alert Agent

An AI agent that reads my job-alert emails, extracts every job, and tells me **how useful each one is to me**. It checks experience, skills, location, work requirements, pay and dealbreakers, then gives each job a verdict: **Apply now / Worth a look / Skip**.

> 🚧 Work in progress. See [PLAN.md](PLAN.md) for the full design and milestones.

## Architecture

| Layer | Tech | Role |
|-------|------|------|
| **Core platform** (`server/`) | Node.js, Express | REST API, storage, scheduler, dashboard |
| **Automation layer** (`agent/`) | Python, FastAPI | Gmail fetching, email parsing, LLM judging |
| **LLM** | Gemini API (free tier) or Ollama (local) | Rates each job on six factors |

## Quick start (demo mode, no credentials needed)

Requirements: Python 3.11+, Node.js 22.9+.

**1. Python agent** (terminal 1)
```bash
cd agent
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

**2. Node platform** (terminal 2)
```bash
cd server
npm install
npm run dev
```

Open http://localhost:3000.

## Try the agent from the terminal

1. Get a free Gemini API key at https://aistudio.google.com (no credit card) and set `GEMINI_API_KEY` in `agent/.env`.
2. Optional: copy `profile.example.json` to `profile.json` and fill in your own details. It's git-ignored.
3. Run:
```bash
cd agent
python -m app.cli            # judge the sample emails (or your Gmail, if EMAIL_PROVIDER=gmail)
python -m app.cli --limit 1  # just one email
```

To keep everything on your laptop instead, install [Ollama](https://ollama.com), run `ollama pull qwen2.5:7b`, and set `LLM_PROVIDER=ollama`.

## Tests
```bash
cd agent && python -m pytest
cd server && npm test
```

## Project status
- [x] M1: Scaffolding, health endpoints, tests
- [x] M2: Email ingestion (demo samples + Gmail API + IMAP backup)
- [x] M3: LLM summariser and scorer (Gemini / Ollama)
- [x] M4: Platform storage, pipeline and dedupe
- [ ] M5: Dashboard
- [ ] M6: Scheduler and hardening
- [ ] M7: Portfolio polish
