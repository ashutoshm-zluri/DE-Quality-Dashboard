import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Download,
  Eye,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TeamMember } from "../types";
import { api } from "../api/client";
import { useAuth } from "../api/auth";
import { canCreateRca } from "../api/permissions";
import { useLocalDraft } from "../api/storage";
import { useToast } from "../components/Toast";
import MarkdownToolbar, {
  type MarkdownEdit,
} from "../components/MarkdownToolbar";
import Pill from "../components/Pill";

/** Q/A block — one question (single-line) + one answer (multi-line markdown). */
interface QABlock {
  id: string;
  question: string;
  answer: string;
}

function newBlock(seedQ = ""): QABlock {
  return {
    id: `qa_${Math.random().toString(36).slice(2, 10)}`,
    question: seedQ,
    answer: "",
  };
}

const INITIAL_BLOCKS: QABlock[] = [
  newBlock("What broke?"),
  newBlock("What was the root cause?"),
  newBlock("What's the action plan to prevent it?"),
];

const MAX_BYTES = 5 * 1024 * 1024; // mirrors server cap

function compileMarkdown(opts: {
  title: string;
  owner: string;
  reviewer: string;
  tags: string[];
  blocks: QABlock[];
}): string {
  const lines: string[] = [];
  lines.push(`# ${opts.title.trim() || "Untitled RCA"}`);
  lines.push("");

  const meta: string[] = [];
  if (opts.owner) meta.push(`**Owner:** ${opts.owner}`);
  if (opts.reviewer) meta.push(`**Reviewer:** ${opts.reviewer}`);
  if (opts.tags.length > 0) meta.push(`**Tags:** ${opts.tags.join(", ")}`);
  if (meta.length) {
    lines.push(meta.join(" · "));
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  for (const b of opts.blocks) {
    const q = b.question.trim();
    const a = b.answer.trim();
    if (!q && !a) continue;
    lines.push(`## ${q || "Question"}`);
    lines.push("");
    lines.push(a || "_(no answer yet)_");
    lines.push("");
  }
  return lines.join("\n");
}

function safeFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `${slug || "rca"}.md`;
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

interface CreatorDraft {
  title: string;
  owner: string;
  reviewer: string;
  tags: string[];
  blocks: QABlock[];
}

const EMPTY_DRAFT: CreatorDraft = {
  title: "",
  owner: "",
  reviewer: "",
  tags: [],
  blocks: INITIAL_BLOCKS,
};

export default function RcaCreatorPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const canWrite = canCreateRca(user);

  // Persisted draft survives navigation away and accidental close.
  // `clearDraft()` runs on successful save below.
  const [draft, setDraft, clearDraft] = useLocalDraft<CreatorDraft>(
    "rca.creator.draft",
    EMPTY_DRAFT
  );
  const { title, owner, reviewer, tags, blocks } = draft;
  const setTitle = (v: string) => setDraft((d) => ({ ...d, title: v }));
  const setOwner = (v: string) => setDraft((d) => ({ ...d, owner: v }));
  const setReviewer = (v: string) => setDraft((d) => ({ ...d, reviewer: v }));
  const setTags = (v: string[] | ((p: string[]) => string[])) =>
    setDraft((d) => ({
      ...d,
      tags: typeof v === "function" ? v(d.tags) : v,
    }));
  const setBlocks = (v: QABlock[] | ((p: QABlock[]) => QABlock[])) =>
    setDraft((d) => ({
      ...d,
      blocks: typeof v === "function" ? v(d.blocks) : v,
    }));

  const [tagDraft, setTagDraft] = useState("");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [preview, setPreview] = useState(false);

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Block viewers from this page entirely — bounce them to the list.
  useEffect(() => {
    if (user && !canWrite) navigate("/rca", { replace: true });
  }, [user, canWrite, navigate]);

  // Active textarea tracking — toolbar buttons need to know which Q/A
  // answer is focused so they can wrap/insert at the right caret.
  const refs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const activeIdRef = useRef<string | null>(null);
  // Force re-render of the toolbar (via state bump) when activeId changes.
  const [, bump] = useState(0);
  const setActive = (id: string | null) => {
    activeIdRef.current = id;
    bump((n) => n + 1);
  };

  useEffect(() => {
    api.members
      .list()
      .then((r) => setMembers(r.items))
      .catch(() => setMembers([]));
  }, []);

  useEffect(() => {
    if (!savedAt) return;
    const t = setTimeout(() => setSavedAt(null), 5000);
    return () => clearTimeout(t);
  }, [savedAt]);

  const compiled = useMemo(
    () => compileMarkdown({ title, owner, reviewer, tags, blocks }),
    [title, owner, reviewer, tags, blocks]
  );
  const compiledSize = new Blob([compiled]).size;

  const addBlock = () => {
    const b = newBlock();
    setBlocks((prev) => [...prev, b]);
    // Focus the new answer once it's mounted
    setTimeout(() => {
      const el = refs.current.get(b.id);
      if (el) {
        el.focus();
        setActive(b.id);
      }
    }, 0);
  };

  const removeBlock = (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    if (activeIdRef.current === id) setActive(null);
    refs.current.delete(id);
  };

  const updateBlock = (id: string, patch: Partial<QABlock>) =>
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, ...patch } : b))
    );

  const addTag = () => {
    const t = tagDraft.trim();
    if (!t) return;
    if (tags.includes(t)) return;
    setTags((prev) => [...prev, t]);
    setTagDraft("");
  };

  /** Receives toolbar edits — applies to the answer of `id`, restores caret. */
  const applyToolbarEdit = (id: string, edit: MarkdownEdit) => {
    updateBlock(id, { answer: edit.value });
    // Caret restore: setTimeout so React commits the new value first
    setTimeout(() => {
      const el = refs.current.get(id);
      if (el) {
        el.focus();
        el.setSelectionRange(edit.cursor, edit.cursor);
      }
    }, 0);
  };

  /** Always available — local download of the compiled markdown. */
  const downloadLocal = () => {
    const blob = new Blob([compiled], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeFilename(title);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const validate = (): string | null => {
    if (!title.trim()) return "Title is required";
    if (compiledSize > MAX_BYTES) {
      return `Doc is ${fmtBytes(compiledSize)} — exceeds the ${fmtBytes(MAX_BYTES)} cap. Trim images or split it.`;
    }
    return null;
  };

  const save = async () => {
    const v = validate();
    if (v) {
      setSaveErr(v);
      toast.error("Can't save", v);
      return;
    }
    setSaving(true);
    setSaveErr(null);
    try {
      const created = await api.rca.create({
        name: title.trim(),
        filename: safeFilename(title),
        content: compiled,
        owner: owner.trim(),
        reviewer: reviewer.trim(),
        tags,
      });
      toast.success("Doc saved", title.trim());
      setSavedAt(Date.now());
      clearDraft();
      // Brief delay so the user sees the toast, then go to the live doc.
      setTimeout(() => navigate(`/rca/${created.id}`), 1500);
    } catch (e) {
      toast.fromError(e, "Save failed");
      setSaveErr("Your draft is preserved. Use Download to save locally.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-6 py-6">
      {/* Toast — auto-dismisses after 5s */}
      {savedAt && (
        <div className="fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 shadow-lg">
          <span className="inline-flex items-center gap-2">
            <Check className="h-4 w-4" />
            Doc was saved successfully
          </span>
        </div>
      )}

      {/* Top bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => navigate("/rca")}
          className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to RCA docs
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {compiledSize > 0 && (
            <span className="text-[11px] text-ink-500">
              draft size: <span className="mono">{fmtBytes(compiledSize)}</span>
            </span>
          )}
          <button
            onClick={() => setPreview((v) => !v)}
            className="btn"
            title="Toggle live preview of the compiled markdown"
          >
            <Eye className="h-3.5 w-3.5" />
            {preview ? "Hide preview" : "Preview"}
          </button>
          <button onClick={downloadLocal} className="btn">
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
          <button
            onClick={save}
            disabled={saving || !title.trim()}
            className="btn-primary"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </button>
        </div>
      </div>

      {saveErr && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50/60 px-3 py-2 text-[12px] text-red-800">
          {saveErr}
        </div>
      )}

      {/* Header / metadata */}
      <header className="card mb-4 px-5 py-4">
        <input
          type="text"
          placeholder="Untitled RCA — click to set title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-transparent text-2xl font-semibold text-ink-900 outline-none placeholder:text-ink-400"
        />
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[11px] uppercase tracking-wide text-ink-500">
              Owner
            </label>
            <MemberSelect
              members={members}
              value={owner}
              onChange={setOwner}
              placeholder="— select owner —"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-ink-500">
              Reviewer
            </label>
            <MemberSelect
              members={members}
              value={reviewer}
              onChange={setReviewer}
              placeholder="— select reviewer —"
            />
          </div>
        </div>
        <div className="mt-3">
          <label className="text-[11px] uppercase tracking-wide text-ink-500">
            Tags
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-md border border-ink-200 bg-white px-2 py-1.5">
            {tags.map((t) => (
              <Pill key={t} tone="ink">
                {t}
                <button
                  type="button"
                  onClick={() => setTags((p) => p.filter((x) => x !== t))}
                  className="-mr-1 ml-0.5 rounded-full p-0.5 hover:bg-black/10"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Pill>
            ))}
            <input
              className="flex-1 min-w-[80px] bg-transparent text-[12px] text-ink-900 outline-none placeholder:text-ink-400"
              placeholder="add tag and hit Enter"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag();
                } else if (
                  e.key === "Backspace" &&
                  tagDraft === "" &&
                  tags.length
                ) {
                  setTags((p) => p.slice(0, -1));
                }
              }}
            />
          </div>
        </div>
      </header>

      {/* Toolbar */}
      <div className="mb-4">
        <MarkdownToolbar
          getActive={() =>
            activeIdRef.current
              ? refs.current.get(activeIdRef.current) ?? null
              : null
          }
          onChange={applyToolbarEdit}
        />
      </div>

      {/* Body — Q/A blocks + optional preview side-by-side */}
      <div
        className={
          preview
            ? "grid grid-cols-1 gap-4 lg:grid-cols-2"
            : "grid grid-cols-1 gap-4"
        }
      >
        <div className="space-y-3">
          {blocks.map((b, i) => (
            <BlockCard
              key={b.id}
              block={b}
              index={i + 1}
              registerRef={(el) => {
                if (el) refs.current.set(b.id, el);
                else refs.current.delete(b.id);
              }}
              onChange={(patch) => updateBlock(b.id, patch)}
              onFocusAnswer={() => setActive(b.id)}
              onBlurAnswer={() => {
                // Don't clear the active id immediately — toolbar buttons
                // remove focus from the textarea and would go inert. We rely
                // on focus moving to a different textarea (which calls setActive)
                // to update the toolbar.
              }}
              onDelete={() => removeBlock(b.id)}
              canDelete={blocks.length > 1}
            />
          ))}

          <button
            type="button"
            onClick={addBlock}
            className="card flex w-full items-center justify-center gap-2 px-4 py-3 text-sm text-ink-600 transition hover:bg-ink-50/60 hover:text-ink-900"
          >
            <Plus className="h-4 w-4" />
            Add Q/A block
          </button>
        </div>

        {preview && (
          <div className="card sticky top-4 max-h-[calc(100vh-120px)] overflow-auto px-5 py-4">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-ink-500">
              Preview
            </div>
            <article className="markdown-body text-[13px] leading-relaxed text-ink-900">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {compiled}
              </ReactMarkdown>
            </article>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Block card ────────────────────────────────────────────────────────────
function BlockCard({
  block,
  index,
  registerRef,
  onChange,
  onFocusAnswer,
  onBlurAnswer,
  onDelete,
  canDelete,
}: {
  block: QABlock;
  index: number;
  registerRef: (el: HTMLTextAreaElement | null) => void;
  onChange: (patch: Partial<QABlock>) => void;
  onFocusAnswer: () => void;
  onBlurAnswer: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-ink-100 bg-ink-50/40 px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Block {index}
        </span>
        <input
          type="text"
          placeholder="Question (e.g. What broke?)"
          value={block.question}
          onChange={(e) => onChange({ question: e.target.value })}
          className="flex-1 bg-transparent text-sm font-semibold text-ink-900 outline-none placeholder:text-ink-400"
        />
        <button
          type="button"
          onClick={onDelete}
          disabled={!canDelete}
          className="rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
          title={canDelete ? "Remove this block" : "Need at least one block"}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <textarea
        ref={registerRef}
        data-block-id={block.id}
        value={block.answer}
        onChange={(e) => onChange({ answer: e.target.value })}
        onFocus={onFocusAnswer}
        onBlur={onBlurAnswer}
        rows={6}
        spellCheck={false}
        placeholder="Answer in markdown — use the toolbar above for formatting."
        className="mono w-full resize-y bg-transparent px-4 py-3 text-[13px] leading-relaxed text-ink-900 outline-none placeholder:text-ink-400"
      />
    </div>
  );
}

// ── Member select (mirrors RcaUploadModal's behavior) ─────────────────────
function MemberSelect({
  members,
  value,
  onChange,
  placeholder,
}: {
  members: TeamMember[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  if (members.length === 0) {
    return (
      <div className="mt-1 rounded-md border border-dashed border-ink-200 px-3 py-1.5 text-[12px] text-ink-500">
        No team members yet. Add some in{" "}
        <a href="/settings" className="text-ink-700 underline">
          Settings → Team members
        </a>
        .
      </div>
    );
  }
  return (
    <select
      className="input mt-1 w-full"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {members.map((m) => (
        <option key={m.id} value={m.email}>
          {m.name} · {m.email}
        </option>
      ))}
    </select>
  );
}
