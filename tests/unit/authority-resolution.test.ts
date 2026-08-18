import { describe, expect, it } from 'vitest';
import { StaticActionAuthorityResolver } from '@arcp/workflow-core';
import type { ActionIntent } from '@arcp/schema';

function action(overrides: Partial<ActionIntent> = {}): ActionIntent {
  return {
    action_id: 'action:test',
    actor: 'arcp:agent:test',
    intent: 'resource.write',
    target: 'resource:data',
    sensitivity: 'P1',
    risk: 'R1',
    reversibility: 'reversible',
    requested_scopes: ['write'],
    idempotency_key: 'action:key:test',
    ...overrides,
  };
}

describe('Phase 4 static action authority resolver', () => {
  it('keeps ordinary resource authority scoped to the resource', async () => {
    const resolver = new StaticActionAuthorityResolver({
      grants: [{
        subjectEntityRef: 'arcp:agent:test',
        resourceRef: 'resource:data',
        scopes: ['write'],
        source: 'resource-owner-authorized',
      }],
    });

    const result = await resolver.resolveAction({
      runId: 'run:1',
      action: action({ resource_refs: ['resource:data'], continuity_impact: 'none' }),
      actionHash: 'sha256:action',
    });

    expect(result.status).toBe('authorized');
    expect(result.sources).toContain('resource-owner-authorized');
    expect(result.resource_scope).toEqual(['resource:data#write']);
  });

  it('does not let ordinary resource ownership destroy a sole Residence', async () => {
    const resolver = new StaticActionAuthorityResolver({
      grants: [{
        subjectEntityRef: 'arcp:agent:test',
        resourceRef: 'resource:sole-residence',
        scopes: ['delete'],
        source: 'resource-owner-authorized',
      }],
    });

    const result = await resolver.resolveAction({
      runId: 'run:2',
      action: action({
        target: 'resource:sole-residence',
        requested_scopes: ['delete'],
        resource_refs: ['resource:sole-residence'],
        residence_refs: ['residence:only'],
        continuity_impact: 'continuity-destructive',
      }),
      actionHash: 'sha256:destructive',
    });

    expect(result.status).toBe('denied');
    expect(result.continuity_precondition).toBe('separate-governance');
  });

  it('permits an explicit separate-governance grant to satisfy the destructive guard', async () => {
    const resolver = new StaticActionAuthorityResolver({
      grants: [{
        subjectEntityRef: 'arcp:agent:test',
        resourceRef: 'resource:sole-residence',
        scopes: ['delete'],
        source: 'multi-party-authorized',
        continuityPrecondition: 'separate-governance',
      }],
    });

    const result = await resolver.resolveAction({
      runId: 'run:3',
      action: action({
        target: 'resource:sole-residence',
        requested_scopes: ['delete'],
        resource_refs: ['resource:sole-residence'],
        residence_refs: ['residence:only'],
        continuity_impact: 'continuity-destructive',
      }),
      actionHash: 'sha256:destructive-allowed',
    });

    expect(result.status).toBe('authorized');
    expect(result.sources).toContain('multi-party-authorized');
    expect(result.continuity_precondition).toBe('separate-governance');
  });
});
