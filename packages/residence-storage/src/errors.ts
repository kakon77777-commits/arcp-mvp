export type ResidenceStorageErrorCode =
  | 'not_found'
  | 'permission_denied'
  | 'conflict'
  | 'temporarily_unavailable'
  | 'rate_limited'
  | 'invalid_path_or_ref'
  | 'integrity_mismatch'
  | 'unsupported_operation'
  | 'authentication_required'
  | 'unknown_backend_error';

export class ResidenceStorageError extends Error {
  constructor(
    readonly code: ResidenceStorageErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ResidenceStorageError';
  }
}
