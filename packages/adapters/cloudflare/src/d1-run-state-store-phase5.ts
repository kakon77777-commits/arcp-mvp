import type { D1DatabaseLike } from './d1-types.js';
import { D1RunStateStore as Phase4D1RunStateStore } from './d1-run-state-store.js';
import {
  WorkflowError,
  type BudgetDimension,
  type CompleteRunBudgetView,
  type Phase5RunStateStorePort,
} from '@arcp/workflow-core';

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

interface BudgetRow {
  dimension: string;
  limit_value: number;
  reserved: number;
  consumed: number;
  released: number;
}

/**
 * Phase 5.0A adapter wrapper. The Phase 4 store remains readable/exportable
 * under an explicit legacy name while the package-level D1RunStateStore
 * points to this stronger contract during the staged migration.
 */
export class Phase5D1RunStateStore
  extends Phase4D1RunStateStore
  implements Phase5RunStateStorePort {
  constructor(private readonly phase5Db: D1DatabaseLike) {
    super(phase5Db);
  }

  async getBudgetView(runId: string): Promise<CompleteRunBudgetView> {
    if ((await this.getRun(runId)) === null) {
      throw new WorkflowError('invalid_persisted_state', `run not found: ${runId}`, false);
    }

    const query = await this.phase5Db.prepare(
      `SELECT dimension, limit_value, reserved, consumed, released
       FROM arcp_run_budget_ledger WHERE run_id = ? ORDER BY dimension`,
    ).bind(runId).all<BudgetRow>();
    if (!query.success) {
      throw new WorkflowError('invalid_persisted_state', `D1 budget view query failed: ${runId}`, false);
    }

    const seen = new Set<string>();
    const output: Partial<CompleteRunBudgetView> = {};
    for (const row of query.results) {
      if (!DIMENSIONS.includes(row.dimension as BudgetDimension) || seen.has(row.dimension)) {
        throw new WorkflowError('invalid_persisted_state', `D1 run budget has unknown/duplicate dimension: ${row.dimension}`, false);
      }
      seen.add(row.dimension);
      output[row.dimension as BudgetDimension] = {
        limit: row.limit_value,
        reserved: row.reserved,
        consumed: row.consumed,
        released: row.released,
      };
    }

    if (seen.size !== DIMENSIONS.length || DIMENSIONS.some((dimension) => output[dimension] === undefined)) {
      throw new WorkflowError('invalid_persisted_state', `D1 run budget is incomplete: ${runId}`, false);
    }
    return output as CompleteRunBudgetView;
  }
}
