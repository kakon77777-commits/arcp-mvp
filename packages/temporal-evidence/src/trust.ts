import type { InstantRef, RiskLevel } from '@arcp/schema';

export interface TemporalTrustContext {
  temporallySensitive: boolean;
  risk: RiskLevel;
  evidence: InstantRef | null;
  maxUncertaintyNs?: number;
}

export type TemporalTrustAction = 'allow' | 'allow-with-log' | 'delay' | 'require-evidence';

export interface TemporalTrustResult {
  acceptable: boolean;
  action: TemporalTrustAction;
  reason: string;
}

function hasNonDegradedEvidence(evidence: InstantRef | null): evidence is InstantRef {
  return evidence !== null && evidence.unverified !== true && evidence.source_quality !== undefined;
}

export function evaluateTemporalTrust(context: TemporalTrustContext): TemporalTrustResult {
  if (!context.temporallySensitive) {
    return {
      acceptable: true,
      action: 'allow',
      reason: 'action is not temporally sensitive',
    };
  }

  if (!hasNonDegradedEvidence(context.evidence)) {
    if (context.risk === 'R0' || context.risk === 'R1') {
      return {
        acceptable: true,
        action: 'allow-with-log',
        reason: 'temporal evidence is missing or degraded; low-risk action requires an explicit log',
      };
    }
    if (context.risk === 'R2') {
      return {
        acceptable: false,
        action: 'delay',
        reason: 'R2 temporally-sensitive action requires non-degraded temporal evidence before proceeding',
      };
    }
    return {
      acceptable: false,
      action: 'require-evidence',
      reason: `${context.risk} temporally-sensitive action requires non-degraded temporal evidence`,
    };
  }

  if (context.maxUncertaintyNs !== undefined) {
    const uncertainty = context.evidence.source_quality?.estimated_uncertainty_ns;
    if (uncertainty === undefined || uncertainty > context.maxUncertaintyNs) {
      return {
        acceptable: false,
        action: 'require-evidence',
        reason:
          uncertainty === undefined
            ? 'temporal evidence does not report uncertainty required by the configured ceiling'
            : `temporal evidence uncertainty ${uncertainty}ns exceeds configured ceiling ${context.maxUncertaintyNs}ns`,
      };
    }
  }

  return {
    acceptable: true,
    action: 'allow',
    reason: 'temporal evidence satisfies the configured requirement',
  };
}
