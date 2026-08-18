import { describe, expect, it } from 'vitest';
import {
  evaluateContainment,
  reviewContainmentAt,
} from '@arcp/workflow-core';
import type { ContainmentRecord } from '@arcp/schema';

const active: ContainmentRecord = {
  schema: 'arcp/containment/0.1',
  containment_id: 'containment:1',
  agent_id: 'arcp:agent:test',
  scope: ['external-action:write', 'network:outbound'],
  reason: 'anomalous writes',
  authority_source: 'policy-authorized',
  entered_at: { instant_id: 'local:entered' },
  expires_at: { instant_id: 'local:expires', encoding: 'unix_ms', value: '2000' },
  review_required: true,
  review_after: { instant_id: 'local:review', encoding: 'unix_ms', value: '1500' },
  exit_conditions: ['manual-review'],
  status: 'active',
};

describe('Phase 4 containment', () => {
  it('blocks matching effect scopes but never mandatory effect evidence recording', () => {
    expect(evaluateContainment([active], 'external-action:write')).toMatchObject({ blocked: true });
    expect(evaluateContainment([active], 'record-effect-evidence')).toEqual({
      blocked: false,
      matchingContainmentIds: [],
      mandatoryEvidencePath: true,
    });
  });

  it('moves an unresolved containment to review-due instead of silently releasing it', () => {
    expect(reviewContainmentAt(active, 1600).status).toBe('review-due');
    expect(reviewContainmentAt(active, 2500).status).toBe('review-due');
  });

  it('leaves a containment active before its review boundary', () => {
    expect(reviewContainmentAt(active, 1200).status).toBe('active');
  });
});
