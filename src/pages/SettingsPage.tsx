import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  ExternalLink,
  Loader2,
  Plus,
  Settings as SettingsIcon,
  ShieldCheck,
  Tag,
  Trash2,
  UserRound,
  Users,
  EyeOff,
  Wand2,
} from "lucide-react";
import type {
  ErrorTagRule,
  IgnoreEntry,
  Label,
  LabelColor,
  MemberRole,
  Release,
  TeamMember,
} from "../types";
import { api } from "../api/client";
import { useAuth, isAdmin } from "../api/auth";
import { useEnv } from "../api/env";
import { useSessionState } from "../api/storage";
import { useToast } from "../components/Toast";
import EmptyState from "../components/EmptyState";
import Spinner from "../components/Spinner";
import LabelChip from "../components/LabelChip";
import ConfirmDialog from "../components/ConfirmDialog";
import Pill from "../components/Pill";

const COLOR_OPTIONS: LabelColor[] = [
  "blue",
  "violet",
  "emerald",
  "amber",
  "orange",
  "red",
  "ink",
  "neutral",
];

const ALL_TABS = [
  { id: "profile", label: "Profile", adminOnly: false },
  { id: "labels", label: "Labels", adminOnly: true },
  { id: "members", label: "Team members", adminOnly: true },
  { id: "releases", label: "Release epics", adminOnly: true },
  { id: "ignore", label: "Ignore list", adminOnly: true },
  { id: "tagrules", label: "Error tag rules", adminOnly: true },
] as const;

type TabId = (typeof ALL_TABS)[number]["id"];

export default function SettingsPage() {
  const { user } = useAuth();
  const admin = isAdmin(user);
  const visibleTabs = ALL_TABS.filter((t) => admin || !t.adminOnly);
  const [tab, setTab] = useSessionState<TabId>("settings.tab", "profile");
  const [labels, setLabels] = useState<Label[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // If a viewer/member previously had an admin-only tab open and their role
  // changed, fall back to profile.
  useEffect(() => {
    if (!visibleTabs.find((t) => t.id === tab)) setTab("profile");
  }, [tab, visibleTabs, setTab]);

  const loadCommon = async () => {
    if (!admin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const [labelRes, relRes] = await Promise.all([
        api.labels.list(),
        api.releases.list(),
      ]);
      setLabels(labelRes.items);
      setReleases(relRes.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCommon();
  }, [admin]);

  return (
    <div className="px-6 py-6">
      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900">
          <SettingsIcon className="h-5 w-5 text-ink-700" />
          Settings
        </h1>
        <p className="mt-1 text-xs text-ink-500">
          App-wide configuration. Most sections are not env-scoped — Ignore
          list applies per-env (different IDs in dev vs prod).
        </p>
      </header>

      {/* Tab strip */}
      <div className="mb-5 flex flex-wrap items-center gap-1 border-b border-ink-200">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === t.id
                ? "border-ink-900 text-ink-900"
                : "border-transparent text-ink-500 hover:text-ink-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : err ? (
        <EmptyState title="Couldn't load settings" hint={err} />
      ) : !visibleTabs.find((t) => t.id === tab) ? (
        <ProfileSection />
      ) : tab === "profile" ? (
        <ProfileSection />
      ) : tab === "labels" ? (
        <LabelsSection labels={labels} onChange={loadCommon} />
      ) : tab === "members" ? (
        <MembersSection />
      ) : tab === "releases" ? (
        <ReleasesSection releases={releases} onChange={loadCommon} />
      ) : tab === "ignore" ? (
        <IgnoreListSection />
      ) : (
        <ErrorTagRulesSection />
      )}
    </div>
  );
}

// ── Profile (self-edit) ─────────────────────────────────────────────────────
const ROLE_PERMISSIONS: Array<{
  role: MemberRole;
  short: string;
  bullets: string[];
}> = [
  {
    role: "admin",
    short: "Full access — manage everything",
    bullets: [
      "Create/edit/delete labels, releases, members, ignore list, error-tag rules",
      "Sync releases from Jira; re-trigger failing flows; mark syncs complete",
      "Refresh failure statuses against mongo",
      "Edit/delete any RCA doc",
      "Manually edit the error_tags on any failure",
    ],
  },
  {
    role: "member",
    short: "Read access + own RCAs",
    bullets: [
      "View everything signed-in users can view",
      "Upload RCA docs (you become the default owner)",
      "Edit/delete RCA docs you own or review",
      "No release/label/ignore-list/error-rule writes",
      "No re-triggering or marking complete",
    ],
  },
  {
    role: "viewer",
    short: "Read-only",
    bullets: [
      "View failures, runs, reliability stats, releases, RCA docs, settings",
      "Cannot mutate anything — every POST/PATCH/DELETE returns 403",
    ],
  },
];

function ProfileSection() {
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [designation, setDesignation] = useState(user?.designation ?? "");
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setName(user?.name ?? "");
    setDesignation(user?.designation ?? "");
  }, [user?.id]);

  useEffect(() => {
    if (savedAt == null) return;
    const t = setTimeout(() => setSavedAt(null), 3000);
    return () => clearTimeout(t);
  }, [savedAt]);

  if (!user) return null;

  const dirty =
    name.trim() !== (user.name ?? "") ||
    designation.trim() !== (user.designation ?? "");

  const initials = (user.name || user.email)
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await updateProfile({
        name: name.trim(),
        designation: designation.trim(),
      });
      setSavedAt(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      {/* Profile card */}
      <section className="card overflow-hidden lg:col-span-2">
        <div className="flex items-center justify-between border-b border-ink-100 bg-ink-50/40 px-4 py-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
            <UserRound className="h-3.5 w-3.5 text-ink-600" />
            Your profile
          </h2>
          {savedAt && (
            <span className="inline-flex items-center gap-1 text-[12px] text-emerald-700">
              <Check className="h-3.5 w-3.5" />
              Saved
            </span>
          )}
        </div>
        <form onSubmit={submit} className="px-4 py-5">
          <div className="mb-5 flex items-center gap-3">
            {user.picture ? (
              <img
                src={user.picture}
                alt={user.name}
                referrerPolicy="no-referrer"
                className="h-14 w-14 rounded-full"
              />
            ) : (
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ink-100 text-base font-semibold text-ink-700">
                {initials}
              </span>
            )}
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-ink-900">
                {user.name}
              </div>
              <div className="mono text-[12px] text-ink-500">{user.email}</div>
              <div className="mt-1 flex items-center gap-2">
                <Pill
                  tone={
                    user.role === "admin"
                      ? "violet"
                      : user.role === "member"
                        ? "blue"
                        : "ink"
                  }
                >
                  {user.role}
                </Pill>
                <span className="text-[11px] text-ink-500">
                  {user.role === "admin"
                    ? "all permissions"
                    : "ask an admin to change role"}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
                Name
              </label>
              <input
                className="input mt-1 w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-ink-400">
                Synced from Google on first sign-in. You can override it here.
              </p>
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
                Designation
              </label>
              <input
                className="input mt-1 w-full"
                placeholder="e.g. SDE Intern, DE Lead"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
                Email
              </label>
              <input
                className="input mt-1 w-full opacity-60"
                value={user.email}
                disabled
              />
              <p className="mt-1 text-[11px] text-ink-400">
                Bound to your Google account — not editable.
              </p>
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
                Joined portal
              </label>
              <input
                className="input mt-1 w-full opacity-60"
                value={new Date(user.created_at).toLocaleString()}
                disabled
                title="When this profile was first created from a Google sign-in"
              />
              <p className="mt-1 text-[11px] text-ink-400">
                First sign-in to the portal. Google account creation date isn't
                exposed via OAuth scopes.
              </p>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-2">
            <button
              type="submit"
              disabled={busy || !dirty}
              className="btn-primary"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Save changes
            </button>
            {dirty && (
              <button
                type="button"
                onClick={() => {
                  setName(user.name);
                  setDesignation(user.designation);
                }}
                className="btn"
              >
                Reset
              </button>
            )}
            {err && <span className="text-xs text-red-600">{err}</span>}
          </div>
        </form>
      </section>

      {/* Role permissions cheat-sheet */}
      <section className="card overflow-hidden">
        <div className="flex items-center gap-1.5 border-b border-ink-100 bg-ink-50/40 px-4 py-2">
          <ShieldCheck className="h-3.5 w-3.5 text-ink-600" />
          <h2 className="text-sm font-semibold text-ink-900">
            Role permissions
          </h2>
        </div>
        <div className="space-y-4 px-4 py-4">
          {ROLE_PERMISSIONS.map((row) => (
            <div key={row.role}>
              <div className="mb-1 flex items-center gap-2">
                <Pill
                  tone={
                    row.role === "admin"
                      ? "violet"
                      : row.role === "member"
                        ? "blue"
                        : "ink"
                  }
                >
                  {row.role}
                </Pill>
                <span className="text-[12px] font-medium text-ink-700">
                  {row.short}
                </span>
              </div>
              <ul className="ml-5 list-disc space-y-0.5 text-[12px] leading-relaxed text-ink-600">
                {row.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
          <div className="mt-3 rounded-md border border-ink-100 bg-ink-50/40 px-3 py-2 text-[11px] leading-relaxed text-ink-500">
            Admins manage roles in <strong>Team members</strong>. RCA docs use
            their own per-doc rule: <strong>admin OR owner OR reviewer</strong>{" "}
            can edit / delete.
          </div>
        </div>
      </section>
    </div>
  );
}

// ── Labels ───────────────────────────────────────────────────────────────────
function LabelsSection({
  labels,
  onChange,
}: {
  labels: Label[];
  onChange: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<LabelColor>("blue");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Label | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.labels.create(name.trim(), color);
      setName("");
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "create failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-ink-100 bg-ink-50/40 px-4 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
          <Tag className="h-3.5 w-3.5 text-ink-600" />
          Bug labels
        </h2>
        <span className="text-[11px] text-ink-500">
          {labels.length} label{labels.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="px-4 py-4">
        <p className="mb-3 text-[12px] text-ink-500">
          Use labels to categorize bugs in Release Tracker. Deleting a label
          also removes it from any bug that references it.
        </p>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {labels.length === 0 ? (
            <span className="text-[12px] text-ink-400">No labels yet.</span>
          ) : (
            labels.map((l) => (
              <LabelChip
                key={l.id}
                label={l}
                onRemove={() => setConfirming(l)}
              />
            ))
          )}
        </div>

        <ConfirmDialog
          open={confirming !== null}
          title={`Delete label "${confirming?.name ?? ""}"?`}
          message={
            <>
              This label will be removed from <strong>any bugs</strong> that
              reference it across all releases.
            </>
          }
          confirmLabel="Delete label"
          onClose={() => setConfirming(null)}
          onConfirm={async () => {
            if (!confirming) return;
            await api.labels.remove(confirming.id);
            onChange();
          }}
        />

        <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
          <input
            className="input flex-1 min-w-[160px]"
            placeholder="New label name (e.g. Test gap)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <ColorPicker value={color} onChange={setColor} />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="btn-primary"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Add label
          </button>
        </form>
        {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
      </div>
    </section>
  );
}

function ColorPicker({
  value,
  onChange,
}: {
  value: LabelColor;
  onChange: (c: LabelColor) => void;
}) {
  const SWATCH: Record<LabelColor, string> = {
    blue: "bg-blue-200 ring-blue-500",
    violet: "bg-violet-200 ring-violet-500",
    emerald: "bg-emerald-200 ring-emerald-500",
    amber: "bg-amber-200 ring-amber-500",
    orange: "bg-orange-200 ring-orange-500",
    red: "bg-red-200 ring-red-500",
    ink: "bg-ink-200 ring-ink-700",
    neutral: "bg-ink-100 ring-ink-400",
  };
  return (
    <div className="flex items-center gap-1 rounded-md border border-ink-200 bg-white px-1.5 py-1">
      {COLOR_OPTIONS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          title={c}
          className={`h-4 w-4 rounded-full ${SWATCH[c]} ${
            value === c ? "ring-2" : "opacity-70"
          }`}
        />
      ))}
    </div>
  );
}

// ── Releases ─────────────────────────────────────────────────────────────────
function ReleasesSection({
  releases,
  onChange,
}: {
  releases: Release[];
  onChange: () => void;
}) {
  const now = new Date();
  const currentQ = Math.ceil((now.getUTCMonth() + 1) / 3);
  const currentY = now.getUTCFullYear();

  const [name, setName] = useState("");
  const [jiraUrl, setJiraUrl] = useState("");
  const [releasedOn, setReleasedOn] = useState("");
  const [quarter, setQuarter] = useState<number>(currentQ);
  const [year, setYear] = useState<number>(currentY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Release | null>(null);

  // When the user picks a release date, default quarter/year to match it
  // (they can still override).
  useEffect(() => {
    if (!releasedOn) return;
    const d = new Date(releasedOn);
    if (Number.isNaN(d.getTime())) return;
    setQuarter(Math.ceil((d.getUTCMonth() + 1) / 3));
    setYear(d.getUTCFullYear());
  }, [releasedOn]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const created = await api.releases.create(name.trim(), jiraUrl.trim(), {
        released_on: releasedOn || undefined,
        quarter,
        year,
      });
      try {
        await api.releases.syncFromJira(created.id);
      } catch (syncErr) {
        setErr(
          "Release added, but Jira auto-sync failed: " +
            (syncErr instanceof Error ? syncErr.message : "unknown error")
        );
      }
      setName("");
      setJiraUrl("");
      setReleasedOn("");
      setQuarter(currentQ);
      setYear(currentY);
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "create failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-ink-100 bg-ink-50/40 px-4 py-2">
        <h2 className="text-sm font-semibold text-ink-900">Release epics</h2>
        <Link
          to="/releases"
          className="inline-flex items-center gap-1 text-[12px] text-ink-700 hover:text-ink-900 hover:underline"
        >
          Open Release Tracker
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="px-4 py-4">
        <p className="mb-3 text-[12px] text-ink-500">
          Each entry tracks one release and its parent Jira epic. Bugs are
          synced from Jira, attached, and labelled inside Release Tracker.
        </p>
        <form onSubmit={submit} className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <input
              className="input flex-1 min-w-[180px]"
              placeholder="Release name (e.g. AMJ-1)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <input
              className="input flex-1 min-w-[260px]"
              placeholder="https://zluri.atlassian.net/browse/DATA-303"
              value={jiraUrl}
              onChange={(e) => setJiraUrl(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="input w-auto"
              value={quarter}
              onChange={(e) => setQuarter(Number(e.target.value))}
              title="Quarter"
            >
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={q}>
                  Q{q}
                </option>
              ))}
            </select>
            <input
              type="number"
              className="input w-24"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              min={2000}
              max={3000}
              title="Year"
            />
            <input
              type="date"
              className="input w-auto"
              value={releasedOn}
              onChange={(e) => setReleasedOn(e.target.value)}
              title="Released on (optional)"
            />
            <button
              type="submit"
              disabled={busy || !name.trim() || !jiraUrl.trim()}
              className="btn-primary"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Add release epic
            </button>
          </div>
          <p className="text-[11px] text-ink-500">
            Quarter + year group releases on the Release Tracker page. The
            release date is optional and just shown alongside.
          </p>
          {err && <div className="text-xs text-red-600">{err}</div>}
        </form>

        <div className="mt-5 space-y-2">
          {releases.length === 0 ? (
            <span className="text-[12px] text-ink-400">No releases yet.</span>
          ) : (
            releases.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-md border border-ink-100 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="font-medium text-ink-900">{r.name}</div>
                  <div className="text-[12px] text-ink-500">
                    <a
                      href={r.jira_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 hover:underline"
                    >
                      {r.jira_id}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    {r.quarter && r.year && (
                      <>
                        <span className="mx-1 text-ink-300">·</span>
                        <span className="mono">
                          Q{r.quarter} {r.year}
                        </span>
                      </>
                    )}
                    <span className="mx-1 text-ink-300">·</span>
                    {r.bugs.length} bug{r.bugs.length === 1 ? "" : "s"}
                    {r.released_on && (
                      <>
                        <span className="mx-1 text-ink-300">·</span>
                        released {r.released_on}
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setConfirming(r)}
                  className="rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"
                  title="Delete release"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        <ConfirmDialog
          open={confirming !== null}
          title={`Delete release "${confirming?.name ?? ""}"?`}
          message={
            <>
              This will permanently remove the release and all{" "}
              <strong>{confirming?.bugs.length ?? 0}</strong> bug
              {confirming && confirming.bugs.length !== 1 ? "s" : ""} attached
              to it. The Jira ticket itself is not affected.
            </>
          }
          confirmLabel="Delete release"
          onClose={() => setConfirming(null)}
          onConfirm={async () => {
            if (!confirming) return;
            await api.releases.remove(confirming.id);
            onChange();
          }}
        />
      </div>
    </section>
  );
}

// ── Team members ─────────────────────────────────────────────────────────────
const ROLE_OPTIONS: MemberRole[] = ["admin", "member", "viewer"];

function MembersSection() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<TeamMember | null>(null);

  // add form
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<MemberRole>("member");
  const [designation, setDesignation] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.members.list();
      setMembers(r.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.members.create({
        email: email.trim(),
        name: name.trim(),
        role,
        designation: designation.trim(),
      });
      setEmail("");
      setName("");
      setDesignation("");
      setRole("member");
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Add failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-ink-100 bg-ink-50/40 px-4 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
          <Users className="h-3.5 w-3.5 text-ink-600" />
          Team members
        </h2>
        <span className="text-[11px] text-ink-500">
          {members.length} member{members.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="px-4 py-4">
        <p className="mb-3 text-[12px] text-ink-500">
          Members appear as owner / reviewer options in RCA docs. Roles will
          gate destructive actions once Google sign-in is wired
          (admin · member · viewer).
        </p>

        {loading ? (
          <Spinner />
        ) : (
          <>
            {/* Add form */}
            <form
              onSubmit={submit}
              className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              <input
                className="input"
                placeholder="email@zluri.com"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <input
                className="input"
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <input
                className="input"
                placeholder="Designation (e.g. SRE, DE-Lead)"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <select
                  className="input flex-1"
                  value={role}
                  onChange={(e) => setRole(e.target.value as MemberRole)}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={busy || !email.trim() || !name.trim()}
                  className="btn-primary shrink-0"
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  Add member
                </button>
              </div>
              {err && (
                <div className="sm:col-span-2 text-xs text-red-600">{err}</div>
              )}
            </form>

            {/* List */}
            {members.length === 0 ? (
              <div className="text-[12px] text-ink-400">No members yet.</div>
            ) : (
              <div className="overflow-auto rounded-md border border-ink-100">
                <table className="min-w-full">
                  <thead>
                    <tr>
                      <th className="table-th">Member</th>
                      <th className="table-th">Email</th>
                      <th className="table-th">Role</th>
                      <th className="table-th">Designation</th>
                      <th className="table-th"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <MemberRow
                        key={m.id}
                        member={m}
                        onChange={load}
                        onDelete={() => setConfirming(m)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <ConfirmDialog
          open={confirming !== null}
          title={`Remove ${confirming?.name ?? ""}?`}
          message={
            <>
              This removes the member from the directory. RCA docs they own
              or review keep their email but lose the linked profile.
            </>
          }
          confirmLabel="Remove member"
          onClose={() => setConfirming(null)}
          onConfirm={async () => {
            if (!confirming) return;
            await api.members.remove(confirming.id);
            load();
          }}
        />
      </div>
    </section>
  );
}

function MemberRow({
  member,
  onChange,
  onDelete,
}: {
  member: TeamMember;
  onChange: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ ...member });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.members.update(member.id, {
        email: draft.email,
        name: draft.name,
        role: draft.role,
        designation: draft.designation,
      });
      onChange();
      setEditing(false);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const initials = (member.name || member.email)
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <tr className="border-t border-ink-100 hover:bg-ink-50/40">
      <td className="table-td">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-100 text-[11px] font-medium text-ink-700">
            {member.picture ? (
              <img
                src={member.picture}
                alt={member.name}
                className="h-7 w-7 rounded-full"
              />
            ) : (
              initials
            )}
          </div>
          {editing ? (
            <input
              className="input h-7 py-0 text-[12px]"
              value={draft.name}
              onChange={(e) =>
                setDraft({ ...draft, name: e.target.value })
              }
            />
          ) : (
            <span className="font-medium text-ink-900">{member.name}</span>
          )}
        </div>
      </td>
      <td className="table-td mono text-[12px] text-ink-600">
        {editing ? (
          <input
            className="input h-7 py-0 text-[12px]"
            value={draft.email}
            onChange={(e) =>
              setDraft({ ...draft, email: e.target.value })
            }
          />
        ) : (
          member.email
        )}
      </td>
      <td className="table-td">
        {editing ? (
          <select
            className="input h-7 w-auto py-0 text-[12px]"
            value={draft.role}
            onChange={(e) =>
              setDraft({ ...draft, role: e.target.value as MemberRole })
            }
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        ) : (
          <Pill
            tone={
              member.role === "admin"
                ? "violet"
                : member.role === "member"
                  ? "blue"
                  : "ink"
            }
          >
            {member.role}
          </Pill>
        )}
      </td>
      <td className="table-td">
        {editing ? (
          <input
            className="input h-7 py-0 text-[12px]"
            value={draft.designation}
            onChange={(e) =>
              setDraft({ ...draft, designation: e.target.value })
            }
          />
        ) : (
          <span className="text-[12px] text-ink-700">
            {member.designation || "—"}
          </span>
        )}
      </td>
      <td className="table-td text-right">
        {editing ? (
          <div className="flex justify-end gap-1">
            <button
              onClick={() => {
                setDraft({ ...member });
                setEditing(false);
              }}
              className="btn h-7 px-2 py-0 text-[12px]"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="btn-primary h-7 px-2 py-0 text-[12px]"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
            </button>
          </div>
        ) : (
          <div className="flex justify-end gap-1">
            <button
              onClick={() => setEditing(true)}
              className="btn h-7 px-2 py-0 text-[12px]"
            >
              Edit
            </button>
            <button
              onClick={onDelete}
              className="rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"
              title="Remove member"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ── Ignore list (per-env) ───────────────────────────────────────────────────
function IgnoreListSection() {
  const { env } = useEnv();
  const [items, setItems] = useState<IgnoreEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<IgnoreEntry | null>(null);

  // add form
  const [kind, setKind] = useState<"org" | "orgIntegration">("orgIntegration");
  const [targetId, setTargetId] = useState("");
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  // failure-cache lookup so the user gets name suggestions for IDs they paste
  const [nameHint, setNameHint] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.ignoreList.list(env);
      setItems(r.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    setNameHint(null);
    setTargetId("");
    setName("");
    setComment("");
  }, [env]);

  // When user pastes an ID, search the env's failures_latest for a name hint.
  useEffect(() => {
    let cancelled = false;
    if (!/^[a-fA-F0-9]{24}$/.test(targetId)) {
      setNameHint(null);
      return;
    }
    (async () => {
      try {
        const failures = await api.failures(env);
        if (cancelled) return;
        let hit: string | null = null;
        for (const f of failures.failures) {
          if (kind === "orgIntegration" && f.org_integration_id === targetId) {
            hit = f.integration_instance_name;
            break;
          }
          if (kind === "org" && f.org_id === targetId) {
            hit = f.org_name;
            break;
          }
        }
        setNameHint(hit);
      } catch {
        setNameHint(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetId, kind, env]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.ignoreList.add(env, {
        kind,
        target_id: targetId.trim(),
        cached_name: name.trim() || nameHint || "",
        comment: comment.trim(),
      });
      setTargetId("");
      setName("");
      setComment("");
      setNameHint(null);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Add failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-ink-100 bg-ink-50/40 px-4 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
          <EyeOff className="h-3.5 w-3.5 text-ink-600" />
          Ignore list
        </h2>
        <span className="text-[11px] text-ink-500">
          env <span className="mono">{env}</span>
          {" · "}
          {items.length} entr{items.length === 1 ? "y" : "ies"}
        </span>
      </div>
      <div className="px-4 py-4">
        <p className="mb-3 text-[12px] text-ink-500">
          Failing syncs from these orgs / orgIntegrations will be{" "}
          <strong>excluded from the failures list AND from stats</strong>{" "}
          on the next discovery tick. Add a comment so the rest of the team
          knows why each ID is being skipped.
        </p>

        <form onSubmit={submit} className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <select
              className="input w-auto"
              value={kind}
              onChange={(e) =>
                setKind(e.target.value as "org" | "orgIntegration")
              }
            >
              <option value="orgIntegration">orgIntegration</option>
              <option value="org">org</option>
            </select>
            <input
              className="input flex-1 min-w-[260px] font-mono text-[12px]"
              placeholder="24-char Mongo ObjectId"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              maxLength={24}
              required
            />
            <input
              className="input flex-1 min-w-[160px]"
              placeholder={
                nameHint
                  ? `Name (${nameHint} from current failures)`
                  : "Name (optional, for display)"
              }
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              className="input flex-1"
              placeholder="Comment — why is this ignored?"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <button
              type="submit"
              disabled={
                busy || !/^[a-fA-F0-9]{24}$/.test(targetId.trim())
              }
              className="btn-primary"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Add to ignore list
            </button>
          </div>
          {err && <div className="text-xs text-red-600">{err}</div>}
        </form>

        <div className="mt-5">
          {loading ? (
            <Spinner />
          ) : items.length === 0 ? (
            <div className="text-[12px] text-ink-400">
              Nothing ignored in <span className="mono">{env}</span> yet.
            </div>
          ) : (
            <div className="overflow-auto rounded-md border border-ink-100">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className="table-th">Kind</th>
                    <th className="table-th">ID</th>
                    <th className="table-th">Name</th>
                    <th className="table-th">Comment</th>
                    <th className="table-th">Added</th>
                    <th className="table-th"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr
                      key={it.id}
                      className="border-t border-ink-100 hover:bg-ink-50/40"
                    >
                      <td className="table-td">
                        <Pill tone={it.kind === "org" ? "violet" : "blue"}>
                          {it.kind}
                        </Pill>
                      </td>
                      <td className="table-td mono text-[12px]">
                        {it.target_id}
                      </td>
                      <td className="table-td text-[12px]">
                        {it.cached_name || "—"}
                      </td>
                      <td className="table-td max-w-[28rem] text-[12px] text-ink-700">
                        {it.comment || "—"}
                      </td>
                      <td className="table-td text-[11px] text-ink-500">
                        {new Date(it.added_at).toLocaleDateString()}
                      </td>
                      <td className="table-td text-right">
                        <button
                          onClick={() => setConfirming(it)}
                          className="rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <ConfirmDialog
          open={confirming !== null}
          title={`Remove ${confirming?.kind} "${
            confirming?.cached_name || confirming?.target_id
          }" from ignore list?`}
          message="The next discovery tick will start surfacing failures for this ID again."
          confirmLabel="Remove from ignore list"
          onClose={() => setConfirming(null)}
          onConfirm={async () => {
            if (!confirming) return;
            await api.ignoreList.remove(env, confirming.id);
            load();
          }}
        />
      </div>
    </section>
  );
}

// ── Error tag rules ─────────────────────────────────────────────────────────
function ErrorTagRulesSection() {
  const [rules, setRules] = useState<ErrorTagRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [test, setTest] = useState("");

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.errorTagRules.list();
      setRules(r.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Auto-dismiss the saved indicator
  useEffect(() => {
    if (savedAt == null) return;
    const t = setTimeout(() => setSavedAt(null), 3000);
    return () => clearTimeout(t);
  }, [savedAt]);

  const save = async () => {
    setErr(null);
    try {
      await api.errorTagRules.replace(rules);
      setSavedAt(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  };

  const updateRule = (i: number, patch: Partial<ErrorTagRule>) => {
    setRules((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const addRule = () =>
    setRules((prev) => [
      ...prev,
      { tag: "", match: "", color: "neutral" },
    ]);

  const removeRule = (i: number) =>
    setRules((prev) => prev.filter((_, idx) => idx !== i));

  // Live preview: which rules match the test string?
  const matches = (() => {
    if (!test.trim()) return [] as string[];
    const out: string[] = [];
    for (const r of rules) {
      if (!r.match) continue;
      try {
        const re = new RegExp(r.match, "i");
        if (re.test(test)) out.push(r.tag);
      } catch {
        // ignore invalid regex during typing
      }
    }
    return out;
  })();

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-ink-100 bg-ink-50/40 px-4 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
          <Wand2 className="h-3.5 w-3.5 text-ink-600" />
          Error tag rules
        </h2>
        <span className="text-[11px] text-ink-500">
          {rules.length} rule{rules.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="px-4 py-4">
        <p className="mb-3 text-[12px] text-ink-500">
          Regex rules over <span className="mono">error_reason</span>. A failure
          can match multiple tags. Save changes — discovery picks them up on
          the next tick. Tags <span className="mono">unknown</span> /{" "}
          <span className="mono">other</span> are reserved fallbacks.
        </p>

        {loading ? (
          <Spinner />
        ) : (
          <>
            <div className="overflow-auto rounded-md border border-ink-100">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className="table-th">Tag</th>
                    <th className="table-th">Color</th>
                    <th className="table-th">Pattern (regex)</th>
                    <th className="table-th"></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="table-td text-center text-[12px] text-ink-400"
                      >
                        No rules. Add one below.
                      </td>
                    </tr>
                  ) : (
                    rules.map((r, i) => (
                      <tr
                        key={i}
                        className="border-t border-ink-100 hover:bg-ink-50/40"
                      >
                        <td className="table-td">
                          <input
                            className="input mono h-7 py-0 text-[12px]"
                            placeholder="tag_name"
                            value={r.tag}
                            onChange={(e) =>
                              updateRule(i, { tag: e.target.value })
                            }
                          />
                        </td>
                        <td className="table-td">
                          <ColorPicker
                            value={r.color as LabelColor}
                            onChange={(c) => updateRule(i, { color: c })}
                          />
                        </td>
                        <td className="table-td">
                          <input
                            className="input mono w-full h-7 py-0 text-[12px]"
                            placeholder="regex pattern"
                            value={r.match}
                            onChange={(e) =>
                              updateRule(i, { match: e.target.value })
                            }
                            spellCheck={false}
                          />
                          <RegexValidity pattern={r.match} />
                        </td>
                        <td className="table-td text-right">
                          <button
                            onClick={() => removeRule(i)}
                            className="rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button onClick={addRule} className="btn">
                <Plus className="h-3.5 w-3.5" />
                Add rule
              </button>
              <button
                onClick={save}
                className="btn-primary"
                title="Replace all rules atomically"
              >
                Save changes
              </button>
              {savedAt && (
                <span className="text-[12px] text-emerald-700">Saved.</span>
              )}
              {err && (
                <span className="text-[12px] text-red-600">{err}</span>
              )}
            </div>

            {/* Live tester */}
            <div className="mt-5 rounded-md border border-dashed border-ink-200 bg-ink-50/40 p-3">
              <label className="text-[11px] uppercase tracking-wide text-ink-500">
                Test against an error string
              </label>
              <textarea
                className="mono mt-1 h-20 w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-[12px] focus:border-ink-500 focus:outline-none focus:ring-1 focus:ring-ink-500"
                value={test}
                onChange={(e) => setTest(e.target.value)}
                placeholder="Paste an error_reason here to see which tags hit"
                spellCheck={false}
              />
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {test.trim() === "" ? (
                  <span className="text-[11px] text-ink-400">
                    Awaiting input.
                  </span>
                ) : matches.length === 0 ? (
                  <Pill tone="ink">no rule matches → would tag as "other"</Pill>
                ) : (
                  matches.map((m) => (
                    <Pill key={m} tone="emerald">
                      {m}
                    </Pill>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function RegexValidity({ pattern }: { pattern: string }) {
  if (!pattern) return null;
  try {
    new RegExp(pattern);
    return null;
  } catch (e) {
    return (
      <div className="mt-0.5 text-[10px] text-red-600">
        invalid regex: {(e as Error).message}
      </div>
    );
  }
}
