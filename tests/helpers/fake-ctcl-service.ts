export interface FakeCtclServiceOptions {
  nowUnixNs?: string;
}

export interface FakeCtclService {
  fetch: typeof globalThis.fetch;
  registeredIds(): string[];
}

type JsonObject = Record<string, unknown>;

const DEFAULT_NOW_UNIX_NS = '1786980000123000000';
const ZERO_ED25519_X = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function object(value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected JSON object');
  }
  return value as JsonObject;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function success(data: unknown, requestId: string): Response {
  return json({ ok: true, data, meta: { api_version: 'v1', request_id: requestId } });
}

function failure(code: string, message: string, requestId: string, status = 400): Response {
  return json({
    ok: false,
    error: { code, message },
    meta: { api_version: 'v1', request_id: requestId },
  }, status);
}

function parseScaledDecimal(value: string, fractionalDigits: number): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (match === null) throw new Error(`invalid decimal time value: ${value}`);
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2]!);
  const fractionRaw = match[3] ?? '';
  if (fractionRaw.length > fractionalDigits) {
    throw new Error(`time value exceeds supported precision: ${value}`);
  }
  const scale = 10n ** BigInt(fractionalDigits);
  const fraction = fractionRaw.length === 0
    ? 0n
    : BigInt(fractionRaw.padEnd(fractionalDigits, '0'));
  return sign * (whole * scale + fraction);
}

function toUnixNs(value: string, encoding: string): bigint {
  if (encoding === 'unix_s') return parseScaledDecimal(value, 9);
  if (encoding === 'unix_ms') return parseScaledDecimal(value, 6);
  if (encoding === 'unix_us') return parseScaledDecimal(value, 3);
  if (encoding === 'unix_ns') return parseScaledDecimal(value, 0);
  if (encoding === 'rfc3339') {
    const unixMs = Date.parse(value);
    if (!Number.isFinite(unixMs)) throw new Error(`invalid rfc3339 time value: ${value}`);
    return BigInt(unixMs) * 1_000_000n;
  }
  throw new Error(`unsupported encoding: ${encoding}`);
}

function formatScaled(unixNs: bigint, fractionalDigits: number): string {
  const scale = 10n ** BigInt(fractionalDigits);
  const negative = unixNs < 0n;
  const absolute = negative ? -unixNs : unixNs;
  const whole = absolute / scale;
  const fraction = absolute % scale;
  const sign = negative ? '-' : '';
  if (fractionalDigits === 0) return `${sign}${whole}`;
  if (fraction === 0n) return `${sign}${whole}`;
  const fractionText = fraction.toString().padStart(fractionalDigits, '0').replace(/0+$/, '');
  return `${sign}${whole}.${fractionText}`;
}

function encodeUnixNs(unixNs: bigint) {
  const unixMs = unixNs / 1_000_000n;
  const milliseconds = Number(unixMs);
  return {
    unix_s: formatScaled(unixNs, 9),
    unix_ms: formatScaled(unixNs, 6),
    unix_us: formatScaled(unixNs, 3),
    unix_ns: unixNs.toString(),
    rfc3339: new Date(milliseconds).toISOString(),
  };
}

function instantData(id: string, unixNs: bigint, timescale: 'utc' | 'posix' = 'utc') {
  const encodings = encodeUnixNs(unixNs);
  return {
    instant: {
      id,
      reference: {
        timescale,
        value: encodings.rfc3339,
      },
    },
    encodings,
    source: {
      class: 'fake_ctcl_service',
      sync_status: 'synchronized',
    },
    quality: {
      precision: 'millisecond_representation',
      estimated_uncertainty_ns: 5_000_000,
      synchronized: true,
    },
  };
}

function candidate(unixS: string) {
  return {
    unix_s: unixS,
    score: 1,
    satisfied: [],
    violated: [],
    unsupported: [],
  };
}

export function createFakeCtclService(options: FakeCtclServiceOptions = {}): FakeCtclService {
  const registry = new Map<string, ReturnType<typeof instantData>>();
  const ids: string[] = [];
  let sequence = 0;
  const nowUnixNs = BigInt(options.nowUnixNs ?? DEFAULT_NOW_UNIX_NS);

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname;
    const requestId = `fake-ctcl-${sequence + 1}`;

    try {
      if (request.method === 'GET' && path === '/v1/now') {
        return success(instantData('ctcl:instant:fake-service-now', nowUnixNs), requestId);
      }

      if (request.method === 'POST' && path === '/v1/instants') {
        const body = request.body === null ? {} : object(await request.json());
        const rawValue = typeof body.value === 'string' ? body.value : undefined;
        const encoding = typeof body.encoding === 'string' ? body.encoding : undefined;
        const timescale = body.timescale === 'posix' ? 'posix' : 'utc';
        const unixNs = rawValue === undefined
          ? nowUnixNs
          : toUnixNs(rawValue, encoding ?? 'rfc3339');
        sequence += 1;
        const id = `ctcl:instant:fake-service-${String(sequence).padStart(6, '0')}`;
        const data = instantData(id, unixNs, timescale);
        registry.set(id, data);
        ids.push(id);
        return success(data, requestId);
      }

      if (request.method === 'GET' && path.startsWith('/v1/instant/')) {
        const id = decodeURIComponent(path.slice('/v1/instant/'.length));
        const data = registry.get(id);
        if (data === undefined) return failure('NOT_FOUND', 'instant not found', requestId, 404);
        return success(data, requestId);
      }

      if (request.method === 'POST' && path === '/v1/convert') {
        const body = object(await request.json());
        const inputValue = object(body.input);
        const output = object(body.output);
        if (typeof inputValue.value !== 'string' || typeof inputValue.encoding !== 'string') {
          return failure('INVALID_TIME_VALUE', 'invalid conversion input', requestId);
        }
        const unixNs = toUnixNs(inputValue.value, inputValue.encoding);
        const outputEncoding = typeof output.encoding === 'string' ? output.encoding : 'unix_ns';
        const encodings = encodeUnixNs(unixNs);
        const outputValue = encodings[outputEncoding as keyof typeof encodings];
        if (outputValue === undefined) {
          return failure('UNKNOWN_ENCODING', 'unsupported conversion output', requestId);
        }
        return success({
          output: { value: outputValue },
          canonical_unix_ns: unixNs.toString(),
          quality: { lossless: true },
        }, requestId);
      }

      if (request.method === 'POST' && path === '/v1/boundaries/inspect') {
        return success({ status: 'normal', safe: true, detail: { fixture: true } }, requestId);
      }

      if (request.method === 'POST' && path === '/v1/planner/shared-instant') {
        const body = object(await request.json());
        const window = object(body.window);
        const from = window.from;
        if (typeof from !== 'number' || !Number.isFinite(from)) {
          return failure('INVALID_TIME_VALUE', 'planner window.from must be finite', requestId);
        }
        const best = candidate(String(from));
        return success({ best, alternatives: [], explanation: 'deterministic fake candidate' }, requestId);
      }

      if (request.method === 'GET' && path === '/v1/pubkey') {
        return success({
          alg: 'Ed25519',
          key_id: 'fake-ctcl-ed25519-1',
          public_jwk: {
            kty: 'OKP',
            crv: 'Ed25519',
            x: ZERO_ED25519_X,
            ext: true,
          },
        }, requestId);
      }
    } catch (error) {
      return failure(
        'INVALID_TIME_VALUE',
        error instanceof Error ? error.message : 'invalid fake CTCL request',
        requestId,
      );
    }

    return failure('NOT_FOUND', `unsupported fake CTCL route: ${request.method} ${path}`, requestId, 404);
  };

  return {
    fetch: fetchImpl as typeof globalThis.fetch,
    registeredIds: () => [...ids],
  };
}
