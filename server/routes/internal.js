import { Router } from "express";
import { discover } from "../recovery/discover.js";

const router = Router();

const INTERNAL_CRON_TOKEN = process.env.INTERNAL_CRON_TOKEN ?? "";
const SUPPORTED_ENVS = ["dev", "prod"];

/**
 * Bearer-token middleware for cron-only endpoints. Compares against
 * INTERNAL_CRON_TOKEN env var. Constant-time-ish comparison (no early exit
 * on length mismatch) to discourage trivial timing attacks.
 */
function requireCronToken(req, res, next) {
  const header = req.get("authorization") ?? "";
  const expected = `Bearer ${INTERNAL_CRON_TOKEN}`;
  if (!INTERNAL_CRON_TOKEN) {
    return res
      .status(503)
      .json({ error: "INTERNAL_CRON_TOKEN is not configured on the server" });
  }
  if (
    header.length !== expected.length ||
    !timingSafeEquals(header, expected)
  ) {
    return res.status(401).json({ error: "invalid cron token" });
  }
  next();
}

function timingSafeEquals(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * GET /api/internal/health — open. Cron pings this to keep Render warm,
 * monitors poll it. <100ms.
 */
router.get("/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

/**
 * POST /api/internal/refresh — bearer-token gated. Runs discover for both
 * envs sequentially and returns a per-env summary. Replaces the standalone
 * `python -m recovery discover` cron job.
 *
 * Failures in one env do NOT abort the other env.
 */
router.post("/refresh", requireCronToken, async (req, res) => {
  const ranAt = new Date().toISOString();
  const summary = {};
  for (const env of SUPPORTED_ENVS) {
    const t0 = Date.now();
    try {
      const auditLine = await discover({ env });
      summary[env] = {
        ok: true,
        ms: Date.now() - t0,
        run_id: auditLine.run_id,
        failures: auditLine.discover.failed,
        by_action: auditLine.discover.by_action,
      };
    } catch (err) {
      summary[env] = {
        ok: false,
        ms: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  const overallOk = Object.values(summary).every((s) => s.ok);
  res.status(overallOk ? 200 : 207).json({ ran_at: ranAt, summary });
});

export default router;
