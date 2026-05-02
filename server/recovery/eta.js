/**
 * Bucket completed syncs by (orgInt:mode) and summarize each bucket.
 * Inputs are expected sorted by createdAt DESC (most recent first).
 */

function minutesBetween(a, b) {
  return Math.max(0, (b.getTime() - a.getTime()) / 60_000);
}

export function computeEtaTable(completed, { lastN = 10 } = {}) {
  const buckets = new Map();
  for (const c of completed) {
    const key = `${c.org_integration_id}:${c.mode}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    if (bucket.length < lastN) bucket.push(c);
  }

  const out = {};
  for (const [key, items] of buckets) {
    const durations = items.map((c) =>
      minutesBetween(new Date(c.createdAt), new Date(c.updatedAt))
    );
    if (!durations.length) continue;
    const latest = items[0];
    const latestDur = minutesBetween(
      new Date(latest.createdAt),
      new Date(latest.updatedAt)
    );
    const sum = durations.reduce((a, b) => a + b, 0);
    out[key] = {
      avg_minutes: round2(sum / durations.length),
      samples: durations.length,
      min: round2(Math.min(...durations)),
      max: round2(Math.max(...durations)),
      last_completed_minutes: round2(latestDur),
      last_completed_at: new Date(latest.createdAt).toISOString(),
    };
  }
  return out;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}
