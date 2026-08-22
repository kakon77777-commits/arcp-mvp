import { InMemoryRunStateStore as Phase4InMemoryRunStateStore } from './in-memory-store.js';
import type { BudgetDimension, CompleteRunBudgetView } from './budget.js';
import { WorkflowError } from './errors.js';
import type { Phase5RunStateStorePort } from './phase5-run-state-store.js';

const DIMENSIONS: BudgetDimension[] = [
  'turns',
  'wall_time_ms',
  'model_input_tokens',
  'model_output_tokens',
  'model_cost_micros',
  'tool_calls',
  'external_actions',
  'storage_writes',
  'network_requests',
  'recursive_wakes',
];

/** Phase 5.0A-compatible in-memory store layered over the Phase 4 implementation. */
export class Phase5InMemoryRunStateStore
  extends Phase4InMemoryRunStateStore
  implements Phase5RunStateStorePort {
  async getBudgetView(runId: string): Promise<CompleteRunBudgetView> {
    const view = this.budgetView(runId);
    const keys = Object.keys(view);
    if (keys.length !== DIMENSIONS.length || DIMENSIONS.some((dimension) => view[dimension] === undefined)) {
      throw new WorkflowError('invalid_persisted_state', `in-memory run budget is incomplete: ${runId}`, false);
    }
    return structuredClone(view) as CompleteRunBudgetView;
  }
}
