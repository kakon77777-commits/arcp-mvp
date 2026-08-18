import { describe, expect, it } from 'vitest';
import {
  DeterministicModelAdapter,
  FakeModelAdapter,
} from '@arcp/adapter-model';
import type { ModelTurnInput } from '@arcp/workflow-core';

const input: ModelTurnInput = {
  agentId: 'arcp:agent:test',
  runId: 'run:1',
  turnIndex: 0,
  wake: {
    schema: 'arcp/wake/0.1', wake_id: 'wake:1', trigger_type: 'human', trigger_ref: 'human:test',
    required_authority: 'human:test', revalidate_on_wake: true, idempotency_key: 'wake:key:1',
  },
  context: { baseManifestVersion: null, contextHash: 'sha256:context', values: {} },
  priorReceipts: [],
  priorDenials: [],
  budgetView: {},
};

describe('Phase 4 model port', () => {
  it('deliberates asynchronously using structured proposals only', async () => {
    const model = new DeterministicModelAdapter([
      {
        actionIntents: [{
          action_id: 'action:1', actor: 'arcp:agent:test', intent: 'resource.read', target: 'resource:data',
          sensitivity: 'P0', risk: 'R0', reversibility: 'reversible', requested_scopes: ['read'],
          idempotency_key: 'action:key:1',
        }],
        usage: { inputTokens: 10, outputTokens: 5, costMicros: 20 },
      },
    ]);

    const proposal = await model.deliberate(input);
    expect(proposal.actionIntents).toHaveLength(1);
    expect(proposal.usage).toEqual({ inputTokens: 10, outputTokens: 5, costMicros: 20 });
    expect('executor' in model).toBe(false);
  });

  it('preserves Phase 0 synchronous FakeModelAdapter behavior', () => {
    const legacy = new FakeModelAdapter([{ actionIntents: [] }]);
    expect(legacy.nextTurn()).toEqual({ actionIntents: [] });
  });
});
