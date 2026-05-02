# Deployment runbook

End-to-end first-time deploy. Plan on ~90 minutes for a clean run. After this
the redeploy cycle is just `git push`.

## What you'll need before starting

- AWS access to account `637188757652` (the SSO profile you already use locally).
- A working `INTERNAL_CRON_TOKEN`, `SESSION_SECRET` (32-byte hex each).
- Google OAuth client ID for production (or reuse the dev one and add the Vercel domain to authorized origins).
- Atlas connection string with `0.0.0.0/0` allowed (Render's egress IP rotates).
- A GitHub account, a Vercel account, a Render account.

Generate the two random hex secrets now:

```bash
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # INTERNAL_CRON_TOKEN
```

Save both. You'll paste each in two places (Render + GitHub secrets for the cron token).

---

## Step 1 — Push to GitHub

The repo is currently not git-initialized. Make a public repo on GitHub
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

Verify the push uploaded `.gitignore`, `vercel.json`, `render.yaml`,
`.github/workflows/cron-refresh.yml`, and `.env.example` — but **not** `.env`.

---

## Step 2 — Atlas allowlist + DB user

1. Sign in to Atlas → select the project that owns `MONGO_URI_DEV` / `MONGO_URI_PROD`.
2. **Network Access** → **Add IP Address** → "Allow Access From Anywhere"
   (`0.0.0.0/0`). Comment: *"Render free egress — rotating; secured by mongo auth"*.
3. **Database Access** → confirm the user in your URIs has a strong password.
   Rotate if it's been around for a while.

If your platform team won't allow `0.0.0.0/0`, you'll need a paid Render plan
with the static-outbound-IP add-on; otherwise this step blocks the deploy.

---

## Step 3 — Deploy backend to Render

1. **Render dashboard** → New → Blueprint → connect the GitHub repo.
2. Render reads `render.yaml` and proposes a service named `de-quality-portal-api`.
   Confirm.
3. Wait for the first build to complete. It will fail to start because env
   vars are missing — that's expected.
4. Open the service → **Environment** → set the secrets. The blueprint
   already declares the keys; you just paste values:

   | Key | Value |
   |-----|-------|
   | `SESSION_SECRET` | (the 32-byte hex you generated) |
   | `INTERNAL_CRON_TOKEN` | (the 32-byte hex you generated) |
   | `GOOGLE_CLIENT_ID` | from Google Cloud Console |
   | `MONGO_URI_DEV` | from your local `.env` / `failing-flows/.env` |
   | `MONGO_URI_PROD` | from your local `.env` / `failing-flows/.env` |
   | `JIRA_EMAIL`, `JIRA_API_TOKEN` | your existing Jira creds |
   | `DEV_SAFE_ALLOWLIST` | comma-separated orgIntegrationIds for dev-safe runs |
   | `AWS_ACCESS_KEY_ID` | (see Step 4 below) |
   | `AWS_SECRET_ACCESS_KEY` | (see Step 4 below) |
   | `AWS_SESSION_TOKEN` | (see Step 4 below) |

5. Manual deploy → wait for green. Note the service URL, e.g.
   `https://de-quality-portal-api.onrender.com`.
6. Sanity check:

   ```bash
   curl https://de-quality-portal-api.onrender.com/api/internal/health
   # → {"ok":true,"ts":"..."}
   ```

---

## Step 4 — AWS credentials on Render

Until the platform team mints a long-lived IAM user for this app, Render
runs on rotating SSO session creds. Paste them whenever they expire (typically
every 1–8 hours). Procedure:

```bash
aws sso login --profile DE-team-Interns-permissions-637188757652

# Print the active session creds
aws --profile DE-team-Interns-permissions-637188757652 \
    configure export-credentials --format env
```

Copy the three lines into Render → Environment:

```
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_SESSION_TOKEN=...
```

Save → Render auto-redeploys. **When the session expires** (you'll see
`CredentialsProviderError` in Render logs), repeat this step. Schedule a
follow-up to swap to a long-lived IAM user — see Step 9.

---

## Step 5 — Deploy frontend to Vercel

1. **Vercel dashboard** → Add New → Project → import the GitHub repo.
2. Framework preset: **Vite** (auto-detected). Build command: `npm run build`.
   Output directory: `dist`.
3. Edit `vercel.json` *before* deploying — replace `REPLACE-ME` with your
   actual Render URL:

   ```json
   {
     "rewrites": [
       {
         "source": "/api/:path*",
         "destination": "https://de-quality-portal-api.onrender.com/api/:path*"
       }
     ]
   }
   ```

   Commit and push. Vercel picks it up.
4. Set Vercel env vars:
   - `VITE_GOOGLE_CLIENT_ID` (same value as Render's `GOOGLE_CLIENT_ID`)
5. Wait for green. Vercel gives you a URL like `your-app.vercel.app`.
6. **Update Google OAuth Console** to add the Vercel URL:
   - Authorized JavaScript origins: `https://your-app.vercel.app`
   - Save in Cloud Console.

---

## Step 6 — GitHub repo secrets

Repo → Settings → Secrets and variables → Actions → **New repository secret**:

| Name | Value |
|------|-------|
| `RENDER_URL` | `https://de-quality-portal-api.onrender.com` (no trailing slash) |
| `INTERNAL_CRON_TOKEN` | same hex value as on Render |

---

## Step 7 — First cron run

The workflow fires every 10 min between 04:00 and 16:50 UTC. To trigger
immediately:

Repo → **Actions** tab → "Refresh dashboard data" → **Run workflow** → main.

Watch the logs. You should see:

```
Health ping (wake Render) → 200
Refresh discovered data → 200, ~30–90 s wall time
```

After it completes, check S3:

```bash
aws s3 ls s3://de-quality-dashboard/dev/ui_data/
aws s3 ls s3://de-quality-dashboard/prod/ui_data/
```

You should see `failures_latest.json`, `stats.json`, `eta_cache.json`,
`bad_requests.json` in each.

---

## Step 8 — End-to-end smoke test

1. Open `https://your-app.vercel.app`.
2. Sign in with a `@zluri.com` Google account.
3. Failures page loads with data from S3.
4. Switch env (dev ↔ prod) → both load.
5. As an admin: click Refresh on Failures (verifies in-flight status refresh
   end-to-end through `/api/refresh-statuses`).
6. As a viewer: confirm action buttons are greyed out / hidden.
7. Trigger a Sync from Jira on a release card.
8. Open an RCA doc, navigate around, verify state persists across pages.

---

## Step 9 — Eventually: long-lived IAM user

When the rotating-creds workflow becomes annoying, ask whoever owns AWS account `637188757652` for an IAM user `de-quality-portal-render` with this inline policy:

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

Replace the three `AWS_*` env vars on Render with the long-lived
`AWS_ACCESS_KEY_ID` (starts with `AKIA`) and `AWS_SECRET_ACCESS_KEY`. Delete
`AWS_SESSION_TOKEN` from Render. No more rotation.

---

## Routine ops

- **Backend cold start:** outside the cron window (10pm–10am IST), Render
  sleeps. First request takes ~30s. Acceptable.
- **Stale data:** the cron runs every 10 min during work hours. If you need
  fresher, click Refresh on the Failures page (admin-only).
- **AWS creds expired:** Render logs show `CredentialsProviderError` →
  rerun Step 4.
- **Render free-tier hours:** 750/month. Keep-alive 12h/day × 30 days = 360h,
  well under cap.
- **GitHub Actions minutes:** public repo = unlimited. Private repo = 2000
  free min/month; current cadence uses ~1100 min/month, fits.

---

## Rollback

- **Backend:** Render dashboard → service → Manual Deploy → choose a previous
  successful deploy.
- **Frontend:** Vercel dashboard → deployments → "Promote to Production" on
  any prior build.
- **Cron:** Disable the workflow from Repo → Actions → Refresh dashboard data
  → "..." → Disable workflow.
