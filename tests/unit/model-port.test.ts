import { describe, expect, it } from 'vitest';
import {
  DeterministicModelAdapter,
  FakeModelAdapter,
} from '@arcp/adapter-model';
import type { ModelCallLimits, ModelTurnInput } from '@arcp/workflow-core';

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

const limits: ModelCallLimits = {
  maxOutputTokens: 1000,
  maxInputTokens: 5000,
  maxCostMicros: 20_000,
  maxActiveDurationMs: 8000,
};

function scriptedModel() {
  return new DeterministicModelAdapter([
    {
      actionIntents: [{
        action_id: 'action:1', actor: 'arcp:agent:test', intent: 'resource.read', target: 'resource:data',
        sensitivity: 'P0', risk: 'R0', reversibility: 'reversible', requested_scopes: ['read'],
        idempotency_key: 'action:key:1',
      }],
      usage: { inputTokens: 10, outputTokens: 5, costMicros: 20 },
    },
  ]);
}

describe('Phase 4/5 staged model port', () => {
  it('preserves Phase 4 deliberate compatibility', async () => {
    const model = scriptedModel();
    const proposal = await model.deliberate(input);
    expect(proposal.actionIntents).toHaveLength(1);
    expect(proposal.usage).toEqual({ inputTokens: 10, outputTokens: 5, costMicros: 20 });
    expect('executor' in model).toBe(false);
  });

  it('prepares locally without consuming the provider step until execute', async () => {
    const model = scriptedModel();
    const prepared = await model.prepareCall!(input, limits);

    expect(model.preparations).toHaveLength(1);
    expect(model.preparations[0]?.limits).toEqual(limits);
    expect(model.executions).toBe(0);

    const proposal = await prepared.execute();
    expect(model.executions).toBe(1);
    expect(proposal.usage.outputTokens).toBe(5);
  });

  it('fails unsupported finite limits during zero-I/O preflight', async () => {
    const model = new DeterministicModelAdapter(
      [{ actionIntents: [], usage: { inputTokens: 1, outputTokens: 1, costMicros: 1 } }],
      { unsupportedLimits: ['maxCostMicros'] },
    );

    await expect(model.prepareCall!(input, limits)).rejects.toMatchObject({ code: 'model_limit_unsupported' });
    expect(model.preparations).toHaveLength(1);
    expect(model.executions).toBe(0);
  });

  it('preserves Phase 0 synchronous FakeModelAdapter behavior', () => {
    const legacy = new FakeModelAdapter([{ actionIntents: [] }]);
    expect(legacy.nextTurn()).toEqual({ actionIntents: [] });
  });
});
