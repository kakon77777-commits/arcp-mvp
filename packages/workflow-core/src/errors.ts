export type WorkflowErrorCode =
  | 'invalid_wake'
  | 'duplicate_wake'
  | 'wake_authority_denied'
  | 'hydration_failed'
  | 'containment_active'
  | 'model_budget_exhausted'
  | 'model_temporarily_unavailable'
  | 'model_invalid_output'
  | 'action_authority_denied'
  | 'approval_required'
  | 'approval_expired'
  | 'approval_invalid'
  | 'budget_exhausted'
  | 'stale_fencing_token'
  | 'execution_failed'
  | 'execution_partial'
  | 'execution_unknown'
  | 'reconciliation_failed'
  | 'commit_conflict'
  | 'commit_failed'
  | 'retry_exhausted'
  | 'invalid_persisted_state';

export class WorkflowError extends Error {
  constructor(
    public readonly code: WorkflowErrorCode,
    message: string,
    public readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'WorkflowError';
  }
}
