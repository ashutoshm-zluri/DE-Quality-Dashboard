import type { Env } from "./env";

/**
 * Real Prefect host pattern (confirmed by Ashutosh):
 *   prod SSO  → https://prefect-sso-gvt.pvt.zluri.com
 *   prod app  → https://prefect-apps-gvt.pvt.zluri.com
 *   dev       → https://prefect.pvt.zluri.dev   (single host, no sso/app split)
 *
 * Path is always /flow-runs/flow-run/<flow_run_id>.
 *
 * `app_flag` and `payment_flag` both route to the app host; otherwise SSO.
 */

interface RouteFlags {
  app_flag?: boolean | null;
  payment_flag?: boolean | null;
}

export function prefectFlowUrl(
  env: Env,
  flowId: string | null | undefined,
  flags: RouteFlags = {}
): string | null {
  if (!flowId) return null;

  if (env === "dev") {
    return `https://prefect.pvt.zluri.dev/flow-runs/flow-run/${flowId}`;
  }

  const isApp = !!(flags.app_flag || flags.payment_flag);
  const host = isApp ? "prefect-apps-gvt" : "prefect-sso-gvt";
  return `https://${host}.pvt.zluri.com/flow-runs/flow-run/${flowId}`;
}

/** Convenience for the failure modal: pull the first id out of step_function. */
export function firstStepFunctionId(stepFn: string[] | string | null): string | null {
  if (!stepFn) return null;
  if (Array.isArray(stepFn)) return stepFn[0] ?? null;
  return stepFn;
}
