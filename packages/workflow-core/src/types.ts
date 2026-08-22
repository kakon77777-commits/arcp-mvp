import type {
  ActionIntent,
  ActionReceipt,
  AuthorityResolution,
  BudgetEnvelopeKind,
  InstantRef,
  PolicyResult,
  ResidenceManifest,
  RiskLevel,
  RunBudgetSpec,
  RunRecord,
  WakeRecord,
} from '@arcp/schema';
import type { BudgetDimension, RunBudgetView } from './budget.js';

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

/** Host-owned hard ceilings for one prepared model call. */
export interface ModelCallLimits {
  maxOutputTokens: number;
  maxInputTokens: number;
  maxCostMicros: number;
  maxActiveDurationMs: number;
}

/** Process-local capability returned only after zero-I/O provider preflight. */
export interface PreparedModelCall {
  execute(): Promise<ModelTurnProposal>;
}

export interface ReserveBudgetEnvelopeInput {
  runId: string;
  fencingToken: number;
  envelopeId: string;
  kind: BudgetEnvelopeKind;
  items: Array<{ dimension: BudgetDimension; amount: number }>;
  reservedAt: InstantRef;
}

export interface SettleBudgetEnvelopeInput {
  runId: string;
  envelopeId: string;
  actuals: Partial<Record<BudgetDimension, number>>;
  settledAt: InstantRef;
}

export interface ReleaseBudgetEnvelopeInput {
  runId: string;
  envelopeId: string;
  releasedAt: InstantRef;
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
