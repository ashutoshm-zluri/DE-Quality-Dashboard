/**
 * Reliability stats. Pure-ish: takes syncstatus docs + an integration name
 * map + an error tagger, returns the UI-shaped stats payload.
 *
 * Mirrors recovery/stats.py exactly so the frontend doesn't need to change.
 */

const SLA_BUCKETS_MIN = {
  completed_24h: 24 * 60,
  completed_72h: 72 * 60,
};
const HOURLY_LOOKBACK_HOURS = 72;

export function computeStats({
  docs,
  integrationNameMap,
  ieBadCount,
  startedAt,
  windowDays,
  errorTagger,
}) {
  const byDate = new Map();
  const byHour = new Map();
  const byIntegration = new Map();
  const summary = emptyBucket();

  const durationsCompletedMin = [];
  const pairFailureCounts = new Map();
  const errorTagCounts = new Map();

  const hourlyCutoff = new Date(
    startedAt.getTime() - HOURLY_LOOKBACK_HOURS * 3_600_000
  );

  for (const d of docs) {
    const created = toDate(d.createdAt);
    if (!created) continue;

    const dateKey = isoDate(created);
    const hourKey = isoHour(created);

    updateBucket(getOrCreate(byDate, dateKey, emptyBucket), d, created);
    updateBucket(summary, d, created);
    if (created >= hourlyCutoff) {
      updateBucket(getOrCreate(byHour, hourKey, emptyBucket), d, created);
    }

    const intId = d.integrationId;
    if (intId) {
      updateBucket(
        getOrCreate(byIntegration, String(intId), emptyBucket),
        d,
        created
      );
    }

    const status = d.sync_status;
    const complete = !!d.sync_complete;
    const isCompleted = status === "Completed" && complete;
    const isNotCompleted = !isCompleted;

    if (isCompleted) {
      const updated = toDate(d.updatedAt) ?? created;
      durationsCompletedMin.push(
        Math.max(0, (updated.getTime() - created.getTime()) / 60_000)
      );
    }

    if (isNotCompleted) {
      const pair = `${d.orgIntegrationId ?? ""}:${d.mode ?? ""}`;
      pairFailureCounts.set(pair, (pairFailureCounts.get(pair) ?? 0) + 1);

      if (errorTagger) {
        for (const tag of errorTagger.tag(d.error_reason ?? "")) {
          errorTagCounts.set(tag, (errorTagCounts.get(tag) ?? 0) + 1);
        }
      }
    }
  }

  const byDateList = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, b]) => rowWithLabel(k, "date", b));

  const byHourList = [...byHour.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, b]) => rowWithLabel(k, "ts", b));

  const byIntegrationList = [...byIntegration.entries()]
    .map(([id, b]) => integrationRow(id, b, integrationNameMap))
    .sort((a, b) => b.not_completed - a.not_completed);

  durationsCompletedMin.sort((a, b) => a - b);
  const durationStats = {
    samples: durationsCompletedMin.length,
    avg: round2(avg(durationsCompletedMin)),
    p50: round2(percentile(durationsCompletedMin, 0.5)),
    p95: round2(percentile(durationsCompletedMin, 0.95)),
    p99: round2(percentile(durationsCompletedMin, 0.99)),
  };

  const windowHours = Math.max(1, windowDays * 24);
  const completedCount = summary.completed;
  const throughputPerHour = round2(completedCount / windowHours);
  let peakThroughputPerHour = 0;
  for (const b of byHour.values()) {
    if (b.completed > peakThroughputPerHour) peakThroughputPerHour = b.completed;
  }

  const pairsTotal = pairFailureCounts.size;
  let pairsRepeated = 0;
  let failuresInRepeated = 0;
  let failuresTotalFromPairs = 0;
  for (const c of pairFailureCounts.values()) {
    failuresTotalFromPairs += c;
    if (c >= 2) {
      pairsRepeated++;
      failuresInRepeated += c;
    }
  }
  const repeat = {
    pairs_total: pairsTotal,
    pairs_repeated: pairsRepeated,
    pairs_repeat_rate: pct(pairsRepeated, pairsTotal),
    failures_in_repeated: failuresInRepeated,
    share_of_failures_in_repeats: pct(failuresInRepeated, failuresTotalFromPairs),
  };

  const repeatTop = [...pairFailureCounts.entries()]
    .filter(([, c]) => c >= 2)
    .map(([pair, failures]) => {
      const [orgInt, mode] = pair.split(":");
      return { orgIntegrationId: orgInt, mode, failures };
    })
    .sort((a, b) => b.failures - a.failures)
    .slice(0, 10);

  return {
    generated_at: startedAt.toISOString(),
    window: {
      start: isoDate(new Date(startedAt.getTime() - windowDays * 86_400_000)),
      end: isoDate(startedAt),
    },
    summary: {
      total_syncs: summary.total,
      total_failed: summary.failed,
      total_not_completed: summary.not_completed,
      total_completed: summary.completed,
      total_ie_bad_requests: ieBadCount,
      overall_success_24h: pct(summary.completed_24h, summary.total),
      overall_success_72h: pct(summary.completed_72h, summary.total),
      overall_success_all: pct(summary.completed, summary.total),
      duration_minutes: durationStats,
      throughput_per_hour: throughputPerHour,
      peak_throughput_per_hour: peakThroughputPerHour,
      repeat_failure: repeat,
    },
    by_date: byDateList,
    by_hour: byHourList,
    by_integration: byIntegrationList,
    errors_by_tag: [...errorTagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count })),
    repeat_failure_top: repeatTop,
  };
}

// ── helpers ────────────────────────────────────────────────────────────────

function emptyBucket() {
  return {
    total: 0,
    failed: 0,
    not_completed: 0,
    completed: 0,
    completed_24h: 0,
    completed_72h: 0,
  };
}

function updateBucket(bucket, doc, created) {
  bucket.total++;
  const status = doc.sync_status;
  const complete = !!doc.sync_complete;
  const isCompleted = status === "Completed" && complete;
  if (status === "Failed") bucket.failed++;
  if (!isCompleted) bucket.not_completed++;
  if (isCompleted) {
    bucket.completed++;
    const updated = toDate(doc.updatedAt) ?? created;
    const durationMin = Math.max(
      0,
      (updated.getTime() - created.getTime()) / 60_000
    );
    for (const [key, threshold] of Object.entries(SLA_BUCKETS_MIN)) {
      if (durationMin <= threshold) bucket[key]++;
    }
  }
}

function rowWithLabel(key, labelField, b) {
  return {
    [labelField]: key,
    total: b.total,
    failed: b.failed,
    not_completed: b.not_completed,
    completed: b.completed,
    completed_24h: b.completed_24h,
    completed_72h: b.completed_72h,
    success_24h: pct(b.completed_24h, b.total),
    success_72h: pct(b.completed_72h, b.total),
    success_all: pct(b.completed, b.total),
  };
}

function integrationRow(intId, b, nameMap) {
  const name = nameMap?.[intId]?.name ?? intId;
  return {
    integration_id: intId,
    integration_name: name,
    total: b.total,
    failed: b.failed,
    not_completed: b.not_completed,
    failure_rate: pct(b.not_completed, b.total),
  };
}

function pct(num, denom) {
  if (!denom) return 0.0;
  return Math.round((num / denom) * 100 * 100) / 100;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function avg(items) {
  if (!items.length) return 0;
  return items.reduce((a, b) => a + b, 0) / items.length;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  if (p <= 0) return sorted[0];
  if (p >= 1) return sorted[sorted.length - 1];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, sorted.length - 1);
  const frac = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

function getOrCreate(map, key, factory) {
  let v = map.get(key);
  if (!v) {
    v = factory();
    map.set(key, v);
  }
  return v;
}

function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function isoHour(d) {
  // Round to nearest hour (UTC), match Python's datetime.replace(minute=0, ...)
  const z = new Date(d);
  z.setUTCMinutes(0, 0, 0);
  return z.toISOString();
}
