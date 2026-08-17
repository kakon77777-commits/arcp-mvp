import { describe, expect, it } from 'vitest';
import { CtclRestTemporalAdapter } from '@arcp/adapter-ctcl';
import { TemporalEvidenceError } from '@arcp/temporal-evidence';
import { createFakeCtclFetch, type FakeCtclResponder } from '../helpers/fake-ctcl-fetch.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function instantData(id = 'ctcl:instant:test-1') {
  return {
    instant: {
      id,
      reference: { timescale: 'utc', value: '2026-08-17T15:00:00.123Z' },
    },
    encodings: {
      unix_s: '1786978800.123',
      unix_ms: '1786978800123',
      unix_us: '1786978800123000',
      unix_ns: '1786978800123000000',
      rfc3339: '2026-08-17T15:00:00.123Z',
    },
    timescales: {
      utc: '2026-08-17T15:00:00.123Z',
      posix: '1786978800.123',
    },
    source: { class: 'edge_wall_clock', sync_status: 'synchronized' },
    quality: {
      precision: 'millisecond_representation',
      estimated_uncertainty_ns: 5_000_000,
      synchronized: true,
    },
    signature: {
      alg: 'Ed25519',
      key_id: 'ctcl-ed25519-1',
      signed_fields: 'instant_id|unix_ns|timescale',
      value: 'fixture-signature',
    },
  };
}

function ok(data: unknown) {
  return { ok: true, data, meta: { api_version: 'v1', request_id: 'req-test' } };
}

function makeAdapter(responders: FakeCtclResponder[], baseUrl?: string) {
  const fake = createFakeCtclFetch(responders);
  const adapter = new CtclRestTemporalAdapter({ fetch: fake.fetch, ...(baseUrl ? { baseUrl } : {}) });
  return { fake, adapter };
}

function decodeJsonBody(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

describe('CtclRestTemporalAdapter', () => {
  it('normalizes /v1/now without overstating millisecond source precision', async () => {
    const { fake, adapter } = makeAdapter([jsonResponse(ok(instantData()))]);

    const evidence = await adapter.now();

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.method).toBe('GET');
    expect(fake.requests[0]?.url).toBe('https://commoninstant.org/v1/now');
    expect(fake.requests[0]?.headers.get('accept')).toBe('application/json');
    expect(fake.requests[0]?.headers.has('content-type')).toBe(false);

    expect(evidence.instant).toMatchObject({
      instant_id: 'ctcl:instant:test-1',
      timescale: 'utc',
      encoding: 'unix_ns',
      value: '1786978800123000000',
      source_quality: {
        source_class: 'edge_wall_clock',
        precision: 'millisecond_representation',
        estimated_uncertainty_ns: 5_000_000,
        synchronized: true,
      },
      attestation: {
        alg: 'Ed25519',
        key_id: 'ctcl-ed25519-1',
        signed_fields: 'instant_id|unix_ns|timescale',
        value: 'fixture-signature',
      },
    });
    expect(evidence.canonicalUnixNs).toBe('1786978800123000000');
    expect(evidence.sourceQuality.precision).toBe('millisecond_representation');
    expect(evidence.sourceQuality.estimatedUncertaintyNs).toBe(5_000_000);
    expect(evidence.verification).toBe('provider-asserted');
    expect(evidence.attestation).toEqual({
      alg: 'Ed25519',
      keyId: 'ctcl-ed25519-1',
      signedFields: 'instant_id|unix_ns|timescale',
      value: 'fixture-signature',
    });
  });

  it('registers only supplied instant fields and normalizes the returned instant', async () => {
    const { fake, adapter } = makeAdapter([
      jsonResponse(ok(instantData('ctcl:instant:registered-1'))),
    ]);

    const evidence = await adapter.registerInstant({
      value: '1786978800.123',
      encoding: 'unix_s',
      label: 'handoff',
      meta: { agent: 'alpha' },
    });

    expect(fake.requests[0]?.method).toBe('POST');
    expect(fake.requests[0]?.url).toBe('https://commoninstant.org/v1/instants');
    expect(fake.requests[0]?.headers.get('content-type')).toBe('application/json');
    expect(decodeJsonBody(fake.requests[0]!.body)).toEqual({
      value: '1786978800.123',
      encoding: 'unix_s',
      label: 'handoff',
      meta: { agent: 'alpha' },
    });
    expect(evidence.instant.instant_id).toBe('ctcl:instant:registered-1');
  });

  it('URL-encodes registered instant IDs on retrieval', async () => {
    const { fake, adapter } = makeAdapter([
      jsonResponse(ok(instantData('ctcl:instant:a/b?c'))),
    ]);

    const evidence = await adapter.getInstant('ctcl:instant:a/b?c');

    expect(fake.requests[0]?.url).toBe(
      'https://commoninstant.org/v1/instant/ctcl%3Ainstant%3Aa%2Fb%3Fc',
    );
    expect(evidence.instant.instant_id).toBe('ctcl:instant:a/b?c');
  });

  it('converts values through the canonical conversion result shape', async () => {
    const { fake, adapter } = makeAdapter([
      jsonResponse(ok({
        output: { value: '2026-08-17T23:00:00.123+08:00' },
        canonical_unix_ns: '1786978800123000000',
        quality: { lossless: true },
      })),
    ]);

    await expect(adapter.convert({
      input: { value: '1786978800.123', encoding: 'unix_s', timescale: 'posix' },
      output: { encoding: 'rfc3339', timezone: 'Asia/Taipei' },
    })).resolves.toEqual({
      value: '2026-08-17T23:00:00.123+08:00',
      canonicalUnixNs: '1786978800123000000',
      lossless: true,
    });

    expect(fake.requests[0]?.url).toBe('https://commoninstant.org/v1/convert');
    expect(decodeJsonBody(fake.requests[0]!.body)).toEqual({
      input: { value: '1786978800.123', encoding: 'unix_s', timescale: 'posix' },
      output: { encoding: 'rfc3339', timezone: 'Asia/Taipei' },
    });
  });

  it('maps boundary input to CTCL snake_case and validates returned status', async () => {
    const { fake, adapter } = makeAdapter([
      jsonResponse(ok({ status: 'fold', safe: false, detail: { candidates: 2 } })),
    ]);

    await expect(adapter.inspectBoundary({
      timezone: 'America/New_York',
      localValue: '2026-11-01T01:30:00',
      windowHours: 48,
    })).resolves.toEqual({ status: 'fold', safe: false, detail: { candidates: 2 } });

    expect(decodeJsonBody(fake.requests[0]!.body)).toEqual({
      timezone: 'America/New_York',
      local_value: '2026-11-01T01:30:00',
      window_hours: 48,
    });
  });

  it('maps planner step_s and normalizes candidate evidence arrays', async () => {
    const { fake, adapter } = makeAdapter([
      jsonResponse(ok({
        best: {
          unix_s: '1787000000',
          score: 8.5,
          satisfied: [{ type: 'weekday_hours' }],
          violated: [],
          unsupported: [],
        },
        alternatives: [{
          unix_s: '1787000900',
          score: 7,
          satisfied: [],
          violated: [{ type: 'prefer_window' }],
          unsupported: [{ type: 'market_hours' }],
        }],
        explanation: 'best supported candidate',
      })),
    ]);

    const result = await adapter.planSharedInstant({
      window: { from: 1786990000, to: 1787010000, stepS: 900 },
      constraints: [{ type: 'weekday_hours', weight: 2 }],
    });

    expect(decodeJsonBody(fake.requests[0]!.body)).toEqual({
      window: { from: 1786990000, to: 1787010000, step_s: 900 },
      constraints: [{ type: 'weekday_hours', weight: 2 }],
    });
    expect(result).toEqual({
      best: {
        unixS: '1787000000',
        score: 8.5,
        satisfied: [{ type: 'weekday_hours' }],
        violated: [],
        unsupported: [],
      },
      alternatives: [{
        unixS: '1787000900',
        score: 7,
        satisfied: [],
        violated: [{ type: 'prefer_window' }],
        unsupported: [{ type: 'market_hours' }],
      }],
      explanation: 'best supported candidate',
    });
  });

  it.each([
    [400, 'INVALID_TIME_VALUE', 'invalid_input', false],
    [401, 'NOT_AUTHENTICATED', 'authentication_required', false],
    [403, 'FORBIDDEN', 'permission_denied', false],
    [404, 'UNKNOWN_INSTANT', 'not_found', false],
    [429, 'RATE_LIMITED', 'rate_limited', true],
    [503, 'REGISTRY_UNAVAILABLE', 'temporarily_unavailable', true],
  ] as const)(
    'maps HTTP %i / %s into %s',
    async (status, providerCode, expectedCode, retryable) => {
      const { adapter } = makeAdapter([
        jsonResponse({
          ok: false,
          error: { code: providerCode, message: 'fixture error' },
          meta: { api_version: 'v1' },
        }, status),
      ]);

      await expect(adapter.now()).rejects.toMatchObject({
        name: 'TemporalEvidenceError',
        code: expectedCode,
        retryable,
      });
    },
  );

  it('normalizes provider RATE_LIMITED even when the HTTP status is successful', async () => {
    const { adapter } = makeAdapter([
      jsonResponse({
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'provider quota' },
        meta: { api_version: 'v1' },
      }),
    ]);

    await expect(adapter.now()).rejects.toMatchObject({
      code: 'rate_limited',
      retryable: true,
    });
  });

  it('maps fetch/network failure into retryable temporarily_unavailable', async () => {
    const { adapter } = makeAdapter([
      () => { throw new Error('network down'); },
    ]);

    await expect(adapter.now()).rejects.toMatchObject({
      code: 'temporarily_unavailable',
      retryable: true,
    });
  });

  it('fails closed on malformed successful endpoint data', async () => {
    const { adapter } = makeAdapter([jsonResponse(ok({ instant: {} }))]);

    await expect(adapter.now()).rejects.toMatchObject({
      code: 'unknown_backend_error',
      retryable: false,
    });
  });

  it('fails closed on malformed success envelopes', async () => {
    const { adapter } = makeAdapter([jsonResponse({ ok: true, meta: {} })]);

    await expect(adapter.now()).rejects.toBeInstanceOf(TemporalEvidenceError);
    await expect(Promise.resolve()).resolves.toBeUndefined();
  });

  it('rejects insecure or credential-bearing custom base URLs, but permits localhost HTTP', async () => {
    expect(() => new CtclRestTemporalAdapter({ baseUrl: 'http://example.com' })).toThrowError(
      expect.objectContaining({ code: 'invalid_input' }),
    );
    expect(() => new CtclRestTemporalAdapter({ baseUrl: 'https://user:pass@example.com' })).toThrowError(
      expect.objectContaining({ code: 'invalid_input' }),
    );

    const { fake, adapter } = makeAdapter([jsonResponse(ok(instantData()))], 'http://127.0.0.1:8787');
    await adapter.now();
    expect(fake.requests[0]?.url).toBe('http://127.0.0.1:8787/v1/now');
  });
});
