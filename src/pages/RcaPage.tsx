import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText,
  FilePlus,
  Plus,
  RefreshCw,
  Search,
  ScrollText,
  X,
} from "lucide-react";
import type { RcaDoc } from "../types";
import { api } from "../api/client";
import { useAuth } from "../api/auth";
import { canCreateRca } from "../api/permissions";
import { paginate, usePageSize } from "../api/pagination";
import { useSessionState } from "../api/storage";
import EmptyState from "../components/EmptyState";
import Spinner from "../components/Spinner";
import Pill from "../components/Pill";
import RcaUploadModal from "../components/RcaUploadModal";
import Pagination from "../components/Pagination";

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(s: string) {
  const d = new Date(s);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function RcaPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canWrite = canCreateRca(user);
  const [docs, setDocs] = useState<RcaDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useSessionState<string>("rca.search", "");
  const [tagFilter, setTagFilter] = useSessionState<string | null>(
    "rca.tagFilter",
    null
  );
  const [uploadOpen, setUploadOpen] = useState(false);
  const [page, setPage] = useSessionState<number>("rca.page", 1);
  const [pageSize, setPageSize] = usePageSize("rca");

  useEffect(() => setPage(1), [search, tagFilter, setPage]);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.rca.list();
      setDocs(r.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Distinct tags across all docs (for the quick-filter row)
  const allTags = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of docs)
      for (const t of d.tags) counts[t] = (counts[t] ?? 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [docs]);

  // Server returns docs sorted by updated_at desc (most recent first); we
  // keep that ordering through the filter so the most-recently-edited RCAs
  // surface first. Falling back to created_at for old docs.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = [...docs].sort((a, b) =>
      (b.updated_at ?? b.created_at).localeCompare(
        a.updated_at ?? a.created_at
      )
    );
    return list.filter((d) => {
      if (tagFilter && !d.tags.includes(tagFilter)) return false;
      if (!q) return true;
      const hay = [d.name, d.owner, d.reviewer, d.tags.join(" ")]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [docs, search, tagFilter]);

  const visible = useMemo(
    () => paginate(filtered, page, pageSize),
    [filtered, page, pageSize]
  );

  return (
    <div className="px-6 py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900">
            <ScrollText className="h-5 w-5 text-ink-700" />
            RCA documents
          </h1>
          <p className="mt-1 text-xs text-ink-500">
            Maintain weekly RCA discussion docs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={load} className="btn">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          {canWrite && (
            <button
              onClick={() => setUploadOpen(true)}
              className="btn"
            >
              <Plus className="h-4 w-4" />
              Upload doc
            </button>
          )}
          {canWrite && (
            <button
              onClick={() => navigate("/rca/new")}
              className="btn-primary"
            >
              <FilePlus className="h-4 w-4" />
              Create doc
            </button>
          )}
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            className="input pl-8"
            placeholder="Search by name, owner, reviewer, tag…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {tagFilter && (
          <button
            type="button"
            onClick={() => setTagFilter(null)}
            className="btn"
          >
            <X className="h-3.5 w-3.5" />
            Tag: {tagFilter}
          </button>
        )}
      </div>

      {allTags.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-500">
            Tags
          </span>
          {allTags.map(([t, n]) => (
            <button
              key={t}
              type="button"
              onClick={() => setTagFilter(tagFilter === t ? null : t)}
              className="rounded-full"
            >
              <Pill tone={tagFilter === t ? "blue" : "ink"}>
                {t} <span className="opacity-70">×{n}</span>
              </Pill>
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : err ? (
        <EmptyState title="Couldn't load RCA docs" hint={err} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={
            docs.length === 0 ? "No RCA docs yet" : "No docs match the filter"
          }
          hint={
            docs.length === 0
              ? canWrite
                ? "Click Upload doc to add the first one."
                : "No docs have been added yet."
              : "Try a different search or clear the tag filter."
          }
          icon={<FileText className="h-6 w-6" />}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {visible.map((d) => (
              <DocCard
                key={d.id}
                doc={d}
                onOpen={() => navigate(`/rca/${d.id}`)}
              />
            ))}
          </div>
          <div className="mt-3 card overflow-hidden">
            <Pagination
              total={filtered.length}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(1);
              }}
              itemLabel="docs"
            />
          </div>
        </>
      )}

      <RcaUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUpload={async (input) => {
          const created = await api.rca.create(input);
          // Land directly on the new doc — usually you upload to read or
          // edit, so skip the round-trip through the list.
          navigate(`/rca/${created.id}`);
        }}
      />
    </div>
  );
}

function DocCard({ doc, onOpen }: { doc: RcaDoc; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card flex w-full flex-col items-stretch px-4 py-3 text-left transition hover:translate-y-[-1px] hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
            doc.format === "md"
              ? "bg-violet-50 text-violet-700"
              : "bg-ink-100 text-ink-600"
          }`}
        >
          <FileText className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="truncate text-base font-semibold text-ink-900">
              {doc.name}
            </span>
            <Pill tone={doc.format === "md" ? "violet" : "ink"}>
              .{doc.format}
            </Pill>
          </div>
          <div className="mt-0.5 text-[12px] text-ink-500">
            Owner:{" "}
            <span className="text-ink-700">{doc.owner || "—"}</span>
            <span className="mx-1 text-ink-300">·</span>
            Reviewer:{" "}
            <span className="text-ink-700">{doc.reviewer || "—"}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {doc.tags.length === 0 ? (
              <span className="text-[11px] text-ink-400">no tags</span>
            ) : (
              doc.tags.map((t) => (
                <Pill key={t} tone="ink">
                  {t}
                </Pill>
              ))
            )}
          </div>
          <div className="mt-2 text-[11px] text-ink-500">
            {fmtBytes(doc.size_bytes)}
            <span className="mx-1 text-ink-300">·</span>
            updated {fmtDate(doc.updated_at)}
          </div>
        </div>
      </div>
    </button>
  );
}
