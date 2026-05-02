# Deployment runbook

End-to-end first-time deploy. Plan on ~90 minutes for a clean run. After this
the redeploy cycle is just `git push`.

## What you'll need before starting

- AWS access to account `637188757652` (the SSO profile you already use locally).
- Two random hex secrets — `INTERNAL_CRON_TOKEN`, `SESSION_SECRET` (32 bytes each).
- Google OAuth client ID for production (or reuse the dev one and add the Vercel domain to authorized origins).
- Atlas connection string with `0.0.0.0/0` allowed (Railway egress IPs are not fixed on the trial / hobby plan).
- Accounts on GitHub, Vercel, and Railway.

Generate the two random hex secrets now:

```bash
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # INTERNAL_CRON_TOKEN
```

Save both. The cron token also goes into GitHub repo secrets so the workflow can authenticate.

---

## Step 1 — Push to GitHub

The repo is currently not git-initialized. Create a public repo on GitHub
(public so Actions cron stays free) named e.g. `de-quality-portal`, then:

```bash
cd /Users/ashutosh/reRunSyncs
git init
git add .
git commit -m "Initial commit: DE-quality portal"
git branch -M main
git remote add origin https://github.com/<you>/de-quality-portal.git
git push -u origin main
```

Verify the push uploaded `.gitignore`, `vercel.json`, `railway.toml`,
`.github/workflows/cron-refresh.yml`, and `.env.example` — but **not** `.env`.

---

## Step 2 — Atlas allowlist + DB user

1. Atlas console → select the project.
2. **Network Access** → **Add IP Address** → "Allow Access From Anywhere"
   (`0.0.0.0/0`). Comment: *"Railway egress — rotating; secured by mongo auth"*.
3. **Database Access** → confirm the user in `MONGO_URI_DEV` / `MONGO_URI_PROD`
   has a strong password. Rotate if it's old.

If platform won't allow `0.0.0.0/0`, you'll need a paid Railway plan + a static-egress add-on; otherwise this step blocks the deploy.

---

## Step 3 — Deploy backend to Railway

1. **Railway dashboard** → New Project → "Deploy from GitHub repo" → pick the repo.
2. Railway auto-detects Node from `package.json` and reads `railway.toml`. It will start building immediately — the first build will fail to start (no env vars yet), that's expected.
3. Open the service → **Settings**:
   - **Service Name**: `de-quality-portal-api`
   - **Root Directory**: leave blank
   - **Build Command**: leave blank (Nixpacks handles `npm install`)
   - **Start Command**: leave blank (uses `npm start` from `railway.toml`)
   - **Healthcheck Path**: `/api/internal/health` (also from `railway.toml`)
4. **Variables** tab → paste each of the env vars below. Railway has a "Raw Editor" — copy-paste the whole block at once.

   **Public configuration:**
   ```
   STORAGE_BACKEND=s3
   S3_BUCKET=de-quality-dashboard
   S3_REGION=us-west-2
   S3_PREFIX=
   AWS_REGION=us-west-2
   PROD_WRITES_ENABLED=false
   DISCOVERY_WINDOW_DAYS=30
   STALENESS_HOURS=48
   ALLOWED_EMAIL_DOMAIN=zluri.com
   JIRA_BASE_URL=https://zluri.atlassian.net
   NODE_ENV=production
   ```

   **Secrets** (paste real values):
   ```
   SESSION_SECRET=<from your generated hex>
   INTERNAL_CRON_TOKEN=<from your generated hex>
   GOOGLE_CLIENT_ID=<from Google Cloud Console>
   MONGO_URI_DEV=<from your local .env>
   MONGO_URI_PROD=<from your local .env>
   JIRA_EMAIL=<your Jira email>
   JIRA_API_TOKEN=<your Jira API token>
   DEV_SAFE_ALLOWLIST=669525cdd686b80a47f957b4,69d6363e30ed128ec34451f0
   ```

5. **AWS creds** (rotating, until you get a long-lived IAM user). Run locally:

   ```bash
   aws sso login --profile DE-team-Interns-permissions-637188757652
   aws --profile DE-team-Interns-permissions-637188757652 \
       configure export-credentials --format env
   ```

   Paste the three exported lines into Railway:

   ```
   AWS_ACCESS_KEY_ID=ASIA...
   AWS_SECRET_ACCESS_KEY=...
   AWS_SESSION_TOKEN=IQoJ...
   ```

6. **Generate a public domain.** In Railway: **Settings → Networking → Generate Domain**. You get something like `de-quality-portal-api.up.railway.app`. Note this URL.

7. Trigger a redeploy (Variables tab usually does this automatically when you save). Wait for the build to go green and the healthcheck at `/api/internal/health` to pass.

8. Sanity check from your laptop:

   ```bash
   curl https://<your-railway-app>.up.railway.app/api/internal/health
   # → {"ok":true,"ts":"..."}
   ```

---

## Step 4 — Deploy frontend to Vercel

1. Update `vercel.json` — replace `REPLACE-ME.up.railway.app` with the Railway domain from Step 3.6:

   ```json
   {
     "rewrites": [
       {
         "source": "/api/:path*",
         "destination": "https://de-quality-portal-api.up.railway.app/api/:path*"
       }
     ]
   }
   ```

   Commit + push.

2. **Vercel dashboard** → Add New → Project → import the GitHub repo. Framework auto-detects as Vite.

3. Vercel env vars (Settings → Environment Variables):
   - `VITE_GOOGLE_CLIENT_ID` (same value as Railway's `GOOGLE_CLIENT_ID`).

4. Deploy. Note the URL, e.g. `your-app.vercel.app`.

5. **Google Cloud Console** → OAuth credentials → Authorized JavaScript origins → add `https://your-app.vercel.app` → Save.

---

## Step 5 — GitHub Actions secrets

Repo → Settings → Secrets and variables → Actions → **New repository secret**:

| Name | Value |
|------|-------|
| `BACKEND_URL` | `https://de-quality-portal-api.up.railway.app` (no trailing slash) |
| `INTERNAL_CRON_TOKEN` | same hex as in Railway |

---

## Step 6 — First cron run

The workflow fires every 10 min between 04:00 and 16:50 UTC. Trigger it manually to seed S3 immediately:

Repo → **Actions** tab → "Refresh dashboard data" → **Run workflow** → main.

Watch the logs. Expect:

```
Health probe → 200
Refresh discovered data → HTTP 200 in ~30–90s
```

Verify S3 got populated:

```bash
aws s3 ls s3://de-quality-dashboard/dev/ui_data/
aws s3 ls s3://de-quality-dashboard/prod/ui_data/
```

You should see `failures_latest.json`, `stats.json`, `eta_cache.json`, `bad_requests.json` in each.

---

## Step 7 — End-to-end smoke test

1. Open `https://your-app.vercel.app`.
2. Sign in with `@zluri.com` Google account.
3. Failures, Stats, Bad Requests, RCA, Recovery pages all load.
4. Switch env (dev ↔ prod) → both load.
5. As an admin: click Refresh on Failures (round-trips through `/api/refresh-statuses`).
6. As a viewer (test with another account): Refresh + Re-run all are greyed out; mark-complete / retrigger buttons hidden inside failure detail.
7. Sync from Jira on a release card.

---

## Step 8 — Eventually: long-lived IAM user

When the rotating-creds workflow becomes annoying, ask whoever owns AWS account `637188757652` for an IAM user `de-quality-portal-railway` with this inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"
    ],
    "Resource": [
      "arn:aws:s3:::de-quality-dashboard",
      "arn:aws:s3:::de-quality-dashboard/*"
    ]
  }]
}
```

In Railway → Variables, replace the three rotating `AWS_*` values with the long-lived `AWS_ACCESS_KEY_ID` (starts with `AKIA`) and `AWS_SECRET_ACCESS_KEY`. **Delete** `AWS_SESSION_TOKEN` — long-lived keys don't use one.

---

## Routine ops

- **AWS creds expired:** Railway logs show `CredentialsProviderError` → repeat Step 3.5.
- **Railway billing:** the trial plan has $5 of credit (no card). When that runs out you'll be prompted to add a card for the Hobby plan ($5/month + usage). Watch the dashboard for credit balance.
- **Stale data on dashboard:** the cron runs every 10 min during work hours. Click Refresh on Failures for an immediate mongo round-trip.
- **GitHub Actions minutes:** public repo = unlimited. Current cadence is well within free limits regardless.

---

## Rollback

- **Backend:** Railway dashboard → Deployments → pick a previous green deploy → Redeploy.
- **Frontend:** Vercel dashboard → Deployments → "Promote to Production" on any prior build.
- **Cron:** Repo → Actions → "Refresh dashboard data" → "..." → Disable workflow.
