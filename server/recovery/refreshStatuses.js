import storage from "../dal/storage.js";
import { findStatusByIds } from "./queries.js";

/**
 * refresh-statuses — re-query mongo for currently in-flight rows only and
 * patch the JSON payload in place. Fast alternative to a full discover run.
 *
 * Touches only:
 *   - rows in failures_latest.json with current_status in {Running, Triggered, Not Started, Not Triggered}
 *   - runs/<sync_id>.json with status in {queued, running}
 *
 * Read-only against mongo. Mutations are JSON file updates.
 */

const STALE_FAILURE_STATUSES = new Set([
  "Running",
  "Triggered",
  "Not Started",
  "Not Triggered",
]);
const RUN_INFLIGHT_STATUSES = new Set(["queued", "running"]);

export async function refreshStatuses({ env }) {
  const startedAt = new Date();

  const failures = await storage.getJson(`${env}/ui_data/failures_latest.json`);
  if (!failures) {
    return { ok: false, error: "no_failures_file", env };
  }

  const rows = failures.failures ?? [];

  // 1. ids worth checking — failure rows in stale statuses
  const failureTargets = new Map();
  for (const r of rows) {
    if (STALE_FAILURE_STATUSES.has(r.current_status)) {
      failureTargets.set(r.de_sync_status_id, r);
    }
  }

  // 2. plus ids from in-flight runs files
  const runTargets = new Map(); // de_sync_status_id -> run doc
  const runKeys = new Map(); // de_sync_status_id -> storage key
  const runFiles = await storage.listKeys(`${env}/ui_data/runs/`);
  for (const key of runFiles) {
    if (!key.endsWith(".json")) continue;
    const run = await storage.getJson(key);
    if (!run) continue;
    if (!RUN_INFLIGHT_STATUSES.has(run.status)) continue;
    const deId = run.de_sync_status_id;
    if (deId) {
      runTargets.set(deId, run);
      runKeys.set(deId, key);
    }
  }

  const targetIds = new Set([...failureTargets.keys(), ...runTargets.keys()]);
  if (!targetIds.size) {
    return result({
      ok: true,
      env,
      checked: 0,
      completed: 0,
      status_changed: 0,
      runs_completed: 0,
      startedAt,
    });
  }

  // 3. one mongo find — primary-key index
  const current = await findStatusByIds({ env, deIds: [...targetIds] });

  // 4. apply: drop now-Completed, update status changes, mark runs completed
  const updatedRows = [];
  const completedDeIds = [];
  let statusChanged = 0;

  for (const row of rows) {
    const deId = row.de_sync_status_id;
    const cur = current.get(deId);
    if (!cur || !failureTargets.has(deId)) {
      updatedRows.push(row);
      continue;
    }
    const newStatus = cur.sync_status ?? row.current_status;
    const syncComplete = !!cur.sync_complete;
    if (syncComplete && newStatus === "Completed") {
      completedDeIds.push(deId);
      continue; // drop from failures
    }
    if (newStatus !== row.current_status) {
      updatedRows.push({ ...row, current_status: newStatus });
      statusChanged++;
    } else {
      updatedRows.push(row);
    }
  }

  failures.failures = updatedRows;
  failures.summary = summarize(updatedRows);
  failures.last_refreshed_at = startedAt.toISOString();
  await storage.putJsonAtomic(
    `${env}/ui_data/failures_latest.json`,
    failures
  );

  // 5. update runs/<id>.json for the ones that just completed
  let runsCompleted = 0;
  for (const [deId, run] of runTargets) {
    const cur = current.get(deId);
    if (!cur) continue;
    if (cur.sync_complete && cur.sync_status === "Completed") {
      const next = {
        ...run,
        status: "completed",
        timeline: [
          ...(run.timeline ?? []),
          {
            at: startedAt.toISOString(),
            event: "status_refreshed",
            detail: "Detected Completed in mongo on UI refresh.",
          },
        ],
      };
      await storage.putJsonAtomic(runKeys.get(deId), next);
      runsCompleted++;
    }
  }

  const out = result({
    ok: true,
    env,
    checked: targetIds.size,
    completed: completedDeIds.length,
    status_changed: statusChanged,
    runs_completed: runsCompleted,
    startedAt,
  });

  await storage.appendJsonl(`${env}/audit/runs.jsonl`, {
    ...out,
    phase: "refresh",
  });
  return out;
}

function summarize(rows) {
  const byAction = {};
  const byMode = {};
  for (const r of rows) {
    byAction[r.recommended_action ?? ""] =
      (byAction[r.recommended_action ?? ""] ?? 0) + 1;
    byMode[r.mode ?? ""] = (byMode[r.mode ?? ""] ?? 0) + 1;
  }
  return { total: rows.length, by_action: byAction, by_mode: byMode };
}

function result({ ok, env, checked, completed, status_changed, runs_completed, startedAt }) {
  const durationS =
    Math.round(((Date.now() - startedAt.getTime()) / 1000) * 100) / 100;
  return {
    ts: new Date().toISOString(),
    duration_s: durationS,
    ok,
    env,
    checked,
    completed,
    status_changed,
    runs_completed,
  };
}
