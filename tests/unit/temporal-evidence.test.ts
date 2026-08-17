import { describe, expect, it } from 'vitest';
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
