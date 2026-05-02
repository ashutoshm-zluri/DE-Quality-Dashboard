import storage from "./storage.js";

/**
 * Env-scoped data DAL — backend-agnostic. Reads and writes go through the
 * storage primitive, so the same code works against local-fs and S3.
 *
 * Logical layout:
 *   <env>/ui_data/failures_latest.json
 *   <env>/ui_data/stats.json
 *   <env>/ui_data/eta_cache.json
 *   <env>/ui_data/bad_requests.json
 *   <env>/ui_data/runs/<sync_id>.json
 *   <env>/ui_data/triggers/<sync_id>.json
 */

const SUPPORTED_ENVS = new Set(["dev", "prod"]);

function envKey(env, ...parts) {
  if (!SUPPORTED_ENVS.has(env)) {
    throw new Error(
      `unsupported env "${env}"; expected one of ${[...SUPPORTED_ENVS].join(", ")}`
    );
  }
  return [env, "ui_data", ...parts].join("/");
}

const dataDal = {
  async getFailures({ env }) {
    return storage.getJson(envKey(env, "failures_latest.json"));
  },

  async getStats({ env }) {
    return storage.getJson(envKey(env, "stats.json"));
  },

  async getEtaCache({ env }) {
    return storage.getJson(envKey(env, "eta_cache.json"));
  },

  async getBadRequests({ env }) {
    return storage.getJson(envKey(env, "bad_requests.json"));
  },

  async getRun({ env, syncId }) {
    return storage.getJson(envKey(env, "runs", `${syncId}.json`));
  },

  async listActiveRuns({ env }) {
    const keys = await storage.listKeys(envKey(env, "runs"));
    const items = [];
    for (const key of keys) {
      if (!key.endsWith(".json")) continue;
      const doc = await storage.getJson(key);
      if (doc && (doc.status === "queued" || doc.status === "running")) {
        items.push(doc);
      }
    }
    items.sort((a, b) =>
      (b.triggered_at ?? "").localeCompare(a.triggered_at ?? "")
    );
    return {
      generated_at: new Date().toISOString(),
      count: items.length,
      items,
    };
  },

  /**
   * Drop a "trigger requested" file. The Python script picks these up,
   * calls the validator, and overwrites runs/<sync_id>.json with the real
   * flow run details. We pre-create runs/<sync_id>.json so the UI reflects
   * the queued state immediately.
   */
  async requestTrigger({ env, syncId, failure }) {
    const triggeredAt = new Date().toISOString();
    const eta = await safeEtaLookup(env, failure);

    await storage.putJsonAtomic(envKey(env, "triggers", `${syncId}.json`), {
      sync_id: syncId,
      de_sync_status_id: failure?.de_sync_status_id ?? null,
      org_integration_id: failure?.org_integration_id ?? null,
      org_id: failure?.org_id ?? null,
      integration_id: failure?.integration_id ?? null,
      mode: failure?.mode ?? null,
      action: "retrigger",
      requested_at: triggeredAt,
      requested_by: "ui",
      consumed: false,
    });

    const runDoc = {
      sync_id: syncId,
      de_sync_status_id: failure?.de_sync_status_id ?? null,
      org_integration_id: failure?.org_integration_id ?? null,
      org_name: failure?.org_name ?? null,
      integration_instance_name: failure?.integration_instance_name ?? null,
      integration_name: failure?.integration_name ?? null,
      mode: failure?.mode ?? null,
      triggered_at: triggeredAt,
      triggered_by: "ui",
      status: "queued",
      validator_status_code: null,
      validator_response: null,
      flow_run_id: null,
      flow_run_url: null,
      new_step_function: null,
      eta_minutes: eta?.avg_minutes ?? failure?.eta_minutes ?? null,
      eta_basis: eta
        ? `Average of last ${eta.samples} ${failure?.mode} syncs for orgIntegration ${failure?.org_integration_id}`
        : null,
      expected_completion_at: eta?.avg_minutes
        ? new Date(Date.now() + eta.avg_minutes * 60_000).toISOString()
        : null,
      event_payload: null,
      timeline: [
        {
          at: triggeredAt,
          event: "trigger_requested",
          detail: "User clicked retrigger from UI",
        },
      ],
    };
    await storage.putJsonAtomic(
      envKey(env, "runs", `${syncId}.json`),
      runDoc
    );
    return runDoc;
  },

  /**
   * Mark-complete is the script's job (it talks to mongo). The UI just
   * records intent in the same triggers/ inbox.
   */
  async requestMarkComplete({ env, syncId, failure, message }) {
    const requestedAt = new Date().toISOString();
    await storage.putJsonAtomic(
      envKey(env, "triggers", `${syncId}.mark_complete.json`),
      {
        sync_id: syncId,
        de_sync_status_id: failure?.de_sync_status_id ?? null,
        org_integration_id: failure?.org_integration_id ?? null,
        mode: failure?.mode ?? null,
        action: "mark_complete",
        message: message ?? failure?.action_reason ?? "auto_recovered via UI",
        requested_at: requestedAt,
        requested_by: "ui",
        consumed: false,
      }
    );
    return { ok: true, requested_at: requestedAt };
  },

  /**
   * Fan out a list of actions. Never throws on partial failure.
   */
  async runBulk({ env, actions }) {
    const results = [];
    for (const a of actions ?? []) {
      try {
        if (a.action === "retrigger") {
          await this.requestTrigger({
            env,
            syncId: a.sync_id,
            failure: a.failure,
          });
        } else if (a.action === "mark_complete") {
          await this.requestMarkComplete({
            env,
            syncId: a.sync_id,
            failure: a.failure,
            message: a.message,
          });
        } else {
          throw new Error(`unsupported action: ${a.action}`);
        }
        results.push({ sync_id: a.sync_id, action: a.action, ok: true });
      } catch (e) {
        results.push({
          sync_id: a.sync_id,
          action: a.action,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return {
      ok: results.every((r) => r.ok),
      ran_at: new Date().toISOString(),
      count: results.length,
      results,
    };
  },
};

async function safeEtaLookup(env, failure) {
  if (!failure?.org_integration_id || !failure?.mode) return null;
  const cache = await storage.getJson(envKey(env, "eta_cache.json"));
  return (
    cache?.entries?.[`${failure.org_integration_id}:${failure.mode}`] ?? null
  );
}

export default dataDal;
