import type { InstantRef } from '@arcp/schema';
import {
  TemporalEvidenceError,
  type RegisterInstantInput,
  type SharedInstantPlan,
  type SharedInstantPlanInput,
  type TemporalBoundaryInput,
  type TemporalBoundaryResult,
  type TemporalConversionInput,
  type TemporalConversionResult,
  type TemporalEncoding,
  type TemporalEvidence,
  type TemporalEvidencePort,
} from '@arcp/temporal-evidence';

function parseDecimalSecondsToNs(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,9}))?$/.exec(value);
  if (match === null) {
    throw new TemporalEvidenceError('invalid_input', `invalid unix_s value: ${value}`, false);
  }
  const sign = match[1] === '-' ? -1n : 1n;
  const seconds = BigInt(match[2]!);
  const fraction = (match[3] ?? '').padEnd(9, '0');
  return sign * (seconds * 1_000_000_000n + BigInt(fraction.length === 0 ? '0' : fraction));
}

function parseToNs(value: string, encoding: TemporalEncoding): bigint {
  try {
    if (encoding === 'unix_ns') return BigInt(value);
    if (encoding === 'unix_us') return BigInt(value) * 1_000n;
    if (encoding === 'unix_ms') return BigInt(value) * 1_000_000n;
    if (encoding === 'unix_s') return parseDecimalSecondsToNs(value);
    const parsedMs = Date.parse(value);
    if (!Number.isFinite(parsedMs)) throw new Error('invalid RFC3339');
    return BigInt(parsedMs) * 1_000_000n;
  } catch (error) {
    if (error instanceof TemporalEvidenceError) throw error;
    throw new TemporalEvidenceError('invalid_input', `invalid ${encoding} value: ${value}`, false, {
      cause: error,
    });
  }
}

function formatUnixSeconds(ns: bigint): string {
  const negative = ns < 0n;
  const absolute = negative ? -ns : ns;
  const seconds = absolute / 1_000_000_000n;
  const fraction = (absolute % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${seconds.toString()}${fraction.length === 0 ? '' : `.${fraction}`}`;
}

function formatFromNs(ns: bigint, encoding: TemporalEncoding): { value: string; lossless: boolean } {
  if (encoding === 'unix_ns') return { value: ns.toString(), lossless: true };
  if (encoding === 'unix_us') {
    return { value: (ns / 1_000n).toString(), lossless: ns % 1_000n === 0n };
  }
  if (encoding === 'unix_ms') {
    return { value: (ns / 1_000_000n).toString(), lossless: ns % 1_000_000n === 0n };
  }
  if (encoding === 'unix_s') return { value: formatUnixSeconds(ns), lossless: true };
  const millisecond = ns / 1_000_000n;
  const asNumber = Number(millisecond);
  if (!Number.isSafeInteger(asNumber)) {
    throw new TemporalEvidenceError('invalid_input', 'RFC3339 conversion is outside Date range', false);
  }
  return {
    value: new Date(asNumber).toISOString(),
    lossless: ns % 1_000_000n === 0n,
  };
}

function cloneEvidence(evidence: TemporalEvidence): TemporalEvidence {
  return structuredClone(evidence);
}

export interface DeterministicTemporalEvidenceAdapterOptions {
  startUnixMs?: number;
  stepMs?: number;
}

export class DeterministicTemporalEvidenceAdapter implements TemporalEvidencePort {
  private readonly startUnixMs: number;
  private readonly stepMs: number;
  private nowCounter = 0;
  private registrationCounter = 0;
  private readonly registered = new Map<string, TemporalEvidence>();

  constructor(options: DeterministicTemporalEvidenceAdapterOptions = {}) {
    this.startUnixMs = options.startUnixMs ?? 1_700_000_000_000;
    this.stepMs = options.stepMs ?? 1;
    if (!Number.isSafeInteger(this.startUnixMs) || !Number.isSafeInteger(this.stepMs)) {
      throw new TemporalEvidenceError(
        'invalid_input',
        'deterministic temporal clock requires safe-integer millisecond values',
        false,
      );
    }
  }

  async now(): Promise<TemporalEvidence> {
    const unixMs = this.startUnixMs + this.nowCounter * this.stepMs;
    const sequence = this.nowCounter;
    this.nowCounter += 1;
    return this.evidenceForMs(`ctcl:instant:det-now-${sequence.toString().padStart(6, '0')}`, unixMs);
  }

  async registerInstant(input: RegisterInstantInput = {}): Promise<TemporalEvidence> {
    let ns: bigint;
    if (input.value === undefined) {
      const unixMs = this.startUnixMs + this.nowCounter * this.stepMs;
      this.nowCounter += 1;
      ns = BigInt(unixMs) * 1_000_000n;
    } else {
      if (input.encoding === undefined) {
        throw new TemporalEvidenceError(
          'invalid_input',
          'encoding is required when a deterministic instant value is supplied',
          false,
        );
      }
      ns = parseToNs(input.value, input.encoding);
    }

    const id = `ctcl:instant:det-registered-${this.registrationCounter
      .toString()
      .padStart(6, '0')}`;
    this.registrationCounter += 1;
    const evidence = this.evidenceForNs(id, ns);
    this.registered.set(id, cloneEvidence(evidence));
    return evidence;
  }

  async getInstant(id: string): Promise<TemporalEvidence> {
    const evidence = this.registered.get(id);
    if (evidence === undefined) {
      throw new TemporalEvidenceError('not_found', `deterministic instant not found: ${id}`, false);
    }
    return cloneEvidence(evidence);
  }

  async convert(input: TemporalConversionInput): Promise<TemporalConversionResult> {
    const ns = parseToNs(input.input.value, input.input.encoding);
    const formatted = formatFromNs(ns, input.output.encoding);
    return {
      value: formatted.value,
      canonicalUnixNs: ns.toString(),
      lossless: formatted.lossless,
    };
  }

  async inspectBoundary(input: TemporalBoundaryInput): Promise<TemporalBoundaryResult> {
    return {
      status: 'normal',
      safe: true,
      detail: { deterministic: true, input: structuredClone(input) },
    };
  }

  async planSharedInstant(input: SharedInstantPlanInput): Promise<SharedInstantPlan> {
    if (!Number.isFinite(input.window.from) || !Number.isFinite(input.window.to)) {
      throw new TemporalEvidenceError('invalid_input', 'planner window must be finite', false);
    }
    if (input.window.from > input.window.to) {
      throw new TemporalEvidenceError('invalid_input', 'planner window is inverted', false);
    }
    return {
      best: {
        unixS: String(input.window.from),
        score: 1,
        satisfied: structuredClone(input.constraints),
        violated: [],
        unsupported: [],
      },
      alternatives: [],
      explanation: 'deterministic test provider selected the beginning of the window',
    };
  }

  private evidenceForMs(id: string, unixMs: number): TemporalEvidence {
    const value = String(unixMs);
    return {
      instant: {
        instant_id: id,
        timescale: 'posix',
        encoding: 'unix_ms',
        value,
        source_quality: {
          source_class: 'deterministic_test_clock',
          precision: 'millisecond_representation',
          estimated_uncertainty_ns: 0,
          synchronized: true,
        },
      },
      canonicalUnixNs: `${value}000000`,
      sourceQuality: {
        sourceClass: 'deterministic_test_clock',
        precision: 'millisecond_representation',
        estimatedUncertaintyNs: 0,
        synchronized: true,
      },
      verification: 'provider-asserted',
    };
  }

  private evidenceForNs(id: string, ns: bigint): TemporalEvidence {
    const canonicalUnixNs = ns.toString();
    return {
      instant: {
        instant_id: id,
        timescale: 'posix',
        encoding: 'unix_ns',
        value: canonicalUnixNs,
        source_quality: {
          source_class: 'deterministic_test_clock',
          precision: 'nanosecond_fixture_representation',
          estimated_uncertainty_ns: 0,
          synchronized: true,
        },
      },
      canonicalUnixNs,
      sourceQuality: {
        sourceClass: 'deterministic_test_clock',
        precision: 'nanosecond_fixture_representation',
        estimatedUncertaintyNs: 0,
        synchronized: true,
      },
      verification: 'provider-asserted',
    };
  }
}

/**
 * Phase 0 compatibility clock. New Phase 3 code should prefer
 * DeterministicTemporalEvidenceAdapter through TemporalEvidencePort.
 */
export class FakeCtclAdapter {
  private counter = 0;
  private available = true;

  now(): InstantRef {
    if (!this.available) {
      return {
        instant_id: `local:unverified:${Date.now()}`,
        unverified: true,
      };
    }
    this.counter += 1;
    return {
      instant_id: `ctcl:instant:fake-${String(this.counter).padStart(6, '0')}`,
      timescale: 'utc',
      encoding: 'unix_ms',
      source_quality: {
        source_class: 'fake_test_clock',
        precision: 'millisecond',
        estimated_uncertainty_ns: 0,
      },
    };
  }

  setUnavailable(unavailable: boolean): void {
    this.available = !unavailable;
  }

  reset(): void {
    this.counter = 0;
    this.available = true;
  }
}
