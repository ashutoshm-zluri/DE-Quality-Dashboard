import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, Search } from "lucide-react";
import type { BadRequestsResponse } from "../types";
import { api } from "../api/client";
import { useEnv } from "../api/env";
import { paginate, usePageSize } from "../api/pagination";
import EmptyState from "../components/EmptyState";
import Spinner from "../components/Spinner";
import Pill, { type PillTone } from "../components/Pill";
import Pagination from "../components/Pagination";

const codeTone = (code: number): PillTone => {
  if (code === 400) return "red";
  if (code === 403) return "orange";
  if (code === 105) return "amber";
  return "neutral";
};

export default function BadRequestsPage() {
  const { env } = useEnv();
  const [data, setData] = useState<BadRequestsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("bad-requests");

  useEffect(() => setPage(1), [search, env]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = data?.items ?? [];
    if (!q) return items;
    return items.filter((r) =>
      [
        r.org_name,
        r.integration_instance_name,
        r.integration_name,
        r.sync_id,
        r.de_sync_status_id,
        r.org_integration_id,
        r.mode,
        r.validator_message,
        String(r.validator_status_code),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [data, search]);

  const visible = useMemo(
    () => paginate(filtered, page, pageSize),
    [filtered, page, pageSize]
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.badRequests(env));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [env]);

  return (
    <div className="px-6 py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">
            IE bad requests
          </h1>
          <p className="mt-1 text-xs text-ink-500">
            Validator-rejected events. These never started a DE sync — they
            need a payload or upstream config fix, not a retrigger.
          </p>
        </div>
        <button onClick={load} className="btn">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </header>

      <div className="mb-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            className="input pl-8"
            placeholder="Search org, integration, validator message, sync id…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <EmptyState title="Couldn't load bad requests" hint={error} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="No IE bad requests in window"
          icon={<AlertTriangle className="h-6 w-6" />}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No bad requests match the filter"
          hint="Try a different search."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="table-th">Date</th>
                  <th className="table-th">Org · Integration</th>
                  <th className="table-th">Mode</th>
                  <th className="table-th">Code</th>
                  <th className="table-th">Validator message</th>
                  <th className="table-th">Sync ID</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr
                    key={row.de_sync_status_id}
                    className="border-t border-ink-100 hover:bg-ink-50/40"
                  >
                    <td className="table-td mono">{row.ie_end_date}</td>
                    <td className="table-td">
                      <div className="font-medium text-ink-900">
                        {row.org_name}
                      </div>
                      <div className="text-[12px] text-ink-500">
                        {row.integration_instance_name}
                        <span className="mx-1 text-ink-300">·</span>
                        {row.integration_name}
                      </div>
                    </td>
                    <td className="table-td mono text-[12px]">{row.mode}</td>
                    <td className="table-td">
                      <Pill tone={codeTone(row.validator_status_code)}>
                        {row.validator_status_code}
                      </Pill>
                    </td>
                    <td className="table-td">
                      <span className="text-[12px] text-ink-700">
                        {row.validator_message}
                      </span>
                    </td>
                    <td className="table-td mono text-[12px] text-ink-600">
                      {row.sync_id}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            total={filtered.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
            itemLabel="bad requests"
          />
        </div>
      )}
    </div>
  );
}
