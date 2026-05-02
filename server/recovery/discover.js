import storage from "../dal/storage.js";
import { classify } from "./classify.js";
import { computeEtaTable } from "./eta.js";
import { loadTagger } from "./errorTags.js";
import {
  fetchNames,
  findAllInWindowForStats,
  findFailedInWindow,
  findIePipelineResponses,
  lastNCompletedForEta,
  latestAnyPerOrgIntMode,
  latestCompletedPerOrgIntMode,
} from "./queries.js";
import { computeStats } from "./stats.js";

/**
 * Phase 1 — read-only discovery, ported from recovery/discover.py.
 *
 * Pulls failures + context from mongo, runs the classifier, writes JSON
 * payloads to S3 (or local-fs). Never mutates mongo.
 *
 * Output:
 *   <env>/ui_data/failures_latest.json
 *   <env>/ui_data/eta_cache.json
 *   <env>/ui_data/bad_requests.json
 *   <env>/ui_data/stats.json
 *   <env>/audit/runs.jsonl                 (appended)
 */

const IN_PROGRESS_STATUSES = new Set(["Running", "Not Started", "Not Triggered"]);
const IE_BAD_STATUS_CODES = new Set([400, 403, 105]);

const DEV_SAFE_ALLOWLIST = (process.env.DEV_SAFE_ALLOWLIST ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const DISCOVERY_WINDOW_DAYS = Number(
  process.env.DISCOVERY_WINDOW_DAYS ?? "30"
);
const STALENESS_HOURS = Number(process.env.STALENESS_HOURS ?? "48");

function newRunId() {
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/Z$/, "Z");
  const rand = Math.random().toString(16).slice(2, 6);
  return `rec_${ts}_${rand}`;
}

function resolveAllowlist({ devSafe, extraAllowlist }) {
  const extra = Array.isArray(extraAllowlist) ? extraAllowlist : [];
  if (devSafe) {
    return Array.from(new Set([...DEV_SAFE_ALLOWLIST, ...extra]));
  }
  return extra;
}

async function readIgnoreList(env) {
  const raw = await storage.getJson(`${env}/ui_data/ignore_list.json`);
  const orgIntegrationIds = new Set();
  const orgIds = new Set();
  for (const entry of raw?.items ?? []) {
    const tid = entry?.target_id;
    if (typeof tid !== "string") continue;
    if (entry.kind === "orgIntegration") orgIntegrationIds.add(tid);
    else if (entry.kind === "org") orgIds.add(tid);
  }
  return { orgIntegrationIds, orgIds };
}

function isIgnored(doc, ignore) {
  const orgInt = String(doc.orgIntegrationId ?? "");
  const org = String(doc.orgId ?? "");
  return ignore.orgIntegrationIds.has(orgInt) || ignore.orgIds.has(org);
}

function isRecentInProgress(doc, cutoff) {
  if (!IN_PROGRESS_STATUSES.has(doc.sync_status)) return false;
  const created = doc.createdAt instanceof Date ? doc.createdAt : null;
  if (!created) return false;
  return created > cutoff;
}

function badRequestSet(responses) {
  const out = new Set();
  for (const [syncId, ie] of responses) {
    for (const resp of ie.dePipelineResponse ?? []) {
      const code = resp?.statusCode;
      if (typeof code === "number" && IE_BAD_STATUS_CODES.has(code)) {
        out.add(syncId);
        break;
      }
    }
  }
  return out;
}

function ieTimingTable(responses) {
  const out = new Map();
  for (const [syncId, ie] of responses) {
    const start = ie.start_time ?? ie.created_on;
    const end = ie.end_time;
    let mins = 0;
    if (typeof start === "number" && typeof end === "number") {
      mins = Math.max(0, (end - start) / 1000 / 60);
    }
    out.set(syncId, {
      start_ms: typeof start === "number" ? start : null,
      end_ms: typeof end === "number" ? end : null,
      ie_minutes: round2(mins),
    });
  }
  return out;
}

async function inflightSyncIds(env) {
  const keys = await storage.listKeys(`${env}/ui_data/runs/`);
  const out = new Set();
  for (const key of keys) {
    if (!key.endsWith(".json")) continue;
    const doc = await storage.getJson(key);
    if (!doc) continue;
    if ((doc.status === "queued" || doc.status === "running") && doc.sync_id) {
      out.add(String(doc.sync_id));
    }
  }
  return out;
}

function buildFailureRow({
  doc,
  action,
  reason,
  names,
  etaTable,
  latestCompleted,
  ieTiming,
  ieBad,
}) {
  const orgInt = String(doc.orgIntegrationId);
  const mode = doc.mode ?? "";
  const syncId = String(doc.syncId);

  const orgIdStr = doc.orgId ? String(doc.orgId) : "";
  const integrationIdStr = doc.integrationId ? String(doc.integrationId) : "";

  const orgName = names.organizations[orgIdStr]?.name ?? "";
  const integrationName = names.globalintegrations[integrationIdStr]?.name ?? "";
  const integrationInstanceName = names.orgintegrations[orgInt]?.name ?? "";

  const etaEntry = etaTable[`${orgInt}:${mode}`];
  const etaMinutes = etaEntry?.avg_minutes ?? null;

  const latestForMode = latestCompleted.get(`${orgInt}:${mode}`);

  const created = doc.createdAt instanceof Date ? doc.createdAt : null;
  const updated = doc.updatedAt instanceof Date ? doc.updatedAt : null;
  let deMinutes = 0;
  if (created && updated) {
    deMinutes = Math.max(0, (updated.getTime() - created.getTime()) / 60_000);
  }

  const ieMinutes = ieTiming.get(syncId)?.ie_minutes ?? 0;

  return {
    de_sync_status_id: String(doc._id),
    sync_id: syncId,
    org_integration_id: orgInt,
    org_id: orgIdStr,
    integration_id: integrationIdStr,
    org_name: orgName,
    integration_instance_name: integrationInstanceName,
    integration_name: integrationName,
    mode,
    current_status: doc.sync_status ?? "Failed",
    ie_start_date: created ? isoDate(created) : "",
    ie_end_date: updated ? isoDate(updated) : created ? isoDate(created) : "",
    time_taken_by_ie_in_mins: round2(ieMinutes),
    time_taken_by_de_in_mins: round2(deMinutes),
    step_function: doc.step_function ?? null,
    is_IE_bad_request: ieBad.has(syncId),
    latest_sync_timestamp:
      latestForMode?.createdAt instanceof Date
        ? latestForMode.createdAt.toISOString()
        : null,
    recommended_action: action,
    action_reason: reason,
    error_reason: doc.error_reason ?? "",
    createdAt: created?.toISOString() ?? null,
    updatedAt: updated?.toISOString() ?? null,
    s3_key: doc.s3Key ?? "",
    app_flag: !!doc.app_flag,
    payment_flag: !!doc.payment_flag,
    eta_minutes: etaMinutes,
    trigger_state: null,
  };
}

function summarize(rows) {
  const byAction = {};
  const byMode = {};
  for (const r of rows) {
    byAction[r.recommended_action] = (byAction[r.recommended_action] ?? 0) + 1;
    byMode[r.mode] = (byMode[r.mode] ?? 0) + 1;
  }
  return { total: rows.length, by_action: byAction, by_mode: byMode };
}

function buildBadRequestsPayload({
  rows,
  ieResponses,
  startedAt,
  windowDays,
}) {
  const items = [];
  for (const r of rows) {
    if (!r.is_IE_bad_request) continue;
    const ie = ieResponses.get(r.sync_id) ?? {};
    let code = null;
    for (const resp of ie.dePipelineResponse ?? []) {
      const sc = resp?.statusCode;
      if (typeof sc === "number" && IE_BAD_STATUS_CODES.has(sc)) {
        code = sc;
        break;
      }
    }
    items.push({
      de_sync_status_id: r.de_sync_status_id,
      sync_id: r.sync_id,
      org_integration_id: r.org_integration_id,
      org_name: r.org_name,
      integration_instance_name: r.integration_instance_name,
      integration_name: r.integration_name,
      mode: r.mode,
      ie_end_date: r.ie_end_date,
      validator_status_code: code,
      validator_message: r.error_reason ?? "",
      createdAt: r.createdAt,
    });
  }
  const windowStart = new Date(startedAt.getTime() - windowDays * 86_400_000);
  return {
    generated_at: startedAt.toISOString(),
    window: { start: isoDate(windowStart), end: isoDate(startedAt) },
    total: items.length,
    items,
  };
}

export async function discover({ env, devSafe = false, extraAllowlist = [] } = {}) {
  const startedAt = new Date();
  const runId = newRunId();
  const allowlist = resolveAllowlist({ devSafe, extraAllowlist });

  // ── ignore list
  const ignore = await readIgnoreList(env);

  // ── 1. failed docs in window
  let rawDocs = await findFailedInWindow({
    env,
    windowDays: DISCOVERY_WINDOW_DAYS,
    allowlist,
  });
  rawDocs = rawDocs.filter((d) => !isIgnored(d, ignore));

  const stalenessCutoff = new Date(
    startedAt.getTime() - STALENESS_HOURS * 3_600_000
  );
  const failedDocs = rawDocs.filter((d) => !isRecentInProgress(d, stalenessCutoff));
  const skippedInProgress = rawDocs.length - failedDocs.length;

  const orgIntIds = Array.from(
    new Set(failedDocs.map((d) => String(d.orgIntegrationId)))
  );
  const orgIds = Array.from(
    new Set(failedDocs.map((d) => d.orgId).filter(Boolean).map(String))
  );
  let integrationIds = Array.from(
    new Set(
      failedDocs.map((d) => d.integrationId).filter(Boolean).map(String)
    )
  );
  const syncIdsStr = failedDocs.map((d) => String(d.syncId));

  // ── 2-4 parallel mongo aggregations
  const [latestCompleted, latestAny] = await Promise.all([
    latestCompletedPerOrgIntMode({ env, orgIntIds }),
    latestAnyPerOrgIntMode({ env, orgIntIds }),
  ]);

  const failedModes = Array.from(
    new Set(failedDocs.map((d) => d.mode).filter(Boolean))
  ).sort();
  const completedForEta = await lastNCompletedForEta({
    env,
    orgIntIds,
    modes: failedModes,
    n: 10,
  });
  const etaTable = computeEtaTable(completedForEta, { lastN: 10 });

  // ── error tagger + manual overrides
  const tagger = await loadTagger();
  const overridesDoc =
    (await storage.getJson(`${env}/ui_data/failure_tag_overrides.json`)) ?? {};
  const tagOverrides = overridesDoc.items ?? {};

  // ── 5. IE pipeline responses
  const ieResponses = await findIePipelineResponses({
    env,
    syncIds: syncIdsStr,
  });
  const ieBad = badRequestSet(ieResponses);
  const ieTiming = ieTimingTable(ieResponses);

  // ── stats query (full window — same index as failed query)
  let statsDocs = await findAllInWindowForStats({
    env,
    windowDays: DISCOVERY_WINDOW_DAYS,
    allowlist,
  });
  if (ignore.orgIntegrationIds.size || ignore.orgIds.size) {
    statsDocs = statsDocs.filter((d) => !isIgnored(d, ignore));
  }

  const statsIntegrationIds = Array.from(
    new Set(statsDocs.map((d) => d.integrationId).filter(Boolean).map(String))
  ).sort();
  integrationIds = Array.from(
    new Set([...integrationIds, ...statsIntegrationIds])
  ).sort();

  // ── 6. names
  const names = await fetchNames({
    env,
    orgIds,
    integrationIds,
    orgIntIds,
  });

  // ── inflight set
  const inFlightSyncIds = await inflightSyncIds(env);

  // ── classify + assemble UI rows
  const ctx = {
    now: startedAt,
    windowDays: DISCOVERY_WINDOW_DAYS,
    latestCompleted,
    latestAny,
    ieBadRequestSyncIds: ieBad,
    inFlightSyncIds,
  };

  const rows = [];
  for (const doc of failedDocs) {
    const [action, reason] = classify(doc, ctx);
    const row = buildFailureRow({
      doc,
      action,
      reason,
      names,
      etaTable,
      latestCompleted,
      ieTiming,
      ieBad,
    });
    const override = tagOverrides[row.de_sync_status_id];
    if (override && Array.isArray(override.tags)) {
      row.error_tags = [...override.tags];
    } else {
      row.error_tags = tagger.tag(row.error_reason);
    }
    rows.push(row);
  }

  const summary = summarize(rows);

  // ── write outputs (atomic via storage)
  const failuresPayload = {
    run_id: runId,
    generated_at: startedAt.toISOString(),
    env,
    summary,
    failures: rows,
  };
  await storage.putJsonAtomic(
    `${env}/ui_data/failures_latest.json`,
    failuresPayload
  );

  await storage.putJsonAtomic(`${env}/ui_data/eta_cache.json`, {
    generated_at: startedAt.toISOString(),
    basis:
      "Average of last 10 Completed syncs (updatedAt - createdAt) per orgIntegration+mode",
    entries: etaTable,
  });

  await storage.putJsonAtomic(
    `${env}/ui_data/bad_requests.json`,
    buildBadRequestsPayload({
      rows,
      ieResponses,
      startedAt,
      windowDays: DISCOVERY_WINDOW_DAYS,
    })
  );

  const statsPayload = computeStats({
    docs: statsDocs,
    integrationNameMap: names.globalintegrations,
    ieBadCount: ieBad.size,
    startedAt,
    windowDays: DISCOVERY_WINDOW_DAYS,
    errorTagger: tagger,
  });
  await storage.putJsonAtomic(`${env}/ui_data/stats.json`, statsPayload);

  // ── audit log line
  const durationS = (Date.now() - startedAt.getTime()) / 1000;
  const auditLine = {
    run_id: runId,
    phase: "discover",
    env,
    started_at: startedAt.toISOString(),
    duration_s: round2(durationS),
    args: { dev_safe: devSafe, allowlist_len: allowlist.length },
    discover: {
      failed: rows.length,
      by_action: summary.by_action,
      by_mode: summary.by_mode,
      ie_bad_requests: ieBad.size,
      eta_buckets: Object.keys(etaTable).length,
      skipped_in_progress_under_threshold: skippedInProgress,
      staleness_hours: STALENESS_HOURS,
      stats_docs_loaded: statsDocs.length,
      stats_integrations: statsPayload.by_integration.length,
    },
  };
  await storage.appendJsonl(`${env}/audit/runs.jsonl`, auditLine);

  return auditLine;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function round2(v) {
  return Math.round(v * 100) / 100;
}
