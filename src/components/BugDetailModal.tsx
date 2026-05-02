import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, Loader2, Tag } from "lucide-react";
import type { Bug, Label, Release } from "../types";
import { api } from "../api/client";
import Modal from "./Modal";
import KV from "./KV";
import LabelChip from "./LabelChip";
import Pill, { type PillTone } from "./Pill";

interface Props {
  open: boolean;
  bug: Bug | null;
  release: Release;
  labels: Label[];
  onClose: () => void;
  onChange: () => void;
}

const STATUS_TONE: Record<string, PillTone> = {
  done: "emerald",
  indeterminate: "blue",
  todo: "amber",
};

const PRIORITY_TONE: Record<string, PillTone> = {
  Highest: "red",
  High: "orange",
  Medium: "amber",
  Low: "ink",
  Lowest: "neutral",
};

function arraysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  for (const x of b) if (!s.has(x)) return false;
  return true;
}

export default function BugDetailModal({
  open,
  bug,
  release,
  labels,
  onClose,
  onChange,
}: Props) {
  // ── Local state for the picker. Toggling a chip updates this immediately
  //    so the UI is instantly responsive — server roundtrip happens once on
  //    close, not per click.
  const [localLabelIds, setLocalLabelIds] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // We snapshot the bug's id so we know if a "save" is for the same bug the
  // user is still looking at, even after re-opens.
  const lastSavedRef = useRef<string[] | null>(null);

  // Reset local state whenever a different bug opens.
  useEffect(() => {
    if (bug) {
      setLocalLabelIds(bug.label_ids ?? []);
      lastSavedRef.current = bug.label_ids ?? [];
    } else {
      setLocalLabelIds([]);
      lastSavedRef.current = null;
    }
    setPicking(false);
    setErr(null);
  }, [bug?.id]);

  const meta = bug?.jira_meta ?? null;

  const toggle = (labelId: string) => {
    setLocalLabelIds((prev) =>
      prev.includes(labelId)
        ? prev.filter((x) => x !== labelId)
        : [...prev, labelId]
    );
  };

  // Persist whatever the user picked. Returns whether anything was sent.
  const flush = async (): Promise<boolean> => {
    if (!bug) return true;
    const original = lastSavedRef.current ?? bug.label_ids ?? [];
    if (arraysEqual(original, localLabelIds)) return true;
    setSaving(true);
    setErr(null);
    try {
      await api.releases.updateBug(release.id, bug.id, {
        label_ids: localLabelIds,
      });
      lastSavedRef.current = [...localLabelIds];
      onChange();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Close-from-picker: just collapse the picker locally. The actual save
  // happens when the modal closes (so the user can keep editing other parts
  // of the modal without round-tripping each click).
  const onPickerDone = () => setPicking(false);

  // Modal close: flush first, then close. If the save fails, keep the modal
  // open so the user can retry.
  const handleClose = async () => {
    if (saving) return;
    const ok = await flush();
    if (ok) onClose();
  };

  const liveLabels = useMemo(
    () =>
      localLabelIds
        .map((id) => labels.find((l) => l.id === id))
        .filter((l): l is Label => !!l),
    [localLabelIds, labels]
  );

  if (!bug) return null;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      width="lg"
      title={
        <div className="flex items-center gap-2">
          {bug.jira_id ? (
            <a
              href={bug.jira_url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="mono text-[13px] text-blue-700 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {bug.jira_id}
            </a>
          ) : (
            <span className="mono text-[13px] text-ink-500">no-jira</span>
          )}
          <span className="truncate">{bug.title}</span>
        </div>
      }
      subtitle={
        <div className="flex flex-wrap items-center gap-2">
          {meta?.issuetype && <Pill tone="ink">{meta.issuetype}</Pill>}
          {meta?.status && (
            <Pill
              tone={STATUS_TONE[meta.status_category ?? ""] ?? "neutral"}
            >
              {meta.status}
            </Pill>
          )}
          {meta?.priority && (
            <Pill tone={PRIORITY_TONE[meta.priority] ?? "neutral"}>
              {meta.priority}
            </Pill>
          )}
          {meta?.resolution && (
            <Pill tone="emerald">resolved · {meta.resolution}</Pill>
          )}
          <span className="text-[12px] text-ink-500">
            in <span className="mono">{release.name}</span>
          </span>
        </div>
      }
      footer={
        <>
          {err && <span className="mr-auto text-xs text-red-600">{err}</span>}
          {bug.jira_url && (
            <a
              href={bug.jira_url}
              target="_blank"
              rel="noreferrer"
              className="btn"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open in Jira
            </a>
          )}
          <button
            onClick={handleClose}
            disabled={saving}
            className="btn-primary"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Close
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Internal labels (root cause) */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              <Tag className="h-3.5 w-3.5" />
              Root cause labels
            </h4>
            {!picking ? (
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="text-[12px] text-ink-700 hover:text-ink-900"
              >
                Edit labels
              </button>
            ) : (
              <button
                type="button"
                onClick={onPickerDone}
                className="inline-flex items-center gap-1 text-[12px] text-emerald-700 hover:text-emerald-900"
              >
                <Check className="h-3.5 w-3.5" />
                Done
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {liveLabels.length === 0 ? (
              <span className="text-[12px] text-ink-400">
                No labels assigned yet.
              </span>
            ) : (
              liveLabels.map((l) => (
                <LabelChip
                  key={l.id}
                  label={l}
                  onRemove={picking ? () => toggle(l.id) : undefined}
                />
              ))
            )}
          </div>

          {picking && (
            <div className="mt-3 rounded-md border border-ink-100 bg-ink-50/40 p-3">
              <div className="mb-2 text-[11px] uppercase tracking-wide text-ink-500">
                {labels.length === 0
                  ? "No labels yet — add some from Settings"
                  : "Click a label to toggle. Click Done when finished."}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {labels.map((l) => (
                  <LabelChip
                    key={l.id}
                    label={l}
                    selected={localLabelIds.includes(l.id)}
                    onClick={() => toggle(l.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Jira metadata */}
        <section>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Jira metadata
          </h4>
          {meta ? (
            <>
              <KV
                label="Assignee"
                value={
                  meta.assignee
                    ? `${meta.assignee.name}${meta.assignee.email ? ` · ${meta.assignee.email}` : ""}`
                    : "—"
                }
              />
              <KV
                label="Jira labels"
                value={
                  meta.jira_labels.length === 0
                    ? "—"
                    : meta.jira_labels.join(", ")
                }
                mono
              />
              <KV
                label="Created"
                value={
                  meta.created
                    ? new Date(meta.created).toLocaleString()
                    : "—"
                }
              />
              <KV
                label="Updated"
                value={
                  meta.updated
                    ? new Date(meta.updated).toLocaleString()
                    : "—"
                }
              />
            </>
          ) : (
            <p className="text-[12px] text-ink-500">
              Not yet synced from Jira. Click "Sync from Jira" on the release
              card to pull metadata.
            </p>
          )}
        </section>

        {/* Description */}
        {meta?.description && (
          <section>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              Description
            </h4>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-ink-200 bg-ink-50 p-3 text-[12px] leading-relaxed text-ink-800">
              {meta.description.trim()}
            </pre>
          </section>
        )}
      </div>
    </Modal>
  );
}
