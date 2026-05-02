# DE-Quality Portal

Internal dashboard for Zluri's data engineering team — failing-sync recovery
flow, reliability stats, RCA documents, release tracker with Jira, and
recovery actions (mark-complete + retrigger) with snapshots and audit trail.

## Architecture

```
       Vercel (React)  ──/api/* rewrite──▶  Render (Express)  ──▶  Mongo Atlas
                                              │
                                              └─▶  S3 (de-quality-dashboard)
                                                     - <env>/ui_data/*  (refreshed by cron)
                                                     - <env>/snapshots/* (Phase 3)
                                                     - <env>/recovery_runs/* (Phase 3)
                                                     - shared/*  (members, labels, releases, RCAs)

       GitHub Actions cron (every 10 min, 09:30–22:20 IST)
                  │
                  ├──GET   /api/internal/health    (keeps Render warm)
                  └──POST  /api/internal/refresh   (re-runs discover)
```

## Local development

```bash
cp .env.example .env
# fill in MONGO_URI_DEV, MONGO_URI_PROD, GOOGLE_CLIENT_ID, SESSION_SECRET,
# INTERNAL_CRON_TOKEN, JIRA creds. Keep STORAGE_BACKEND=local for offline work.

npm install
npm run dev
```

Vite serves the React app on `http://localhost:5173` and proxies `/api/*`
to Express on `5174`. Sign in with a `@zluri.com` Google account.

To run against the real S3 bucket locally:

```bash
aws sso login --profile DE-team-Interns-permissions-637188757652
# in .env:
#   STORAGE_BACKEND=s3
#   AWS_PROFILE=DE-team-Interns-permissions-637188757652
npm run dev
```

## Layout

```
src/                       React app (Vite + TS + Tailwind)
  api/                       client + auth context + permissions + storage hook
  components/
  pages/

server/                    Express service
  index.js                   bootstrap, mounts routes
  auth.js                    Google JWT verify, session cookie, role helpers
  routes/
    auth.js                    /api/auth/* (login/logout/me)
    api.js                     all main endpoints (failures, stats, RCAs, ...)
    internal.js                /api/internal/{health,refresh} (cron-only)
  dal/
    storage.js                 unified S3 / local-fs storage primitive
    dataDal.js                 env-scoped reads/writes (failures, runs, etc.)
    shared.js                  cross-env state (members, labels, releases, ...)
    rca.js                     RCA doc store
    jira.js                    Jira REST client
  recovery/                  ported from the old Python recovery package
    mongoClient.js
    queries.js                 read-only mongo aggregations
    classify.js                pure decision tree
    errorTags.js               regex tagger
    eta.js                     duration averages
    stats.js                   reliability dashboard payload
    discover.js                top-level discover orchestrator
    refreshStatuses.js         in-flight status refresh

.github/workflows/cron-refresh.yml   GitHub Actions cron
vercel.json                          Vercel rewrites /api/* → Render
render.yaml                          Render blueprint
```

## Deploy

See [deploy steps](./DEPLOY.md) for the end-to-end runbook (one-time setup,
plus the rotation cycle for the SSO session creds Render uses).

## Cron + freshness

`POST /api/internal/refresh` runs the full discover for both envs (~30–90 s
each). It writes the four payloads to S3:

```
<env>/ui_data/failures_latest.json
<env>/ui_data/stats.json
<env>/ui_data/eta_cache.json
<env>/ui_data/bad_requests.json
<env>/audit/runs.jsonl                 (append-only)
```

The frontend reads through Render which reads through S3; cache-line freshness
is bounded by the cron interval (10 min) plus action-driven invalidation on
admin mutations.

## Roles

| Role   | Capabilities |
|--------|--------------|
| admin  | Full mutation access, including recovery actions (mark-complete, retrigger, re-run all) |
| member | Read everything; can create/edit own RCAs |
| viewer | Read-only |

New Google sign-ins default to `viewer`. Admins promote in Settings → Team members.

## Prod write guard

Recovery actions in prod return `503 prod_writes_not_configured` until
`PROD_WRITES_ENABLED=true` on Render. Flip when platform grants mongo prod
write credentials.
