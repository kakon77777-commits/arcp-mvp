import type {
  ActionExecutionRecord,
  ActionReceipt,
  ApprovalGrant,
  ApprovalRequest,
  AuthorityResolution,
  ContainmentRecord,
  DeadLetterRecord,
  InstantRef,
  ModelInvocationRecord,
  PolicyInput,
  PolicyResult,
  ResidenceManifest,
  RunBudgetSpec,
  RunCheckpoint,
  RunRecord,
} from '@arcp/schema';
import type { BudgetDimension, RunBudgetView } from './budget.js';
import type {
  ActionAuthorityInput,
  ActionExecutionResult,
  ActionExecutorDescriptor,
  ActionReconcileInput,
  ActionReconcileResult,
  AuthorizedActionExecution,
  CanonicalRunCommitInput,
  HydratedRunContext,
  HydrationInput,
  ModelTurnInput,
  ModelTurnProposal,
  PolicyEvaluationOptions,
  WakeAuthorityInput,
  WakeAuthorityResult,
} from './types.js';

export interface ModelPort {
  deliberate(input: ModelTurnInput): Promise<ModelTurnProposal>;
}

export interface ContextHydratorPort {
  hydrate(input: HydrationInput): Promise<HydratedRunContext>;
}

export interface WakeAuthorityResolverPort {
  resolveWake(input: WakeAuthorityInput): Promise<WakeAuthorityResult>;
}

export interface ActionAuthorityResolverPort {
  resolveAction(input: ActionAuthorityInput): Promise<AuthorityResolution>;
}

export interface PolicyPort {
  evaluate(input: PolicyInput, options?: PolicyEvaluationOptions): PolicyResult;
}

export interface RunBudgetProviderPort {
  resolveBudget(agentId: string, budgetRef?: string): Promise<RunBudgetSpec>;
}

export interface BudgetReservationInput {
  reservationId: string;
  dimension: BudgetDimension;
  amount: number;
}

export interface ActionClaimInput {
  runId: string;
  fencingToken: number;
  executionId: string;
  actionId: string;
  actionHash: string;
  actionIdempotencyKey: string;
  executorId: string;
  providerIdempotencyMode: 'provider-enforced' | 'best-effort' | 'none';
  providerIdempotencyKey?: string;
  reservationId: string;
  budgetDimension: BudgetDimension;
  budgetAmount: number;
  claimedAt: InstantRef;
}

export interface RunStateStorePort {
  createRunIfAbsent(run: RunRecord): Promise<RunRecord>;
  getRun(runId: string): Promise<RunRecord | null>;
  updateRun(run: RunRecord, expectedFencingToken?: number): Promise<RunRecord>;
  getBudgetView(runId: string): Promise<RunBudgetView>;

  saveCheckpoint(checkpoint: RunCheckpoint): Promise<void>;
  getLatestCheckpoint(runId: string): Promise<RunCheckpoint | null>;

  reserveModelBudget(runId: string, fencingToken: number, reservation: BudgetReservationInput): Promise<void>;
  settleModelBudget(runId: string, reservationId: string, actualAmount: number): Promise<void>;
  appendModelInvocation(record: ModelInvocationRecord): Promise<void>;

  reserveBudgetAndClaimAction(input: ActionClaimInput): Promise<ActionExecutionRecord>;
  markActionExecuting(executionId: string, fencingToken: number, at: InstantRef): Promise<ActionExecutionRecord>;
  appendActionReceipt(receipt: ActionReceipt): Promise<void>;
  getActionExecution(executionId: string): Promise<ActionExecutionRecord | null>;
  getActionReceipts(runId: string): Promise<ActionReceipt[]>;
  markActionReconciled(executionId: string, effectStatus: ActionExecutionRecord['effect_status']): Promise<ActionExecutionRecord>;
  markActionCanonicallyRecorded(executionId: string): Promise<ActionExecutionRecord>;

  appendAuthorityResolution(resolution: AuthorityResolution): Promise<void>;
  getAuthorityResolutions(runId: string): Promise<AuthorityResolution[]>;

  createApprovalRequest(request: ApprovalRequest): Promise<ApprovalRequest>;
  appendApprovalGrant(grant: ApprovalGrant): Promise<void>;
  getApprovalRequest(requestId: string): Promise<ApprovalRequest | null>;
  getApprovalGrants(requestId: string): Promise<ApprovalGrant[]>;

  appendContainment(record: ContainmentRecord): Promise<void>;
  activeContainments(agentId: string): Promise<ContainmentRecord[]>;

  appendDeadLetter(record: DeadLetterRecord): Promise<void>;
  getDeadLetters(runId: string): Promise<DeadLetterRecord[]>;
}

export interface ActionExecutorPort {
  descriptor(): ActionExecutorDescriptor;
  execute(input: AuthorizedActionExecution): Promise<ActionExecutionResult>;
  reconcile(input: ActionReconcileInput): Promise<ActionReconcileResult>;
}

export interface CommitPort {
  commit(input: CanonicalRunCommitInput): Promise<ResidenceManifest>;
}
