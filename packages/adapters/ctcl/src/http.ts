import {
  TemporalEvidenceError,
  type TemporalEvidenceErrorCode,
} from '@arcp/temporal-evidence';

export type CtclJsonObject = Record<string, unknown>;

const DEFAULT_BASE_URL = 'https://commoninstant.org';

const INVALID_INPUT_CODES = new Set([
  'INVALID_TIME_VALUE',
  'UNKNOWN_ENCODING',
  'INVALID_TIMEZONE',
  'NONEXISTENT_LOCAL_TIME',
  'AMBIGUOUS_LOCAL_TIME',
  'UNSUPPORTED_POLICY',
  'AUTH_DENIED',
  'AUTH_STATE_INVALID',
]);

const TEMPORARILY_UNAVAILABLE_CODES = new Set([
  'REGISTRY_UNAVAILABLE',
  'SIGNING_DISABLED',
  'AUTH_PROVIDER_ERROR',
  'AUTH_DISABLED',
]);

export function asCtclObject(value: unknown, context: string): CtclJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TemporalEvidenceError(
      'unknown_backend_error',
      `malformed CTCL ${context}`,
      false,
    );
  }
  return value as CtclJsonObject;
}

export function ctclRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TemporalEvidenceError(
      'unknown_backend_error',
      `malformed CTCL field: ${field}`,
      false,
    );
  }
  return value;
}

export function ctclRequiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TemporalEvidenceError(
      'unknown_backend_error',
      `malformed CTCL field: ${field}`,
      false,
    );
  }
  return value;
}

export function ctclRequiredNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TemporalEvidenceError(
      'unknown_backend_error',
      `malformed CTCL field: ${field}`,
      false,
    );
  }
  return value;
}

function temporalError(
  code: TemporalEvidenceErrorCode,
  message: string,
  retryable: boolean,
  cause?: unknown,
): TemporalEvidenceError {
  return new TemporalEvidenceError(
    code,
    message,
    retryable,
    cause === undefined ? undefined : { cause },
  );
}

function mapStatus(status: number): { code: TemporalEvidenceErrorCode; retryable: boolean } {
  if (status === 400) return { code: 'invalid_input', retryable: false };
  if (status === 401) return { code: 'authentication_required', retryable: false };
  if (status === 403) return { code: 'permission_denied', retryable: false };
  if (status === 404) return { code: 'not_found', retryable: false };
  if (status === 429) return { code: 'rate_limited', retryable: true };
  if (status >= 500 && status <= 599) {
    return { code: 'temporarily_unavailable', retryable: true };
  }
  return { code: 'unknown_backend_error', retryable: false };
}

function mapProviderCode(
  providerCode: string,
  status: number,
): { code: TemporalEvidenceErrorCode; retryable: boolean } {
  if (INVALID_INPUT_CODES.has(providerCode)) return { code: 'invalid_input', retryable: false };
  if (providerCode === 'NOT_AUTHENTICATED') {
    return { code: 'authentication_required', retryable: false };
  }
  if (providerCode === 'FORBIDDEN') return { code: 'permission_denied', retryable: false };
  if (providerCode === 'RATE_LIMITED') return { code: 'rate_limited', retryable: true };
  if (TEMPORARILY_UNAVAILABLE_CODES.has(providerCode)) {
    return { code: 'temporarily_unavailable', retryable: true };
  }
  if (providerCode === 'NOT_FOUND' || providerCode.startsWith('UNKNOWN_')) {
    return { code: 'not_found', retryable: false };
  }
  return mapStatus(status);
}

function validateBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (error) {
    throw temporalError('invalid_input', 'CTCL baseUrl must be an absolute URL', false, error);
  }

  if (url.username.length > 0 || url.password.length > 0) {
    throw temporalError('invalid_input', 'CTCL baseUrl must not contain credentials', false);
  }

  const localHttp =
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1');
  if (url.protocol !== 'https:' && !localHttp) {
    throw temporalError(
      'invalid_input',
      'CTCL baseUrl must use HTTPS except for localhost test endpoints',
      false,
    );
  }

  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url;
}

export interface CtclHttpClientOptions {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
}

export class CtclHttpClient {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly baseUrl: URL;

  constructor(options: CtclHttpClientOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseUrl = validateBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  }

  async get(path: string): Promise<unknown> {
    return this.request(path, 'GET');
  }

  async post(path: string, body: unknown): Promise<unknown> {
    return this.request(path, 'POST', body);
  }

  private async request(path: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    const headers = new Headers({ accept: 'application/json' });
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers.set('content-type', 'application/json');
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (error) {
      throw temporalError(
        'temporarily_unavailable',
        'CTCL request failed before receiving a response',
        true,
        error,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await response.text()) as unknown;
    } catch (error) {
      if (!response.ok) {
        const mapped = mapStatus(response.status);
        throw temporalError(
          mapped.code,
          `CTCL HTTP ${response.status}`,
          mapped.retryable,
          error,
        );
      }
      throw temporalError('unknown_backend_error', 'malformed CTCL JSON response', false, error);
    }

    const envelope = asCtclObject(parsed, 'response envelope');
    if (typeof envelope.ok !== 'boolean') {
      throw temporalError('unknown_backend_error', 'malformed CTCL response field: ok', false);
    }
    asCtclObject(envelope.meta, 'response meta');

    if (envelope.ok === false) {
      const providerError = asCtclObject(envelope.error, 'error response');
      const providerCode = ctclRequiredString(providerError.code, 'error.code');
      const providerMessage = ctclRequiredString(providerError.message, 'error.message');
      const mapped = mapProviderCode(providerCode, response.status);
      throw temporalError(
        mapped.code,
        `${providerMessage} (${providerCode}, HTTP ${response.status})`,
        mapped.retryable,
      );
    }

    if (!response.ok) {
      const mapped = mapStatus(response.status);
      throw temporalError(mapped.code, `CTCL HTTP ${response.status}`, mapped.retryable);
    }

    if (!Object.prototype.hasOwnProperty.call(envelope, 'data')) {
      throw temporalError('unknown_backend_error', 'malformed CTCL success envelope: data missing', false);
    }

    return envelope.data;
  }
}
