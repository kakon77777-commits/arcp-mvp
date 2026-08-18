export type TemporalEvidenceErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'authentication_required'
  | 'permission_denied'
  | 'rate_limited'
  | 'temporarily_unavailable'
  | 'attestation_invalid'
  | 'unsupported_operation'
  | 'unknown_backend_error';

export class TemporalEvidenceError extends Error {
  constructor(
    public readonly code: TemporalEvidenceErrorCode,
    message: string,
    public readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'TemporalEvidenceError';
  }
}
