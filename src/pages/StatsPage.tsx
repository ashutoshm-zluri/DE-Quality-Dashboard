import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { StatsResponse } from "../types";
import { api } from "../api/client";
import { useEnv } from "../api/env";
import EmptyState from "../components/EmptyState";
import Spinner from "../components/Spinner";

const fmtPct = (n: number | null | undefined) =>
  `${(n ?? 0).toFixed(1)}%`;
const fmtNum = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString();

const SLA_COLORS = {
  success_24h: "#0ea5e9",
  success_72h: "#8b5cf6",
  success_all: "#10b981",
};

// ── time range selector ──────────────────────────────────────────────────────
type TimeRange = "24h" | "72h" | "1w" | "2w" | "1m";

const TIME_RANGES: Array<{ value: TimeRange; label: string }> = [
  { value: "24h", label: "Past 24h" },
  { value: "72h", label: "Past 72h" },
  { value: "1w", label: "Past 1 week" },
  { value: "2w", label: "Past 2 weeks" },
  { value: "1m", label: "Past 1 month" },
];

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  "24h": "Past 24h",
  "72h": "Past 72h",
  "1w": "Past 1 week",
  "2w": "Past 2 weeks",
  "1m": "Past 1 month",
};

interface ChartPoint {
  ts: string;            // ISO timestamp (the canonical x value, hidden from axis)
  total: number;
  failed: number;
  not_completed: number;
  completed: number;
  completed_24h: number;
  completed_72h: number;
  success_24h: number;
  success_72h: number;
  success_all: number;
}

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

/** Aggregate hourly buckets into bins of `binHours`. */
function binHourly(
  hourBuckets: NonNullable<StatsResponse["by_hour"]>,
  lookbackHours: number,
  binHours: number,
  now: Date
): ChartPoint[] {
  const cutoff = now.getTime() - lookbackHours * HOUR_MS;
  // Sort by ts asc (data is already sorted but be defensive)
  const sorted = [...hourBuckets].sort((a, b) =>
    a.ts.localeCompare(b.ts)
  );
  const inWindow = sorted.filter(
    (b) => new Date(b.ts).getTime() >= cutoff
  );

  const binCount = Math.ceil(lookbackHours / binHours);
  const bins: ChartPoint[] = [];
  for (let i = 0; i < binCount; i++) {
    const binStart = cutoff + i * binHours * HOUR_MS;
    const binEnd = binStart + binHours * HOUR_MS;
    const slice = inWindow.filter((b) => {
      const t = new Date(b.ts).getTime();
      return t >= binStart && t < binEnd;
    });
    bins.push(reduceToChartPoint(new Date(binStart).toISOString(), slice));
  }
  return bins;
}

/** Take last N daily buckets and lift them into ChartPoints. */
function lastDailyBuckets(
  dateBuckets: StatsResponse["by_date"],
  days: number
): ChartPoint[] {
  const sorted = [...dateBuckets].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  return sorted.slice(-days).map((d) => ({
    ts: `${d.date}T00:00:00Z`,
    total: d.total ?? 0,
    failed: d.failed ?? 0,
    not_completed: d.not_completed ?? 0,
    completed: d.completed ?? 0,
    completed_24h: d.completed_24h ?? 0,
    completed_72h: d.completed_72h ?? 0,
    success_24h: d.success_24h ?? 0,
    success_72h: d.success_72h ?? 0,
    success_all: d.success_all ?? 0,
  }));
}

function reduceToChartPoint(ts: string, slice: any[]): ChartPoint {
  const total = sum(slice, "total");
  const completed_24h = sum(slice, "completed_24h");
  const completed_72h = sum(slice, "completed_72h");
  const completed = sum(slice, "completed");
  return {
    ts,
    total,
    failed: sum(slice, "failed"),
    not_completed: sum(slice, "not_completed"),
    completed,
    completed_24h,
    completed_72h,
    success_24h: pct(completed_24h, total),
    success_72h: pct(completed_72h, total),
    success_all: pct(completed, total),
  };
}

function sum(items: any[], key: string): number {
  return items.reduce((acc, x) => acc + (x[key] ?? 0), 0);
}
function pct(num: number, denom: number): number {
  return denom === 0 ? 0 : Math.round((num / denom) * 10000) / 100;
}

function buildChartData(
  range: TimeRange,
  data: StatsResponse,
  now: Date
): ChartPoint[] {
  const byHour = data.by_hour ?? [];
  if (range === "24h") return binHourly(byHour, 24, 2, now);
  if (range === "72h") return binHourly(byHour, 72, 6, now);
  const days = range === "1w" ? 7 : range === "2w" ? 14 : 30;
  return lastDailyBuckets(data.by_date, days);
}

function fmtTimestampFor(range: TimeRange, ts: string): string {
  const d = new Date(ts);
  if (range === "24h" || range === "72h") {
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// ── tag color palette + duration formatter ──────────────────────────────────
const TAG_COLOR: Record<string, string> = {
  config_missing: "#f59e0b",
  athena_timeout: "#ef4444",
  athena_schema: "#f97316",
  glue_failure: "#f97316",
  skyflow_5xx: "#ef4444",
  skyflow_data: "#3a3a45",
  rate_limit: "#f59e0b",
  auth: "#ef4444",
  network: "#0ea5e9",
  orchestrator: "#8b5cf6",
  dependency: "#8b5cf6",
  code_bug: "#ef4444",
  validator_400: "#f97316",
  unknown: "#6b6b78",
  other: "#9ca3af",
};

function fmtMinutes(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1) return `${(n * 60).toFixed(0)}s`;
  if (n < 60) return `${n.toFixed(1)}m`;
  if (n < 1440) return `${(n / 60).toFixed(1)}h`;
  return `${(n / 1440).toFixed(1)}d`;
}

// ── KPI card ─────────────────────────────────────────────────────────────────
interface KpiProps {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "danger";
}

function Kpi({ label, value, hint, tone }: KpiProps) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-semibold ${
          tone === "danger" ? "text-red-600" : "text-ink-900"
        }`}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-ink-500">{hint}</div>}
    </div>
  );
}

// ── integration sort selector ────────────────────────────────────────────────
type IntegrationSort = "not_completed" | "failed" | "failure_rate" | "total";

const INTEGRATION_SORT_LABELS: Record<IntegrationSort, string> = {
  not_completed: "Most not-completed",
  failed: "Most failed",
  failure_rate: "Highest failure rate",
  total: "Most volume",
};

// ── page ─────────────────────────────────────────────────────────────────────
export default function StatsPage() {
  const { env } = useEnv();
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intSort, setIntSort] = useState<IntegrationSort>("not_completed");
  const [topN, setTopN] = useState(5);
  const [timeRange, setTimeRange] = useState<TimeRange>("1w");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.stats(env));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [env]);

  const now = useMemo(() => new Date(), [data]);
  const chartData = useMemo(
    () => (data ? buildChartData(timeRange, data, now) : []),
    [data, timeRange, now]
  );

  // Aggregate KPIs across the visible chart range — keeps numbers consistent
  // with what the user is looking at.
  const windowAgg = useMemo(() => {
    const total = chartData.reduce((a, p) => a + p.total, 0);
    const failed = chartData.reduce((a, p) => a + p.failed, 0);
    const not_completed = chartData.reduce((a, p) => a + p.not_completed, 0);
    const completed = chartData.reduce((a, p) => a + p.completed, 0);
    const completed_24h = chartData.reduce((a, p) => a + p.completed_24h, 0);
    const completed_72h = chartData.reduce((a, p) => a + p.completed_72h, 0);
    return {
      total,
      failed,
      not_completed,
      completed,
      success_all: pct(completed, total),
      success_24h: pct(completed_24h, total),
      success_72h: pct(completed_72h, total),
      failure_rate: pct(not_completed, total),
    };
  }, [chartData]);

  const sortedIntegrations = useMemo(() => {
    const all = [...(data?.by_integration ?? [])];
    all.sort(
      (a, b) =>
        ((b[intSort] ?? 0) as number) - ((a[intSort] ?? 0) as number)
    );
    return all;
  }, [data, intSort]);

  const topIntegrations = useMemo(
    () => sortedIntegrations.slice(0, topN),
    [sortedIntegrations, topN]
  );

  if (loading) return <Spinner />;
  if (error) return <EmptyState title="Couldn't load stats" hint={error} />;
  if (!data) return null;

  const rangeLabel = TIME_RANGE_LABELS[timeRange];

  return (
    <div className="px-6 py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">
            Reliability dashboard
          </h1>
          <p className="mt-1 text-xs text-ink-500">
            <span className="mono">{rangeLabel}</span>
            {" · env "}
            <span className="mono">{env}</span>
            {" · refreshed "}
            <span className="mono">
              {new Date(data.generated_at).toLocaleString()}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <TimeRangeSelect value={timeRange} onChange={setTimeRange} />
          <button onClick={load} className="btn">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </header>

      {/* Row 1 — window-driven KPIs (re-aggregated from chart data) */}
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Total syncs"
          value={fmtNum(windowAgg.total)}
          hint={`for ${rangeLabel.toLowerCase()}`}
        />
        <Kpi
          label="Failed"
          value={fmtNum(windowAgg.failed)}
          hint={`${fmtNum(windowAgg.not_completed)} not-completed`}
          tone="danger"
        />
        <Kpi
          label="SLA pass rate"
          value={fmtPct(windowAgg.success_all)}
          hint={`24h ${fmtPct(windowAgg.success_24h)} · 72h ${fmtPct(windowAgg.success_72h)}`}
        />
        <Kpi
          label="Failure rate"
          value={fmtPct(windowAgg.failure_rate)}
          hint="not-completed / total"
          tone={windowAgg.failure_rate >= 5 ? "danger" : "default"}
        />
      </div>

      {/* Row 2 — duration / throughput / repeat (full-window, not range-driven) */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="P95 sync duration"
          value={fmtMinutes(data.summary.duration_minutes?.p95)}
          hint={`p50 ${fmtMinutes(data.summary.duration_minutes?.p50)} · p99 ${fmtMinutes(data.summary.duration_minutes?.p99)} · avg ${fmtMinutes(data.summary.duration_minutes?.avg)}`}
        />
        <Kpi
          label="Throughput"
          value={
            data.summary.throughput_per_hour != null
              ? `${data.summary.throughput_per_hour.toFixed(1)}/h`
              : "—"
          }
          hint={
            data.summary.peak_throughput_per_hour != null
              ? `peak ${data.summary.peak_throughput_per_hour}/h observed`
              : undefined
          }
        />
        <Kpi
          label="Repeat failure rate"
          value={fmtPct(data.summary.repeat_failure?.pairs_repeat_rate)}
          hint={
            data.summary.repeat_failure
              ? `${data.summary.repeat_failure.pairs_repeated} of ${data.summary.repeat_failure.pairs_total} (orgInt, mode) pairs failed ≥2×`
              : undefined
          }
          tone={
            (data.summary.repeat_failure?.pairs_repeat_rate ?? 0) >= 30
              ? "danger"
              : "default"
          }
        />
        <Kpi
          label="In repeats"
          value={fmtPct(
            data.summary.repeat_failure?.share_of_failures_in_repeats
          )}
          hint="share of failures from pairs that failed multiple times"
        />
      </div>

      {/* SLA pass rate over time */}
      <section className="card mb-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-100 bg-ink-50/40 px-4 py-2">
          <h2 className="text-sm font-semibold text-ink-900">
            SLA pass rate over time
          </h2>
          <div className="flex items-center gap-3 text-[11px] text-ink-600">
            <LegendDot color={SLA_COLORS.success_24h} label="24h" />
            <LegendDot color={SLA_COLORS.success_72h} label="72h" />
            <LegendDot color={SLA_COLORS.success_all} label="all-time" />
          </div>
        </div>
        <div className="h-72 px-2 pb-3 pt-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
            >
              <CartesianGrid stroke="#eeeef0" strokeDasharray="3 3" />
              <XAxis
                dataKey="ts"
                tick={false}
                axisLine={{ stroke: "#d9d9de" }}
                tickLine={false}
                height={20}
              />
              <YAxis
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 11, fill: "#6b6b78" }}
                axisLine={{ stroke: "#d9d9de" }}
                tickLine={false}
                width={42}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 6,
                  border: "1px solid #d9d9de",
                  boxShadow: "0 2px 8px rgba(0,0,0,.06)",
                }}
                labelFormatter={(label: string) =>
                  fmtTimestampFor(timeRange, label)
                }
                formatter={(value: number) => `${value.toFixed(2)}%`}
              />
              <Line
                type="monotone"
                dataKey="success_24h"
                name="24h SLA"
                stroke={SLA_COLORS.success_24h}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="success_72h"
                name="72h SLA"
                stroke={SLA_COLORS.success_72h}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="success_all"
                name="all-time"
                stroke={SLA_COLORS.success_all}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Errors by tag */}
      {(data.errors_by_tag ?? []).length > 0 && (
        <section className="card mb-5 overflow-hidden">
          <div className="border-b border-ink-100 bg-ink-50/40 px-4 py-2">
            <h2 className="text-sm font-semibold text-ink-900">
              Errors by tag
            </h2>
            <p className="mt-0.5 text-[11px] text-ink-500">
              From regex rules in <span className="mono">shared/error_tags.json</span>.
              Edit that file to refine — script picks up changes on the next tick.
            </p>
          </div>
          <div className="h-72 px-2 pb-3 pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={(data.errors_by_tag ?? []).slice(0, 12)}
                layout="vertical"
                margin={{ top: 4, right: 32, left: 0, bottom: 4 }}
              >
                <CartesianGrid stroke="#eeeef0" strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "#6b6b78" }}
                  axisLine={{ stroke: "#d9d9de" }}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="tag"
                  tick={{ fontSize: 11, fill: "#3a3a45", fontFamily: "monospace" }}
                  axisLine={false}
                  tickLine={false}
                  width={130}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 6,
                    border: "1px solid #d9d9de",
                  }}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {(data.errors_by_tag ?? []).slice(0, 12).map((row, i) => (
                    <Cell key={i} fill={TAG_COLOR[row.tag] ?? "#6b7280"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Repeat-failure offenders */}
      {(data.repeat_failure_top ?? []).length > 0 && (
        <section className="card mb-5 overflow-hidden">
          <div className="border-b border-ink-100 bg-ink-50/40 px-4 py-2">
            <h2 className="text-sm font-semibold text-ink-900">
              Repeat-failure offenders
            </h2>
            <p className="mt-0.5 text-[11px] text-ink-500">
              (orgIntegration, mode) pairs that failed multiple times in window —
              retries aren't healing these.
            </p>
          </div>
          <div className="overflow-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="table-th">orgIntegrationId</th>
                  <th className="table-th">Mode</th>
                  <th className="table-th">Failures</th>
                </tr>
              </thead>
              <tbody>
                {(data.repeat_failure_top ?? []).map((row) => (
                  <tr
                    key={`${row.orgIntegrationId}:${row.mode}`}
                    className="border-t border-ink-100"
                  >
                    <td className="table-td mono text-[12px]">
                      {row.orgIntegrationId}
                    </td>
                    <td className="table-td mono text-[12px]">
                      {row.mode || "(empty)"}
                    </td>
                    <td className="table-td font-medium text-red-600">
                      {row.failures}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* Dynamic top-N integration chart */}
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-ink-100 bg-ink-50/40 px-4 py-2">
            <h2 className="text-sm font-semibold text-ink-900">
              Top integrations
            </h2>
            <div className="flex items-center gap-2">
              <select
                className="input h-8 w-auto py-0 text-[12px]"
                value={intSort}
                onChange={(e) =>
                  setIntSort(e.target.value as IntegrationSort)
                }
              >
                {Object.entries(INTEGRATION_SORT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <select
                className="input h-8 w-auto py-0 text-[12px]"
                value={topN}
                onChange={(e) => setTopN(Number(e.target.value))}
              >
                {[5, 10, 15].map((n) => (
                  <option key={n} value={n}>
                    Top {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="px-4 py-2 text-[11px] text-ink-500">
            Showing {topIntegrations.length} of {sortedIntegrations.length}{" "}
            integration{sortedIntegrations.length === 1 ? "" : "s"} ·
            sorted by {INTEGRATION_SORT_LABELS[intSort].toLowerCase()}
          </div>
          <div className="h-80 px-2 pb-3 pt-2">
            {topIntegrations.length === 0 ? (
              <EmptyState title="No integrations had any syncs in the window" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topIntegrations}
                  layout="vertical"
                  margin={{ top: 4, right: 32, left: 0, bottom: 4 }}
                >
                  <CartesianGrid stroke="#eeeef0" strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    tickFormatter={(v) =>
                      intSort === "failure_rate"
                        ? `${v.toFixed(0)}%`
                        : v.toLocaleString()
                    }
                    tick={{ fontSize: 11, fill: "#6b6b78" }}
                    axisLine={{ stroke: "#d9d9de" }}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="integration_name"
                    tick={{ fontSize: 11, fill: "#3a3a45" }}
                    axisLine={false}
                    tickLine={false}
                    width={150}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 6,
                      border: "1px solid #d9d9de",
                    }}
                    formatter={(value: number, name: string) => {
                      if (name === "failure_rate")
                        return [`${value.toFixed(2)}%`, "failure rate"];
                      return [value.toLocaleString(), name];
                    }}
                  />
                  <Bar
                    dataKey={intSort}
                    fill="#ef4444"
                    radius={[0, 4, 4, 0]}
                  >
                    {topIntegrations.map((_, i) => (
                      <Cell
                        key={i}
                        fill={
                          intSort === "total"
                            ? "#0ea5e9"
                            : intSort === "failure_rate"
                              ? "#f59e0b"
                              : "#ef4444"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* Failed count over time — same time range, dot-based axis */}
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-ink-100 bg-ink-50/40 px-4 py-2">
            <h2 className="text-sm font-semibold text-ink-900">
              Failed count over time
            </h2>
            <div className="flex items-center gap-3 text-[11px] text-ink-600">
              <LegendDot color="#ef4444" label="failed" />
              <LegendDot color="#fca5a5" label="not-completed" />
            </div>
          </div>
          <div className="h-80 px-2 pb-3 pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
              >
                <CartesianGrid stroke="#eeeef0" strokeDasharray="3 3" />
                <XAxis
                  dataKey="ts"
                  tick={false}
                  axisLine={{ stroke: "#d9d9de" }}
                  tickLine={false}
                  height={20}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#6b6b78" }}
                  axisLine={{ stroke: "#d9d9de" }}
                  tickLine={false}
                  width={36}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 6,
                    border: "1px solid #d9d9de",
                  }}
                  labelFormatter={(label: string) =>
                    fmtTimestampFor(timeRange, label)
                  }
                />
                <Line
                  type="monotone"
                  dataKey="not_completed"
                  name="not-completed"
                  stroke="#fca5a5"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="failed"
                  name="failed"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  );
}

function TimeRangeSelect({
  value,
  onChange,
}: {
  value: TimeRange;
  onChange: (v: TimeRange) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-ink-200 bg-white text-[12px]">
      {TIME_RANGES.map((r) => (
        <button
          key={r.value}
          type="button"
          onClick={() => onChange(r.value)}
          className={`px-3 py-1.5 transition ${
            value === r.value
              ? "bg-ink-900 text-white"
              : "text-ink-700 hover:bg-ink-50"
          }`}
        >
          {r.label.replace("Past ", "")}
        </button>
      ))}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: color }}
      />
      <span>{label}</span>
    </span>
  );
}
