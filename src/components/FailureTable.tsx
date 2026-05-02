import { Fragment, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
} from "lucide-react";
import type { Failure, RecommendedAction } from "../types";
import StatusBadge from "./StatusBadge";
import ActionBadge from "./ActionBadge";
import Pill, { type PillTone } from "./Pill";
import { fmtMode } from "../api/format";
import type { GroupBy } from "./FilterBar";

interface Props {
  rows: Failure[];
  onSelect: (f: Failure) => void;
  groupBy: GroupBy;
}

const COLUMN_COUNT = 10;

const fmtMins = (n: number) => {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1440) return `${(n / 1440).toFixed(1)}d`;
  if (n >= 60) return `${(n / 60).toFixed(1)}h`;
  return `${n.toFixed(1)}m`;
};

const fmtEta = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}m`);

const ACTION_TONE: Record<RecommendedAction, PillTone> = {
  MARK_COMPLETE: "emerald",
  RETRIGGER: "blue",
  TRIGGERED: "violet",
  SKIP_RUNNING: "amber",
  MANUAL_REVIEW: "red",
  SKIP_OUT_OF_WINDOW: "ink",
};

const ACTION_SHORT: Record<RecommendedAction, string> = {
  MARK_COMPLETE: "MC",
  RETRIGGER: "RT",
  TRIGGERED: "TR",
  SKIP_RUNNING: "SR",
  MANUAL_REVIEW: "MR",
  SKIP_OUT_OF_WINDOW: "OW",
};

interface Group {
  key: string;
  label: string;
  sublabel?: string;
  rows: Failure[];
  byAction: Record<string, number>;
}

function buildGroups(rows: Failure[], groupBy: GroupBy): Group[] {
  if (groupBy === "none") return [];

  const map = new Map<string, Group>();
  for (const r of rows) {
    let key: string;
    let label: string;
    let sublabel: string | undefined;
    if (groupBy === "org") {
      key = r.org_id || "(unknown org)";
      label = r.org_name || "(unknown org)";
    } else if (groupBy === "integration") {
      key = r.integration_id || "(unknown integration)";
      label = r.integration_name || "(unknown integration)";
    } else {
      key = r.org_integration_id;
      label = r.integration_instance_name || "(unnamed instance)";
      sublabel = `${r.org_name} · ${r.integration_name}`;
    }

    let g = map.get(key);
    if (!g) {
      g = { key, label, sublabel, rows: [], byAction: {} };
      map.set(key, g);
    }
    g.rows.push(r);
    g.byAction[r.recommended_action] =
      (g.byAction[r.recommended_action] ?? 0) + 1;
  }

  return Array.from(map.values()).sort(
    (a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label)
  );
}

function FailureRow({ r, onSelect }: { r: Failure; onSelect: (f: Failure) => void }) {
  return (
    <tr
      onClick={() => onSelect(r)}
      className="cursor-pointer border-t border-ink-100 hover:bg-ink-50/60"
    >
      <td className="table-td whitespace-nowrap">
        <div className="font-medium text-ink-900">{r.ie_end_date}</div>
        <div className="mono text-[11px] text-ink-500">
          {new Date(r.createdAt).toUTCString().slice(17, 25)} UTC
        </div>
      </td>
      <td className="table-td">
        <div className="font-medium text-ink-900">{r.org_name}</div>
        <div className="text-[12px] text-ink-500">
          {r.integration_instance_name}
          <span className="mx-1 text-ink-300">·</span>
          {r.integration_name}
        </div>
      </td>
      <td className="table-td">
        <span className="mono text-[12px] text-ink-700">{fmtMode(r.mode)}</span>
      </td>
      <td className="table-td">
        <StatusBadge status={r.current_status} />
      </td>
      <td className="table-td">
        <ActionBadge action={r.recommended_action} />
      </td>
      <td className="table-td whitespace-nowrap">
        <span className="mono text-[12px] text-ink-700">
          {fmtMins(r.time_taken_by_ie_in_mins)}
          <span className="mx-1 text-ink-300">/</span>
          {fmtMins(r.time_taken_by_de_in_mins)}
        </span>
      </td>
      <td className="table-td whitespace-nowrap">
        <span className="mono text-[12px] text-ink-700">
          {fmtEta(r.eta_minutes)}
        </span>
      </td>
      <td className="table-td whitespace-nowrap">
        {r.latest_sync_timestamp ? (
          <span className="text-[12px] text-ink-700">
            {r.latest_sync_timestamp.slice(0, 10)}
          </span>
        ) : (
          <span className="text-[12px] text-ink-400">—</span>
        )}
      </td>
      <td className="table-td">
        {r.is_IE_bad_request ? (
          <Pill tone="red">Yes</Pill>
        ) : (
          <span className="text-[12px] text-ink-400">No</span>
        )}
      </td>
      <td className="table-td text-right">
        <ChevronRight className="ml-auto h-4 w-4 text-ink-400" />
      </td>
    </tr>
  );
}

function GroupHeader({
  group,
  expanded,
  onToggle,
}: {
  group: Group;
  expanded: boolean;
  onToggle: () => void;
}) {
  const breakdown = Object.entries(group.byAction)
    .sort((a, b) => b[1] - a[1]);
  return (
    <tr className="bg-ink-50/70">
      <td colSpan={COLUMN_COUNT} className="px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-ink-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-ink-500" />
          )}
          <span className="text-sm font-semibold text-ink-900">
            {group.label}
          </span>
          {group.sublabel && (
            <span className="text-[12px] text-ink-500">
              {group.sublabel}
            </span>
          )}
          <span className="text-ink-300">·</span>
          <span className="text-[12px] font-medium text-ink-700">
            {group.rows.length} failure
            {group.rows.length === 1 ? "" : "s"}
          </span>

          <div className="ml-auto flex items-center gap-1">
            {breakdown.map(([action, count]) => (
              <Pill
                key={action}
                tone={ACTION_TONE[action as RecommendedAction] ?? "neutral"}
                title={`${count} ${action}`}
              >
                {count} {ACTION_SHORT[action as RecommendedAction] ?? action}
              </Pill>
            ))}
          </div>
        </button>
      </td>
    </tr>
  );
}

export default function FailureTable({ rows, onSelect, groupBy }: Props) {
  const groups = useMemo(() => buildGroups(rows, groupBy), [rows, groupBy]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () =>
    setCollapsed(new Set(groups.map((g) => g.key)));

  const allExpanded = groupBy !== "none" && collapsed.size === 0;
  const allCollapsed =
    groupBy !== "none" && groups.length > 0 && collapsed.size === groups.length;

  return (
    <div className="card overflow-hidden">
      {groupBy !== "none" && groups.length > 0 && (
        <div className="flex items-center justify-between border-b border-ink-100 bg-ink-50/40 px-3 py-1.5 text-[12px]">
          <span className="text-ink-500">
            {groups.length} group{groups.length === 1 ? "" : "s"} ·{" "}
            {rows.length} row{rows.length === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={expandAll}
              disabled={allExpanded}
              className="btn h-7 px-2 py-0 text-[12px]"
            >
              <ChevronsUpDown className="h-3 w-3" />
              Expand all
            </button>
            <button
              type="button"
              onClick={collapseAll}
              disabled={allCollapsed}
              className="btn h-7 px-2 py-0 text-[12px]"
            >
              <ChevronsDownUp className="h-3 w-3" />
              Collapse all
            </button>
          </div>
        </div>
      )}
      <div className="max-h-[calc(100vh-280px)] overflow-auto">
        <table className="min-w-full">
          <thead>
            <tr>
              <th className="table-th">Date</th>
              <th className="table-th">Org · Integration</th>
              <th className="table-th">Mode</th>
              <th className="table-th">Status</th>
              <th className="table-th">Recommendation</th>
              <th className="table-th">IE / DE</th>
              <th className="table-th">ETA</th>
              <th className="table-th">Last completed</th>
              <th className="table-th">Bad req?</th>
              <th className="table-th"></th>
            </tr>
          </thead>
          <tbody>
            {groupBy === "none"
              ? rows.map((r) => (
                  <FailureRow
                    key={r.de_sync_status_id}
                    r={r}
                    onSelect={onSelect}
                  />
                ))
              : groups.map((g) => {
                  const expanded = !collapsed.has(g.key);
                  return (
                    <Fragment key={g.key}>
                      <GroupHeader
                        group={g}
                        expanded={expanded}
                        onToggle={() => toggle(g.key)}
                      />
                      {expanded &&
                        g.rows.map((r) => (
                          <FailureRow
                            key={r.de_sync_status_id}
                            r={r}
                            onSelect={onSelect}
                          />
                        ))}
                    </Fragment>
                  );
                })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
