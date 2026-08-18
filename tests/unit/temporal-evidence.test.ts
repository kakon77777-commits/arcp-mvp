import { describe, expect, it } from 'vitest';
import { DeterministicTemporalEvidenceAdapter } from '@arcp/adapter-ctcl';
import {
  TemporalEvidenceError,
  createDegradedLocalEvidence,
} from '@arcp/temporal-evidence';

describe('@arcp/temporal-evidence', () => {
  it('creates explicit degraded-local evidence without forging a CTCL identity', () => {
    const evidence = createDegradedLocalEvidence({
      unixMs: 1786980000123,
      sequence: 7,
    });

    expect(evidence.instant.instant_id).toBe('local:unverified:1786980000123:7');
    expect(evidence.instant.unverified).toBe(true);
    expect(evidence.instant.timescale).toBe('posix');
    expect(evidence.instant.encoding).toBe('unix_ms');
    expect(evidence.instant.value).toBe('1786980000123');
    expect(evidence.instant.source_quality).toEqual({
      source_class: 'local_wall_clock',
      precision: 'millisecond_representation',
    });
    expect(evidence.verification).toBe('degraded-local');
    expect(evidence.canonicalUnixNs).toBe('1786980000123000000');
    expect(evidence.instant.instant_id.startsWith('ctcl:instant:')).toBe(false);
  });

  it('keeps normalized temporal errors explicit and retryability caller-visible', () => {
    const error = new TemporalEvidenceError('temporarily_unavailable', 'CTCL unavailable', true);
    expect(error.name).toBe('TemporalEvidenceError');
    expect(error.code).toBe('temporarily_unavailable');
    expect(error.retryable).toBe(true);
  });
});

describe('DeterministicTemporalEvidenceAdapter', () => {
  it('advances deterministically without reading the wall clock', async () => {
    const adapter = new DeterministicTemporalEvidenceAdapter({
      startUnixMs: 1_786_980_000_000,
      stepMs: 25,
    });

    const first = await adapter.now();
    const second = await adapter.now();

    expect(first.instant.value).toBe('1786980000000');
    expect(first.canonicalUnixNs).toBe('1786980000000000000');
    expect(second.instant.value).toBe('1786980000025');
    expect(second.canonicalUnixNs).toBe('1786980000025000000');
    expect(first.instant.instant_id).not.toBe(second.instant.instant_id);
    expect(first.verification).toBe('provider-asserted');
  });

  it('registers and later retrieves the same deterministic Common Instant', async () => {
    const adapter = new DeterministicTemporalEvidenceAdapter({ startUnixMs: 1_786_980_000_000 });

    const registered = await adapter.registerInstant({
      value: '1786980000.250',
      encoding: 'unix_s',
      label: 'handoff',
    });
    const retrieved = await adapter.getInstant(registered.instant.instant_id);

    expect(retrieved.instant.instant_id).toBe(registered.instant.instant_id);
    expect(retrieved.canonicalUnixNs).toBe(registered.canonicalUnixNs);
  });

  it('returns deterministic fixture transformations without network access', async () => {
    const adapter = new DeterministicTemporalEvidenceAdapter();

    await expect(adapter.convert({
      input: { value: '1786980000000', encoding: 'unix_ms', timescale: 'posix' },
      output: { encoding: 'unix_ns', timescale: 'posix' },
    })).resolves.toEqual({
      value: '1786980000000000000',
      canonicalUnixNs: '1786980000000000000',
      lossless: true,
    });

    await expect(adapter.inspectBoundary({ timezone: 'Asia/Taipei', localValue: '2026-08-18T00:00:00' }))
      .resolves.toMatchObject({ status: 'normal', safe: true });
  });
});
