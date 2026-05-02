import { useEffect, useRef, useState } from "react";
import { File as FileIcon, Loader2, Upload, X } from "lucide-react";
import type { TeamMember } from "../types";
import { api } from "../api/client";
import Modal from "./Modal";
import Pill from "./Pill";

interface Props {
  open: boolean;
  onClose: () => void;
  onUpload: (input: {
    name: string;
    filename: string;
    content: string;
    owner: string;
    reviewer: string;
    tags: string[];
  }) => Promise<void>;
}

const ACCEPTED_EXT = /\.(md|markdown|txt|text)$/i;

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

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function RcaUploadModal({ open, onClose, onUpload }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);

  // reset form whenever the modal opens; reload members fresh too
  useEffect(() => {
    if (!open) return;
    setFilename("");
    setContent("");
    setName("");
    setOwner("");
    setReviewer("");
    setTagInput("");
    setTags([]);
    setBusy(false);
    setErr(null);
    setDragOver(false);
    api.members
      .list()
      .then((r) => setMembers(r.items))
      .catch(() => setMembers([]));
  }, [open]);

  const acceptFile = (file: File) => {
    if (!ACCEPTED_EXT.test(file.name)) {
      setErr(`Unsupported format. Use .md or .txt (got ${file.name})`);
      return;
    }
    setErr(null);
    setFilename(file.name);
    if (!name.trim()) {
      setName(file.name.replace(ACCEPTED_EXT, ""));
    }
    const reader = new FileReader();
    reader.onload = () => setContent(String(reader.result ?? ""));
    reader.onerror = () => setErr("Failed to read file");
    reader.readAsText(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) acceptFile(file);
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) acceptFile(file);
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    if (tags.includes(t)) return;
    setTags((p) => [...p, t]);
    setTagInput("");
  };

  const submit = async () => {
    if (!filename || !content) {
      setErr("Pick a file first");
      return;
    }
    if (!name.trim()) {
      setErr("Name is required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onUpload({
        name: name.trim(),
        filename,
        content,
        owner: owner.trim(),
        reviewer: reviewer.trim(),
        tags,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const sizeBytes = content
    ? new Blob([content]).size
    : 0;

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      width="lg"
      title="Upload RCA document"
      subtitle="Drag & drop a .md or .txt file, or pick from local."
      footer={
        <>
          {err && <span className="mr-auto text-xs text-red-600">{err}</span>}
          <button onClick={onClose} disabled={busy} className="btn">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !filename || !name.trim()}
            className="btn-primary"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Upload
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition ${
            dragOver
              ? "border-ink-700 bg-ink-50"
              : "border-ink-200 bg-ink-50/40 hover:bg-ink-50/80"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".md,.markdown,.txt,.text"
            className="hidden"
            onChange={onPick}
          />
          {filename ? (
            <div className="flex items-center gap-2">
              <FileIcon className="h-5 w-5 text-ink-600" />
              <div>
                <div className="text-sm font-medium text-ink-900">
                  {filename}
                </div>
                <div className="text-[11px] text-ink-500">
                  {formatBytes(sizeBytes)} ·{" "}
                  {ACCEPTED_EXT.exec(filename)?.[1].replace(/markdown/i, "md")
                    ?.toLowerCase() ?? "file"}
                </div>
              </div>
            </div>
          ) : (
            <>
              <Upload className="mb-2 h-6 w-6 text-ink-500" />
              <div className="text-sm font-medium text-ink-900">
                Drag & drop a file here
              </div>
              <div className="text-[12px] text-ink-500">
                or click to browse · .md or .txt only · 5 MB max
              </div>
            </>
          )}
        </div>

        {/* Form */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
              Doc name
            </label>
            <input
              className="input mt-1 w-full"
              placeholder="2026-W18 RCA — activity sync split-order failure"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
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
            <label className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
              Reviewer
            </label>
            <MemberSelect
              members={members}
              value={reviewer}
              onChange={setReviewer}
              placeholder="— select reviewer —"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
              Tags
            </label>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-md border border-ink-200 bg-white px-2 py-1.5">
              {tags.map((t) => (
                <Pill key={t} tone="ink">
                  {t}
                  <button
                    type="button"
                    onClick={() =>
                      setTags((p) => p.filter((x) => x !== t))
                    }
                    className="-mr-1 ml-0.5 rounded-full p-0.5 hover:bg-black/10"
                    aria-label={`Remove ${t}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Pill>
              ))}
              <input
                className="flex-1 min-w-[80px] bg-transparent text-[12px] text-ink-900 outline-none placeholder:text-ink-400"
                placeholder="add tag and hit Enter"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag();
                  } else if (
                    e.key === "Backspace" &&
                    tagInput === "" &&
                    tags.length
                  ) {
                    setTags((p) => p.slice(0, -1));
                  }
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
