import { Router } from "express";
import dal from "../dal/index.js";
import storage from "../dal/storage.js";
import { shared } from "../dal/shared.js";
import { fetchEpicChildren, jiraConfig } from "../dal/jira.js";
import { rca } from "../dal/rca.js";
import { requireAuth, requireRole } from "../auth.js";
import { refreshStatuses } from "../recovery/refreshStatuses.js";

/**
 * Persist a manual override of error_tags for a failure. Writes through the
 * unified storage layer (local-fs or S3) so override surviving the next
 * discover tick is the same on both backends:
 *   1. <env>/ui_data/failure_tag_overrides.json — the persistent record;
 *      discover.py reads this and re-applies on every tick.
 *   2. <env>/ui_data/failures_latest.json — patched in place so the UI sees
 *      the change immediately.
 */
async function setFailureTagOverride({ env, deSyncStatusId, tags, setBy }) {
  const overrideKey = `${env}/ui_data/failure_tag_overrides.json`;
  const failuresKey = `${env}/ui_data/failures_latest.json`;

  const overrides = (await storage.getJson(overrideKey)) ?? { items: {} };
  overrides.items = overrides.items ?? {};
  overrides.items[deSyncStatusId] = {
    tags,
    set_by: setBy,
    set_at: new Date().toISOString(),
  };
  await storage.putJsonAtomic(overrideKey, overrides);

  const failures = await storage.getJson(failuresKey);
  if (failures && Array.isArray(failures.failures)) {
    const idx = failures.failures.findIndex(
      (f) => f.de_sync_status_id === deSyncStatusId
    );
    if (idx >= 0) {
      failures.failures[idx] = {
        ...failures.failures[idx],
        error_tags: tags,
      };
      await storage.putJsonAtomic(failuresKey, failures);
    }
  }
}

const router = Router();

const SUPPORTED_ENVS = ["dev", "prod"];

// Every /api endpoint requires a signed-in user. /api/auth/* is mounted
// separately on the app and stays open for login/logout/me.
router.use(requireAuth);

const adminOnly = requireRole("admin");

/**
 * Block recovery writes in prod until the platform team grants mongo prod
 * write credentials. Toggle on by setting PROD_WRITES_ENABLED=true.
 *
 * The 503 is intentional: dev still works, this is a configuration gap that
 * will be lifted later, not a permission denial. Surfaces as a friendly
 * toast in the UI via api/client.ts → ApiError.
 */
const PROD_WRITES_ENABLED =
  String(process.env.PROD_WRITES_ENABLED ?? "false").toLowerCase() === "true";

function prodWriteGuard(req, res, next) {
  const env = (req.query?.env ?? "").toString();
  if (env === "prod" && !PROD_WRITES_ENABLED) {
    return res.status(503).json({
      error:
        "Production recovery actions are disabled — this app doesn't have mongo prod write credentials yet. Run actions in dev, or coordinate with the platform team to enable prod writes.",
      code: "prod_writes_not_configured",
      env,
    });
  }
  next();
}

/**
 * RCA edits are admin OR (owner or reviewer of that specific doc). Resolves
 * the doc, then runs requireRole('admin') equivalent if user isn't owner/reviewer.
 */
async function rcaWriteGuard(req, res, next) {
  if (req.user?.role === "admin") return next();
  try {
    const doc = await rca.get(req.params.id, { withContent: false });
    const me = req.user?.email;
    if (me && (doc.owner === me || doc.reviewer === me)) return next();
    return res
      .status(403)
      .json({ error: "forbidden", reason: "admin or owner/reviewer only" });
  } catch (e) {
    return next(e);
  }
}

// (Python subprocess scaffolding removed — recovery is now native Node.)

function asyncHandler(fn) {
  return (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
}

// Pulls and validates ?env=dev|prod (defaults to "dev"). 400 if junk.
function envOf(req) {
  const env = (req.query.env ?? req.body?.env ?? "dev").toString();
  if (!SUPPORTED_ENVS.includes(env)) {
    const err = new Error(
      `Unsupported env "${env}"; expected one of: ${SUPPORTED_ENVS.join(", ")}`
    );
    err.status = 400;
    throw err;
  }
  return env;
}

router.get(
  "/health",
  asyncHandler(async (_req, res) => {
    res.json({
      ok: true,
      ts: new Date().toISOString(),
      supported_envs: SUPPORTED_ENVS,
    });
  })
);

// Apply the ignore list at read time as well as at discovery time. Without
// this, adding an entry in Settings only takes effect on the next discover
// tick, so the user keeps seeing failures they just hid.
//
// `bad_requests` and `active_runs` only carry org_integration_id (no org_id),
// so for kind=org ignores we resolve org_int → org_id from the failures file
// (every failure carries both ids). Orgs with no recent failures won't be in
// the map; that's an acceptable corner case — discover.py is the source of
// truth on the next tick.
async function buildIgnoreContext(env) {
  const items = await shared.listIgnoreList({ env });
  const orgIds = new Set();
  const orgIntegrationIds = new Set();
  for (const it of items) {
    if (!it?.target_id) continue;
    if (it.kind === "org") orgIds.add(it.target_id);
    else if (it.kind === "orgIntegration") orgIntegrationIds.add(it.target_id);
  }
  const hasAny = orgIds.size + orgIntegrationIds.size > 0;
  let orgIntToOrg = null;
  if (hasAny && orgIds.size) {
    try {
      const failures = await dal.getFailures({ env });
      orgIntToOrg = new Map();
      for (const f of failures?.failures ?? []) {
        if (f.org_integration_id && f.org_id) {
          orgIntToOrg.set(f.org_integration_id, f.org_id);
        }
      }
    } catch {
      orgIntToOrg = new Map();
    }
  }
  return { orgIds, orgIntegrationIds, hasAny, orgIntToOrg };
}

function isIgnoredFailure(f, ctx) {
  return ctx.orgIds.has(f.org_id) || ctx.orgIntegrationIds.has(f.org_integration_id);
}

function isIgnoredByOrgInt(orgInt, ctx) {
  if (!orgInt) return false;
  if (ctx.orgIntegrationIds.has(orgInt)) return true;
  if (ctx.orgIntToOrg) {
    const orgId = ctx.orgIntToOrg.get(orgInt);
    if (orgId && ctx.orgIds.has(orgId)) return true;
  }
  return false;
}

function summarize(failures) {
  const by_action = {};
  const by_mode = {};
  for (const f of failures) {
    const a = f.recommended_action;
    if (a) by_action[a] = (by_action[a] ?? 0) + 1;
    if (f.mode) by_mode[f.mode] = (by_mode[f.mode] ?? 0) + 1;
  }
  return { total: failures.length, by_action, by_mode };
}

router.get(
  "/failures",
  asyncHandler(async (req, res) => {
    const env = envOf(req);
    const payload = await dal.getFailures({ env });
    const ctx = await buildIgnoreContext(env);
    if (!ctx.hasAny || !Array.isArray(payload?.failures)) {
      return res.json(payload);
    }
    const kept = payload.failures.filter((f) => !isIgnoredFailure(f, ctx));
    res.json({ ...payload, failures: kept, summary: summarize(kept) });
  })
);

router.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const env = envOf(req);
    const payload = await dal.getStats({ env });
    const ctx = await buildIgnoreContext(env);
    if (!ctx.hasAny || !payload) return res.json(payload);
    // Aggregate counts (summary, by_date, by_hour, by_integration) can't be
    // accurately re-derived without raw window docs — leave them stale until
    // next discover. We can at least filter the per-orgInt repeat-failure list.
    const filtered = { ...payload };
    if (Array.isArray(payload.repeat_failure_top)) {
      filtered.repeat_failure_top = payload.repeat_failure_top.filter(
        (r) => !isIgnoredByOrgInt(r.orgIntegrationId, ctx)
      );
    }
    res.json(filtered);
  })
);

router.get(
  "/eta",
  asyncHandler(async (req, res) => {
    res.json(await dal.getEtaCache({ env: envOf(req) }));
  })
);

router.get(
  "/bad-requests",
  asyncHandler(async (req, res) => {
    const env = envOf(req);
    const payload = await dal.getBadRequests({ env });
    const ctx = await buildIgnoreContext(env);
    if (!ctx.hasAny || !Array.isArray(payload?.items)) {
      return res.json(payload);
    }
    const kept = payload.items.filter(
      (it) => !isIgnoredByOrgInt(it.org_integration_id, ctx)
    );
    res.json({ ...payload, items: kept, total: kept.length });
  })
);

router.get(
  "/active-runs",
  asyncHandler(async (req, res) => {
    const env = envOf(req);
    const payload = await dal.listActiveRuns({ env });
    const ctx = await buildIgnoreContext(env);
    if (!ctx.hasAny || !Array.isArray(payload?.items)) {
      return res.json(payload);
    }
    const kept = payload.items.filter(
      (r) => !isIgnoredByOrgInt(r.org_integration_id, ctx)
    );
    res.json({ ...payload, items: kept, count: kept.length });
  })
);

router.get(
  "/runs/:syncId",
  asyncHandler(async (req, res) => {
    const run = await dal.getRun({
      env: envOf(req),
      syncId: req.params.syncId,
    });
    if (!run) return res.status(404).json({ error: "run_not_found" });
    res.json(run);
  })
);

router.post(
  "/trigger/:syncId",
  adminOnly,
  prodWriteGuard,
  asyncHandler(async (req, res) => {
    const env = envOf(req);
    const failure = req.body?.failure ?? null;
    const run = await dal.requestTrigger({
      env,
      syncId: req.params.syncId,
      failure,
    });
    res.json(run);
  })
);

router.post(
  "/mark-complete/:syncId",
  adminOnly,
  prodWriteGuard,
  asyncHandler(async (req, res) => {
    const env = envOf(req);
    const failure = req.body?.failure ?? null;
    const message = req.body?.message ?? null;
    const result = await dal.requestMarkComplete({
      env,
      syncId: req.params.syncId,
      failure,
      message,
    });
    res.json(result);
  })
);

router.post(
  "/refresh-statuses",
  adminOnly,
  // Read-only on mongo (queries current status of in-flight syncs and
  // updates the JSON payload). Not a recovery write; no prod gate.
  asyncHandler(async (req, res) => {
    const env = envOf(req);
    const summary = await refreshStatuses({ env });
    // Re-read the (now-updated) failures payload so the UI gets fresh rows
    // in the same response.
    const failures = await dal.getFailures({ env });
    res.json({ ...failures, refresh_summary: summary });
  })
);

// ── labels ────────────────────────────────────────────────────────────────
router.get(
  "/labels",
  asyncHandler(async (_req, res) => {
    res.json({ items: await shared.listLabels() });
  })
);

router.post(
  "/labels",
  adminOnly,
  asyncHandler(async (req, res) => {
    const { name, color } = req.body ?? {};
    res.json(await shared.createLabel({ name, color }));
  })
);

router.delete(
  "/labels/:id",
  adminOnly,
  asyncHandler(async (req, res) => {
    res.json(await shared.deleteLabel(req.params.id));
  })
);

// ── releases ──────────────────────────────────────────────────────────────
router.get(
  "/releases",
  asyncHandler(async (_req, res) => {
    res.json({ items: await shared.listReleases() });
  })
);

router.post(
  "/releases",
  adminOnly,
  asyncHandler(async (req, res) => {
    const { name, jira_url, released_on } = req.body ?? {};
    res.json(await shared.createRelease({ name, jira_url, released_on }));
  })
);

router.get(
  "/releases/:id",
  asyncHandler(async (req, res) => {
    const r = await shared.getRelease(req.params.id);
    if (!r) return res.status(404).json({ error: "release_not_found" });
    res.json(r);
  })
);

router.delete(
  "/releases/:id",
  adminOnly,
  asyncHandler(async (req, res) => {
    res.json(await shared.deleteRelease(req.params.id));
  })
);

router.get(
  "/jira/health",
  asyncHandler(async (_req, res) => {
    res.json({
      configured: jiraConfig.configured,
      base_url: jiraConfig.baseUrl,
      email: jiraConfig.email,
    });
  })
);

router.post(
  "/releases/:id/sync-from-jira",
  adminOnly,
  asyncHandler(async (req, res) => {
    const release = await shared.getRelease(req.params.id);
    if (!release) return res.status(404).json({ error: "release_not_found" });
    const issues = await fetchEpicChildren(release.jira_id);
    const result = await shared.syncBugsFromJira(release.id, issues);
    res.json(result);
  })
);

router.post(
  "/releases/:id/bugs",
  adminOnly,
  asyncHandler(async (req, res) => {
    const { jira_id, jira_url, title, label_ids } = req.body ?? {};
    res.json(
      await shared.addBug(req.params.id, { jira_id, jira_url, title, label_ids })
    );
  })
);

router.patch(
  "/releases/:id/bugs/:bugId",
  // Bug edits are mostly label assignments — keep these admin-only too
  adminOnly,
  asyncHandler(async (req, res) => {
    res.json(
      await shared.updateBug(req.params.id, req.params.bugId, req.body ?? {})
    );
  })
);

router.delete(
  "/releases/:id/bugs/:bugId",
  adminOnly,
  asyncHandler(async (req, res) => {
    res.json(await shared.deleteBug(req.params.id, req.params.bugId));
  })
);

// ── error tag rules (shared, env-less) ────────────────────────────────────
router.get(
  "/error-tag-rules",
  asyncHandler(async (_req, res) => {
    res.json({ items: await shared.listErrorTagRules() });
  })
);

router.put(
  "/error-tag-rules",
  adminOnly,
  asyncHandler(async (req, res) => {
    const items = req.body?.items;
    res.json(await shared.replaceErrorTagRules(items));
  })
);

// ── members (shared, env-less) ────────────────────────────────────────────
router.get(
  "/members",
  asyncHandler(async (_req, res) => {
    res.json({ items: await shared.listMembers() });
  })
);

router.post(
  "/members",
  adminOnly,
  asyncHandler(async (req, res) => {
    res.json(await shared.createMember(req.body ?? {}));
  })
);

router.patch(
  "/members/:id",
  adminOnly,
  asyncHandler(async (req, res) => {
    res.json(await shared.updateMember(req.params.id, req.body ?? {}));
  })
);

router.delete(
  "/members/:id",
  adminOnly,
  asyncHandler(async (req, res) => {
    res.json(await shared.deleteMember(req.params.id));
  })
);

// ── ignore list (per-env) ─────────────────────────────────────────────────
router.get(
  "/ignore-list",
  asyncHandler(async (req, res) => {
    res.json({ items: await shared.listIgnoreList({ env: envOf(req) }) });
  })
);

router.post(
  "/ignore-list",
  adminOnly,
  asyncHandler(async (req, res) => {
    res.json(
      await shared.addIgnoreEntry({
        env: envOf(req),
        ...(req.body ?? {}),
        added_by: req.user?.email ?? "system",
      })
    );
  })
);

router.delete(
  "/ignore-list/:id",
  adminOnly,
  asyncHandler(async (req, res) => {
    res.json(
      await shared.deleteIgnoreEntry({ env: envOf(req), id: req.params.id })
    );
  })
);

// ── RCA docs ──────────────────────────────────────────────────────────────
router.get(
  "/rca",
  asyncHandler(async (_req, res) => {
    res.json({ items: await rca.list() });
  })
);

router.get(
  "/rca/:id",
  asyncHandler(async (req, res) => {
    res.json(await rca.get(req.params.id));
  })
);

router.post(
  "/rca",
  // Members and admins can create/upload RCAs; viewers are read-only.
  // The UI mirrors this: viewers don't see the Create / Upload buttons.
  requireRole("admin", "member"),
  asyncHandler(async (req, res) => {
    const { name, filename, content, owner, reviewer, tags } = req.body ?? {};
    res.json(
      await rca.create({
        name,
        filename,
        content,
        owner: owner || req.user?.email || "",
        reviewer,
        tags,
      })
    );
  })
);

// Edit / delete: admin OR (this doc's owner or reviewer)
router.patch(
  "/rca/:id",
  asyncHandler(rcaWriteGuard),
  asyncHandler(async (req, res) => {
    res.json(await rca.update(req.params.id, req.body ?? {}));
  })
);

router.delete(
  "/rca/:id",
  asyncHandler(rcaWriteGuard),
  asyncHandler(async (req, res) => {
    res.json(await rca.remove(req.params.id));
  })
);

// Manual override of a failure's error_tags. Admin only. Persists across
// discovery ticks via failure_tag_overrides.json.
router.post(
  "/failures/:deSyncStatusId/tags",
  adminOnly,
  asyncHandler(async (req, res) => {
    const env = envOf(req);
    const tags = Array.isArray(req.body?.tags)
      ? req.body.tags
          .map((t) => String(t).trim())
          .filter((t) => t.length > 0)
      : null;
    if (!tags) {
      return res.status(400).json({ error: "tags must be an array of strings" });
    }
    await setFailureTagOverride({
      env,
      deSyncStatusId: req.params.deSyncStatusId,
      tags,
      setBy: req.user?.email ?? "system",
    });
    res.json({ ok: true, tags });
  })
);

router.post(
  "/rerun-all",
  adminOnly,
  prodWriteGuard,
  asyncHandler(async (req, res) => {
    const env = envOf(req);
    const actions = Array.isArray(req.body?.actions) ? req.body.actions : [];
    const result = await dal.runBulk({ env, actions });
    res.json(result);
  })
);

export default router;
