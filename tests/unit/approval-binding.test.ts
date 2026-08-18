import { describe, expect, it } from 'vitest';
import { computeApprovalBindingHash } from '@arcp/workflow-core';

const base = {
  actionHash: 'sha256:action',
  authorityResolutionHash: 'sha256:authority',
  policyVersion: 3,
  resourceScope: ['resource:a#write', 'resource:b#read'],
  expiresAt: { instant_id: 'ctcl:instant:expiry' },
  requiredParties: ['entity:neo', 'entity:peer'],
};

describe('Phase 4 approval binding', () => {
  it('uses canonical structured binding independent of object insertion order', () => {
    const first = computeApprovalBindingHash(base);
    const reordered = computeApprovalBindingHash({
      requiredParties: ['entity:neo', 'entity:peer'],
      expiresAt: { instant_id: 'ctcl:instant:expiry' },
      resourceScope: ['resource:a#write', 'resource:b#read'],
      policyVersion: 3,
      authorityResolutionHash: 'sha256:authority',
      actionHash: 'sha256:action',
    });
    expect(first).toBe(reordered);
  });

  it.each([
    [{ ...base, actionHash: 'sha256:changed' }],
    [{ ...base, authorityResolutionHash: 'sha256:changed' }],
    [{ ...base, policyVersion: 4 }],
    [{ ...base, resourceScope: ['resource:a#write'] }],
    [{ ...base, expiresAt: { instant_id: 'ctcl:instant:later' } }],
    [{ ...base, requiredParties: ['entity:neo'] }],
  ])('changes when any bound authority/action dimension changes', (candidate) => {
    expect(computeApprovalBindingHash(candidate)).not.toBe(computeApprovalBindingHash(base));
  });
});
