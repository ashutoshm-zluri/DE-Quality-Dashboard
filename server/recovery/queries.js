import { ObjectId } from "mongodb";
import { getDb } from "./mongoClient.js";

/**
 * Mongo data-access layer — read-only. Mirrors recovery/mongo_dal.py.
 *
 * Six queries per discovery tick:
 *   1. syncstatus.find         failed docs in window
 *   2. syncstatus.aggregate    latest Completed per (orgInt, mode)
 *   3. syncstatus.aggregate    latest of any status per (orgInt, mode)
 *   4. syncstatus.aggregate    last 10 Completed per (orgInt, mode)
 *   5. orgintegrationsyncs     IE pipeline responses for bad-request signal
 *   6. organizations + globalintegrations + orgintegrations name lookup
 *
 * Plus one extra query for stats: all docs in window.
 */

const ACTIONABLE_STATUSES = ["Failed", "Running", "Not Triggered", "Not Started"];
const SNAPSHOT_MODES = ["users_data", "other_static_data"];

const FAILURE_PROJECTION = {
  _id: 1,
  syncId: 1,
  mode: 1,
  sync_status: 1,
  sync_complete: 1,
  app_flag: 1,
  payment_flag: 1,
  archive: 1,
  createdAt: 1,
  updatedAt: 1,
  integrationId: 1,
  orgIntegrationId: 1,
  orgId: 1,
  error_reason: 1,
  step_function: 1,
  event: 1,
  s3Key: 1,
};

const STATS_PROJECTION = {
  _id: 1,
  sync_status: 1,
  sync_complete: 1,
  createdAt: 1,
  updatedAt: 1,
  integrationId: 1,
  orgIntegrationId: 1,
  mode: 1,
  error_reason: 1,
};

function toObjectIdArray(ids) {
  return ids
    .filter((x) => x)
    .map((x) => (x instanceof ObjectId ? x : new ObjectId(String(x))));
}

export async function findFailedInWindow({ env, windowDays, allowlist }) {
  const db = await getDb(env);
  const cutoff = new Date(Date.now() - windowDays * 86_400_000);
  const match = {
    sync_status: { $in: ACTIONABLE_STATUSES },
    createdAt: { $gte: cutoff },
  };
  if (allowlist?.length) {
    match.orgIntegrationId = { $in: toObjectIdArray(allowlist) };
  }
  return db.collection("syncstatus").find(match, { projection: FAILURE_PROJECTION }).toArray();
}

export async function latestCompletedPerOrgIntMode({ env, orgIntIds, modes = SNAPSHOT_MODES }) {
  const ids = toObjectIdArray(orgIntIds);
  if (!ids.length) return new Map();
  const db = await getDb(env);
  const cursor = db.collection("syncstatus").aggregate([
    {
      $match: {
        orgIntegrationId: { $in: ids },
        mode: { $in: modes },
        sync_status: "Completed",
        sync_complete: true,
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: { orgInt: "$orgIntegrationId", mode: "$mode" },
        sync_id: { $first: "$_id" },
        syncId: { $first: "$syncId" },
        createdAt: { $first: "$createdAt" },
        updatedAt: { $first: "$updatedAt" },
        sync_status: { $first: "$sync_status" },
        sync_complete: { $first: "$sync_complete" },
      },
    },
  ]);
  const out = new Map();
  for await (const row of cursor) {
    const key = `${row._id.orgInt}:${row._id.mode}`;
    out.set(key, {
      sync_id: String(row.sync_id),
      syncId: String(row.syncId ?? ""),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      sync_status: row.sync_status,
      sync_complete: row.sync_complete,
    });
  }
  return out;
}

export async function latestAnyPerOrgIntMode({ env, orgIntIds, modes = SNAPSHOT_MODES }) {
  const ids = toObjectIdArray(orgIntIds);
  if (!ids.length) return new Map();
  const db = await getDb(env);
  const cursor = db.collection("syncstatus").aggregate([
    {
      $match: {
        orgIntegrationId: { $in: ids },
        mode: { $in: modes },
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: { orgInt: "$orgIntegrationId", mode: "$mode" },
        sync_id: { $first: "$_id" },
        syncId: { $first: "$syncId" },
        createdAt: { $first: "$createdAt" },
        sync_status: { $first: "$sync_status" },
        sync_complete: { $first: "$sync_complete" },
      },
    },
  ]);
  const out = new Map();
  for await (const row of cursor) {
    const key = `${row._id.orgInt}:${row._id.mode}`;
    out.set(key, {
      sync_id: String(row.sync_id),
      syncId: String(row.syncId ?? ""),
      createdAt: row.createdAt,
      sync_status: row.sync_status,
      sync_complete: !!row.sync_complete,
    });
  }
  return out;
}

export async function lastNCompletedForEta({ env, orgIntIds, modes, n = 10 }) {
  const ids = toObjectIdArray(orgIntIds);
  if (!ids.length || !modes?.length) return [];
  const db = await getDb(env);
  const cursor = db.collection("syncstatus").aggregate([
    {
      $match: {
        orgIntegrationId: { $in: ids },
        mode: { $in: modes },
        sync_status: "Completed",
        sync_complete: true,
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: { orgInt: "$orgIntegrationId", mode: "$mode" },
        items: {
          $push: { sync_id: "$_id", createdAt: "$createdAt", updatedAt: "$updatedAt" },
        },
      },
    },
    { $project: { items: { $slice: ["$items", n] } } },
  ]);
  const out = [];
  for await (const row of cursor) {
    const orgInt = String(row._id.orgInt);
    const mode = row._id.mode;
    for (const item of row.items) {
      out.push({
        sync_id: String(item.sync_id),
        org_integration_id: orgInt,
        mode,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt ?? item.createdAt,
      });
    }
  }
  return out;
}

export async function findIePipelineResponses({ env, syncIds }) {
  const ids = toObjectIdArray(syncIds);
  if (!ids.length) return new Map();
  const db = await getDb(env);
  const cursor = db.collection("orgintegrationsyncs").find(
    { _id: { $in: ids } },
    {
      projection: {
        _id: 1,
        dePipelineResponse: 1,
        start_time: 1,
        end_time: 1,
        created_on: 1,
        status: 1,
      },
    }
  );
  const out = new Map();
  for await (const row of cursor) out.set(String(row._id), row);
  return out;
}

export async function findAllInWindowForStats({ env, windowDays, allowlist }) {
  const db = await getDb(env);
  const cutoff = new Date(Date.now() - windowDays * 86_400_000);
  const match = { createdAt: { $gte: cutoff } };
  if (allowlist?.length) {
    match.orgIntegrationId = { $in: toObjectIdArray(allowlist) };
  }
  return db
    .collection("syncstatus")
    .find(match, { projection: STATS_PROJECTION })
    .toArray();
}

export async function findStatusByIds({ env, deIds }) {
  const ids = toObjectIdArray(deIds);
  if (!ids.length) return new Map();
  const db = await getDb(env);
  const cursor = db.collection("syncstatus").find(
    { _id: { $in: ids } },
    {
      projection: {
        _id: 1,
        syncId: 1,
        sync_status: 1,
        sync_complete: 1,
        updatedAt: 1,
      },
    }
  );
  const out = new Map();
  for await (const row of cursor) out.set(String(row._id), row);
  return out;
}

export async function fetchNames({ env, orgIds, integrationIds, orgIntIds }) {
  const db = await getDb(env);
  const orgs = toObjectIdArray(orgIds ?? []);
  const ints = toObjectIdArray(integrationIds ?? []);
  const ois = toObjectIdArray(orgIntIds ?? []);

  const [orgRows, intRows, oiRows] = await Promise.all([
    orgs.length
      ? db
          .collection("organizations")
          .find({ _id: { $in: orgs } }, { projection: { name: 1 } })
          .toArray()
      : [],
    ints.length
      ? db
          .collection("globalintegrations")
          .find(
            { _id: { $in: ints } },
            { projection: { name: 1, application_id: 1 } }
          )
          .toArray()
      : [],
    ois.length
      ? db
          .collection("orgintegrations")
          .find(
            { _id: { $in: ois } },
            { projection: { name: 1, sdkInstanceMeta: 1 } }
          )
          .toArray()
      : [],
  ]);

  const organizations = {};
  for (const r of orgRows) organizations[String(r._id)] = { name: r.name ?? "" };

  const globalintegrations = {};
  for (const r of intRows) {
    globalintegrations[String(r._id)] = {
      name: r.name ?? "",
      application_id: r.application_id ? String(r.application_id) : "",
    };
  }

  const orgintegrations = {};
  for (const r of oiRows) {
    orgintegrations[String(r._id)] = {
      name: r.name ?? "",
      sdkInstanceMeta: r.sdkInstanceMeta ?? {},
    };
  }

  return { organizations, globalintegrations, orgintegrations };
}
