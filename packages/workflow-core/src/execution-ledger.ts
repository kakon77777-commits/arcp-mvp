import type { ActionExecutionRecord } from '@arcp/schema';

export type ExecutionRecoveryDecision =
  | 'execute'
  | 'safe-provider-retry-or-reconcile'
  | 'reconcile'
  | 'commit-only'
  | 'done';

export function recoverExecutionDecision(record: ActionExecutionRecord): ExecutionRecoveryDecision {
  if (record.lifecycle_status === 'canonically-recorded') return 'done';
  if (record.lifecycle_status === 'receipt-recorded') return 'commit-only';
  if (record.lifecycle_status === 'planned' || record.lifecycle_status === 'claimed') return 'execute';

  if (record.lifecycle_status === 'executing') {
    if (record.provider_idempotency_mode === 'provider-enforced' && record.provider_idempotency_key) {
      return 'safe-provider-retry-or-reconcile';
    }
    return 'reconcile';
  }

  return 'reconcile';
}
