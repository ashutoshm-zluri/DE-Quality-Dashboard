import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Check,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RotateCw,
  Tag as TagIcon,
  Terminal,
} from "lucide-react";
import type { ErrorTagRule, Failure } from "../types";
import { api } from "../api/client";
import { useEnv } from "../api/env";
import { useAuth, isAdmin } from "../api/auth";
import { firstStepFunctionId, prefectFlowUrl } from "../api/prefect";
import { useToast } from "./Toast";
import Modal from "./Modal";
import KV from "./KV";
import StatusBadge from "./StatusBadge";
import ActionBadge from "./ActionBadge";
import Pill, { type PillTone } from "./Pill";

const TAG_TONE: Record<string, PillTone> = {
  blue: "blue",
  violet: "violet",
  emerald: "emerald",
  amber: "amber",
  orange: "orange",
  red: "red",
  ink: "ink",
  neutral: "neutral",
};

function arraysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  for (const x of b) if (!s.has(x)) return false;
  return true;
}

interface Props {
  open: boolean;
  failure: Failure | null;
  onClose: () => void;
  onMutated: () => void;
}

export default function FailureDetailModal({
  open,
  failure,
  onClose,
  onMutated,
}: Props) {
  const { env } = useEnv();
  const { user } = useAuth();
  const toast = useToast();
  const admin = isAdmin(user);
  const [busy, setBusy] = useState<"trigger" | "mark" | null>(null);

  // ── error tag editing (admin only, batch-saved on close) ───────────────
  const [tagRules, setTagRules] = useState<ErrorTagRule[]>([]);
  const [editTags, setEditTags] = useState(false);
  const [localTags, setLocalTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [tagsSaving, setTagsSaving] = useState(false);
  const tagBaseline = failure?.error_tags ?? [];

  // Load rules once when modal first opens (lazy)
  useEffect(() => {
    if (!open) return;
    if (tagRules.length > 0) return;
    api.errorTagRules
      .list()
      .then((r) => setTagRules(r.items))
      .catch(() => setTagRules([]));
  }, [open, tagRules.length]);

  // Reset local tag state whenever the modal opens with a different failure
  useEffect(() => {
    if (!failure) return;
    setLocalTags(failure.error_tags ?? []);
    setEditTags(false);
    setTagDraft("");
  }, [failure?.de_sync_status_id]);

  if (!failure) return null;

  const stepFn = Array.isArray(failure.step_function)
    ? failure.step_function.join(", ")
    : failure.step_function ?? "";

  const prefectHref = prefectFlowUrl(env, firstStepFunctionId(failure.step_function), {
    app_flag: failure.app_flag,
    payment_flag: failure.payment_flag,
  });

  const mayTrigger =
    failure.recommended_action === "RETRIGGER" ||
    failure.recommended_action === "TRIGGERED";

  const mayMark = failure.recommended_action === "MARK_COMPLETE";

  const flushTags = async (): Promise<boolean> => {
    if (!admin) return true;
    if (arraysEqual(tagBaseline, localTags)) return true;
    setTagsSaving(true);
    try {
      await api.setFailureTags(env, failure.de_sync_status_id, localTags);
      onMutated();
      return true;
    } catch (e) {
      toast.fromError(e, "Failed to save error tags");
      return false;
    } finally {
      setTagsSaving(false);
    }
  };

  const handleClose = async () => {
    if (busy || tagsSaving) return;
    const ok = await flushTags();
    if (ok) onClose();
  };

  const toggleTag = (tag: string) => {
    setLocalTags((prev) =>
      prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]
    );
  };

  const addCustomTag = () => {
    const t = tagDraft.trim();
    if (!t) return;
    if (!localTags.includes(t)) setLocalTags((prev) => [...prev, t]);
    setTagDraft("");
  };

  const onTrigger = async () => {
    setBusy("trigger");
    try {
      await api.trigger(env, failure.sync_id, failure);
      toast.success("Retrigger requested", failure.org_name);
      onMutated();
      onClose();
    } catch (e) {
      toast.fromError(e, "Trigger failed");
    } finally {
      setBusy(null);
    }
  };

  const onMark = async () => {
    setBusy("mark");
    try {
      await api.markComplete(env, failure.sync_id, failure);
      toast.success("Marked complete", failure.org_name);
      onMutated();
      onClose();
    } catch (e) {
      toast.fromError(e, "Mark-complete failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      width="xl"
      title={
        <div className="flex items-center gap-2">
          <span className="truncate">{failure.org_name}</span>
          <span className="text-ink-300">·</span>
          <span className="truncate font-normal text-ink-600">
            {failure.integration_instance_name} ({failure.integration_name})
          </span>
        </div>
      }
      subtitle={
        <div className="flex flex-wrap items-center gap-2">
          <span className="mono">{failure.mode}</span>
          <StatusBadge status={failure.current_status} />
          <ActionBadge action={failure.recommended_action} />
          {failure.is_IE_bad_request && <Pill tone="red">IE bad request</Pill>}
        </div>
      }
      footer={
        <>
          {prefectHref && (
            <a
              href={prefectHref}
              target="_blank"
              rel="noreferrer"
              className="btn"
              title="Open the Prefect flow run in a new tab"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open in Prefect
            </a>
          )}
          <button onClick={onClose} className="btn">
            Close
          </button>
          {admin && mayMark && (
            <button
              onClick={onMark}
              disabled={busy !== null}
              className="btn-success"
            >
              {busy === "mark" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Mark complete
            </button>
          )}
          {admin && mayTrigger && (
            <button
              onClick={onTrigger}
              disabled={busy !== null}
              className="btn-primary"
            >
              {busy === "trigger" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCw className="h-4 w-4" />
              )}
              Retrigger via validator
            </button>
          )}
        </>
      }
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className="space-y-1">
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Sync identifiers
          </h4>
          <KV label="Sync ID" value={failure.sync_id} copy={failure.sync_id} mono />
          <KV
            label="DE Sync Status"
            value={failure.de_sync_status_id}
            copy={failure.de_sync_status_id}
            mono
          />
          <KV
            label="Org Integration"
            value={failure.org_integration_id}
            copy={failure.org_integration_id}
            mono
          />
          <KV label="Org" value={failure.org_id} copy={failure.org_id} mono />
          <KV
            label="Integration"
            value={failure.integration_id}
            copy={failure.integration_id}
            mono
          />
          <KV label="Step function" value={stepFn} copy={stepFn} mono />
        </section>

        <section className="space-y-1">
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Timing
          </h4>
          <KV label="IE start date" value={failure.ie_start_date} />
          <KV label="IE end date" value={failure.ie_end_date} />
          <KV
            label="IE time"
            value={`${failure.time_taken_by_ie_in_mins.toFixed(2)} min`}
          />
          <KV
            label="DE time"
            value={`${failure.time_taken_by_de_in_mins.toFixed(2)} min`}
          />
          <KV
            label="Created at"
            value={new Date(failure.createdAt).toLocaleString()}
          />
          <KV
            label="Updated at"
            value={new Date(failure.updatedAt).toLocaleString()}
          />
          <KV
            label="Latest completed"
            value={
              failure.latest_sync_timestamp
                ? new Date(failure.latest_sync_timestamp).toLocaleString()
                : "—"
            }
          />
        </section>

        <section className="md:col-span-2 space-y-1">
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Recovery rationale
          </h4>
          <KV label="Recommended action" value={failure.recommended_action} />
          <KV label="Reasoning" value={failure.action_reason} />
          <KV
            label="App / Payment flag"
            value={`app=${failure.app_flag} · payment=${failure.payment_flag}`}
          />
          <KV
            label="S3 key"
            value={<span className="break-all">{failure.s3_key}</span>}
            copy={failure.s3_key}
            mono
          />

          {/* Error tags — visible to all, editable by admins */}
          <div className="mt-2 border-t border-ink-100 pt-3">
            <div className="flex items-center justify-between">
              <h5 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                <TagIcon className="h-3.5 w-3.5" />
                Error tags
              </h5>
              {admin && (
                <button
                  type="button"
                  onClick={() => setEditTags((v) => !v)}
                  className="text-[12px] text-ink-700 hover:text-ink-900"
                >
                  {editTags ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <Check className="h-3.5 w-3.5" />
                      Done
                    </span>
                  ) : (
                    "Edit tags"
                  )}
                </button>
              )}
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {localTags.length === 0 ? (
                <span className="text-[12px] text-ink-400">
                  no tags
                </span>
              ) : (
                localTags.map((t) => {
                  const rule = tagRules.find((r) => r.tag === t);
                  return (
                    <Pill key={t} tone={TAG_TONE[rule?.color ?? "ink"] ?? "ink"}>
                      <span className="mono">{t}</span>
                      {editTags && (
                        <button
                          type="button"
                          onClick={() => toggleTag(t)}
                          className="-mr-1 ml-0.5 rounded-full p-0.5 hover:bg-black/10"
                          aria-label={`Remove ${t}`}
                        >
                          ×
                        </button>
                      )}
                    </Pill>
                  );
                })
              )}
            </div>

            {editTags && (
              <div className="mt-2 rounded-md border border-ink-100 bg-ink-50/40 p-2.5">
                <div className="mb-1.5 text-[11px] uppercase tracking-wide text-ink-500">
                  {tagRules.length === 0
                    ? "No rule-defined tags yet — type a custom one below"
                    : "Click a tag to add. Type custom tags in the box."}
                </div>
                {tagRules.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {tagRules.map((r) => {
                      const sel = localTags.includes(r.tag);
                      return (
                        <button
                          key={r.tag}
                          type="button"
                          onClick={() => toggleTag(r.tag)}
                          className={`rounded-full transition ${
                            sel ? "" : "opacity-50 hover:opacity-100"
                          }`}
                        >
                          <Pill
                            tone={TAG_TONE[r.color] ?? "neutral"}
                            Icon={sel ? Check : undefined}
                          >
                            <span className="mono">{r.tag}</span>
                          </Pill>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <input
                    className="input mono h-7 flex-1 py-0 text-[12px]"
                    placeholder="custom_tag (e.g. orgint_specific)"
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCustomTag();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={addCustomTag}
                    disabled={!tagDraft.trim()}
                    className="btn h-7 px-2 py-0 text-[12px]"
                  >
                    Add
                  </button>
                </div>
                {tagsSaving && (
                  <div className="mt-1 text-[11px] text-ink-500">
                    Saving on close…
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="md:col-span-2 space-y-1">
          <h4 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            <Terminal className="h-3.5 w-3.5" />
            Error
          </h4>
          <pre className="mono whitespace-pre-wrap rounded-md border border-ink-200 bg-ink-50 p-3 text-[12px] leading-relaxed text-ink-800">
            {failure.error_reason || "(no error_reason recorded)"}
          </pre>
        </section>

        {failure.trigger_state && (
          <section className="md:col-span-2 space-y-1 rounded-lg border border-violet-200 bg-violet-50/50 p-3">
            <h4 className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-violet-700">
              <span>Last trigger</span>
              <Link
                to={`/runs/${failure.sync_id}`}
                className="inline-flex items-center gap-1 normal-case tracking-normal text-violet-700 hover:underline"
              >
                View run
                <ExternalLink className="h-3 w-3" />
              </Link>
            </h4>
            <KV
              label="Triggered at"
              value={new Date(failure.trigger_state.triggered_at).toLocaleString()}
            />
            <KV label="Status" value={failure.trigger_state.status} />
            <KV
              label="Validator code"
              value={String(failure.trigger_state.validator_status_code ?? "—")}
            />
            <KV
              label="Flow run URL"
              value={(() => {
                const url = prefectFlowUrl(env, failure.trigger_state.flow_run_id, {
                  app_flag: failure.app_flag,
                  payment_flag: failure.payment_flag,
                });
                return url ? (
                  <a
                    className="text-violet-700 underline-offset-2 hover:underline break-all"
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {url}
                  </a>
                ) : (
                  "—"
                );
              })()}
            />
            <KV
              label="ETA"
              value={
                failure.trigger_state.eta_minutes
                  ? `${failure.trigger_state.eta_minutes.toFixed(1)} min`
                  : "—"
              }
            />
            <KV label="ETA basis" value={failure.trigger_state.eta_basis ?? "—"} />
          </section>
        )}
      </div>
    </Modal>
  );
}
