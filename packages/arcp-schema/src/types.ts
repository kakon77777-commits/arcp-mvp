/**
 * Core types per arcp_ctcl_internal_web_mvp_implementation_spec_v0.1.md §5, §7, §10
 * and arcp_agent_residence_continuity_protocol_whitepaper_v0.1.md.
 */

export type Sensitivity = 'P0' | 'P1' | 'P2' | 'P3';

export type CanonicalRole = 'canonical' | 'derived' | 'replica' | 'archive' | 'inbox';

export type RiskLevel = 'R0' | 'R1' | 'R2' | 'R3' | 'R4';

export type PolicyDecision =
  | 'allow'
  | 'allow-with-log'
  | 'simulate'
  | 'delay'
  | 'request-approval'
  | 'require-multi-party'
  | 'deny';

export type SourceType = 'experienced' | 'inherited' | 'learned' | 'inferred' | 'reported' | 'created';

export interface SourceQuality {
  source_class: string;
  precision: string;
  estimated_uncertainty_ns?: number;
  synchronized?: boolean;
}

export interface InstantRef {
  instant_id: string;
  timescale?: 'utc' | 'posix';
  encoding?: 'unix_s' | 'unix_ms' | 'unix_us' | 'unix_ns' | 'rfc3339';
  value?: string;
  source_quality?: SourceQuality;
  attestation?: {
    alg: string;
    key_id: string;
    signed_fields: string;
    value: string;
    verified?: boolean;
  };
  unverified?: boolean;
}

export interface Provenance {
  source_type: SourceType;
  causal_parent?: string;
  created_by?: string;
}

export interface ObjectVersion {
  schema: 'arcp/object-version/0.1';
  object_id: string;
  object_type: string;
  version: number;
  parents: string[];
  content_hash: string;
  content_uri?: string;
  canonical_role: CanonicalRole;
  sensitivity: Sensitivity;
  provenance: Provenance;
  event_instant?: InstantRef;
  write_instant?: InstantRef;
  status: 'active' | 'tombstoned';
}

export interface EventEnvelope {
  schema: 'arcp/event/0.1';
  event_id: string;
  agent_id: string;
  event_type: string;
  causal_parent: string | null;
  producer: string;
  idempotency_key: string;
  payload_ref?: string;
  payload_hash: string;
  observed_at: InstantRef;
  received_local_time: string;
}

export type WakeTriggerType = 'human' | 'schedule' | 'webhook' | 'state' | 'goal' | 'peer' | 'instant';

export interface WakeRecord {
  schema: 'arcp/wake/0.1';
  wake_id: string;
  trigger_type: WakeTriggerType;
  trigger_ref: string;
  task_ref?: string;
  required_authority: string;
  budget_ref?: string;
  not_before?: string;
  expires_at?: string;
  not_before_instant?: InstantRef;
  expires_at_instant?: InstantRef;
  revalidate_on_wake: boolean;
  idempotency_key: string;
}

export interface Lease {
  lease_id: string;
  holder: string;
  scope: string;
  valid_from: string;
  valid_until: string;
  fencing_token: number;
}

export type ContinuityImpact =
  | 'none'
  | 'replica-loss'
  | 'service-degraded'
  | 'migration-required'
  | 'continuity-destructive';

export interface ActionIntent {
  action_id: string;
  actor: string;
  intent: string;
  target: string;
  sensitivity: Sensitivity;
  risk: RiskLevel;
  reversibility: string;
  requested_scopes: string[];
  idempotency_key: string;
  /** Phase 4 impact hints. These are proposal data, never trusted authority facts. */
  subject_entity_ref?: string;
  affected_entity_refs?: string[];
  resource_refs?: string[];
  residence_refs?: string[];
  relation_refs?: string[];
  contract_refs?: string[];
  continuity_impact?: ContinuityImpact;
}

export interface Budget {
  remaining: number;
  unit: string;
}

export interface PolicyInput {
  actor: string;
  intent: string;
  target: string;
  sensitivity: Sensitivity;
  risk: RiskLevel;
  reversibility: string;
  requested_scopes: string[];
  lease_fencing_token: number;
  budget: Budget;
  policy_version: number;
}

export interface PolicyResult {
  decision: PolicyDecision;
  reason: string;
  risk: RiskLevel;
  policy_version: number;
}

export interface ResidenceManifest {
  schema: 'arcp/residence-manifest/0.1';
  agent_id: string;
  residence_id: string;
  manifest_version: number;
  parents: string[];
  event_cursor: string;
  root_hash: string;
  policy_version: number;
  lease_fencing_token: number;
  commit_instant?: InstantRef;
  status: 'active' | 'suspended';
}

// ---------------------------------------------------------------------------
// Phase 4 — Promptless Bounded Runs
// ---------------------------------------------------------------------------

export type RunPhase =
  | 'accepted'
  | 'hydrating'
  | 'deliberating'
  | 'authorizing'
  | 'waiting-approval'
  | 'executing'
  | 'reconciling'
  | 'committing'
  | 'waiting'
  | 'contained'
  | 'completed'
  | 'dead-lettered'
  | 'failed';

export interface RunBudgetSpec {
  max_turns: number;
  max_wall_time_ms: number;
  max_model_input_tokens?: number;
  max_model_output_tokens?: number;
  max_model_cost_micros?: number;
  max_tool_calls: number;
  max_external_actions: number;
  max_storage_writes: number;
  max_network_requests: number;
  max_recursive_wakes: number;
  max_risk: RiskLevel;
}

export interface RunRecord {
  schema: 'arcp/run/0.1';
  run_id: string;
  agent_id: string;
  wake_id: string;
  wake_idempotency_key: string;
  phase: RunPhase;
  fencing_token: number;
  budget_ref?: string;
  /** Resolved bounded profile; missing budget_ref never means unlimited. */
  budget_spec: RunBudgetSpec;
  turn_index: number;
  checkpoint_sequence: number;
  created_at: InstantRef;
  updated_at: InstantRef;
  stop_reason?: string;
  last_error_code?: string;
}

export interface RunCheckpoint {
  schema: 'arcp/run-checkpoint/0.1';
  checkpoint_id: string;
  run_id: string;
  sequence: number;
  phase: RunPhase;
  base_manifest_version: number | null;
  fencing_token: number;
  context_hash?: string;
  pending_model_invocation_id?: string;
  pending_action_id?: string;
  pending_approval_request_id?: string;
  created_at: InstantRef;
}

export type ModelInvocationStatus = 'reserved' | 'calling' | 'succeeded' | 'failed' | 'unknown';

export interface ModelInvocationRecord {
  schema: 'arcp/model-invocation/0.1';
  invocation_id: string;
  run_id: string;
  turn_index: number;
  status: ModelInvocationStatus;
  budget_reservation_id: string;
  input_hash: string;
  output_hash?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cost_micros?: number;
  };
  observed_at: InstantRef;
}

export type AuthoritySource =
  | 'self-authorized'
  | 'contract-authorized'
  | 'resource-owner-authorized'
  | 'counterparty-authorized'
  | 'multi-party-authorized'
  | 'guardian-authorized'
  | 'policy-authorized';

export type AuthorityResolutionStatus =
  | 'authorized'
  | 'approval-required'
  | 'multi-party-required'
  | 'denied';

export type ContinuityPrecondition =
  | 'none'
  | 'verified-replica'
  | 'checkpoint'
  | 'migration'
  | 'separate-governance';

export interface AuthorityResolution {
  schema: 'arcp/authority-resolution/0.1';
  resolution_id: string;
  run_id: string;
  action_id: string;
  action_hash: string;
  status: AuthorityResolutionStatus;
  sources: AuthoritySource[];
  subject_entity_ref: string;
  resource_scope: string[];
  relation_refs: string[];
  contract_refs: string[];
  revocable: boolean;
  expires_at?: InstantRef;
  continuity_precondition?: ContinuityPrecondition;
}

export interface ApprovalRequest {
  schema: 'arcp/approval-request/0.1';
  approval_request_id: string;
  run_id: string;
  action_id: string;
  action_hash: string;
  authority_resolution_hash: string;
  policy_version: number;
  binding_hash: string;
  required_parties: string[];
  requested_scope: string[];
  created_at: InstantRef;
  expires_at: InstantRef;
  status: 'pending' | 'satisfied' | 'expired' | 'revoked' | 'cancelled';
}

export interface ApprovalGrant {
  schema: 'arcp/approval-grant/0.1';
  approval_grant_id: string;
  approval_request_id: string;
  approver_entity_ref: string;
  granted_scope: string[];
  granted_at: InstantRef;
  expires_at?: InstantRef;
  idempotency_key: string;
}

export type ActionLifecycleStatus =
  | 'planned'
  | 'claimed'
  | 'executing'
  | 'receipt-recorded'
  | 'canonically-recorded';

export type ExternalEffectStatus = 'not-observed' | 'succeeded' | 'failed' | 'partial' | 'unknown';
export type ReconciliationStatus = 'not-required' | 'pending' | 'reconciled' | 'manual-required';
export type ProviderIdempotencyMode = 'provider-enforced' | 'best-effort' | 'none';

export interface ActionExecutionRecord {
  schema: 'arcp/action-execution/0.1';
  execution_id: string;
  run_id: string;
  action_id: string;
  action_hash: string;
  action_idempotency_key: string;
  lifecycle_status: ActionLifecycleStatus;
  effect_status: ExternalEffectStatus;
  reconciliation_status: ReconciliationStatus;
  fencing_token: number;
  budget_reservation_id: string;
  executor_id: string;
  provider_idempotency_mode: ProviderIdempotencyMode;
  provider_idempotency_key?: string;
  attempt: number;
  claimed_at: InstantRef;
  executing_at?: InstantRef;
  last_receipt_id?: string;
}

export interface ActionReceipt {
  schema: 'arcp/action-receipt/0.1';
  receipt_id: string;
  execution_id: string;
  run_id: string;
  action_id: string;
  status: Exclude<ExternalEffectStatus, 'not-observed'>;
  executor_id: string;
  provider_operation_id?: string;
  external_ref?: string;
  result_hash?: string;
  error_code?: string;
  redacted_summary?: string;
  observed_at: InstantRef;
}

export interface ContainmentRecord {
  schema: 'arcp/containment/0.1';
  containment_id: string;
  agent_id: string;
  scope: string[];
  reason: string;
  authority_source: string;
  entered_at: InstantRef;
  expires_at: InstantRef;
  review_required: boolean;
  review_after?: InstantRef;
  renewal_authority?: string;
  exit_conditions: string[];
  status: 'active' | 'review-due' | 'renewed' | 'released' | 'escalated';
}

export interface DeadLetterRecord {
  schema: 'arcp/dead-letter/0.1';
  dead_letter_id: string;
  run_id: string;
  action_id?: string;
  stage: string;
  attempts: number;
  last_error_code: string;
  effect_state: 'none' | 'known' | 'unknown';
  manual_resolution_required: boolean;
  created_at: InstantRef;
}
