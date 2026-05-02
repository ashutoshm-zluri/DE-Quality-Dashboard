import type { RecoveryRun } from "../types";

/**
 * Hand-crafted sample data covering every recovery state. Used by the
 * Recovery Runs page until the real backend lands. The data mirrors the
 * shape of <env>/recovery_runs/<run_id>.json that consume.py will write.
 *
 * NB: The "live_doc" field on each MOCK run is fake. In the real flow the
 * live doc is read from mongo at undo time and compared against snapshot.
 */

const ME = {
  email: "ashutosh.m@zluri.com",
  name: "Ashutosh Mishra",
  picture: null,
};

const ALICE = {
  email: "alice@zluri.com",
  name: "Alice Park",
  picture: null,
};

export const MOCK_RECOVERY_RUNS: RecoveryRun[] = [
  // 1. SUCCEEDED MARK_COMPLETE — fresh, undo eligible, snapshot intact
  {
    id: "rec_2026-05-02T09-12-04Z_8a4c",
    env: "prod",
    action: "MARK_COMPLETE",
    state: "SUCCEEDED",
    de_sync_status_id: "65f3a1c4d7e9f00012a4b8e1",
    sync_id: "65f3a1c4d7e9f00012a4b8e2",
    org_id: "62a5b1c4d7e9f00012a4b801",
    org_name: "Acme Corp",
    org_integration_id: "63b8c1c4d7e9f00012a4c901",
    integration_name: "Salesforce",
    integration_instance_name: "Acme · Sandbox",
    mode: "users_data",
    triggered_by: ME,
    batch_id: "batch_2026-05-02T09-12-00Z_a3",
    created_at: "2026-05-02T09:12:04Z",
    completed_at: "2026-05-02T09:12:06Z",
    state_history: [
      { state: "PLANNED", at: "2026-05-02T09:12:04.011Z", by: ME },
      { state: "READY", at: "2026-05-02T09:12:04.214Z" },
      {
        state: "SNAPSHOT_SAVED",
        at: "2026-05-02T09:12:04.310Z",
        note: "1.4 KB · sha256:c91f…",
      },
      { state: "EXECUTING", at: "2026-05-02T09:12:04.415Z" },
      {
        state: "MUTATION_APPLIED",
        at: "2026-05-02T09:12:06.002Z",
        note: "$set on de_sync_status",
      },
      { state: "SUCCEEDED", at: "2026-05-02T09:12:06.018Z" },
    ],
    snapshot: {
      saved_at: "2026-05-02T09:12:04.310Z",
      hash: "sha256:c91f4e2a8b…",
      size_bytes: 1432,
      storage_path:
        "prod/snapshots/rec_2026-05-02T09-12-04Z_8a4c/65f3a1c4d7e9f00012a4b8e1.json",
      fields_recorded: [
        "sync_status",
        "sync_complete",
        "lastSyncCompletedAt",
        "updatedAt",
      ],
    },
    mutation: {
      set: {
        sync_status: "Completed",
        sync_complete: true,
        lastSyncCompletedAt: "2026-05-02T09:12:06.000Z",
        mark_source: "recovery",
      },
    },
    undo: {
      eligible: true,
      eligible_until: "2026-05-09T09:12:06Z",
      drift_check: {
        checked_at: "2026-05-02T10:00:00Z",
        drift_detected: false,
        drifted_fields: [],
      },
    },
  },

  // 2. SUCCEEDED RETRIGGER — validator accepted, flow_run_id linked
  {
    id: "rec_2026-05-02T09-12-04Z_3f1e",
    env: "prod",
    action: "RETRIGGER",
    state: "SUCCEEDED",
    de_sync_status_id: "65f3a1c4d7e9f00012a4b8e3",
    sync_id: "65f3a1c4d7e9f00012a4b8e4",
    org_id: "62a5b1c4d7e9f00012a4b801",
    org_name: "Acme Corp",
    org_integration_id: "63b8c1c4d7e9f00012a4c902",
    integration_name: "Slack",
    integration_instance_name: "Acme · Workspace",
    mode: "activity_data",
    triggered_by: ME,
    batch_id: "batch_2026-05-02T09-12-00Z_a3",
    created_at: "2026-05-02T09:12:05Z",
    completed_at: "2026-05-02T09:12:09Z",
    state_history: [
      { state: "PLANNED", at: "2026-05-02T09:12:05.111Z", by: ME },
      { state: "READY", at: "2026-05-02T09:12:05.302Z" },
      {
        state: "VALIDATOR_PREFLIGHT",
        at: "2026-05-02T09:12:05.580Z",
        note: "validator_ok=true",
      },
      {
        state: "SNAPSHOT_SAVED",
        at: "2026-05-02T09:12:05.640Z",
        note: "0.9 KB · sha256:71b3…",
      },
      { state: "EXECUTING", at: "2026-05-02T09:12:05.720Z" },
      {
        state: "MUTATION_APPLIED",
        at: "2026-05-02T09:12:08.901Z",
        note: "validator returned 200, flow_run_id=42c8…",
      },
      { state: "SUCCEEDED", at: "2026-05-02T09:12:09.014Z" },
    ],
    snapshot: {
      saved_at: "2026-05-02T09:12:05.640Z",
      hash: "sha256:71b3f0c8e2…",
      size_bytes: 936,
      storage_path:
        "prod/snapshots/rec_2026-05-02T09-12-04Z_3f1e/65f3a1c4d7e9f00012a4b8e3.json",
      fields_recorded: ["sync_status", "trigger_state", "updatedAt"],
    },
    mutation: {
      set: {
        sync_status: "Running",
        "trigger_state.flow_run_id": "42c8a1c4-d7e9-f000-12a4-b8e500000000",
        "trigger_state.triggered_at": "2026-05-02T09:12:08.901Z",
      },
    },
    validator: {
      status_code: 200,
      message: "accepted",
      flow_run_id: "42c8a1c4-d7e9-f000-12a4-b8e500000000",
      flow_run_url:
        "https://prefect.zluri.internal/runs/42c8a1c4-d7e9-f000-12a4-b8e500000000",
    },
    undo: {
      eligible: false,
      reason_if_not:
        "Retrigger has fired and the validator accepted. The flow is now running on Prefect — request cancellation there if needed.",
    },
    active_run_path: "/runs/65f3a1c4d7e9f00012a4b8e4",
  },

  // 3. EXECUTING — live, in flight
  {
    id: "rec_2026-05-02T10-04-22Z_b2d9",
    env: "prod",
    action: "RETRIGGER",
    state: "EXECUTING",
    de_sync_status_id: "65f3a1c4d7e9f00012a4b8f0",
    sync_id: "65f3a1c4d7e9f00012a4b8f1",
    org_id: "62a5b1c4d7e9f00012a4b803",
    org_name: "Bright Inc",
    org_integration_id: "63b8c1c4d7e9f00012a4c910",
    integration_name: "Okta",
    integration_instance_name: "Bright · Production",
    mode: "users_data",
    triggered_by: ME,
    created_at: "2026-05-02T10:04:22Z",
    state_history: [
      { state: "PLANNED", at: "2026-05-02T10:04:22.011Z", by: ME },
      { state: "READY", at: "2026-05-02T10:04:22.234Z" },
      {
        state: "VALIDATOR_PREFLIGHT",
        at: "2026-05-02T10:04:22.512Z",
        note: "validator_ok=true",
      },
      {
        state: "SNAPSHOT_SAVED",
        at: "2026-05-02T10:04:22.604Z",
        note: "1.1 KB · sha256:9aef…",
      },
      { state: "EXECUTING", at: "2026-05-02T10:04:22.700Z" },
    ],
    snapshot: {
      saved_at: "2026-05-02T10:04:22.604Z",
      hash: "sha256:9aef02c14d…",
      size_bytes: 1102,
      storage_path:
        "prod/snapshots/rec_2026-05-02T10-04-22Z_b2d9/65f3a1c4d7e9f00012a4b8f0.json",
      fields_recorded: ["sync_status", "trigger_state", "updatedAt"],
    },
    mutation: null,
    undo: {
      eligible: false,
      reason_if_not: "Action is still in flight; wait for it to settle.",
    },
  },

  // 4. FAILED — validator rejected with 4xx
  {
    id: "rec_2026-05-02T08-58-11Z_5cae",
    env: "prod",
    action: "RETRIGGER",
    state: "FAILED",
    de_sync_status_id: "65f3a1c4d7e9f00012a4b900",
    sync_id: "65f3a1c4d7e9f00012a4b901",
    org_id: "62a5b1c4d7e9f00012a4b820",
    org_name: "Cog Labs",
    org_integration_id: "63b8c1c4d7e9f00012a4c920",
    integration_name: "Zoom",
    integration_instance_name: "Cog · Tenant",
    mode: "users_data",
    triggered_by: ALICE,
    created_at: "2026-05-02T08:58:11Z",
    completed_at: "2026-05-02T08:58:13Z",
    state_history: [
      { state: "PLANNED", at: "2026-05-02T08:58:11.001Z", by: ALICE },
      { state: "READY", at: "2026-05-02T08:58:11.180Z" },
      {
        state: "VALIDATOR_PREFLIGHT",
        at: "2026-05-02T08:58:12.901Z",
        note: "validator_ok=false · credentials expired",
      },
      {
        state: "FAILED",
        at: "2026-05-02T08:58:13.012Z",
        note: "Validator rejected (400): credentials expired. No mutation attempted.",
      },
    ],
    snapshot: null,
    mutation: null,
    validator: {
      status_code: 400,
      message: "credentials expired — admin must reconnect Zoom",
    },
    failure_reason: "credentials expired — admin must reconnect Zoom",
    undo: {
      eligible: false,
      reason_if_not: "Nothing was written; nothing to undo.",
    },
  },

  // 5. BLOCKED — safety gate caught a per-org cap
  {
    id: "rec_2026-05-02T09-12-05Z_77a1",
    env: "prod",
    action: "RETRIGGER",
    state: "BLOCKED",
    de_sync_status_id: "65f3a1c4d7e9f00012a4b910",
    sync_id: "65f3a1c4d7e9f00012a4b911",
    org_id: "62a5b1c4d7e9f00012a4b830",
    org_name: "Datapeak",
    org_integration_id: "63b8c1c4d7e9f00012a4c930",
    integration_name: "GitHub",
    integration_instance_name: "Datapeak · Org",
    mode: "users_data",
    triggered_by: ME,
    batch_id: "batch_2026-05-02T09-12-00Z_a3",
    created_at: "2026-05-02T09:12:05Z",
    completed_at: "2026-05-02T09:12:05Z",
    state_history: [
      { state: "PLANNED", at: "2026-05-02T09:12:05.812Z", by: ME },
      {
        state: "BLOCKED",
        at: "2026-05-02T09:12:05.815Z",
        note:
          "blast_radius_per_org: this batch already includes 16 actions for Datapeak; cap is 15.",
      },
    ],
    snapshot: null,
    mutation: null,
    failure_reason:
      "blast_radius_per_org: this batch already includes 16 actions for Datapeak; cap is 15.",
    undo: {
      eligible: false,
      reason_if_not: "Action never executed.",
    },
  },

  // 6. UNDONE — was SUCCEEDED, then user clicked Undo
  {
    id: "rec_2026-05-01T14-22-30Z_4d2b",
    env: "prod",
    action: "MARK_COMPLETE",
    state: "UNDONE",
    de_sync_status_id: "65f3a1c4d7e9f00012a4b920",
    sync_id: "65f3a1c4d7e9f00012a4b921",
    org_id: "62a5b1c4d7e9f00012a4b840",
    org_name: "Echo Systems",
    org_integration_id: "63b8c1c4d7e9f00012a4c940",
    integration_name: "Jira",
    integration_instance_name: "Echo · Cloud",
    mode: "other_static_data",
    triggered_by: ME,
    created_at: "2026-05-01T14:22:30Z",
    completed_at: "2026-05-01T14:22:32Z",
    state_history: [
      { state: "PLANNED", at: "2026-05-01T14:22:30.100Z", by: ME },
      { state: "READY", at: "2026-05-01T14:22:30.310Z" },
      {
        state: "SNAPSHOT_SAVED",
        at: "2026-05-01T14:22:30.410Z",
        note: "1.5 KB · sha256:e2a1…",
      },
      { state: "EXECUTING", at: "2026-05-01T14:22:30.510Z" },
      {
        state: "MUTATION_APPLIED",
        at: "2026-05-01T14:22:32.001Z",
      },
      { state: "SUCCEEDED", at: "2026-05-01T14:22:32.014Z" },
      {
        state: "UNDONE",
        at: "2026-05-01T15:08:11.220Z",
        by: ME,
        note: "Restored 4 fields from snapshot. No drift detected.",
      },
    ],
    snapshot: {
      saved_at: "2026-05-01T14:22:30.410Z",
      hash: "sha256:e2a14b80ff…",
      size_bytes: 1521,
      storage_path:
        "prod/snapshots/rec_2026-05-01T14-22-30Z_4d2b/65f3a1c4d7e9f00012a4b920.json",
      fields_recorded: [
        "sync_status",
        "sync_complete",
        "lastSyncCompletedAt",
        "updatedAt",
      ],
    },
    mutation: {
      set: {
        sync_status: "Completed",
        sync_complete: true,
        lastSyncCompletedAt: "2026-05-01T14:22:32.000Z",
        mark_source: "recovery",
      },
    },
    undo: {
      eligible: false,
      reason_if_not: "Already undone.",
      undone_at: "2026-05-01T15:08:11.220Z",
      undone_by: ME,
      drift_check: {
        checked_at: "2026-05-01T15:08:10.900Z",
        drift_detected: false,
        drifted_fields: [],
      },
    },
  },

  // 7. SUCCEEDED but past undo window
  {
    id: "rec_2026-04-22T11-30-00Z_91dd",
    env: "prod",
    action: "MARK_COMPLETE",
    state: "SUCCEEDED",
    de_sync_status_id: "65f3a1c4d7e9f00012a4b930",
    sync_id: "65f3a1c4d7e9f00012a4b931",
    org_id: "62a5b1c4d7e9f00012a4b850",
    org_name: "Falcon",
    org_integration_id: "63b8c1c4d7e9f00012a4c950",
    integration_name: "ServiceNow",
    integration_instance_name: "Falcon · Production",
    mode: "users_data",
    triggered_by: ALICE,
    created_at: "2026-04-22T11:30:00Z",
    completed_at: "2026-04-22T11:30:02Z",
    state_history: [
      { state: "PLANNED", at: "2026-04-22T11:30:00.011Z", by: ALICE },
      { state: "READY", at: "2026-04-22T11:30:00.214Z" },
      { state: "SNAPSHOT_SAVED", at: "2026-04-22T11:30:00.310Z" },
      { state: "EXECUTING", at: "2026-04-22T11:30:00.415Z" },
      { state: "MUTATION_APPLIED", at: "2026-04-22T11:30:02.000Z" },
      { state: "SUCCEEDED", at: "2026-04-22T11:30:02.018Z" },
    ],
    snapshot: {
      saved_at: "2026-04-22T11:30:00.310Z",
      hash: "sha256:1f0c8d3a91…",
      size_bytes: 1402,
      storage_path:
        "prod/snapshots/rec_2026-04-22T11-30-00Z_91dd/65f3a1c4d7e9f00012a4b930.json",
      fields_recorded: ["sync_status", "sync_complete", "updatedAt"],
    },
    mutation: {
      set: {
        sync_status: "Completed",
        sync_complete: true,
        mark_source: "recovery",
      },
    },
    undo: {
      eligible: false,
      eligible_until: "2026-04-29T11:30:02Z",
      reason_if_not:
        "Outside the 7-day undo window. Snapshot is preserved if you need a manual restore.",
    },
  },

  // 8. POISONED — mid-write failure where the auto-undo also failed
  {
    id: "rec_2026-05-02T07-44-09Z_3e1c",
    env: "prod",
    action: "MARK_COMPLETE",
    state: "POISONED",
    de_sync_status_id: "65f3a1c4d7e9f00012a4b940",
    sync_id: "65f3a1c4d7e9f00012a4b941",
    org_id: "62a5b1c4d7e9f00012a4b860",
    org_name: "GreenWave",
    org_integration_id: "63b8c1c4d7e9f00012a4c960",
    integration_name: "Workday",
    integration_instance_name: "GreenWave · Tenant",
    mode: "users_data",
    triggered_by: ME,
    created_at: "2026-05-02T07:44:09Z",
    completed_at: "2026-05-02T07:44:14Z",
    state_history: [
      { state: "PLANNED", at: "2026-05-02T07:44:09.001Z", by: ME },
      { state: "READY", at: "2026-05-02T07:44:09.210Z" },
      { state: "SNAPSHOT_SAVED", at: "2026-05-02T07:44:09.300Z" },
      { state: "EXECUTING", at: "2026-05-02T07:44:09.400Z" },
      {
        state: "FAILED",
        at: "2026-05-02T07:44:12.901Z",
        note:
          "mongo write returned ok but secondary read mismatched expected fields. Auto-undo started.",
      },
      {
        state: "POISONED",
        at: "2026-05-02T07:44:14.110Z",
        note:
          "Auto-undo $set returned WriteConflict; doc may be partially mutated. Human review required.",
      },
    ],
    snapshot: {
      saved_at: "2026-05-02T07:44:09.300Z",
      hash: "sha256:b40a5c1e7d…",
      size_bytes: 1389,
      storage_path:
        "prod/snapshots/rec_2026-05-02T07-44-09Z_3e1c/65f3a1c4d7e9f00012a4b940.json",
      fields_recorded: ["sync_status", "sync_complete", "updatedAt"],
    },
    mutation: {
      set: {
        sync_status: "Completed",
        sync_complete: true,
        mark_source: "recovery",
      },
    },
    failure_reason:
      "Mid-write divergence; auto-undo also failed. Snapshot is preserved at the path below for manual restore.",
    undo: {
      eligible: false,
      reason_if_not:
        "Run is poisoned. Don't use Undo — it'll fail the same way. Restore manually using the snapshot.",
      drift_check: {
        checked_at: "2026-05-02T07:44:14.000Z",
        drift_detected: true,
        drifted_fields: ["sync_status", "updatedAt"],
      },
    },
  },

  // 9. SUCCEEDED but live doc has drifted (someone else wrote to it after) —
  //    undo will be partial
  {
    id: "rec_2026-05-02T06-15-00Z_a201",
    env: "prod",
    action: "MARK_COMPLETE",
    state: "SUCCEEDED",
    de_sync_status_id: "65f3a1c4d7e9f00012a4b950",
    sync_id: "65f3a1c4d7e9f00012a4b951",
    org_id: "62a5b1c4d7e9f00012a4b870",
    org_name: "Helix Bio",
    org_integration_id: "63b8c1c4d7e9f00012a4c970",
    integration_name: "Microsoft 365",
    integration_instance_name: "Helix · Tenant",
    mode: "other_static_data",
    triggered_by: ME,
    created_at: "2026-05-02T06:15:00Z",
    completed_at: "2026-05-02T06:15:02Z",
    state_history: [
      { state: "PLANNED", at: "2026-05-02T06:15:00.011Z", by: ME },
      { state: "READY", at: "2026-05-02T06:15:00.214Z" },
      { state: "SNAPSHOT_SAVED", at: "2026-05-02T06:15:00.310Z" },
      { state: "EXECUTING", at: "2026-05-02T06:15:00.415Z" },
      { state: "MUTATION_APPLIED", at: "2026-05-02T06:15:02.000Z" },
      { state: "SUCCEEDED", at: "2026-05-02T06:15:02.018Z" },
    ],
    snapshot: {
      saved_at: "2026-05-02T06:15:00.310Z",
      hash: "sha256:71f0c8e2af…",
      size_bytes: 1480,
      storage_path:
        "prod/snapshots/rec_2026-05-02T06-15-00Z_a201/65f3a1c4d7e9f00012a4b950.json",
      fields_recorded: ["sync_status", "sync_complete", "updatedAt"],
    },
    mutation: {
      set: {
        sync_status: "Completed",
        sync_complete: true,
        mark_source: "recovery",
      },
    },
    undo: {
      eligible: true,
      eligible_until: "2026-05-09T06:15:02Z",
      drift_check: {
        checked_at: "2026-05-02T10:30:00Z",
        drift_detected: true,
        drifted_fields: ["updatedAt", "lastSyncCompletedAt"],
      },
    },
  },
];
