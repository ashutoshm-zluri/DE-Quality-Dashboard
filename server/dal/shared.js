/**
 * Env-less shared store. Backend-agnostic — every read and write goes through
 * storage.js, so flipping STORAGE_BACKEND between local and s3 is invisible
 * here.
 *
 * Logical layout:
 *   shared/labels.json
 *   shared/releases.json
 *   shared/error_tags.json
 *   shared/members.json
 *   <env>/ui_data/ignore_list.json   (per-env: org IDs differ in dev vs prod)
 */

import storage from "./storage.js";

const LABELS_KEY = "shared/labels.json";
const RELEASES_KEY = "shared/releases.json";
const ERROR_TAGS_KEY = "shared/error_tags.json";
const MEMBERS_KEY = "shared/members.json";

function ignoreListKey(env) {
  return `${env}/ui_data/ignore_list.json`;
}

const SUPPORTED_IGNORE_KINDS = new Set(["org", "orgIntegration"]);
const SUPPORTED_ROLES = new Set(["admin", "member", "viewer"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function newId(prefix) {
  // Short, readable, low-collision: prefix + 10 hex chars from random.
  const r = Math.random().toString(16).slice(2, 12).padEnd(10, "0");
  return `${prefix}_${r}`;
}

/** Convert "2026-04-15" or any Date-parsable string into {quarter, year}. */
function deriveQuarterYear(releasedOn) {
  if (!releasedOn) return { quarter: null, year: null };
  const d = new Date(releasedOn);
  if (Number.isNaN(d.getTime())) return { quarter: null, year: null };
  const month = d.getUTCMonth() + 1;
  return {
    quarter: Math.ceil(month / 3),
    year: d.getUTCFullYear(),
  };
}

/** Backfill quarter/year on legacy release docs that predate this schema. */
function ensureQuarterYear(release) {
  if (release.quarter && release.year) return release;
  const d = deriveQuarterYear(release.released_on);
  return {
    ...release,
    quarter: release.quarter ?? d.quarter,
    year: release.year ?? d.year,
  };
}

export const shared = {
  // ── labels ────────────────────────────────────────────────────────────────
  async listLabels() {
    const doc = (await storage.getJson(LABELS_KEY)) ?? { items: [] };
    return doc.items ?? [];
  },

  async createLabel({ name, color }) {
    const items = await this.listLabels();
    const trimmed = (name ?? "").trim();
    if (!trimmed) throw httpErr(400, "label name is required");
    if (items.some((l) => l.name.toLowerCase() === trimmed.toLowerCase())) {
      throw httpErr(409, `label "${trimmed}" already exists`);
    }
    const label = {
      id: newId("lbl"),
      name: trimmed,
      color: color ?? "neutral",
      created_at: new Date().toISOString(),
    };
    await storage.putJsonAtomic(LABELS_KEY, { items: [...items, label] });
    return label;
  },

  async deleteLabel(id) {
    const items = await this.listLabels();
    const next = items.filter((l) => l.id !== id);
    if (next.length === items.length) throw httpErr(404, "label not found");
    await storage.putJsonAtomic(LABELS_KEY, { items: next });
    // Also strip the label from any bugs that reference it so we don't leave
    // dangling label_ids around.
    const releases = await this.listReleases();
    let touched = false;
    const cleaned = releases.map((r) => ({
      ...r,
      bugs: (r.bugs ?? []).map((b) => {
        if (!(b.label_ids ?? []).includes(id)) return b;
        touched = true;
        return { ...b, label_ids: b.label_ids.filter((x) => x !== id) };
      }),
    }));
    if (touched) await storage.putJsonAtomic(RELEASES_KEY, { items: cleaned });
    return { ok: true };
  },

  // ── releases ──────────────────────────────────────────────────────────────
  async listReleases() {
    const doc = (await storage.getJson(RELEASES_KEY)) ?? { items: [] };
    const items = (doc.items ?? []).map(ensureQuarterYear);
    items.sort((a, b) => {
      const yA = a.year ?? 0;
      const yB = b.year ?? 0;
      if (yA !== yB) return yB - yA;
      const qA = a.quarter ?? 0;
      const qB = b.quarter ?? 0;
      if (qA !== qB) return qB - qA;
      const rA = a.released_on ?? a.created_at ?? "";
      const rB = b.released_on ?? b.created_at ?? "";
      return rB.localeCompare(rA);
    });
    return items;
  },

  async getRelease(id) {
    const items = await this.listReleases();
    return items.find((r) => r.id === id) ?? null;
  },

  async createRelease({ name, jira_url, released_on, quarter, year }) {
    const trimmedName = (name ?? "").trim();
    const trimmedUrl = (jira_url ?? "").trim();
    if (!trimmedName) throw httpErr(400, "release name is required");
    if (!trimmedUrl) throw httpErr(400, "jira_url is required");
    const jira_id = parseJiraId(trimmedUrl);
    if (!jira_id) {
      throw httpErr(400, `couldn't extract jira id from "${trimmedUrl}"`);
    }
    const items = await this.listReleases();
    if (items.some((r) => r.name.toLowerCase() === trimmedName.toLowerCase())) {
      throw httpErr(409, `release "${trimmedName}" already exists`);
    }

    const derived = deriveQuarterYear(released_on);
    const finalQuarter = Number(quarter) || derived.quarter;
    const finalYear = Number(year) || derived.year;
    if (finalQuarter !== null && (finalQuarter < 1 || finalQuarter > 4)) {
      throw httpErr(400, "quarter must be 1, 2, 3, or 4");
    }
    if (finalYear !== null && (finalYear < 2000 || finalYear > 3000)) {
      throw httpErr(400, "year must be a 4-digit year");
    }

    const release = {
      id: newId("rel"),
      name: trimmedName,
      jira_id,
      jira_url: trimmedUrl,
      released_on: released_on || null,
      quarter: finalQuarter ?? null,
      year: finalYear ?? null,
      created_at: new Date().toISOString(),
      bugs: [],
    };
    await storage.putJsonAtomic(RELEASES_KEY, { items: [...items, release] });
    return release;
  },

  async deleteRelease(id) {
    const items = await this.listReleases();
    const next = items.filter((r) => r.id !== id);
    if (next.length === items.length) throw httpErr(404, "release not found");
    await storage.putJsonAtomic(RELEASES_KEY, { items: next });
    return { ok: true };
  },

  // ── bugs (embedded under releases) ───────────────────────────────────────
  async addBug(releaseId, { jira_id, jira_url, title, label_ids }) {
    const items = await this.listReleases();
    const idx = items.findIndex((r) => r.id === releaseId);
    if (idx < 0) throw httpErr(404, "release not found");
    const trimmedTitle = (title ?? "").trim();
    const trimmedJira = (jira_id ?? "").trim();
    if (!trimmedTitle && !trimmedJira) {
      throw httpErr(400, "either jira_id or title is required");
    }
    const finalUrl =
      jira_url ||
      (trimmedJira
        ? `https://zluri.atlassian.net/browse/${trimmedJira}`
        : null);
    const bug = {
      id: newId("bug"),
      jira_id: trimmedJira || null,
      jira_url: finalUrl,
      title: trimmedTitle || trimmedJira,
      label_ids: Array.isArray(label_ids) ? label_ids : [],
      created_at: new Date().toISOString(),
    };
    const updated = [...items];
    updated[idx] = {
      ...updated[idx],
      bugs: [...(updated[idx].bugs ?? []), bug],
    };
    await storage.putJsonAtomic(RELEASES_KEY, { items: updated });
    return bug;
  },

  async updateBug(releaseId, bugId, patch) {
    const items = await this.listReleases();
    const idx = items.findIndex((r) => r.id === releaseId);
    if (idx < 0) throw httpErr(404, "release not found");
    const bugs = items[idx].bugs ?? [];
    const bidx = bugs.findIndex((b) => b.id === bugId);
    if (bidx < 0) throw httpErr(404, "bug not found");
    const next = { ...bugs[bidx] };
    if (patch.title !== undefined) next.title = String(patch.title).trim();
    if (patch.jira_id !== undefined) next.jira_id = String(patch.jira_id).trim();
    if (patch.label_ids !== undefined && Array.isArray(patch.label_ids)) {
      next.label_ids = patch.label_ids;
    }
    const updated = [...items];
    const newBugs = [...bugs];
    newBugs[bidx] = next;
    updated[idx] = { ...updated[idx], bugs: newBugs };
    await storage.putJsonAtomic(RELEASES_KEY, { items: updated });
    return next;
  },

  async deleteBug(releaseId, bugId) {
    const items = await this.listReleases();
    const idx = items.findIndex((r) => r.id === releaseId);
    if (idx < 0) throw httpErr(404, "release not found");
    const newBugs = (items[idx].bugs ?? []).filter((b) => b.id !== bugId);
    const updated = [...items];
    updated[idx] = { ...updated[idx], bugs: newBugs };
    await storage.putJsonAtomic(RELEASES_KEY, { items: updated });
    return { ok: true };
  },

  // ── error tag rules ────────────────────────────────────────────────────
  async listErrorTagRules() {
    const raw = (await storage.getJson(ERROR_TAGS_KEY)) ?? {};
    return Array.isArray(raw.rules) ? raw.rules : [];
  },

  async replaceErrorTagRules(rules) {
    if (!Array.isArray(rules)) throw httpErr(400, "rules must be an array");
    const seen = new Set();
    for (const r of rules) {
      const tag = (r?.tag ?? "").trim();
      const match = (r?.match ?? "").trim();
      if (!tag) throw httpErr(400, "tag is required for every rule");
      if (!match) throw httpErr(400, `match is required for "${tag}"`);
      if (seen.has(tag)) throw httpErr(400, `duplicate tag "${tag}"`);
      seen.add(tag);
      try {
        new RegExp(match);
      } catch (e) {
        throw httpErr(400, `invalid regex for "${tag}": ${e.message}`);
      }
    }
    const cleaned = rules.map((r) => ({
      tag: r.tag.trim(),
      match: r.match,
      color: (r.color ?? "neutral").trim() || "neutral",
    }));
    await storage.putJsonAtomic(ERROR_TAGS_KEY, { rules: cleaned });
    return { ok: true, count: cleaned.length };
  },

  // ── team members ───────────────────────────────────────────────────────
  async listMembers() {
    const raw = (await storage.getJson(MEMBERS_KEY)) ?? {};
    return Array.isArray(raw.items) ? raw.items : [];
  },

  async createMember({ email, name, role, designation }) {
    const trimmedEmail = (email ?? "").trim().toLowerCase();
    const trimmedName = (name ?? "").trim();
    const trimmedRole = (role ?? "member").trim();
    const trimmedDesignation = (designation ?? "").trim();

    if (!EMAIL_RE.test(trimmedEmail)) {
      throw httpErr(400, "valid email is required");
    }
    if (!trimmedName) throw httpErr(400, "name is required");
    if (!SUPPORTED_ROLES.has(trimmedRole)) {
      throw httpErr(
        400,
        `role must be one of ${[...SUPPORTED_ROLES].join(", ")}`
      );
    }

    const items = await this.listMembers();
    if (items.some((m) => m.email === trimmedEmail)) {
      throw httpErr(409, `member ${trimmedEmail} already exists`);
    }

    const now = new Date().toISOString();
    const member = {
      id: newId("mem"),
      email: trimmedEmail,
      name: trimmedName,
      role: trimmedRole,
      designation: trimmedDesignation,
      picture: null,
      created_at: now,
      updated_at: now,
    };
    await storage.putJsonAtomic(MEMBERS_KEY, { items: [...items, member] });
    return member;
  },

  async updateMember(id, patch) {
    const items = await this.listMembers();
    const idx = items.findIndex((m) => m.id === id);
    if (idx < 0) throw httpErr(404, "member not found");
    const cur = items[idx];
    const next = { ...cur };
    if (patch.email !== undefined) {
      const e = String(patch.email).trim().toLowerCase();
      if (!EMAIL_RE.test(e)) throw httpErr(400, "invalid email");
      if (items.some((m) => m.id !== id && m.email === e)) {
        throw httpErr(409, `another member already has email ${e}`);
      }
      next.email = e;
    }
    if (patch.name !== undefined) {
      const n = String(patch.name).trim();
      if (!n) throw httpErr(400, "name cannot be empty");
      next.name = n;
    }
    if (patch.role !== undefined) {
      const r = String(patch.role).trim();
      if (!SUPPORTED_ROLES.has(r)) {
        throw httpErr(400, "invalid role");
      }
      next.role = r;
    }
    if (patch.designation !== undefined) {
      next.designation = String(patch.designation).trim();
    }
    if (patch.picture !== undefined) {
      next.picture = patch.picture || null;
    }
    next.updated_at = new Date().toISOString();
    const updated = [...items];
    updated[idx] = next;
    await storage.putJsonAtomic(MEMBERS_KEY, { items: updated });
    return next;
  },

  async deleteMember(id) {
    const items = await this.listMembers();
    const next = items.filter((m) => m.id !== id);
    if (next.length === items.length) throw httpErr(404, "member not found");
    await storage.putJsonAtomic(MEMBERS_KEY, { items: next });
    return { ok: true };
  },

  // ── ignore list (per-env) ──────────────────────────────────────────────
  async listIgnoreList({ env }) {
    if (!env || (env !== "dev" && env !== "prod")) {
      throw httpErr(400, "env must be dev or prod");
    }
    const raw = (await storage.getJson(ignoreListKey(env))) ?? {};
    return Array.isArray(raw.items) ? raw.items : [];
  },

  async addIgnoreEntry({ env, kind, target_id, cached_name, comment, added_by }) {
    if (!env || (env !== "dev" && env !== "prod")) {
      throw httpErr(400, "env must be dev or prod");
    }
    if (!SUPPORTED_IGNORE_KINDS.has(kind)) {
      throw httpErr(400, `kind must be one of ${[...SUPPORTED_IGNORE_KINDS].join(", ")}`);
    }
    const tid = (target_id ?? "").trim();
    if (!tid) throw httpErr(400, "target_id is required");
    if (!/^[a-fA-F0-9]{24}$/.test(tid)) {
      throw httpErr(400, "target_id must be a 24-char Mongo ObjectId");
    }
    const items = await this.listIgnoreList({ env });
    if (items.some((x) => x.kind === kind && x.target_id === tid)) {
      throw httpErr(409, `${kind} ${tid} is already ignored`);
    }
    const entry = {
      id: newId("ign"),
      kind,
      target_id: tid,
      cached_name: (cached_name ?? "").trim(),
      comment: (comment ?? "").trim(),
      added_by: (added_by ?? "system").trim() || "system",
      added_at: new Date().toISOString(),
    };
    await storage.putJsonAtomic(ignoreListKey(env), { items: [...items, entry] });
    return entry;
  },

  async deleteIgnoreEntry({ env, id }) {
    const items = await this.listIgnoreList({ env });
    const next = items.filter((x) => x.id !== id);
    if (next.length === items.length) throw httpErr(404, "entry not found");
    await storage.putJsonAtomic(ignoreListKey(env), { items: next });
    return { ok: true };
  },

  /**
   * Replace a release's bugs[] with what Jira returns for its parent epic.
   * Existing bugs are matched by jira_id so any internal label_ids (the
   * Test gap / Unclear spec / etc. categorization the team has assigned)
   * are preserved across syncs.
   *
   * `jiraIssues` is whatever fetchEpicChildren() returned.
   */
  async syncBugsFromJira(releaseId, jiraIssues) {
    const items = await this.listReleases();
    const idx = items.findIndex((r) => r.id === releaseId);
    if (idx < 0) throw httpErr(404, "release not found");

    const existing = items[idx].bugs ?? [];
    const labelMemo = new Map(
      existing
        .filter((b) => b.jira_id)
        .map((b) => [b.jira_id, b.label_ids ?? []])
    );
    const idMemo = new Map(
      existing.filter((b) => b.jira_id).map((b) => [b.jira_id, b.id])
    );

    const newBugs = jiraIssues.map((j) => ({
      id: idMemo.get(j.jira_id) ?? newId("bug"),
      jira_id: j.jira_id,
      jira_url: j.jira_url,
      title: j.title,
      label_ids: labelMemo.get(j.jira_id) ?? [],
      jira_meta: j.jira_meta ?? null,
      created_at:
        existing.find((b) => b.jira_id === j.jira_id)?.created_at ??
        new Date().toISOString(),
    }));

    const updated = [...items];
    updated[idx] = {
      ...updated[idx],
      bugs: newBugs,
      last_synced_at: new Date().toISOString(),
    };
    await storage.putJsonAtomic(RELEASES_KEY, { items: updated });
    return {
      ok: true,
      bug_count: newBugs.length,
      release: updated[idx],
    };
  },
};

function parseJiraId(url) {
  const m = url.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/i);
  return m ? m[1].toUpperCase() : null;
}

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
