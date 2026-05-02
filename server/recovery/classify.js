/**
 * Pure classification of one failed syncstatus doc. No I/O, fully unit-testable.
 *
 * Decision tree (first match wins):
 *
 *   1. sync_status === 'Running'                                → SKIP_RUNNING
 *   2. is_IE_bad_request                                        → MANUAL_REVIEW
 *   3. age(createdAt) > windowDays                              → SKIP_OUT_OF_WINDOW
 *   4. an in-flight runs/<sync_id>.json exists                  → TRIGGERED
 *   5. mode === 'activity_data':
 *        latest users_data Completed AND
 *        latest other_static_data Completed                     → RETRIGGER
 *        else                                                   → MANUAL_REVIEW
 *   6. mode in ('users_data','other_static_data'):
 *        newer Completed of same mode for orgInt exists         → MARK_COMPLETE
 *        else                                                   → MANUAL_REVIEW
 *   7. else                                                     → MANUAL_REVIEW
 */

const ONE_DAY_MS = 86_400_000;

function toDate(d) {
  if (d instanceof Date) return d;
  if (typeof d === "string") return new Date(d);
  return null;
}

export function classify(doc, ctx) {
  const syncId = String(doc.syncId);
  const orgInt = String(doc.orgIntegrationId);
  const mode = doc.mode ?? "";
  const createdAt = toDate(doc.createdAt);

  if (doc.sync_status === "Running") {
    // Discover only forwards Running docs to classify once they've exceeded
    // the staleness threshold (default 48h), so anything here is by definition stuck.
    return [
      "SKIP_RUNNING",
      "Possibly stuck — running for over 48 hours. Manual review recommended.",
    ];
  }

  if (ctx.ieBadRequestSyncIds.has(syncId)) {
    return [
      "MANUAL_REVIEW",
      "IE bad request — re-triggering will not help; payload or upstream config issue requires manual review.",
    ];
  }

  if (
    createdAt &&
    ctx.now.getTime() - createdAt.getTime() > ctx.windowDays * ONE_DAY_MS
  ) {
    return [
      "SKIP_OUT_OF_WINDOW",
      `Failure older than ${ctx.windowDays}-day retry window (${createdAt
        .toISOString()
        .slice(0, 10)}).`,
    ];
  }

  if (ctx.inFlightSyncIds.has(syncId)) {
    return [
      "TRIGGERED",
      "Already retriggered; flow run is in progress. See Active Runs.",
    ];
  }

  if (mode === "activity_data") {
    const usersLatest = ctx.latestAny.get(`${orgInt}:users_data`);
    const staticLatest = ctx.latestAny.get(`${orgInt}:other_static_data`);
    const usersOk = !!usersLatest && usersLatest.sync_status === "Completed";
    const staticOk = !!staticLatest && staticLatest.sync_status === "Completed";
    if (usersOk && staticOk) {
      return [
        "RETRIGGER",
        "Latest users_data and other_static_data are Completed for this orgIntegration; activity is per-day data so safe to retrigger within window.",
      ];
    }
    const missing = [];
    if (!usersOk) {
      missing.push(
        `users_data latest is ${usersLatest ? usersLatest.sync_status : "absent"}`
      );
    }
    if (!staticOk) {
      missing.push(
        `other_static_data latest is ${staticLatest ? staticLatest.sync_status : "absent"}`
      );
    }
    return [
      "MANUAL_REVIEW",
      `Activity retrigger blocked: ${missing.join(
        "; "
      )}. Resolve users_data / other_static_data first.`,
    ];
  }

  if (mode === "users_data" || mode === "other_static_data") {
    const latest = ctx.latestCompleted.get(`${orgInt}:${mode}`);
    const latestCreated = latest ? toDate(latest.createdAt) : null;
    if (latest && latestCreated && createdAt && latestCreated > createdAt) {
      return [
        "MARK_COMPLETE",
        `Newer Completed ${mode} exists for this orgIntegration at ${latestCreated.toISOString()} (sync ${
          latest.sync_id
        }); failure superseded.`,
      ];
    }
    return [
      "MANUAL_REVIEW",
      `No newer Completed ${mode} for this orgIntegration. Failure may be ongoing — manual review required before retriggering.`,
    ];
  }

  return ["MANUAL_REVIEW", `Unsupported mode "${mode}" — manual review required.`];
}
