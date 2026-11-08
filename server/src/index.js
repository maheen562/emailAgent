import { loadConfig } from './config.js';
import { createAgentClient } from './agentClient.js';
import { createApp } from './app.js';

const config = loadConfig();
const agent = createAgentClient({ baseUrl: config.agentUrl, timeoutMs: config.agentTimeoutMs });
const app = createApp({ agent });

app.listen(config.port, () => {
  console.log(`Platform running at http://localhost:${config.port} (agent: ${config.agentUrl})`);
});
