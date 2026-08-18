import type {
  ActionIntent,
  ActionReceipt,
  AuthorityResolution,
  InstantRef,
  PolicyResult,
  ResidenceManifest,
  RiskLevel,
  RunBudgetSpec,
  RunRecord,
  WakeRecord,
} from '@arcp/schema';
import type { RunBudgetView } from './budget.js';

export interface HydratedRunContext {
  baseManifestVersion: number | null;
  contextHash: string;
  values: Record<string, unknown>;
}

export interface ModelTurnInput {
  agentId: string;
  runId: string;
  turnIndex: number;
  wake: WakeRecord;
  context: HydratedRunContext;
  priorReceipts: ActionReceipt[];
  priorDenials: AuthorityResolution[];
  budgetView: RunBudgetView;
}

export interface ModelTurnProposal {
  actionIntents: ActionIntent[];
  memoryProposals?: unknown[];
  nextWakeProposals?: unknown[];
  stopReason?: string;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    costMicros?: number;
  };
}

export interface WakeAuthorityInput {
  agentId: string;
  wake: WakeRecord;
}

export interface WakeAuthorityResult {
  authorized: boolean;
  source?: string;
  reason: string;
}

export interface ActionAuthorityInput {
  runId: string;
  action: ActionIntent;
  actionHash: string;
}

export interface HydrationInput {
  agentId: string;
  runId: string;
  wake: WakeRecord;
}

export interface PolicyEvaluationOptions {
  hasValidApproval?: boolean;
}

export interface ActionExecutorDescriptor {
  executorId: string;
  idempotencyMode: 'provider-enforced' | 'best-effort' | 'none';
}

export interface ExecutionAuthorization {
  action: ActionIntent;
  actionHash: string;
  authority: AuthorityResolution;
  policy: PolicyResult;
  grantedScope: string[];
}

export interface AuthorizedActionExecution {
  runId: string;
  executionId: string;
  authorization: ExecutionAuthorization;
  providerIdempotencyKey?: string;
}

export interface ActionExecutionResult {
  status: 'succeeded' | 'failed' | 'partial' | 'unknown';
  providerOperationId?: string;
  externalRef?: string;
  resultHash?: string;
  errorCode?: string;
  redactedSummary?: string;
}

export interface ActionReconcileInput {
  runId: string;
  executionId: string;
  action: ActionIntent;
  providerOperationId?: string;
  providerIdempotencyKey?: string;
}

export interface ActionReconcileResult {
  status: 'confirmed-succeeded' | 'confirmed-failed' | 'confirmed-partial' | 'still-unknown';
  providerOperationId?: string;
  externalRef?: string;
  resultHash?: string;
  errorCode?: string;
  redactedSummary?: string;
}

export interface CanonicalRunCommitInput {
  run: RunRecord;
  wake: WakeRecord;
  receipts: ActionReceipt[];
  authorityResolutions: AuthorityResolution[];
  policyResults: PolicyResult[];
  expectedBaseManifestVersion: number | null;
  fencingToken: number;
  commitInstant?: InstantRef;
}

export interface BoundedRunAdvanceResult {
  run: RunRecord;
  manifest?: ResidenceManifest;
  stopReason?: string;
  pendingApprovalRequestId?: string;
}

export interface StaticAuthorityGrant {
  subjectEntityRef: string;
  resourceRef: string;
  scopes: string[];
  source:
    | 'self-authorized'
    | 'contract-authorized'
    | 'resource-owner-authorized'
    | 'counterparty-authorized'
    | 'multi-party-authorized'
    | 'guardian-authorized'
    | 'policy-authorized';
  continuityPrecondition?: 'none' | 'verified-replica' | 'checkpoint' | 'migration' | 'separate-governance';
  maxRisk?: RiskLevel;
  revocable?: boolean;
}

export interface StaticWakeAuthorityGrant {
  requiredAuthority: string;
  agentId?: string;
}

export interface BudgetProfile {
  ref?: string;
  spec: RunBudgetSpec;
}
