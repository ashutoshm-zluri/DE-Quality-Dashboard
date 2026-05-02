export type SyncMode =
  | "users_data"
  | "other_static_data"
  | "activity_data"
  | "all"
  | "sdk_all"
  | "sdk_all_v2"
  | string;

export type SyncStatus =
  | "Failed"
  | "Running"
  | "Triggered"
  | "Not Triggered"
  | "Completed"
  | "Not Started";

export type RecommendedAction =
  | "MARK_COMPLETE"
  | "RETRIGGER"
  | "TRIGGERED"
  | "SKIP_RUNNING"
  | "MANUAL_REVIEW"
  | "SKIP_OUT_OF_WINDOW";

export interface TriggerState {
  triggered_at: string;
  triggered_by: string;
  status: "queued" | "running" | "completed" | "failed";
  validator_status_code: number | null;
  flow_run_id: string | null;
  flow_run_url: string | null;
  new_step_function: string | null;
  eta_minutes: number | null;
  eta_basis: string | null;
}

export interface Failure {
  de_sync_status_id: string;
  sync_id: string;
  org_integration_id: string;
  org_id: string;
  integration_id: string;
  org_name: string;
  integration_instance_name: string;
  integration_name: string;
  mode: SyncMode;
  current_status: SyncStatus;
  ie_start_date: string;
  ie_end_date: string;
  time_taken_by_ie_in_mins: number;
  time_taken_by_de_in_mins: number;
  step_function: string[] | string | null;
  is_IE_bad_request: boolean;
  latest_sync_timestamp: string | null;
  recommended_action: RecommendedAction;
  action_reason: string;
  error_reason: string;
  /** Regex-driven categories from shared/error_tags.json. Always at least
   *  one tag — falls back to "unknown" or "other". */
  error_tags?: string[];
  createdAt: string;
  updatedAt: string;
  s3_key: string;
  app_flag: boolean;
  payment_flag: boolean;
  eta_minutes: number | null;
  trigger_state: TriggerState | null;
}

export interface FailuresResponse {
  run_id: string;
  generated_at: string;
  /** Set by the refresh-statuses subcommand. May be absent if discover hasn't
   *  been refreshed since the last full discovery. */
  last_refreshed_at?: string;
  env: string;
  summary: {
    total: number;
    by_action: Record<RecommendedAction, number>;
    by_mode: Record<string, number>;
  };
  failures: Failure[];
}

export interface RunDetail {
  sync_id: string;
  de_sync_status_id: string | null;
  org_integration_id: string | null;
  org_name?: string | null;
  integration_instance_name?: string | null;
  integration_name?: string | null;
  mode: SyncMode | null;
  triggered_at: string;
  triggered_by: string;
  status: "queued" | "running" | "completed" | "failed";
  validator_status_code: number | null;
  validator_response: Record<string, unknown> | null;
  flow_run_id: string | null;
  flow_run_url: string | null;
  new_step_function: string | null;
  eta_minutes: number | null;
  eta_basis: string | null;
  expected_completion_at: string | null;
  event_payload: Record<string, unknown> | null;
  timeline: Array<{ at: string; event: string; detail?: string }>;
}

export interface ActiveRunsResponse {
  generated_at: string;
  count: number;
  items: RunDetail[];
}

export interface DurationStats {
  samples: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface RepeatFailureStats {
  pairs_total: number;
  pairs_repeated: number;
  pairs_repeat_rate: number;
  failures_in_repeated: number;
  share_of_failures_in_repeats: number;
}

export interface StatsResponse {
  generated_at: string;
  window: { start: string; end: string };
  summary: {
    total_syncs: number;
    total_failed: number;
    /** Failed + Running + Not Triggered + Not Started — anything other than Completed.
     *  Optional because old hand-typed mock data didn't include it. */
    total_not_completed?: number;
    total_completed?: number;
    total_ie_bad_requests: number;
    overall_success_24h: number;
    overall_success_72h: number;
    overall_success_all: number;
    // ── new in this iteration ─────────────────────────────────────────
    duration_minutes?: DurationStats;
    throughput_per_hour?: number;
    peak_throughput_per_hour?: number;
    repeat_failure?: RepeatFailureStats;
  };
  by_date: Array<{
    date: string;
    total: number;
    failed: number;
    /** Optional — older mocks didn't carry this. UI defaults to 0. */
    not_completed?: number;
    completed?: number;
    completed_24h?: number;
    completed_72h?: number;
    success_24h: number;
    success_72h: number;
    success_all: number;
  }>;
  /** Hourly buckets for the last ~72h. Same shape as `by_date` but keyed on `ts`
   *  (ISO instant). Optional because old mocks didn't have it. */
  by_hour?: Array<{
    ts: string;
    total: number;
    failed: number;
    not_completed?: number;
    completed?: number;
    completed_24h?: number;
    completed_72h?: number;
    success_24h: number;
    success_72h: number;
    success_all: number;
  }>;
  by_integration: Array<{
    integration_id?: string;
    integration_name: string;
    total: number;
    failed: number;
    not_completed?: number;
    failure_rate: number;
  }>;
  errors_by_tag?: Array<{ tag: string; count: number }>;
  repeat_failure_top?: Array<{
    orgIntegrationId: string;
    mode: string;
    failures: number;
  }>;
}

export interface BadRequestsResponse {
  generated_at: string;
  window: { start: string; end: string };
  total: number;
  items: Array<{
    de_sync_status_id: string;
    sync_id: string;
    org_integration_id: string;
    org_name: string;
    integration_instance_name: string;
    integration_name: string;
    mode: SyncMode;
    ie_end_date: string;
    validator_status_code: number;
    validator_message: string;
    createdAt: string;
  }>;
}

export interface BulkActionItem {
  sync_id: string;
  action: "retrigger" | "mark_complete";
  failure: Failure;
  message?: string;
}

export interface BulkRunResponse {
  ok: boolean;
  ran_at: string;
  count: number;
  results: Array<{
    sync_id: string;
    action: "retrigger" | "mark_complete";
    ok: boolean;
    error?: string;
  }>;
}

// ── Release tracker ───────────────────────────────────────────────────────
export type LabelColor =
  | "neutral"
  | "red"
  | "orange"
  | "amber"
  | "blue"
  | "violet"
  | "emerald"
  | "ink";

export interface Label {
  id: string;
  name: string;
  color: LabelColor;
  created_at: string;
}

export interface JiraIssueMeta {
  status: string | null;
  status_category: string | null;     // "todo" | "indeterminate" | "done"
  issuetype: string | null;
  priority: string | null;
  assignee: { name: string; email: string | null } | null;
  jira_labels: string[];
  created: string | null;
  updated: string | null;
  resolution: string | null;
  description: string;                 // plain text extracted from ADF
}

export interface Bug {
  id: string;
  jira_id: string | null;
  jira_url: string | null;
  title: string;
  label_ids: string[];
  created_at: string;
  jira_meta?: JiraIssueMeta | null;
}

export interface Release {
  id: string;
  name: string;
  jira_id: string;
  jira_url: string;
  released_on: string | null;
  /** 1-4. Required for Release Tracker grouping. */
  quarter: number | null;
  year: number | null;
  created_at: string;
  last_synced_at?: string | null;
  bugs: Bug[];
}

export interface JiraHealth {
  configured: boolean;
  base_url: string;
  email: string | null;
}

// ── RCA docs ──────────────────────────────────────────────────────────────
export type RcaFormat = "md" | "txt";

export interface RcaDoc {
  id: string;
  name: string;
  format: RcaFormat;
  owner: string;
  reviewer: string;
  tags: string[];
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface RcaDocWithContent extends RcaDoc {
  content: string;
}

// ── Settings: tag rules / members / ignore list ───────────────────────────
export interface ErrorTagRule {
  tag: string;
  match: string;
  color: string;
}

export type MemberRole = "admin" | "member" | "viewer";

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: MemberRole;
  designation: string;
  picture: string | null;
  created_at: string;
  updated_at: string;
}

export interface IgnoreEntry {
  id: string;
  kind: "org" | "orgIntegration";
  target_id: string;
  cached_name: string;
  comment: string;
  added_by: string;
  added_at: string;
}

// ── Phase 3: recovery actions, snapshots, undo ─────────────────────────────

export type RecoveryAction = "MARK_COMPLETE" | "RETRIGGER";

export type RecoveryState =
  | "PLANNED"      // queued; safety gate not yet evaluated
  | "BLOCKED"      // safety gate refused (cap, allowlist, role)
  | "READY"        // gate passed; awaiting snapshot
  | "EXECUTING"    // mongo write in flight or validator call in flight
  | "SUCCEEDED"
  | "FAILED"
  | "SKIPPED"      // validator said no, or doc already in target state
  | "UNDONE"       // SUCCEEDED + later restored via /undo
  | "POISONED";    // mid-write failure where auto-undo also failed; needs human

export interface RecoveryActor {
  email: string;
  name: string;
  picture?: string | null;
}

export interface RecoverySnapshot {
  saved_at: string;
  hash: string;            // sha256 of canonical JSON
  size_bytes: number;
  storage_path: string;    // <env>/snapshots/<run_id>/<de_sync_status_id>.json
  fields_recorded: string[];
}

export interface RecoveryMutation {
  /** Fields we $set on the live doc. The pre-image is in the snapshot. */
  set: Record<string, unknown>;
}

export interface ValidatorResponse {
  status_code: number;
  message: string;
  flow_run_id?: string;
  flow_run_url?: string;
}

export interface DriftCheck {
  checked_at: string;
  drift_detected: boolean;
  drifted_fields: string[];
}

export interface UndoState {
  /** Whether undo is currently allowed. False after window expires, after a
   *  RETRIGGER has actually fired off, or if the snapshot is missing. */
  eligible: boolean;
  eligible_until?: string;
  reason_if_not?: string;
  undone_at?: string;
  undone_by?: RecoveryActor;
  drift_check?: DriftCheck;
}

export interface RecoveryStateEvent {
  state: RecoveryState | "VALIDATOR_PREFLIGHT" | "SNAPSHOT_SAVED" | "MUTATION_APPLIED";
  at: string;
  by?: RecoveryActor;
  note?: string;
}

export interface RecoveryRun {
  id: string;                     // rec_2026-05-02T08-08-12Z_a91f
  env: "dev" | "prod";
  action: RecoveryAction;
  state: RecoveryState;

  // Target
  de_sync_status_id: string;
  sync_id: string;
  org_id: string;
  org_name: string;
  org_integration_id: string;
  integration_name: string;
  integration_instance_name: string;
  mode: string;

  // Provenance
  triggered_by: RecoveryActor;
  batch_id?: string;              // groups runs from a single Re-run all click

  // Lifecycle
  created_at: string;
  completed_at?: string;
  state_history: RecoveryStateEvent[];

  // Artifacts
  snapshot: RecoverySnapshot | null;
  mutation: RecoveryMutation | null;
  validator?: ValidatorResponse;
  failure_reason?: string;

  // Undo
  undo: UndoState;

  // Cross-link to /runs/<sync_id> (the active-runs page) — RETRIGGER only
  active_run_path?: string;
}

export interface RecoveryRunsResponse {
  generated_at: string;
  total: number;
  items: RecoveryRun[];
}
