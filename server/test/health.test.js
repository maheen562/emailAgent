import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { createAgentClient } from '../src/agentClient.js';

// Start the app on a random free port and return its base URL.
async function start(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { url: `http://localhost:${server.address().port}`, close: () => server.close() };
}

test('GET /api/health reports agent status when the agent is up', async () => {
  const agent = { health: async () => ({ status: 'ok', llm_provider: 'gemini' }) };
  const { url, close } = await start(createApp({ agent }));
  try {
    const body = await (await fetch(`${url}/api/health`)).json();
    assert.equal(body.status, 'ok');
    assert.equal(body.agent.reachable, true);
    assert.equal(body.agent.llm_provider, 'gemini');
  } finally {
    close();
  }
});

test('GET /api/health is degraded (not an error) when the agent is down', async () => {
  const agent = {
    health: async () => {
      throw new Error('ECONNREFUSED');
    },
  };
  const { url, close } = await start(createApp({ agent }));
  try {
    const res = await fetch(`${url}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'degraded');
    assert.equal(body.agent.reachable, false);
  } finally {
    close();
  }
});

test('unknown /api routes return a JSON 404', async () => {
  const { url, close } = await start(createApp({ agent: { health: async () => ({}) } }));
  try {
    const res = await fetch(`${url}/api/nope`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'Not found' });
  } finally {
    close();
  }
});

test('agent client wraps network failures in AgentError', async () => {
  const client = createAgentClient({
    baseUrl: 'http://agent',
    fetchImpl: async () => {
      throw new Error('boom');
    },
  });
  await assert.rejects(client.health(), { name: 'AgentError' });
});

test('agent client reports non-2xx responses with their status', async () => {
  const client = createAgentClient({
    baseUrl: 'http://agent',
    fetchImpl: async () => new Response('bad', { status: 503 }),
  });
  await assert.rejects(client.health(), { name: 'AgentError', status: 503 });
});
