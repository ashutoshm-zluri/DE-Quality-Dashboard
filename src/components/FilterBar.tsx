import { Search, X } from "lucide-react";
import type { RecommendedAction, SyncMode, SyncStatus } from "../types";
import { fmtMode } from "../api/format";

export type GroupBy = "none" | "org" | "integration" | "org_integration";

export interface Filters {
  search: string;
  mode: SyncMode | "all";
  status: SyncStatus | "all";
  action: RecommendedAction | "all";
  groupBy: GroupBy;
}

const GROUP_LABELS: Record<GroupBy, string> = {
  none: "No grouping",
  org: "By organization",
  integration: "By integration",
  org_integration: "By org-integration",
};

interface Props {
  filters: Filters;
  onChange: (next: Filters) => void;
  modeOptions: string[];
  statusOptions: string[];
  actionOptions: string[];
}

export default function FilterBar({
  filters,
  onChange,
  modeOptions,
  statusOptions,
  actionOptions,
}: Props) {
  const update = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    onChange({ ...filters, [k]: v });

  const reset = () =>
    onChange({
      search: "",
      mode: "all",
      status: "all",
      action: "all",
      groupBy: "none",
    });

  const isFiltered =
    filters.search.trim() !== "" ||
    filters.mode !== "all" ||
    filters.status !== "all" ||
    filters.action !== "all" ||
    filters.groupBy !== "none";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[240px]">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input
          className="input pl-8"
          placeholder="Search org, integration, sync id, error…"
          value={filters.search}
          onChange={(e) => update("search", e.target.value)}
        />
      </div>

      <select
        className="input w-auto"
        value={filters.mode}
        onChange={(e) => update("mode", e.target.value as Filters["mode"])}
      >
        <option value="all">All modes</option>
        {modeOptions.map((m) => (
          <option key={m || "__empty__"} value={m}>
            {fmtMode(m)}
          </option>
        ))}
      </select>

      <select
        className="input w-auto"
        value={filters.status}
        onChange={(e) => update("status", e.target.value as Filters["status"])}
      >
        <option value="all">All statuses</option>
        {statusOptions.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <select
        className="input w-auto"
        value={filters.action}
        onChange={(e) => update("action", e.target.value as Filters["action"])}
      >
        <option value="all">All actions</option>
        {actionOptions.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>

      <div className="ml-auto flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-ink-500">
          Group
        </span>
        <select
          className="input w-auto"
          value={filters.groupBy}
          onChange={(e) => update("groupBy", e.target.value as GroupBy)}
        >
          {(Object.keys(GROUP_LABELS) as GroupBy[]).map((g) => (
            <option key={g} value={g}>
              {GROUP_LABELS[g]}
            </option>
          ))}
        </select>
      </div>

      {isFiltered && (
        <button onClick={reset} className="btn">
          <X className="h-3.5 w-3.5" />
          Clear
        </button>
      )}
    </div>
  );
}
