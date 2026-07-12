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
}

export interface InstantRef {
  instant_id: string;
  timescale?: 'utc';
  encoding?: 'unix_ms' | 'unix_ns';
  source_quality?: SourceQuality;
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
  status: 'active' | 'suspended';
}
