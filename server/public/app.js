// Dashboard for the job alert agent. Plain ES modules, no build step.
//
// Security: job text comes from emails, which are untrusted. Everything is
// inserted with textContent (via h()), never innerHTML, and links are only
// rendered for http(s) URLs.

const VERDICT = {
  apply_now: { label: 'Apply now', tone: 'good' },
  worth_a_look: { label: 'Worth a look', tone: 'warning' },
  skip: { label: 'Skip', tone: 'neutral' },
};
const FACTORS = [
  ['experience', 'Experience'],
  ['skills', 'Skills'],
  ['work_arrangement', 'Work setup'],
  ['terms_pay', 'Terms & pay'],
  ['career_value', 'Career value'],
  ['eligibility', 'Eligibility'],
];
const WORK_MODE = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' };
const EMPLOYMENT = { internship: 'Internship', full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract' };
const RUN_RESULT = {
  running: ['Running', 'warning'],
  success: ['Done', 'good'],
  partial: ['Done with errors', 'warning'],
  stopped: ['Stopped, will resume', 'warning'],
  failed: ['Failed', 'critical'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const $ = (selector) => document.querySelector(selector);

// h('div', { class: 'x' }, 'text', child) -> element. Strings become text nodes.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    // ARIA states need the literal strings "true"/"false", not HTML boolean attributes.
    if (key.startsWith('aria-')) {
      el.setAttribute(key, String(value));
      continue;
    }
    if (value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(body?.error ?? `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const formatDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : '–');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function duration(run) {
  if (!run.finished_at) return '';
  const seconds = Math.round((new Date(run.finished_at) - new Date(run.started_at)) / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 5000);
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

const pill = (label, tone) => h('span', { class: `pill ${tone}` }, label);

// ---------------------------------------------------------------------------
// Header: health, stats, run button
// ---------------------------------------------------------------------------

async function loadHealth() {
  const el = $('#health');
  try {
    const { agent } = await api('/api/health');
    if (!agent.reachable) {
      el.className = 'pill critical';
      el.textContent = 'Agent offline';
      el.title = agent.error;
    } else if (!agent.llm_configured) {
      el.className = 'pill warning';
      el.textContent = `No ${agent.llm_provider} key`;
      el.title = 'Add GEMINI_API_KEY to agent/.env to judge new emails';
    } else {
      el.className = 'pill good';
      el.textContent = `Ready · ${agent.email_provider} · ${agent.llm_provider}`;
      el.title = '';
    }
  } catch {
    el.className = 'pill critical';
    el.textContent = 'Platform offline';
  }
}

async function loadStats() {
  const stats = await api('/api/stats');
  $('#kpi-apply').textContent = stats.open_by_verdict.apply_now;
  $('#kpi-maybe').textContent = stats.open_by_verdict.worth_a_look;
  $('#kpi-applied').textContent = stats.by_status.applied;
  $('#kpi-emails').textContent = stats.emails_total;
  $('#kpi-emails-note').textContent = stats.emails_failed
    ? `${stats.emails_failed} failed, will retry`
    : stats.last_run
      ? `last run ${formatDate(stats.last_run.started_at)}`
      : 'no runs yet';
  return stats;
}

function describeRun(run) {
  const [label] = RUN_RESULT[run.status] ?? [run.status];
  if (run.status === 'running') {
    return `Running… ${plural(run.emails_new, 'new email')} judged, ${plural(run.jobs_new, 'new job')}`;
  }
  const parts = [`${label}: ${plural(run.emails_new, 'new email')}, ${plural(run.jobs_new, 'new job')}`];
  if (run.jobs_duplicate) parts.push(`${run.jobs_duplicate} already seen`);
  if (run.error) parts.push(run.error);
  return parts.join('. ');
}

async function watchRun(id) {
  const button = $('#run-button');
  const status = $('#run-status');
  button.disabled = true;
  try {
    for (;;) {
      const run = await api(`/api/runs/${id}`);
      status.textContent = describeRun(run);
      if (run.status !== 'running') {
        toast(describeRun(run));
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } finally {
    button.disabled = false;
    await refresh();
  }
}

async function startRun() {
  try {
    const run = await api('/api/runs', { method: 'POST' });
    await watchRun(run.id);
  } catch (err) {
    if (err.status === 409) {
      const { runs } = await api('/api/runs?limit=1');
      if (runs[0]?.status === 'running') return watchRun(runs[0].id);
    }
    toast(err.message);
  }
}

// ---------------------------------------------------------------------------
// Jobs view
// ---------------------------------------------------------------------------

const jobFilters = { verdict: '', status: '', sort: 'score', q: '', location: '' };
const LOCATION_FILTERS = {
  pk: { country: 'Pakistan' },
  'pk+ww': { country: 'Pakistan', worldwide: '1' },
};

// The location choice is remembered in this browser. Storage can be blocked
// (private windows, strict settings), so failures are ignored.
const LOCATION_KEY = 'jobAgent.location';
function loadLocationChoice() {
  try {
    const saved = localStorage.getItem(LOCATION_KEY);
    return saved in LOCATION_FILTERS ? saved : '';
  } catch {
    return '';
  }
}
function saveLocationChoice(value) {
  try {
    localStorage.setItem(LOCATION_KEY, value);
  } catch {
    // not remembered; still works for this visit
  }
}

function factorMeter(key, label, factor) {
  const score = factor?.score ?? 0;
  return h(
    'div',
    { class: 'factor' },
    h('span', { class: 'factor-name' }, label),
    h(
      'div',
      { class: 'meter', role: 'meter', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 10, 'aria-valuenow': score, title: factor?.reason ?? '' },
      h('span', { style: `width: ${score * 10}%` }),
    ),
    h('span', { class: 'factor-value' }, `${score}/10`),
    factor?.reason ? h('span', { class: 'factor-reason' }, factor.reason) : null,
  );
}

function jobDetails(job) {
  const facts = [
    ['Experience', job.experience_required],
    ['Hours', job.hours],
    ['Salary', job.salary],
    ['Deadline', job.deadline],
    ['Seen in', job.seen_count > 1 ? `${job.seen_count} alerts (first on ${job.source})` : job.source],
  ].filter(([, value]) => value);

  return h(
    'details',
    {},
    h('summary', {}, 'Why this score'),
    h(
      'div',
      { class: 'detail-grid' },
      h('div', { class: 'factors' }, FACTORS.map(([key, label]) => factorMeter(key, label, job.factor_scores?.[key]))),
      h(
        'div',
        {},
        h('p', { style: 'margin-top: 0' }, job.summary),
        h('dl', {}, facts.flatMap(([term, value]) => [h('dt', {}, term), h('dd', {}, value)])),
        job.skills_matched.length
          ? [h('p', { class: 'muted', style: 'margin: 12px 0 4px' }, 'Skills I have'),
             h('div', { class: 'chips' }, job.skills_matched.map((s) => h('span', { class: 'chip' }, s)))]
          : null,
        job.skills_missing.length
          ? [h('p', { class: 'muted', style: 'margin: 12px 0 4px' }, 'Skills to learn'),
             h('div', { class: 'chips' }, job.skills_missing.map((s) => h('span', { class: 'chip missing' }, s)))]
          : null,
      ),
    ),
  );
}

function statusButton(job, status, label) {
  const active = job.status === status;
  return h(
    'button',
    {
      type: 'button',
      'aria-pressed': active,
      // Clicking the active status again puts the job back to "new".
      onclick: () => setJobStatus(job, active ? 'new' : status),
    },
    label,
  );
}

function jobCard(job) {
  const verdict = VERDICT[job.verdict];
  const url = safeUrl(job.apply_url);
  const workMode = WORK_MODE[job.work_mode];
  // Skip "Remote" if the location already says "Remote (Pakistan)".
  const showMode = workMode && !(job.location ?? '').toLowerCase().includes(workMode.toLowerCase());
  const country =
    job.country === 'Worldwide'
      ? 'Open worldwide'
      : job.country && !(job.location ?? '').toLowerCase().includes(job.country.toLowerCase())
        ? job.country
        : null;
  const meta = [job.company, job.location, country, showMode && workMode, EMPLOYMENT[job.employment_type], job.salary].filter(Boolean);

  return h(
    'article',
    { class: `card${job.status === 'ignored' ? ' dimmed' : ''}`, 'data-id': job.id },
    h(
      'div',
      { class: 'score' },
      h('span', { class: 'score-value', 'aria-label': `Score ${job.overall_score} out of 100` }, job.overall_score),
      h('span', { class: 'score-max', 'aria-hidden': 'true' }, '/ 100'),
      pill(verdict.label, verdict.tone),
    ),
    h(
      'div',
      {},
      h('h2', {}, job.title),
      h('div', { class: 'meta' }, meta.join(' · ')),
      h('p', { class: 'why' }, job.why_it_matters),
      job.dealbreakers_hit.length || job.red_flags.length
        ? h(
            'ul',
            { class: 'flags', 'aria-label': 'Warnings' },
            job.dealbreakers_hit.map((d) => h('li', {}, pill(`Dealbreaker: ${d}`, 'critical'))),
            job.red_flags.map((f) => h('li', {}, pill(`Red flag: ${f}`, 'critical'))),
          )
        : null,
      h(
        'div',
        { class: 'actions' },
        url
          ? h(
              'a',
              { class: `button${job.verdict === 'skip' ? ' secondary' : ''}`, href: url, target: '_blank', rel: 'noopener noreferrer' },
              'Open posting',
            )
          : null,
        statusButton(job, 'saved', 'Save'),
        statusButton(job, 'applied', 'Applied'),
        statusButton(job, 'ignored', 'Ignore'),
      ),
    ),
    jobDetails(job),
  );
}

async function setJobStatus(job, status) {
  try {
    const updated = await api(`/api/jobs/${job.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    const card = document.querySelector(`.card[data-id="${job.id}"]`);
    const wasOpen = card?.querySelector('details')?.open;
    const replacement = jobCard(updated);
    if (wasOpen) replacement.querySelector('details').open = true;
    card?.replaceWith(replacement);
    loadStats();
  } catch (err) {
    toast(`Could not update the job: ${err.message}`);
  }
}

async function loadJobs() {
  const params = new URLSearchParams({ limit: '100', sort: jobFilters.sort });
  for (const key of ['verdict', 'status', 'q']) if (jobFilters[key]) params.set(key, jobFilters[key]);
  for (const [key, value] of Object.entries(LOCATION_FILTERS[jobFilters.location] ?? {})) params.set(key, value);
  const list = $('#job-list');
  try {
    const { jobs, total } = await api(`/api/jobs?${params}`);
    $('#jobs-count').textContent = total > jobs.length ? `Showing ${jobs.length} of ${total} jobs` : plural(total, 'job');
    list.replaceChildren(
      ...(jobs.length
        ? jobs.map(jobCard)
        : [h('div', { class: 'empty' }, 'No jobs match these filters. Try "Run now", or load the demo data with npm run seed.')]),
    );
  } catch (err) {
    list.replaceChildren(h('div', { class: 'empty' }, `Could not load jobs: ${err.message}`));
  }
}

function setupJobFilters() {
  const form = $('#job-filters');
  for (const button of form.querySelectorAll('[data-verdict]')) {
    button.addEventListener('click', () => {
      jobFilters.verdict = button.dataset.verdict;
      for (const b of form.querySelectorAll('[data-verdict]')) b.setAttribute('aria-pressed', String(b === button));
      loadJobs();
    });
  }
  jobFilters.location = loadLocationChoice();
  form.location.value = jobFilters.location;
  form.location.addEventListener('change', () => {
    jobFilters.location = form.location.value;
    saveLocationChoice(jobFilters.location);
    loadJobs();
  });
  form.status.addEventListener('change', () => ((jobFilters.status = form.status.value), loadJobs()));
  form.sort.addEventListener('change', () => ((jobFilters.sort = form.sort.value), loadJobs()));
  form.q.addEventListener('input', debounce(() => ((jobFilters.q = form.q.value.trim()), loadJobs()), 250));
}

// ---------------------------------------------------------------------------
// Inbox view
// ---------------------------------------------------------------------------

function emailRow(email) {
  const failed = email.status === 'failed';
  return h(
    'article',
    { class: 'email' },
    h(
      'div',
      { class: 'email-head' },
      h('div', {}, h('span', { class: 'source' }, email.source), h('span', { class: 'email-subject' }, email.subject)),
      h('span', { class: 'muted' }, formatDate(email.received_at)),
    ),
    failed
      ? h('p', { class: 'email-summary' }, pill(`Failed after ${plural(email.attempts, 'attempt')}`, 'critical'), ' ', email.error)
      : h('p', { class: 'email-summary' }, email.one_line_summary),
  );
}

async function loadInbox() {
  const list = $('#email-list');
  const { emails } = await api('/api/emails?limit=100');
  list.replaceChildren(
    ...(emails.length ? emails.map(emailRow) : [h('div', { class: 'empty' }, 'No alert emails judged yet.')]),
  );
}

// ---------------------------------------------------------------------------
// Runs view
// ---------------------------------------------------------------------------

async function loadRuns() {
  const { runs } = await api('/api/runs?limit=50');
  const body = $('#runs-table tbody');
  if (!runs.length) {
    body.replaceChildren(h('tr', {}, h('td', { colspan: 8, class: 'muted' }, 'No runs yet.')));
    return;
  }
  body.replaceChildren(
    ...runs.map((run) => {
      const [label, tone] = RUN_RESULT[run.status] ?? [run.status, 'neutral'];
      return h(
        'tr',
        {},
        h('td', {}, `#${run.id} `, h('span', { class: 'muted' }, run.trigger)),
        h('td', {}, formatDate(run.started_at), run.finished_at ? h('span', { class: 'muted' }, ` (${duration(run)})`) : null),
        h('td', {}, pill(label, tone)),
        h('td', { class: 'num' }, `${run.emails_new} / ${run.emails_fetched}`),
        h('td', { class: 'num' }, run.jobs_new),
        h('td', { class: 'num' }, run.jobs_duplicate),
        h('td', { class: 'num' }, (run.input_tokens + run.output_tokens).toLocaleString()),
        h('td', { class: 'muted' }, run.error ?? (run.emails_failed ? `${plural(run.emails_failed, 'email')} failed` : '')),
      );
    }),
  );
}

// ---------------------------------------------------------------------------
// Profile view
// ---------------------------------------------------------------------------

async function loadProfile() {
  const profile = await api('/api/profile');
  $('#profile-editor').value = JSON.stringify(profile, null, 2);
  $('#profile-message').textContent = '';
}

async function saveProfile() {
  const message = $('#profile-message');
  let profile;
  try {
    profile = JSON.parse($('#profile-editor').value);
  } catch (err) {
    message.textContent = `Not valid JSON: ${err.message}`;
    return;
  }
  try {
    const saved = await api('/api/profile', { method: 'PUT', body: JSON.stringify(profile) });
    $('#profile-editor').value = JSON.stringify(saved, null, 2);
    message.textContent = 'Saved. New emails will be judged with this profile.';
  } catch (err) {
    message.textContent = err.message;
  }
}

// ---------------------------------------------------------------------------
// Routing & start-up
// ---------------------------------------------------------------------------

const VIEWS = { jobs: loadJobs, inbox: loadInbox, runs: loadRuns, profile: loadProfile };
const currentView = () => (location.hash.slice(1) in VIEWS ? location.hash.slice(1) : 'jobs');

async function showView() {
  const view = currentView();
  for (const name of Object.keys(VIEWS)) $(`#view-${name}`).hidden = name !== view;
  for (const link of document.querySelectorAll('.tabs a')) {
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  try {
    await VIEWS[view]();
  } catch (err) {
    toast(`Could not load ${view}: ${err.message}`);
  }
}

// Reload whatever is on screen (but never overwrite unsaved profile edits).
async function refresh() {
  await loadStats().catch(() => {});
  if (currentView() !== 'profile') await showView();
}

async function init() {
  setupJobFilters();
  $('#run-button').addEventListener('click', startRun);
  $('#profile-save').addEventListener('click', saveProfile);
  $('#profile-reload').addEventListener('click', loadProfile);
  window.addEventListener('hashchange', showView);

  loadHealth();
  const stats = await loadStats().catch(() => null);
  await showView();
  // If a run was already going (e.g. started by the scheduler), follow it.
  if (stats?.running && stats.last_run?.status === 'running') watchRun(stats.last_run.id);
}

init();
