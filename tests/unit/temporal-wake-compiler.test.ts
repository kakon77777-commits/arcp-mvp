import { describe, expect, it } from 'vitest';
import type {
  RegisterInstantInput,
  SharedInstantPlan,
  SharedInstantPlanInput,
  TemporalBoundaryInput,
  TemporalBoundaryResult,
  TemporalConversionInput,
  TemporalConversionResult,
  TemporalEvidence,
  TemporalEvidencePort,
} from '@arcp/temporal-evidence';
import {
  TemporalWakeCompiler,
  parseLocalDateTime,
  resolveIanaLocalDateTime,
} from '@arcp/temporal-wake';

function makeEvidence(id: string, value = '1786980000000000000'): TemporalEvidence {
  return {
    instant: {
      instant_id: id,
      timescale: 'utc',
      encoding: 'unix_ns',
      value,
      source_quality: {
        source_class: 'fixture_clock',
        precision: 'millisecond_representation',
        estimated_uncertainty_ns: 5_000_000,
        synchronized: true,
      },
    },
    canonicalUnixNs: value,
    sourceQuality: {
      sourceClass: 'fixture_clock',
      precision: 'millisecond_representation',
      estimatedUncertaintyNs: 5_000_000,
      synchronized: true,
    },
    verification: 'provider-asserted',
  };
}

class RecordingTemporalPort implements TemporalEvidencePort {
  readonly calls: Array<{ method: string; input?: unknown }> = [];
  boundary: TemporalBoundaryResult = { status: 'normal', safe: true, detail: { fixture: true } };
  plan: SharedInstantPlan = {
    best: {
      unixS: '1786980000',
      score: 0.875,
      satisfied: ['fixture'],
      violated: [],
      unsupported: [],
    },
    alternatives: [],
    explanation: 'fixture plan',
  };
  private nextRegistration = 0;

  async now(): Promise<TemporalEvidence> {
    this.calls.push({ method: 'now' });
    return makeEvidence('ctcl:instant:now');
  }

  async registerInstant(input: RegisterInstantInput = {}): Promise<TemporalEvidence> {
    this.calls.push({ method: 'registerInstant', input: structuredClone(input) });
    this.nextRegistration += 1;
    return makeEvidence(
      `ctcl:instant:registered-${this.nextRegistration}`,
      input.encoding === 'unix_ms' && input.value !== undefined
        ? `${input.value}000000`
        : input.encoding === 'unix_s' && input.value !== undefined
          ? `${input.value.replace('.', '')}${'0'.repeat(Math.max(0, 9 - (input.value.split('.')[1]?.length ?? 0)))}`
          : '1786980000000000000',
    );
  }

  async getInstant(id: string): Promise<TemporalEvidence> {
    this.calls.push({ method: 'getInstant', input: id });
    return makeEvidence(id);
  }

  async convert(input: TemporalConversionInput): Promise<TemporalConversionResult> {
    this.calls.push({ method: 'convert', input: structuredClone(input) });
    return { value: input.input.value, canonicalUnixNs: input.input.value, lossless: true };
  }

  async inspectBoundary(input: TemporalBoundaryInput): Promise<TemporalBoundaryResult> {
    this.calls.push({ method: 'inspectBoundary', input: structuredClone(input) });
    return structuredClone(this.boundary);
  }

  async planSharedInstant(input: SharedInstantPlanInput): Promise<SharedInstantPlan> {
    this.calls.push({ method: 'planSharedInstant', input: structuredClone(input) });
    return structuredClone(this.plan);
  }
}

async function expectInvalidInput(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    code: 'invalid_input',
    retryable: false,
  });
}

describe('TemporalWakeCompiler', () => {
  it('resolves a registered instant using only getInstant()', async () => {
    const temporal = new RecordingTemporalPort();
    const compiler = new TemporalWakeCompiler(temporal);

    const result = await compiler.compile({
      kind: 'registered-instant',
      instantId: 'ctcl:instant:handoff-1',
    });

    expect(result.notBefore.instant_id).toBe('ctcl:instant:handoff-1');
    expect(temporal.calls).toEqual([
      { method: 'getInstant', input: 'ctcl:instant:handoff-1' },
    ]);
  });

  it('inspects a normal IANA local datetime before registering the exact instant', async () => {
    const temporal = new RecordingTemporalPort();
    const compiler = new TemporalWakeCompiler(temporal);

    const result = await compiler.compile({
      kind: 'local-datetime',
      localValue: '2026-08-18T09:30:00',
      timezone: 'Asia/Taipei',
      label: 'taipei-morning',
    });

    expect(result.notBefore.instant_id).toBe('ctcl:instant:registered-1');
    expect(temporal.calls.map((call) => call.method)).toEqual([
      'inspectBoundary',
      'registerInstant',
    ]);
    expect(temporal.calls[0]?.input).toEqual({
      timezone: 'Asia/Taipei',
      localValue: '2026-08-18T09:30:00',
    });
    expect(temporal.calls[1]?.input).toEqual({
      value: String(Date.UTC(2026, 7, 18, 1, 30, 0, 0)),
      encoding: 'unix_ms',
      timescale: 'posix',
      label: 'taipei-morning',
    });
    expect(result.planningEvidence).toEqual(temporal.boundary);
  });

  it('rejects a CTCL-classified local-time gap without registering anything', async () => {
    const temporal = new RecordingTemporalPort();
    temporal.boundary = { status: 'gap', safe: false, detail: { transition: 'spring-forward' } };
    const compiler = new TemporalWakeCompiler(temporal);

    await expectInvalidInput(compiler.compile({
      kind: 'local-datetime',
      localValue: '2026-03-08T02:30:00',
      timezone: 'America/New_York',
    }));

    expect(temporal.calls.map((call) => call.method)).toEqual(['inspectBoundary']);
  });

  it('requires an explicit fold resolution for ambiguous local time', async () => {
    const temporal = new RecordingTemporalPort();
    temporal.boundary = { status: 'fold', safe: false, detail: { transition: 'fall-back' } };
    const compiler = new TemporalWakeCompiler(temporal);

    await expectInvalidInput(compiler.compile({
      kind: 'local-datetime',
      localValue: '2026-11-01T01:30:00',
      timezone: 'America/New_York',
    }));

    expect(temporal.calls.map((call) => call.method)).toEqual(['inspectBoundary']);
  });

  it('chooses distinct exact instants for earlier/later fold resolution', async () => {
    const earlierTemporal = new RecordingTemporalPort();
    earlierTemporal.boundary = { status: 'fold', safe: false, detail: {} };
    const laterTemporal = new RecordingTemporalPort();
    laterTemporal.boundary = { status: 'fold', safe: false, detail: {} };

    await new TemporalWakeCompiler(earlierTemporal).compile({
      kind: 'local-datetime',
      localValue: '2026-11-01T01:30:00',
      timezone: 'America/New_York',
      foldResolution: 'earlier',
    });
    await new TemporalWakeCompiler(laterTemporal).compile({
      kind: 'local-datetime',
      localValue: '2026-11-01T01:30:00',
      timezone: 'America/New_York',
      foldResolution: 'later',
    });

    expect(earlierTemporal.calls[1]?.input).toMatchObject({
      value: String(Date.UTC(2026, 10, 1, 5, 30)),
      encoding: 'unix_ms',
    });
    expect(laterTemporal.calls[1]?.input).toMatchObject({
      value: String(Date.UTC(2026, 10, 1, 6, 30)),
      encoding: 'unix_ms',
    });
  });

  it('compiles a bounded planner candidate and persists planner score as registration metadata', async () => {
    const temporal = new RecordingTemporalPort();
    const compiler = new TemporalWakeCompiler(temporal);
    const constraints = [{ type: 'min_lead_time' as const, seconds: 900 }];

    const result = await compiler.compile({
      kind: 'bounded-constraints',
      window: { from: 1_786_980_000, to: 1_786_983_600, stepS: 60 },
      constraints,
      label: 'bounded-wake',
    });

    expect(temporal.calls.map((call) => call.method)).toEqual([
      'planSharedInstant',
      'registerInstant',
    ]);
    expect(temporal.calls[0]?.input).toEqual({
      window: { from: 1_786_980_000, to: 1_786_983_600, stepS: 60 },
      constraints,
    });
    expect(temporal.calls[1]?.input).toEqual({
      value: '1786980000',
      encoding: 'unix_s',
      timescale: 'posix',
      label: 'bounded-wake',
      meta: { planner_score: 0.875 },
    });
    expect(result.planningEvidence).toEqual(temporal.plan);
  });

  it('rejects a bounded planner result with no candidate and performs no registration', async () => {
    const temporal = new RecordingTemporalPort();
    temporal.plan = { best: null, alternatives: [], explanation: 'no feasible instant' };
    const compiler = new TemporalWakeCompiler(temporal);

    await expectInvalidInput(compiler.compile({
      kind: 'bounded-constraints',
      window: { from: 1, to: 2 },
      constraints: [],
    }));

    expect(temporal.calls.map((call) => call.method)).toEqual(['planSharedInstant']);
  });

  it('rejects malformed, offset-bearing, impossible local datetimes before any provider call', async () => {
    for (const localValue of [
      '2026-08-18',
      '2026-08-18T09:30:00Z',
      '2026-08-18T09:30:00+08:00',
      '2026-02-30T09:30:00',
      '2026-08-18T24:00:00',
    ]) {
      const temporal = new RecordingTemporalPort();
      const compiler = new TemporalWakeCompiler(temporal);
      await expectInvalidInput(compiler.compile({
        kind: 'local-datetime',
        localValue,
        timezone: 'Asia/Taipei',
      }));
      expect(temporal.calls).toEqual([]);
    }
  });

  it('rejects invalid IANA timezone names as invalid input', async () => {
    expect(() => resolveIanaLocalDateTime({
      localValue: '2026-08-18T09:30:00',
      timezone: 'Mars/Olympus_Mons',
    })).toThrowError(expect.objectContaining({ code: 'invalid_input' }));
  });
});

describe('strict local datetime parser', () => {
  it('accepts minute, second, and millisecond forms exactly', () => {
    expect(parseLocalDateTime('2026-08-18T09:30')).toEqual({
      year: 2026, month: 8, day: 18, hour: 9, minute: 30, second: 0, millisecond: 0,
    });
    expect(parseLocalDateTime('2026-08-18T09:30:45')).toMatchObject({ second: 45, millisecond: 0 });
    expect(parseLocalDateTime('2026-08-18T09:30:45.123')).toMatchObject({ second: 45, millisecond: 123 });
  });
});
