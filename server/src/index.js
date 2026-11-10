import { createAgentClient } from './agentClient.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createRunner } from './pipeline.js';
import { createProfileStore } from './profile.js';
import { createRepo } from './repo.js';

const config = loadConfig();
const db = openDb(config.dbFile);
const repo = createRepo(db);
repo.closeAbandonedRuns();

const agent = createAgentClient({ baseUrl: config.agentUrl, timeoutMs: config.agentTimeoutMs });
const profileStore = createProfileStore({ repo });
const runner = createRunner({ repo, agent, getProfile: profileStore.get, config });
const app = createApp({ agent, repo, runner, profileStore });

app.listen(config.port, () => {
  console.log(`Platform running at http://localhost:${config.port}`);
  console.log(`Agent: ${config.agentUrl} | Database: ${config.dbFile}`);
});
