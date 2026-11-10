// HTTP client for the Python agent. Every call has a timeout so a hung agent
// can never block the platform.
export class AgentError extends Error {
  constructor(message, { status, retryAfterSeconds, cause } = {}) {
    super(message, { cause });
    this.name = 'AgentError';
    this.status = status; // undefined when the agent couldn't be reached at all
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// FastAPI puts the reason in {"detail": "..."} (or a list of validation errors).
function describe(body, fallback) {
  try {
    const { detail } = JSON.parse(body);
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return detail.map((d) => `${(d.loc ?? []).slice(1).join('.') || 'body'}: ${d.msg}`).join('; ');
    }
  } catch {
    // not JSON; fall through
  }
  return body.slice(0, 300) || fallback;
}

export function createAgentClient({ baseUrl, timeoutMs = 120_000, fetchImpl = fetch }) {
  async function request(path, { method = 'GET', body, query, timeout = timeoutMs } = {}) {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      throw new AgentError(`Agent unreachable at ${baseUrl}: ${err.message}`, { cause: err });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const retryAfter = Number(res.headers.get('retry-after'));
      throw new AgentError(describe(text, `Agent ${method} ${path} failed with ${res.status}`), {
        status: res.status,
        retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      });
    }
    return res.json();
  }

  return {
    health: () => request('/health', { timeout: 5_000 }),
    fetchEmails: ({ since, limit } = {}) =>
      request('/emails', { query: { since: since?.toISOString?.() ?? since, limit } }),
    // Judging one email can take a while (LLM call plus retries).
    summarize: (email, profile) =>
      request('/summarize', { method: 'POST', body: { email, profile }, timeout: Math.max(timeoutMs, 400_000) }),
    validateProfile: (profile) =>
      request('/profile/validate', { method: 'POST', body: profile, timeout: 10_000 }),
  };
}
