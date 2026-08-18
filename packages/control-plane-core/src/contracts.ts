import type {
  ApprovalGrant,
  ContainmentRecord,
  PolicyDecision,
  ResidenceManifest,
  RunRecord,
  WakeRecord,
} from '@arcp/schema';

export interface AgentStatusSnapshot {
  agent_id: string;
  state: string;
  manifest_version: number;
  root_hash: string;
}

export interface WakeAcceptance {
  status: 'accepted' | 'duplicate';
  policy_decision: PolicyDecision;
  committed_version: number | null;
}

export interface AdvanceRunRequest {
  wake: WakeRecord;
  /** Present when resuming an existing persisted run. */
  run_id?: string;
  /** Host/DO supplied fencing token. Public callers need not invent one. */
  fencing_token?: number;
}

export interface AdvanceRunResponse {
  run: RunRecord;
  manifest?: ResidenceManifest;
  stop_reason?: string;
  pending_approval_request_id?: string;
}

export interface CoordinatorControlPort {
  getManifest(agentId: string): Promise<ResidenceManifest | null>;
  getStatus(agentId: string): Promise<AgentStatusSnapshot | null>;
  acceptWake(agentId: string, wake: WakeRecord): Promise<WakeAcceptance>;

  /** Phase 4 capabilities. Optional so Phase 0–3 adapters remain source-compatible. */
  getRun?(agentId: string, runId: string): Promise<RunRecord | null>;
  advanceRun?(agentId: string, input: AdvanceRunRequest): Promise<AdvanceRunResponse>;
  submitApprovalGrant?(
    agentId: string,
    approvalRequestId: string,
    grant: ApprovalGrant,
  ): Promise<{ accepted: boolean }>;
  applyContainment?(agentId: string, record: ContainmentRecord): Promise<ContainmentRecord>;
  releaseContainment?(agentId: string, containmentId: string): Promise<{ released: boolean }>;
}

export type AuthorizationOperation =
  | 'read-manifest'
  | 'read-status'
  | 'submit-wake'
  | 'read-run'
  | 'advance-run'
  | 'submit-approval'
  | 'apply-containment'
  | 'release-containment';

export interface AuthorizationInput {
  authorization: string | null;
  agentId: string;
  operation: AuthorizationOperation;
}

export interface AuthorizationPort {
  authorize(input: AuthorizationInput): boolean | Promise<boolean>;
}

export interface ControlPlaneDependencies {
  coordinator: CoordinatorControlPort;
  authorization: AuthorizationPort;
  nextRequestId: () => string;
}

export interface ControlPlaneHandler {
  fetch(request: Request): Promise<Response>;
}
