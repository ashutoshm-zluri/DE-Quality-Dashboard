import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  Bug as BugIcon,
  ChevronDown,
  ChevronRight,
  CloudDownload,
  ExternalLink,
  Loader2,
  RefreshCw,
  Settings as SettingsIcon,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Bug, JiraHealth, Label, Release } from "../types";
import { api } from "../api/client";
import { useAuth, isAdmin } from "../api/auth";
import { paginate, usePageSize } from "../api/pagination";
import { useSessionState } from "../api/storage";
import { useToast } from "../components/Toast";
import EmptyState from "../components/EmptyState";
import Spinner from "../components/Spinner";
import LabelChip from "../components/LabelChip";
import BugDetailModal from "../components/BugDetailModal";
import Pagination from "../components/Pagination";
import Pill from "../components/Pill";

// ── time helpers ─────────────────────────────────────────────────────────

function currentQY(): { year: number; quarter: number } {
  const d = new Date();
  return {
    year: d.getUTCFullYear(),
    quarter: Math.ceil((d.getUTCMonth() + 1) / 3),
  };
}

interface QuarterKey {
  year: number;
  quarter: number;
}

function qLabel(q: QuarterKey): string {
  return `Q${q.quarter} ${q.year}`;
}

/** True if both fields match. */
function qMatches(release: Release, q: QuarterKey | null): boolean {
  if (!q) return true;
  return release.year === q.year && release.quarter === q.quarter;
}

// ── filter ───────────────────────────────────────────────────────────────

type FilterMode =
  | { kind: "all" }
  | { kind: "current" }
  | { kind: "pick"; year: number; quarter: number };

/** What (year, quarter) the filter resolves to right now. `null` = all time. */
function resolve(f: FilterMode): QuarterKey | null {
  if (f.kind === "all") return null;
  if (f.kind === "current") return currentQY();
  return { year: f.year, quarter: f.quarter };
}

/** Year options for the dropdown: any year present in releases plus the
 *  current year (always selectable). Newest first. */
function yearOptions(releases: Release[]): number[] {
  const cur = new Date().getUTCFullYear();
  const set = new Set<number>([cur]);
  for (const r of releases) if (r.year) set.add(r.year);
  return Array.from(set).sort((a, b) => b - a);
}

// ── page ─────────────────────────────────────────────────────────────────

export default function ReleaseTrackerPage() {
  const { user } = useAuth();
  const toast = useToast();
  const admin = isAdmin(user);
  const [view, setView] = useSessionState<"list" | "analyse">(
    "releases.view",
    "list"
  );
  const [releases, setReleases] = useState<Release[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [jira, setJira] = useState<JiraHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selectedBug, setSelectedBug] = useState<{
    release: Release;
    bug: Bug;
  } | null>(null);

  const [filter, setFilter] = useSessionState<FilterMode>(
    "releases.filter",
    { kind: "current" }
  );
  const [page, setPage] = useSessionState<number>("releases.page", 1);
  const [pageSize, setPageSize] = usePageSize("releases");

  // Bulk-sync state
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [syncSummary, setSyncSummary] = useState<{
    ok: number;
    failed: number;
    errors: string[];
  } | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [r, l, j] = await Promise.all([
        api.releases.list(),
        api.labels.list(),
        api.jira.health().catch(() => null),
      ]);
      setReleases(r.items);
      setLabels(l.items);
      setJira(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => setPage(1), [filter, setPage]);

  // Auto-clear the sync summary banner after 8s
  useEffect(() => {
    if (!syncSummary) return;
    const t = setTimeout(() => setSyncSummary(null), 8_000);
    return () => clearTimeout(t);
  }, [syncSummary]);

  const years = useMemo(() => yearOptions(releases), [releases]);

  const filteredReleases = useMemo(() => {
    const target = resolve(filter);
    if (!target) return releases;
    return releases.filter((r) => qMatches(r, target));
  }, [releases, filter]);

  const syncAll = async () => {
    if (syncingAll) return;
    setSyncingAll(true);
    setSyncSummary(null);
    setSyncProgress({ done: 0, total: releases.length });
    let ok = 0;
    let failed = 0;
    const errors: string[] = [];
    // Sequential to be friendly to Jira's rate limits.
    for (let i = 0; i < releases.length; i++) {
      const r = releases[i];
      try {
        await api.releases.syncFromJira(r.id);
        ok++;
      } catch (e) {
        failed++;
        errors.push(
          `${r.name}: ${e instanceof Error ? e.message : "unknown error"}`
        );
      }
      setSyncProgress({ done: i + 1, total: releases.length });
    }
    setSyncingAll(false);
    setSyncProgress(null);
    setSyncSummary({ ok, failed, errors });
    if (failed === 0) {
      toast.success(`Synced ${ok} release${ok === 1 ? "" : "s"} from Jira`);
    } else {
      toast.info(
        `${ok} synced, ${failed} failed`,
        "See banner above for details."
      );
    }
    await load();
  };

  const visibleReleases = useMemo(() => {
    // Single quarter (current or picked): no pagination needed.
    if (filter.kind !== "all") return filteredReleases;
    return paginate(filteredReleases, page, pageSize);
  }, [filteredReleases, filter.kind, page, pageSize]);

  if (loading) return <Spinner />;
  if (err) return <EmptyState title="Couldn't load releases" hint={err} />;

  if (view === "analyse") {
    return (
      <AnalyseView
        releases={releases}
        labels={labels}
        onBack={() => setView("list")}
        initialFilter={filter}
      />
    );
  }

  const totalBugsAcrossAll = releases.reduce((a, r) => a + r.bugs.length, 0);

  return (
    <div className="px-6 py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">
            Release tracker
          </h1>
          <p className="mt-1 text-xs text-ink-500">
            {releases.length} release{releases.length === 1 ? "" : "s"} ·{" "}
            {totalBugsAcrossAll} total bugs
            {jira && !jira.configured && (
              <>
                {" · "}
                <span className="text-amber-700">Jira not configured</span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={load} className="btn">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          {admin && (
            <button
              onClick={syncAll}
              disabled={
                syncingAll || !(jira?.configured) || releases.length === 0
              }
              className="btn"
              title={
                !jira?.configured
                  ? "Set JIRA_EMAIL + JIRA_API_TOKEN in .env to enable"
                  : `Re-sync all ${releases.length} releases from Jira`
              }
            >
              {syncingAll ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CloudDownload className="h-3.5 w-3.5" />
              )}
              Sync all from Jira
            </button>
          )}
          <Link to="/settings" className="btn">
            <SettingsIcon className="h-3.5 w-3.5" />
            Settings
          </Link>
          <button
            onClick={() => setView("analyse")}
            disabled={releases.length === 0}
            className="btn-primary"
          >
            <BarChart3 className="h-4 w-4" />
            Analyse
          </button>
        </div>
      </header>

      {syncProgress && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2 text-[12px] text-blue-900">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Syncing release{syncProgress.total === 1 ? "" : "s"} from Jira ·{" "}
          <strong>
            {syncProgress.done} / {syncProgress.total}
          </strong>
        </div>
      )}

      {syncSummary && !syncingAll && (
        <div
          className={`mb-3 rounded-md border px-3 py-2 text-[12px] ${
            syncSummary.failed === 0
              ? "border-emerald-200 bg-emerald-50/60 text-emerald-800"
              : "border-amber-200 bg-amber-50/60 text-amber-900"
          }`}
        >
          Synced{" "}
          <strong>
            {syncSummary.ok} / {syncSummary.ok + syncSummary.failed}
          </strong>{" "}
          releases.
          {syncSummary.failed > 0 && (
            <>
              {" "}
              <strong>{syncSummary.failed}</strong> failed:
              <ul className="mt-1 list-disc pl-5">
                {syncSummary.errors.slice(0, 5).map((e, i) => (
                  <li key={i} className="mono text-[11px]">
                    {e}
                  </li>
                ))}
                {syncSummary.errors.length > 5 && (
                  <li className="text-[11px]">
                    …and {syncSummary.errors.length - 5} more
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
      )}

      {jira && !jira.configured && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-[12px] text-amber-900">
          <strong className="font-semibold">Jira sync disabled.</strong> Set{" "}
          <span className="mono">JIRA_EMAIL</span> and{" "}
          <span className="mono">JIRA_API_TOKEN</span> in{" "}
          <span className="mono">reRunSyncs/.env</span>.
        </div>
      )}

      <QuarterFilter
        years={years}
        filter={filter}
        onChange={setFilter}
      />

      {filteredReleases.length === 0 ? (
        <EmptyState
          title={
            filter.kind === "all"
              ? "No releases tracked yet"
              : `No releases in ${qLabel(resolve(filter)!)}`
          }
          hint={
            <>
              Add one from{" "}
              <Link to="/settings" className="underline">
                Settings
              </Link>
              .
            </>
          }
          icon={<BugIcon className="h-6 w-6" />}
        />
      ) : (
        <div className="space-y-3">
          {visibleReleases.map((r) => (
            <ReleaseCard
              key={r.id}
              release={r}
              labels={labels}
              jiraConfigured={jira?.configured ?? false}
              canSync={admin}
              onChange={load}
              onSelectBug={(bug) => setSelectedBug({ release: r, bug })}
            />
          ))}

          {filter.kind === "all" && (
            <div className="card overflow-hidden">
              <Pagination
                total={filteredReleases.length}
                page={page}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={(s) => {
                  setPageSize(s);
                  setPage(1);
                }}
                itemLabel="releases"
              />
            </div>
          )}
        </div>
      )}

      <BugDetailModal
        open={selectedBug !== null}
        bug={selectedBug?.bug ?? null}
        release={selectedBug?.release ?? releases[0]!}
        labels={labels}
        onClose={() => setSelectedBug(null)}
        onChange={load}
      />
    </div>
  );
}

function QuarterFilter({
  years,
  filter,
  onChange,
}: {
  years: number[];
  filter: FilterMode;
  onChange: (f: FilterMode) => void;
}) {
  // Effective Q + Y the dropdowns should display. Defaults to current when
  // we're in all-time / current modes; otherwise the user's pick.
  const effective = (() => {
    if (filter.kind === "pick") {
      return { year: filter.year, quarter: filter.quarter };
    }
    return currentQY();
  })();

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-md border border-ink-200 bg-white p-0.5">
        <button
          type="button"
          onClick={() => onChange({ kind: "all" })}
          className={`rounded px-3 py-1 text-[12px] font-medium transition ${
            filter.kind === "all"
              ? "bg-ink-900 text-white"
              : "text-ink-700 hover:bg-ink-50"
          }`}
        >
          All time
        </button>
        <button
          type="button"
          onClick={() => onChange({ kind: "current" })}
          className={`rounded px-3 py-1 text-[12px] font-medium transition ${
            filter.kind === "current"
              ? "bg-ink-900 text-white"
              : "text-ink-700 hover:bg-ink-50"
          }`}
        >
          Current quarter
        </button>
      </div>

      <span className="text-[11px] text-ink-400">or pick</span>

      <select
        className="input h-8 w-auto py-0 text-[12px]"
        value={effective.quarter}
        onChange={(e) =>
          onChange({
            kind: "pick",
            year: effective.year,
            quarter: Number(e.target.value),
          })
        }
        title="Quarter"
      >
        {[1, 2, 3, 4].map((q) => (
          <option key={q} value={q}>
            Q{q}
          </option>
        ))}
      </select>
      <select
        className="input h-8 w-auto py-0 text-[12px]"
        value={effective.year}
        onChange={(e) =>
          onChange({
            kind: "pick",
            year: Number(e.target.value),
            quarter: effective.quarter,
          })
        }
        title="Year"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>

      {filter.kind === "pick" && (
        <span className="ml-auto text-[11px] text-ink-500">
          showing <span className="mono">Q{filter.quarter} {filter.year}</span>
        </span>
      )}
    </div>
  );
}

// ── Release card with expandable bug list ─────────────────────────────────
function ReleaseCard({
  release,
  labels,
  jiraConfigured,
  canSync,
  onChange,
  onSelectBug,
}: {
  release: Release;
  labels: Label[];
  jiraConfigured: boolean;
  canSync: boolean;
  onChange: () => void;
  onSelectBug: (b: Bug) => void;
}) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const labelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const b of release.bugs) {
      for (const id of b.label_ids) counts[id] = (counts[id] ?? 0) + 1;
    }
    return counts;
  }, [release.bugs]);

  const sync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSyncing(true);
    try {
      await api.releases.syncFromJira(release.id);
      toast.success(`Synced ${release.name}`);
      onChange();
    } catch (e) {
      toast.fromError(e, `Sync failed: ${release.name}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-ink-500" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-ink-900">
                {release.name}
              </span>
              {release.quarter && release.year && (
                <Pill tone="violet">
                  Q{release.quarter} {release.year}
                </Pill>
              )}
              <a
                href={release.jira_url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-0.5 text-[12px] text-ink-500 hover:text-ink-900 hover:underline"
              >
                {release.jira_id}
                <ExternalLink className="h-3 w-3" />
              </a>
              {release.released_on && (
                <span className="text-[12px] text-ink-500">
                  · released {release.released_on}
                </span>
              )}
              {release.last_synced_at && (
                <span className="text-[11px] text-ink-400">
                  · synced{" "}
                  {new Date(release.last_synced_at).toLocaleString()}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-medium text-ink-700">
                {release.bugs.length} bug
                {release.bugs.length === 1 ? "" : "s"}
              </span>
              {Object.entries(labelCounts).map(([labelId, count]) => {
                const l = labels.find((x) => x.id === labelId);
                if (!l) return null;
                return (
                  <span
                    key={labelId}
                    className="inline-flex items-center gap-1"
                  >
                    <LabelChip label={l} />
                    <span className="text-[11px] text-ink-500">×{count}</span>
                  </span>
                );
              })}
            </div>
          </div>
        </button>

        {canSync && (
          <button
            onClick={sync}
            disabled={syncing || !jiraConfigured}
            className="btn"
            title={
              jiraConfigured
                ? "Pull child issues from Jira and refresh bug list"
                : "Set JIRA_EMAIL + JIRA_API_TOKEN in .env to enable"
            }
          >
            {syncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Sync from Jira
          </button>
        )}
      </div>

      {expanded && (
        <div className="border-t border-ink-100 bg-ink-50/30 px-4 py-3">
          <BugsList
            release={release}
            labels={labels}
            onSelectBug={onSelectBug}
          />
        </div>
      )}
    </div>
  );
}

function BugsList({
  release,
  labels,
  onSelectBug,
}: {
  release: Release;
  labels: Label[];
  onSelectBug: (b: Bug) => void;
}) {
  if (release.bugs.length === 0) {
    return (
      <div className="text-[12px] text-ink-400">
        No bugs synced yet. Click "Sync from Jira" to pull child issues from
        the parent epic.
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {release.bugs.map((b) => (
        <BugRow key={b.id} bug={b} labels={labels} onClick={() => onSelectBug(b)} />
      ))}
    </div>
  );
}

function BugRow({
  bug,
  labels,
  onClick,
}: {
  bug: Bug;
  labels: Label[];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-md border border-ink-100 bg-white px-3 py-2 text-left transition hover:bg-ink-50/60 hover:shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {bug.jira_id ? (
              <span className="mono text-[12px] text-blue-700">
                {bug.jira_id}
              </span>
            ) : (
              <span className="mono text-[12px] text-ink-500">—</span>
            )}
            <span className="truncate text-sm text-ink-900">{bug.title}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {bug.jira_meta?.status && (
              <span className="text-[11px] text-ink-500">
                {bug.jira_meta.status}
              </span>
            )}
            {bug.jira_meta?.assignee && (
              <span className="text-[11px] text-ink-500">
                · {bug.jira_meta.assignee.name}
              </span>
            )}
            {bug.label_ids.length > 0 && (
              <span className="ml-1 flex flex-wrap items-center gap-1">
                {bug.label_ids
                  .map((id) => labels.find((l) => l.id === id))
                  .filter((l): l is Label => !!l)
                  .map((l) => (
                    <LabelChip key={l.id} label={l} />
                  ))}
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />
      </div>
    </button>
  );
}

// ── Analyse view (charts) ─────────────────────────────────────────────────

interface MemberMetric {
  email: string;
  name: string;
  total: number;
  fixed: number;
  pending: number;
}

function aggregateByAssignee(releases: Release[]): MemberMetric[] {
  const map = new Map<string, MemberMetric>();
  for (const r of releases) {
    for (const b of r.bugs) {
      const a = b.jira_meta?.assignee;
      const email = a?.email ?? a?.name ?? "(unassigned)";
      const name = a?.name ?? "(unassigned)";
      const cat = b.jira_meta?.status_category;
      const isDone = cat === "done";
      const cur = map.get(email) ?? {
        email,
        name,
        total: 0,
        fixed: 0,
        pending: 0,
      };
      cur.total += 1;
      if (isDone) cur.fixed += 1;
      else cur.pending += 1;
      map.set(email, cur);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

function AnalyseView({
  releases,
  labels,
  onBack,
  initialFilter,
}: {
  releases: Release[];
  labels: Label[];
  onBack: () => void;
  initialFilter: FilterMode;
}) {
  const [filter, setFilter] = useState<FilterMode>(initialFilter);
  const years = useMemo(() => yearOptions(releases), [releases]);

  const scoped = useMemo(() => {
    const target = resolve(filter);
    if (!target) return releases;
    return releases.filter((r) => qMatches(r, target));
  }, [releases, filter]);

  const releaseSeries = useMemo(() => {
    return [...scoped]
      .sort((a, b) =>
        (a.released_on ?? a.created_at).localeCompare(
          b.released_on ?? b.created_at
        )
      )
      .map((r) => ({
        name: r.name,
        bugs: r.bugs.length,
        ...labels.reduce<Record<string, number>>((acc, l) => {
          acc[l.id] = r.bugs.filter((b) => b.label_ids.includes(l.id)).length;
          return acc;
        }, {}),
      }));
  }, [scoped, labels]);

  const labelSeries = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of scoped) {
      for (const b of r.bugs) {
        for (const id of b.label_ids) counts[id] = (counts[id] ?? 0) + 1;
      }
    }
    return labels
      .map((l) => ({
        id: l.id,
        name: l.name,
        color: l.color,
        count: counts[l.id] ?? 0,
      }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [scoped, labels]);

  const memberMetrics = useMemo(() => aggregateByAssignee(scoped), [scoped]);

  // Per-quarter trend (always shown — useful regardless of the current
  // filter, to give historic context).
  const quarterSeries = useMemo(() => {
    const map = new Map<
      string,
      { label: string; bugs: number; fixed: number; pending: number }
    >();
    for (const r of releases) {
      if (!r.year || !r.quarter) continue;
      const k = `${r.year}-q${r.quarter}`;
      const cur = map.get(k) ?? {
        label: `Q${r.quarter} ${String(r.year).slice(2)}`,
        bugs: 0,
        fixed: 0,
        pending: 0,
      };
      for (const b of r.bugs) {
        cur.bugs += 1;
        if (b.jira_meta?.status_category === "done") cur.fixed += 1;
        else cur.pending += 1;
      }
      map.set(k, cur);
    }
    // Sort old → new for the chart x-axis
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, v]) => v);
  }, [releases]);

  const totalBugs = scoped.reduce((a, r) => a + r.bugs.length, 0);
  const fixedBugs = scoped
    .flatMap((r) => r.bugs)
    .filter((b) => b.jira_meta?.status_category === "done").length;
  const pendingBugs = totalBugs - fixedBugs;
  const avgPerRelease = scoped.length ? totalBugs / scoped.length : 0;
  const max = Math.max(...releaseSeries.map((r) => r.bugs), 0);
  const trend =
    releaseSeries.length >= 2
      ? releaseSeries[releaseSeries.length - 1].bugs -
        releaseSeries[releaseSeries.length - 2].bugs
      : 0;

  return (
    <div className="px-6 py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <button
            onClick={onBack}
            className="mb-2 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to releases
          </button>
          <h1 className="text-xl font-semibold text-ink-900">
            Release tracker · analysis
          </h1>
          <p className="mt-1 text-xs text-ink-500">
            {filter.kind === "all"
              ? `Across all ${releases.length} release${releases.length === 1 ? "" : "s"}`
              : `Across ${scoped.length} release${scoped.length === 1 ? "" : "s"} in ${qLabel(resolve(filter)!)}`}
          </p>
        </div>
      </header>

      <QuarterFilter years={years} filter={filter} onChange={setFilter} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Total bugs" value={String(totalBugs)} />
        <Kpi
          label="Fixed"
          value={String(fixedBugs)}
          hint={`${totalBugs ? ((fixedBugs / totalBugs) * 100).toFixed(0) : 0}% done`}
        />
        <Kpi
          label="Pending"
          value={String(pendingBugs)}
          tone={pendingBugs > 0 ? "danger" : "default"}
        />
        <Kpi label="Releases" value={String(scoped.length)} />
        <Kpi
          label="Avg / release"
          value={avgPerRelease.toFixed(1)}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <section className="card overflow-hidden">
          <div className="border-b border-ink-100 bg-ink-50/40 px-4 py-2">
            <h2 className="text-sm font-semibold text-ink-900">
              Bugs per release
            </h2>
            <p className="mt-0.5 text-[11px] text-ink-500">
              {trend === 0
                ? "no change vs previous"
                : trend > 0
                  ? `up ${trend} vs previous release`
                  : `down ${Math.abs(trend)} vs previous release`}
            </p>
          </div>
          <div className="h-72 px-2 pb-3 pt-4">
            {releaseSeries.length === 0 ? (
              <EmptyState title="No releases in this view" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={releaseSeries}
                  margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
                >
                  <CartesianGrid stroke="#eeeef0" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "#6b6b78" }}
                    axisLine={{ stroke: "#d9d9de" }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "#6b6b78" }}
                    axisLine={{ stroke: "#d9d9de" }}
                    tickLine={false}
                    width={32}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 6,
                      border: "1px solid #d9d9de",
                    }}
                  />
                  <Bar dataKey="bugs" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-ink-100 bg-ink-50/40 px-4 py-2">
            <h2 className="text-sm font-semibold text-ink-900">
              Bugs by label
            </h2>
            <p className="mt-0.5 text-[11px] text-ink-500">
              {filter.kind === "all"
                ? "Across all releases."
                : `In ${qLabel(resolve(filter)!)}.`}
            </p>
          </div>
          <div className="h-72 px-2 pb-3 pt-4">
            {labelSeries.length === 0 ? (
              <EmptyState title="No labels applied yet" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={labelSeries}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
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
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "#3a3a45" }}
                    axisLine={false}
                    tickLine={false}
                    width={120}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 6,
                      border: "1px solid #d9d9de",
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {labelSeries.map((row, i) => (
                      <Cell
                        key={i}
                        fill={LABEL_COLOR_HEX[row.color] ?? "#6b7280"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* Per-quarter trend — kept full-width regardless of current filter,
            shows historic context */}
        <section className="card overflow-hidden xl:col-span-2">
          <div className="border-b border-ink-100 bg-ink-50/40 px-4 py-2">
            <h2 className="text-sm font-semibold text-ink-900">
              Bugs by quarter
            </h2>
            <p className="mt-0.5 text-[11px] text-ink-500">
              All-time history. Stacked: fixed vs pending.
            </p>
          </div>
          <div className="h-72 px-2 pb-3 pt-4">
            {quarterSeries.length === 0 ? (
              <EmptyState title="Not enough history yet" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={quarterSeries}
                  margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
                >
                  <CartesianGrid stroke="#eeeef0" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "#6b6b78" }}
                    axisLine={{ stroke: "#d9d9de" }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "#6b6b78" }}
                    axisLine={{ stroke: "#d9d9de" }}
                    tickLine={false}
                    width={32}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 6,
                      border: "1px solid #d9d9de",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="fixed"
                    stackId="a"
                    fill="#10b981"
                    name="fixed"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="pending"
                    stackId="a"
                    fill="#ef4444"
                    name="pending"
                    radius={[0, 0, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* Per-member metrics */}
        <section className="card overflow-hidden xl:col-span-2">
          <div className="border-b border-ink-100 bg-ink-50/40 px-4 py-2">
            <h2 className="text-sm font-semibold text-ink-900">
              Bugs by assignee
            </h2>
            <p className="mt-0.5 text-[11px] text-ink-500">
              From Jira's <span className="mono">assignee</span> +{" "}
              <span className="mono">status_category</span>. Pending = todo or
              in-progress.
            </p>
          </div>
          {memberMetrics.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12px] text-ink-400">
              No bug ownership data — sync from Jira first.
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className="table-th">Assignee</th>
                    <th className="table-th">Total</th>
                    <th className="table-th">Fixed</th>
                    <th className="table-th">Pending</th>
                    <th className="table-th">Fix rate</th>
                  </tr>
                </thead>
                <tbody>
                  {memberMetrics.map((m) => {
                    const fixRate =
                      m.total === 0 ? 0 : (m.fixed / m.total) * 100;
                    return (
                      <tr
                        key={m.email}
                        className="border-t border-ink-100 hover:bg-ink-50/40"
                      >
                        <td className="table-td">
                          <div className="font-medium text-ink-900">
                            {m.name}
                          </div>
                          {m.email !== m.name && (
                            <div className="mono text-[11px] text-ink-500">
                              {m.email}
                            </div>
                          )}
                        </td>
                        <td className="table-td font-medium text-ink-900">
                          {m.total}
                        </td>
                        <td className="table-td text-emerald-700">
                          {m.fixed}
                        </td>
                        <td
                          className={`table-td ${m.pending > 0 ? "text-red-600" : "text-ink-500"}`}
                        >
                          {m.pending}
                        </td>
                        <td className="table-td">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 rounded-full bg-ink-100">
                              <div
                                className="h-1.5 rounded-full bg-emerald-500"
                                style={{
                                  width: `${Math.min(100, fixRate)}%`,
                                }}
                              />
                            </div>
                            <span className="mono text-[11px] text-ink-700">
                              {fixRate.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const LABEL_COLOR_HEX: Record<string, string> = {
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  blue: "#0ea5e9",
  violet: "#8b5cf6",
  emerald: "#10b981",
  ink: "#3a3a45",
  neutral: "#6b6b78",
};

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "danger";
}) {
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
