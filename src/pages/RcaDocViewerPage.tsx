import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Download,
  Edit3,
  Loader2,
  Save,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { RcaDocWithContent, TeamMember } from "../types";
import { api } from "../api/client";
import { useAuth } from "../api/auth";
import { canEditRca } from "../api/permissions";
import { useToast } from "../components/Toast";
import EmptyState from "../components/EmptyState";
import Spinner from "../components/Spinner";
import Pill from "../components/Pill";
import ConfirmDialog from "../components/ConfirmDialog";

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

interface Draft {
  name: string;
  owner: string;
  reviewer: string;
  tags: string;
  content: string;
}

function draftFromDoc(d: RcaDocWithContent): Draft {
  return {
    name: d.name,
    owner: d.owner,
    reviewer: d.reviewer,
    tags: d.tags.join(", "),
    content: d.content,
  };
}

export default function RcaDocViewerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();

  const [doc, setDoc] = useState<RcaDocWithContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const [d, m] = await Promise.all([
        api.rca.get(id),
        api.members.list().catch(() => ({ items: [] })),
      ]);
      setDoc(d);
      setDraft(draftFromDoc(d));
      setMembers(m.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  // Auto-dismiss the "Saved" banner after 3s
  useEffect(() => {
    if (savedAt == null) return;
    const t = setTimeout(() => setSavedAt(null), 3000);
    return () => clearTimeout(t);
  }, [savedAt]);

  const save = async () => {
    if (!doc || !draft) return;
    setSaving(true);
    setErr(null);
    try {
      await api.rca.update(doc.id, {
        name: draft.name,
        owner: draft.owner,
        reviewer: draft.reviewer,
        tags: draft.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        content: draft.content,
      });
      const fresh = await api.rca.get(doc.id);
      setDoc(fresh);
      setDraft(draftFromDoc(fresh));
      // Stay on the page per spec — just exit edit mode and surface a
      // brief "Saved" indicator. User clicks Back when ready.
      setEditing(false);
      setSavedAt(Date.now());
    } catch (e) {
      toast.fromError(e, "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    if (!doc) return;
    setDraft(draftFromDoc(doc));
    setEditing(false);
    setErr(null);
  };

  const download = () => {
    if (!doc) return;
    const blob = new Blob([doc.content], {
      type: doc.format === "md" ? "text/markdown" : "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.name}.${doc.format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) return <Spinner />;
  if (err && !doc) {
    return (
      <div className="px-6 py-6">
        <button
          onClick={() => navigate("/rca")}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to RCA docs
        </button>
        <EmptyState title="Couldn't load doc" hint={err} />
      </div>
    );
  }
  if (!doc || !draft) {
    return (
      <div className="px-6 py-6">
        <button
          onClick={() => navigate("/rca")}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to RCA docs
        </button>
        <EmptyState title="Doc not found" />
      </div>
    );
  }

  const canWrite = canEditRca(user, doc);

  return (
    <div className="px-6 py-6">
      {/* Top row: back + format + saved banner + action buttons */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <button
          onClick={() => navigate("/rca")}
          className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to RCA docs
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {savedAt && (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[12px] font-medium text-emerald-700">
              <Check className="h-3.5 w-3.5" />
              Saved
            </span>
          )}
          {canWrite && !editing && (
            <button
              type="button"
              onClick={() => setConfirmDel(true)}
              className="btn-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          )}
          <button onClick={download} className="btn">
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
          {canWrite &&
            (editing ? (
              <>
                <button
                  onClick={cancelEdit}
                  disabled={saving}
                  className="btn"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="btn-primary"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="btn-primary"
              >
                <Edit3 className="h-4 w-4" />
                Edit
              </button>
            ))}
        </div>
      </div>

      {/* Header: name + meta */}
      <header className="mb-5 border-b border-ink-100 pb-4">
        {editing ? (
          <input
            className="input w-full text-xl font-semibold"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        ) : (
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-ink-900">{doc.name}</h1>
            <Pill tone={doc.format === "md" ? "violet" : "ink"}>
              .{doc.format}
            </Pill>
          </div>
        )}
        <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-[12px] text-ink-500 sm:grid-cols-2 lg:grid-cols-4">
          <MemberMetaField
            label="Owner"
            editing={editing}
            value={editing ? draft.owner : doc.owner}
            onChange={(v) => setDraft({ ...draft, owner: v })}
            members={members}
          />
          <MemberMetaField
            label="Reviewer"
            editing={editing}
            value={editing ? draft.reviewer : doc.reviewer}
            onChange={(v) => setDraft({ ...draft, reviewer: v })}
            members={members}
          />
          <div>
            <span className="text-[11px] uppercase tracking-wide text-ink-400">
              Size
            </span>
            <div className="text-ink-700">{fmtBytes(doc.size_bytes)}</div>
          </div>
          <div>
            <span className="text-[11px] uppercase tracking-wide text-ink-400">
              Updated
            </span>
            <div className="text-ink-700">
              {new Date(doc.updated_at).toLocaleString()}
            </div>
          </div>
        </div>

        {/* Tags */}
        <div className="mt-3">
          <span className="text-[11px] uppercase tracking-wide text-ink-400">
            Tags
          </span>
          {editing ? (
            <input
              className="input mt-1 w-full"
              placeholder="comma-separated"
              value={draft.tags}
              onChange={(e) =>
                setDraft({ ...draft, tags: e.target.value })
              }
            />
          ) : doc.tags.length === 0 ? (
            <div className="mt-1 text-[12px] text-ink-400">no tags</div>
          ) : (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {doc.tags.map((t) => (
                <Pill key={t} tone="ink">
                  {t}
                </Pill>
              ))}
            </div>
          )}
        </div>

      </header>

      {/* Body — full width, no card constraint */}
      {editing ? (
        <div>
          <label className="text-[11px] uppercase tracking-wide text-ink-400">
            Content (.{doc.format})
          </label>
          <textarea
            className="mono mt-1 h-[calc(100vh-360px)] min-h-[400px] w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-[13px] leading-relaxed text-ink-900 focus:border-ink-500 focus:outline-none focus:ring-1 focus:ring-ink-500"
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            spellCheck={false}
          />
          <div className="mt-1 text-[11px] text-ink-500">
            {fmtBytes(new Blob([draft.content]).size)} ·{" "}
            <span className="opacity-70">
              changes save with the Save button
            </span>
          </div>
        </div>
      ) : doc.format === "md" ? (
        <article className="markdown-body max-w-4xl text-[14px] leading-relaxed text-ink-900">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {doc.content || "*(empty)*"}
          </ReactMarkdown>
        </article>
      ) : (
        <pre className="mono max-w-4xl whitespace-pre-wrap text-[13px] leading-relaxed text-ink-900">
          {doc.content}
        </pre>
      )}

      <ConfirmDialog
        open={confirmDel}
        title={`Delete "${doc.name}"?`}
        message="This permanently removes the document and its file. This can't be undone."
        confirmLabel="Delete document"
        onClose={() => setConfirmDel(false)}
        onConfirm={async () => {
          try {
            await api.rca.remove(doc.id);
            toast.success("Document deleted");
            navigate("/rca");
          } catch (e) {
            toast.fromError(e, "Delete failed");
          }
        }}
      />
    </div>
  );
}

function MemberMetaField({
  label,
  editing,
  value,
  onChange,
  members,
}: {
  label: string;
  editing: boolean;
  value: string;
  onChange: (v: string) => void;
  members: TeamMember[];
}) {
  // When viewing, look up the member by email so we show their name; if no
  // match, fall back to whatever string is stored (legacy free-text values).
  const display = (() => {
    const m = members.find((x) => x.email === value);
    if (m) return `${m.name} · ${m.email}`;
    return value || "—";
  })();

  return (
    <div>
      <span className="text-[11px] uppercase tracking-wide text-ink-400">
        {label}
      </span>
      {editing ? (
        members.length === 0 ? (
          <input
            className="input mt-1 h-7 w-full py-0 text-[12px]"
            placeholder="email@zluri.com"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <select
            className="input mt-1 h-7 w-full py-0 text-[12px]"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">— none —</option>
            {/* Preserve a legacy value that doesn't match any member */}
            {value && !members.find((m) => m.email === value) && (
              <option value={value}>{value} (not in directory)</option>
            )}
            {members.map((m) => (
              <option key={m.id} value={m.email}>
                {m.name} · {m.email}
              </option>
            ))}
          </select>
        )
      ) : (
        <div className="text-ink-700">{display}</div>
      )}
    </div>
  );
}
