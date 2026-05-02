/**
 * Jira REST client. Authenticates with Basic auth (email + API token).
 *
 * Generate a token at:
 *   https://id.atlassian.com/manage-profile/security/api-tokens
 *
 * Required env vars (in failing-flows/.env or reRunSyncs/.env):
 *   JIRA_BASE_URL  default "https://zluri.atlassian.net"
 *   JIRA_EMAIL     your Atlassian account email
 *   JIRA_API_TOKEN the token from the link above
 */

import "dotenv/config";

const JIRA_BASE_URL = (
  process.env.JIRA_BASE_URL ?? "https://zluri.atlassian.net"
).replace(/\/+$/, "");
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

const FIELDS = [
  "summary",
  "status",
  "issuetype",
  "assignee",
  "priority",
  "labels",
  "created",
  "updated",
  "resolution",
  "description",
].join(",");

function ensureCredentials() {
  if (!JIRA_EMAIL || !JIRA_API_TOKEN) {
    const err = new Error(
      "Jira credentials missing — set JIRA_EMAIL and JIRA_API_TOKEN in .env. " +
        "Generate a token at https://id.atlassian.com/manage-profile/security/api-tokens."
    );
    err.status = 503;
    throw err;
  }
  return Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
}

/** Fetch all child issues of an epic (or whatever the parent type is).
 *
 *  Uses the modern POST /rest/api/3/search/jql endpoint (the GET /search
 *  endpoint was deprecated in Apr 2025). Pages through `nextPageToken`
 *  until `isLast` is true.
 */
export async function fetchEpicChildren(epicId) {
  const auth = ensureCredentials();
  const jql = `parent = "${epicId}" OR "Epic Link" = "${epicId}" ORDER BY created DESC`;
  const url = `${JIRA_BASE_URL}/rest/api/3/search/jql`;

  const all = [];
  let nextPageToken = undefined;
  // Hard guard against infinite loops if the API returns inconsistent pages.
  for (let i = 0; i < 20; i++) {
    const body = {
      jql,
      fields: FIELDS.split(","),
      maxResults: 100,
      ...(nextPageToken ? { nextPageToken } : {}),
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(
        `Jira API ${res.status}: ${body.slice(0, 240) || res.statusText}`
      );
      err.status = res.status === 401 || res.status === 403 ? res.status : 502;
      throw err;
    }
    const data = await res.json();
    for (const issue of data.issues ?? []) all.push(issue);
    if (data.isLast || !data.nextPageToken) break;
    nextPageToken = data.nextPageToken;
  }
  return all.map(mapIssue);
}

function mapIssue(issue) {
  const f = issue.fields ?? {};
  return {
    jira_id: issue.key,
    jira_url: `${JIRA_BASE_URL}/browse/${issue.key}`,
    title: f.summary ?? issue.key,
    jira_meta: {
      status: f.status?.name ?? null,
      status_category: f.status?.statusCategory?.key ?? null,
      issuetype: f.issuetype?.name ?? null,
      priority: f.priority?.name ?? null,
      assignee: f.assignee
        ? {
            name: f.assignee.displayName,
            email: f.assignee.emailAddress ?? null,
          }
        : null,
      jira_labels: f.labels ?? [],
      created: f.created ?? null,
      updated: f.updated ?? null,
      resolution: f.resolution?.name ?? null,
      description: extractAdfText(f.description),
    },
  };
}

/** Atlassian Document Format → plain text. Walks the tree, joins text leaves. */
function extractAdfText(adf, depth = 0) {
  if (!adf) return "";
  if (typeof adf === "string") return adf;
  if (depth > 12) return "";
  if (Array.isArray(adf)) {
    return adf.map((x) => extractAdfText(x, depth + 1)).join("");
  }
  if (typeof adf !== "object") return "";
  let s = "";
  if (typeof adf.text === "string") s += adf.text;
  if (Array.isArray(adf.content)) {
    s += adf.content.map((x) => extractAdfText(x, depth + 1)).join("");
  }
  // Add a paragraph break after block-level nodes
  if (
    typeof adf.type === "string" &&
    /paragraph|heading|listItem|bulletList|orderedList/.test(adf.type)
  ) {
    s += "\n";
  }
  return s;
}

export const jiraConfig = {
  baseUrl: JIRA_BASE_URL,
  email: JIRA_EMAIL ?? null,
  configured: Boolean(JIRA_EMAIL && JIRA_API_TOKEN),
};
