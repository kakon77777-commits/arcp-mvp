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

  it('requires every affected resource and requested scope to be explicitly covered', async () => {
    const resolver = new StaticActionAuthorityResolver({
      grants: [{
        subjectEntityRef: 'arcp:agent:test',
        resourceRef: 'resource:a',
        scopes: ['write'],
        source: 'resource-owner-authorized',
      }],
    });

    const result = await resolver.resolveAction({
      runId: 'run:multi-resource',
      action: action({
        resource_refs: ['resource:a', 'resource:b'],
        requested_scopes: ['write'],
        continuity_impact: 'none',
      }),
      actionHash: 'sha256:multi-resource',
    });

    expect(result.status).toBe('denied');
    expect(result.resource_scope).toEqual([]);
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
      grants: [
        {
          subjectEntityRef: 'arcp:agent:test',
          resourceRef: 'resource:sole-residence',
          scopes: ['delete'],
          source: 'multi-party-authorized',
          continuityPrecondition: 'separate-governance',
        },
        {
          subjectEntityRef: 'arcp:agent:test',
          resourceRef: 'residence:only',
          scopes: ['delete'],
          source: 'multi-party-authorized',
          continuityPrecondition: 'separate-governance',
        },
      ],
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

  it('denies an action when residence_refs names a Residence with no covering grant, even though resource_refs is fully covered', async () => {
    const resolver = new StaticActionAuthorityResolver({
      grants: [{
        subjectEntityRef: 'arcp:agent:test',
        resourceRef: 'resource:cache-volume',
        scopes: ['delete'],
        source: 'resource-owner-authorized',
      }],
    });

    const result = await resolver.resolveAction({
      runId: 'run:hidden-residence',
      action: action({
        target: 'resource:cache-volume',
        requested_scopes: ['delete'],
        resource_refs: ['resource:cache-volume'],
        residence_refs: ['residence:agent-x-sole'],
        continuity_impact: 'none',
      }),
      actionHash: 'sha256:hidden-residence',
    });

    expect(result.status).toBe('denied');
  });

  it('requires coverage for affected_entity_refs the same way as resource_refs', async () => {
    const resolver = new StaticActionAuthorityResolver({
      grants: [{
        subjectEntityRef: 'arcp:agent:test',
        resourceRef: 'resource:shared-doc',
        scopes: ['write'],
        source: 'resource-owner-authorized',
      }],
    });

    const result = await resolver.resolveAction({
      runId: 'run:affected-entity',
      action: action({
        target: 'resource:shared-doc',
        requested_scopes: ['write'],
        resource_refs: ['resource:shared-doc'],
        affected_entity_refs: ['arcp:agent:other'],
        continuity_impact: 'none',
      }),
      actionHash: 'sha256:affected-entity',
    });

    expect(result.status).toBe('denied');
  });
});
