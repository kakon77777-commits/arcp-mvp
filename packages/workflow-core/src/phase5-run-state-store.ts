import type { CompleteRunBudgetView } from './budget.js';
import type { RunStateStorePort as Phase4RunStateStorePort } from './ports.js';

/**
 * Staged Phase 5.0A extension of the Phase 4 store contract. Keeping the
 * legacy interface intact until the orchestrator cutover lets each migration
 * task end green while new callers can require the stronger contract.
 */
export interface Phase5RunStateStorePort extends Phase4RunStateStorePort {
  getBudgetView(runId: string): Promise<CompleteRunBudgetView>;
}
