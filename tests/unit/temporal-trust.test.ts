import { describe, expect, it } from 'vitest';
import { evaluateTemporalTrust } from '@arcp/temporal-evidence';
import type { InstantRef, RiskLevel } from '@arcp/schema';

const goodEvidence: InstantRef = {
  instant_id: 'ctcl:instant:trusted-1',
  timescale: 'utc',
  encoding: 'unix_ns',
  value: '1786980000123000000',
  source_quality: {
    source_class: 'edge_wall_clock',
    precision: 'millisecond_representation',
    estimated_uncertainty_ns: 5_000_000,
    synchronized: true,
  },
};

function evaluate(risk: RiskLevel, evidence: InstantRef | null, extra = {}) {
  return evaluateTemporalTrust({
    temporallySensitive: true,
    risk,
    evidence,
    ...extra,
  });
}

describe('evaluateTemporalTrust', () => {
  it('allows non-temporally-sensitive actions without requiring temporal evidence', () => {
    expect(evaluateTemporalTrust({ temporallySensitive: false, risk: 'R4', evidence: null })).toEqual({
      acceptable: true,
      action: 'allow',
      reason: 'action is not temporally sensitive',
    });
  });

  it.each(['R0', 'R1'] as const)('%s allows degraded or missing evidence only with an explicit log', (risk) => {
    expect(evaluate(risk, null).action).toBe('allow-with-log');
    expect(evaluate(risk, { instant_id: 'local:unverified:1:0', unverified: true }).action).toBe('allow-with-log');
    expect(evaluate(risk, null).acceptable).toBe(true);
  });

  it('delays R2 when evidence is degraded or missing', () => {
    expect(evaluate('R2', null)).toMatchObject({ acceptable: false, action: 'delay' });
    expect(evaluate('R2', { instant_id: 'local:unverified:1:0', unverified: true })).toMatchObject({
      acceptable: false,
      action: 'delay',
    });
  });

  it.each(['R3', 'R4'] as const)('%s requires non-degraded evidence', (risk) => {
    expect(evaluate(risk, null)).toMatchObject({ acceptable: false, action: 'require-evidence' });
  });

  it('does not trust a ctcl-shaped identifier merely because of its prefix', () => {
    expect(evaluate('R3', { instant_id: 'ctcl:instant:looks-real' })).toMatchObject({
      acceptable: false,
      action: 'require-evidence',
    });
  });

  it('requires evidence when uncertainty exceeds the configured ceiling', () => {
    expect(evaluate('R0', goodEvidence, { maxUncertaintyNs: 1_000_000 })).toMatchObject({
      acceptable: false,
      action: 'require-evidence',
    });
  });

  it('requires evidence when an uncertainty ceiling exists but the evidence omits uncertainty', () => {
    const noUncertainty: InstantRef = {
      ...goodEvidence,
      source_quality: {
        source_class: 'edge_wall_clock',
        precision: 'millisecond_representation',
      },
    };
    expect(evaluate('R1', noUncertainty, { maxUncertaintyNs: 5_000_000 })).toMatchObject({
      acceptable: false,
      action: 'require-evidence',
    });
  });

  it.each(['R0', 'R1', 'R2', 'R3', 'R4'] as const)('%s allows acceptable non-degraded evidence', (risk) => {
    expect(evaluate(risk, goodEvidence, { maxUncertaintyNs: 5_000_000 })).toEqual({
      acceptable: true,
      action: 'allow',
      reason: 'temporal evidence satisfies the configured requirement',
    });
  });
});
