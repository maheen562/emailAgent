// One "run": fetch alert emails, judge the new ones, store the results.
//
// How each agent error is handled:
//   429 (rate limit / overloaded) -> stop the run; unprocessed emails are retried next run
//   503 / 422 / unreachable       -> stop the run; nothing will work until it's fixed
//   anything else for one email   -> record it as failed and carry on with the rest;
//                                    retried on later runs up to maxEmailAttempts

export function createRunner({ repo, agent, getProfile, config, sleep = defaultSleep, log = console }) {
  let current = null; // { id, promise } while a run is in progress

  async function execute(runId) {
    const totals = {
      emails_fetched: 0,
      emails_new: 0,
      emails_failed: 0,
      jobs_new: 0,
      jobs_duplicate: 0,
      input_tokens: 0,
      output_tokens: 0,
    };
    const finish = (status, error = null) => {
      repo.finishRun(runId, { status, error, ...totals });
      log.info?.(`Run ${runId} ${status}${error ? `: ${error}` : ''}`, totals);
      return repo.getRun(runId);
    };

    let emails;
    try {
      const since = new Date(Date.now() - config.lookbackDays * 24 * 60 * 60 * 1000);
      ({ emails } = await agent.fetchEmails({ since, limit: config.fetchLimit }));
    } catch (err) {
      return finish('failed', `Could not fetch emails: ${err.message}`);
    }
    totals.emails_fetched = emails.length;
    repo.updateRunProgress(runId, totals);

    // Oldest first, so if the run stops early the remaining emails are the newest
    // ones and the order of results stays natural.
    const todo = emails
      .filter((email) => {
        const known = repo.getEmail(email.message_id);
        if (!known) return true;
        return known.status === 'failed' && known.attempts < config.maxEmailAttempts;
      })
      .sort((a, b) => a.received_at.localeCompare(b.received_at));

    const profile = getProfile();
    for (const [index, email] of todo.entries()) {
      if (index > 0 && config.summarizeDelayMs > 0) await sleep(config.summarizeDelayMs); // free-tier friendly

      let summary;
      try {
        summary = await agent.summarize(email, profile);
      } catch (err) {
        if (err.status === 429) {
          return finish('stopped', `${err.message} (${todo.length - index} email(s) left for the next run)`);
        }
        // 503 = agent not set up, 422 = invalid request (e.g. bad profile), no status =
        // agent unreachable. All would fail every email the same way, so stop.
        if (err.status === 503 || err.status === 422 || err.status === undefined) {
          return finish('failed', err.message);
        }
        const attempts = repo.recordEmailFailure(email, { runId, error: err.message });
        totals.emails_failed += 1;
        repo.updateRunProgress(runId, totals);
        log.warn?.(`Email ${email.message_id} failed (attempt ${attempts}): ${err.message}`);
        continue;
      }

      const { created, duplicates } = repo.saveSummary(email, summary, { runId });
      totals.emails_new += 1;
      totals.jobs_new += created;
      totals.jobs_duplicate += duplicates;
      totals.input_tokens += summary.usage?.input_tokens ?? 0;
      totals.output_tokens += summary.usage?.output_tokens ?? 0;
      repo.updateRunProgress(runId, totals);
    }

    return finish(totals.emails_failed > 0 ? 'partial' : 'success');
  }

  return {
    isRunning: () => current !== null,
    currentRunId: () => current?.id ?? null,

    // Starts a run in the background and returns its id straight away.
    // Returns null if a run is already in progress (never two at once).
    start(trigger = 'manual') {
      if (current) return null;
      const id = repo.startRun(trigger);
      const promise = execute(id)
        .catch((err) => {
          // A bug, not an expected agent error: make sure the run is still closed.
          log.error?.(`Run ${id} crashed`, err);
          repo.finishRun(id, { status: 'failed', error: `Unexpected error: ${err.message}` });
          return repo.getRun(id);
        })
        .finally(() => {
          current = null;
        });
      current = { id, promise };
      return { id, promise };
    },
  };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
