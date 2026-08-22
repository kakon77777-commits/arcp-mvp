import type { BudgetEnvelopeRecord, Phase5ModelInvocationRecord } from '@arcp/schema';
import type { CompleteRunBudgetView } from './budget.js';
import type { RunStateStorePort as Phase4RunStateStorePort } from './ports.js';
import type {
  ReleaseBudgetEnvelopeInput,
  ReserveBudgetEnvelopeInput,
  SettleBudgetEnvelopeInput,
} from './types.js';

/**
 * Staged Phase 5.0A extension of the Phase 4 store contract. Keeping the
 * legacy interface intact until the orchestrator cutover lets each migration
 * task end green while new callers can require the stronger contract.
 */
export interface Phase5RunStateStorePort extends Phase4RunStateStorePort {
  getBudgetView(runId: string): Promise<CompleteRunBudgetView>;
  reserveBudgetEnvelope(input: ReserveBudgetEnvelopeInput): Promise<BudgetEnvelopeRecord>;
  settleBudgetEnvelope(input: SettleBudgetEnvelopeInput): Promise<BudgetEnvelopeRecord>;
  releaseBudgetEnvelope(input: ReleaseBudgetEnvelopeInput): Promise<BudgetEnvelopeRecord>;
  markBudgetEnvelopeRecoveryRequired(runId: string, envelopeId: string): Promise<BudgetEnvelopeRecord>;
  getBudgetEnvelope(envelopeId: string): Promise<BudgetEnvelopeRecord | null>;

  createModelInvocation(record: Phase5ModelInvocationRecord): Promise<Phase5ModelInvocationRecord>;
  getModelInvocation(invocationId: string): Promise<Phase5ModelInvocationRecord | null>;
  transitionModelInvocation(
    invocationId: string,
    expectedStatus: Phase5ModelInvocationRecord['status'],
    next: Phase5ModelInvocationRecord,
  ): Promise<Phase5ModelInvocationRecord>;
}
