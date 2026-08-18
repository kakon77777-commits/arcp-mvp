import type { TemporalEvidence } from './types.js';

export function createDegradedLocalEvidence(input: {
  unixMs: number;
  sequence?: number;
}): TemporalEvidence {
  const seq = input.sequence ?? 0;
  const unixMs = String(Math.trunc(input.unixMs));

  return {
    instant: {
      instant_id: `local:unverified:${unixMs}:${seq}`,
      timescale: 'posix',
      encoding: 'unix_ms',
      value: unixMs,
      source_quality: {
        source_class: 'local_wall_clock',
        precision: 'millisecond_representation',
      },
      unverified: true,
    },
    canonicalUnixNs: `${unixMs}000000`,
    sourceQuality: {
      sourceClass: 'local_wall_clock',
      precision: 'millisecond_representation',
    },
    verification: 'degraded-local',
  };
}
