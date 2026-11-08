// Small HTTP client for the Python agent. Every call has a timeout so a hung
// agent can never block the platform.
export class AgentError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message, { cause });
    this.name = 'AgentError';
    this.status = status;
  }
}

export function createAgentClient({ baseUrl, timeoutMs = 120_000, fetchImpl = fetch }) {
  async function request(path, { method = 'GET', body, timeout = timeoutMs } = {}) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      throw new AgentError(`Agent unreachable at ${baseUrl}: ${err.message}`, { cause: err });
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new AgentError(`Agent ${method} ${path} failed with ${res.status}: ${detail}`, {
        status: res.status,
      });
    }
    return res.json();
  }

  return {
    health: () => request('/health', { timeout: 5_000 }),
  };
}
