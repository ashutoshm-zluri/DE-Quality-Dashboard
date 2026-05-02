import type {
  ActiveRunsResponse,
  BadRequestsResponse,
  Bug,
  BulkActionItem,
  BulkRunResponse,
  ErrorTagRule,
  Failure,
  FailuresResponse,
  IgnoreEntry,
  JiraHealth,
  Label,
  MemberRole,
  RcaDoc,
  RcaDocWithContent,
  Release,
  RunDetail,
  StatsResponse,
  TeamMember,
} from "../types";
import type { Env } from "./env";

/**
 * UI-side API client. Mirrors the server DAL surface so swapping local-fs
 * for S3 on the server is invisible here. Every call is env-scoped.
 *
 * Errors throw `ApiError` (extends Error) so the toast layer can branch on
 * `status` to render friendly messages for 401/403/5xx instead of dumping
 * the raw response body.
 */

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function withEnv(path: string, env: Env): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}env=${encodeURIComponent(env)}`;
}

async function readError(res: Response): Promise<{ msg: string; body: unknown }> {
  const text = await res.text().catch(() => "");
  let body: unknown = text;
  let msg = text;
  if (text) {
    try {
      const parsed = JSON.parse(text);
      body = parsed;
      if (parsed && typeof parsed === "object" && "error" in parsed) {
        msg = String((parsed as { error: unknown }).error);
      }
    } catch {
      /* not json */
    }
  }
  return { msg: msg || `HTTP ${res.status}`, body };
}

async function get<T>(path: string, env: Env): Promise<T> {
  const url = withEnv(path, env);
  const res = await fetch(url);
  if (!res.ok) {
    const { msg, body } = await readError(res);
    throw new ApiError(msg, res.status, body);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, env: Env, body?: unknown): Promise<T> {
  const url = withEnv(path, env);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const { msg, body: errBody } = await readError(res);
    throw new ApiError(msg, res.status, errBody);
  }
  return res.json() as Promise<T>;
}

async function getShared<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const { msg, body } = await readError(res);
    throw new ApiError(msg, res.status, body);
  }
  return res.json() as Promise<T>;
}

async function sharedRequest<T>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const { msg, body: errBody } = await readError(res);
    throw new ApiError(msg, res.status, errBody);
  }
  return res.json() as Promise<T>;
}

export const api = {
  failures: (env: Env) => get<FailuresResponse>("/api/failures", env),
  stats: (env: Env) => get<StatsResponse>("/api/stats", env),
  badRequests: (env: Env) => get<BadRequestsResponse>("/api/bad-requests", env),
  activeRuns: (env: Env) => get<ActiveRunsResponse>("/api/active-runs", env),
  run: (env: Env, syncId: string) =>
    get<RunDetail>(`/api/runs/${syncId}`, env),
  trigger: (env: Env, syncId: string, failure: Failure) =>
    post<RunDetail>(`/api/trigger/${syncId}`, env, { failure }),
  markComplete: (env: Env, syncId: string, failure: Failure, message?: string) =>
    post<{ ok: boolean; requested_at: string }>(
      `/api/mark-complete/${syncId}`,
      env,
      { failure, message }
    ),
  rerunAll: (env: Env, actions: BulkActionItem[]) =>
    post<BulkRunResponse>("/api/rerun-all", env, { actions }),
  /** Hits mongo: refreshes status for in-flight rows only. Returns the
   *  updated failures response plus a refresh_summary describing what changed. */
  refreshStatuses: (env: Env) =>
    post<FailuresResponse & { refresh_summary: { checked: number; completed: number; status_changed: number; runs_completed: number; duration_s: number } }>(
      "/api/refresh-statuses",
      env
    ),
  /** Replace the error_tags list for a single failure. Admin-only. */
  setFailureTags: (env: Env, deSyncStatusId: string, tags: string[]) =>
    post<{ ok: boolean; tags: string[] }>(
      `/api/failures/${deSyncStatusId}/tags`,
      env,
      { tags }
    ),

  // ── shared (env-less) ─────────────────────────────────────────────────
  labels: {
    list: () => getShared<{ items: Label[] }>("/api/labels"),
    create: (name: string, color?: string) =>
      sharedRequest<Label>("POST", "/api/labels", { name, color }),
    remove: (id: string) =>
      sharedRequest<{ ok: boolean }>("DELETE", `/api/labels/${id}`),
  },
  releases: {
    list: () => getShared<{ items: Release[] }>("/api/releases"),
    get: (id: string) => getShared<Release>(`/api/releases/${id}`),
    create: (
      name: string,
      jira_url: string,
      options: {
        released_on?: string;
        quarter?: number;
        year?: number;
      } = {}
    ) =>
      sharedRequest<Release>("POST", "/api/releases", {
        name,
        jira_url,
        released_on: options.released_on,
        quarter: options.quarter,
        year: options.year,
      }),
    remove: (id: string) =>
      sharedRequest<{ ok: boolean }>("DELETE", `/api/releases/${id}`),
    /** Pull child issues from Jira and replace bugs[] (preserves label_ids
     *  by jira_id). Requires JIRA_EMAIL + JIRA_API_TOKEN in .env. */
    syncFromJira: (releaseId: string) =>
      sharedRequest<{ ok: boolean; bug_count: number; release: Release }>(
        "POST",
        `/api/releases/${releaseId}/sync-from-jira`
      ),
    updateBug: (
      releaseId: string,
      bugId: string,
      patch: Partial<Pick<Bug, "title" | "jira_id" | "label_ids">>
    ) =>
      sharedRequest<Bug>(
        "PATCH",
        `/api/releases/${releaseId}/bugs/${bugId}`,
        patch
      ),
    removeBug: (releaseId: string, bugId: string) =>
      sharedRequest<{ ok: boolean }>(
        "DELETE",
        `/api/releases/${releaseId}/bugs/${bugId}`
      ),
  },
  jira: {
    health: () => getShared<JiraHealth>("/api/jira/health"),
  },
  errorTagRules: {
    list: () =>
      getShared<{ items: ErrorTagRule[] }>("/api/error-tag-rules"),
    replace: (items: ErrorTagRule[]) =>
      sharedRequest<{ ok: boolean; count: number }>(
        "PUT",
        "/api/error-tag-rules",
        { items }
      ),
  },
  members: {
    list: () => getShared<{ items: TeamMember[] }>("/api/members"),
    create: (input: {
      email: string;
      name: string;
      role: MemberRole;
      designation: string;
    }) => sharedRequest<TeamMember>("POST", "/api/members", input),
    update: (
      id: string,
      patch: Partial<{
        email: string;
        name: string;
        role: MemberRole;
        designation: string;
        picture: string | null;
      }>
    ) => sharedRequest<TeamMember>("PATCH", `/api/members/${id}`, patch),
    remove: (id: string) =>
      sharedRequest<{ ok: boolean }>("DELETE", `/api/members/${id}`),
  },
  ignoreList: {
    list: (env: Env) =>
      getShared<{ items: IgnoreEntry[] }>(`/api/ignore-list?env=${env}`),
    add: (
      env: Env,
      entry: {
        kind: "org" | "orgIntegration";
        target_id: string;
        cached_name?: string;
        comment?: string;
        added_by?: string;
      }
    ) =>
      sharedRequest<IgnoreEntry>(
        "POST",
        `/api/ignore-list?env=${env}`,
        entry
      ),
    remove: (env: Env, id: string) =>
      sharedRequest<{ ok: boolean }>(
        "DELETE",
        `/api/ignore-list/${id}?env=${env}`
      ),
  },
  rca: {
    list: () => getShared<{ items: RcaDoc[] }>("/api/rca"),
    get: (id: string) => getShared<RcaDocWithContent>(`/api/rca/${id}`),
    create: (input: {
      name: string;
      filename: string;
      content: string;
      owner: string;
      reviewer: string;
      tags: string[];
    }) => sharedRequest<RcaDoc>("POST", "/api/rca", input),
    update: (
      id: string,
      patch: Partial<{
        name: string;
        owner: string;
        reviewer: string;
        tags: string[];
        content: string;
        filename: string;
      }>
    ) => sharedRequest<RcaDoc>("PATCH", `/api/rca/${id}`, patch),
    remove: (id: string) =>
      sharedRequest<{ ok: boolean }>("DELETE", `/api/rca/${id}`),
  },
};
