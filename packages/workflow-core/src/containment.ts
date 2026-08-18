import type { ContainmentRecord } from '@arcp/schema';

export interface ContainmentEvaluation {
  blocked: boolean;
  matchingContainmentIds: string[];
  mandatoryEvidencePath: boolean;
}

const MANDATORY_EVIDENCE_SCOPES = new Set([
  'record-effect-evidence',
  'record-audit-evidence',
  'canonicalize-effect-evidence',
]);

export function evaluateContainment(
  containments: readonly ContainmentRecord[],
  operationScope: string,
): ContainmentEvaluation {
  if (MANDATORY_EVIDENCE_SCOPES.has(operationScope)) {
    return { blocked: false, matchingContainmentIds: [], mandatoryEvidencePath: true };
  }

  const matching = containments.filter((containment) =>
    (containment.status === 'active' || containment.status === 'review-due' || containment.status === 'renewed') &&
    containment.scope.some((scope) => scope === '*' || scope === operationScope),
  );

  return {
    blocked: matching.length > 0,
    matchingContainmentIds: matching.map((item) => item.containment_id),
    mandatoryEvidencePath: false,
  };
}

function instantUnixMs(record: ContainmentRecord['expires_at'] | undefined): number | null {
  if (!record?.value || !record.encoding) return null;
  try {
    if (record.encoding === 'unix_ms') return Number(record.value);
    if (record.encoding === 'unix_s') return Number(record.value) * 1_000;
    if (record.encoding === 'unix_us') return Number(BigInt(record.value) / 1_000n);
    if (record.encoding === 'unix_ns') return Number(BigInt(record.value) / 1_000_000n);
    if (record.encoding === 'rfc3339') {
      const value = Date.parse(record.value);
      return Number.isFinite(value) ? value : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function reviewContainmentAt(record: ContainmentRecord, unixMs: number): ContainmentRecord {
  if (record.status === 'released' || record.status === 'escalated') return structuredClone(record);
  const reviewAt = instantUnixMs(record.review_after);
  const expiresAt = instantUnixMs(record.expires_at);
  const due =
    (record.review_required && reviewAt !== null && unixMs >= reviewAt) ||
    (expiresAt !== null && unixMs >= expiresAt);

  if (!due) return structuredClone(record);
  return { ...structuredClone(record), status: 'review-due' };
}
