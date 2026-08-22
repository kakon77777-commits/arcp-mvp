import { describe, expect, it } from 'vitest';
import { DeterministicModelAdapter } from '@arcp/adapter-model';
import { evaluate } from '@arcp/policy-engine';
import type { PolicyInput, ResidenceManifest, RunBudgetSpec, WakeRecord } from '@arcp/schema';
import {
  BoundedRunOrchestrator,
  DEFAULT_BOUNDED_RUN_BUDGET,
  InMemoryRunStateStore,
  StaticActionAuthorityResolver,
  type ActionExecutorPort,
  type AuthorizedActionExecution,
  type CanonicalRunCommitInput,
  type CommitPort,
  type ContextHydratorPort,
  type PolicyPort,
  type ProvenanceClockPort,
  type RunBudgetProviderPort,
  type WakeAuthorityResolverPort,
} from '@arcp/workflow-core';
import { FakeMonotonicClock } from '../helpers/fake-clocks.js';

const agentId = 'arcp:agent:phase5-wall';

class SequenceProvenanceClock implements ProvenanceClockPort {
  private n = 0;
  now() {
    this.n += 1;
    return { instant_id: `local:unverified:wall:${this.n}`, unverified: true } as const;
  }
}

class FixedBudgetProvider implements RunBudgetProviderPort {
  constructor(private readonly spec: RunBudgetSpec) {}
  async resolveBudget(): Promise<RunBudgetSpec> { return structuredClone(this.spec); }
}

const hydrator: ContextHydratorPort = {
  async hydrate() {
    return { baseManifestVersion: null, contextHash: 'sha256:wall-context', values: {} };
  },
};
const policy: PolicyPort = {
  evaluate(input: PolicyInput, options = {}) {
    return evaluate(input, { hasValidApproval: options.hasValidApproval });
  },
};
const wakeAuthority: WakeAuthorityResolverPort = {
  async resolveWake({ wake }) {
    const authorized = wake.required_authority === 'human:neo.manual-run'
      || wake.required_authority.startsWith('approval-resume:');
    return { authorized, reason: authorized ? 'fixture' : 'denied' };
  },
};

function firstWake(): WakeRecord {
  return {
    schema: 'arcp/wake/0.1', wake_id: 'wake:wall:first', trigger_type: 'human', trigger_ref: 'human:neo',
    required_authority: 'human:neo.manual-run', revalidate_on_wake: true, idempotency_key: 'wake:key:wall:first',
  };
}

function advancingModel(clock: FakeMonotonicClock, advanceMs: number, step: ConstructorParameters<typeof DeterministicModelAdapter>[0][number]) {
  const model = new DeterministicModelAdapter([step]);
  const original = model.prepareCall.bind(model);
  model.prepareCall = async (input, limits) => {
    const prepared = await original(input, limits);
    return {
      execute: async () => {
        clock.advance(advanceMs);
        return prepared.execute();
      },
    };
  };
  return model;
}

class AdvancingExecutor implements ActionExecutorPort {
  constructor(private readonly clock: FakeMonotonicClock, private readonly advanceMs: number) {}
  descriptor() { return { executorId: 'executor:wall', idempotencyMode: 'provider-enforced' as const }; }
  async execute(_input: AuthorizedActionExecution) {
    this.clock.advance(this.advanceMs);
    return { status: 'succeeded' as const, resultHash: 'sha256:wall-effect' };
  }
  async reconcile() { return { status: 'confirmed-succeeded' as const, resultHash: 'sha256:wall-effect' }; }
}

class Committer implements CommitPort {
  async commit(input: CanonicalRunCommitInput): Promise<ResidenceManifest> {
    return {
      schema: 'arcp/residence-manifest/0.1', agent_id: input.run.agent_id, residence_id: 'residence:wall',
      manifest_version: 1, parents: [], event_cursor: 'event:wall', root_hash: 'sha256:wall',
      policy_version: 1, lease_fencing_token: input.fencingToken, status: 'active',
    };
  }
}

function baseBudget(maxWall: number): RunBudgetSpec {
  return {
    ...DEFAULT_BOUNDED_RUN_BUDGET,
    max_turns: 1,
    max_wall_time_ms: maxWall,
    max_model_input_tokens: 100,
    max_model_output_tokens: 50,
    max_model_cost_micros: 500,
    max_risk: 'R3',
  };
}

describe('Phase 5.0A active wall-time enforcement', () => {
  it('excludes persisted waiting time between approval advances', async () => {
    const store = new InMemoryRunStateStore();
    const clock = new FakeMonotonicClock(0);
    const model = advancingModel(clock, 100, {
      actionIntents: [{
        action_id: 'action:wall:approval', actor: agentId, intent: 'resource.write', target: 'resource:wall',
        sensitivity: 'P1', risk: 'R3', reversibility: 'reversible', requested_scopes: ['write'],
        idempotency_key: 'action:key:wall:approval', resource_refs: ['resource:wall'],
      }],
      stopReason: 'done-after-approval',
      usage: { inputTokens: 10, outputTokens: 5, costMicros: 20 },
    });
    const engine = new BoundedRunOrchestrator({
      store, hydrator, model, wakeAuthority,
      actionAuthority: new StaticActionAuthorityResolver({ grants: [{
        subjectEntityRef: agentId, resourceRef: 'resource:wall', scopes: ['write'],
        source: 'resource-owner-authorized', maxRisk: 'R3',
      }] }),
      policy, budgetProvider: new FixedBudgetProvider(baseBudget(1000)),
      executor: new AdvancingExecutor(clock, 200), commit: new Committer(),
      defaultApprovalParties: ['entity:neo'],
      provenanceClock: new SequenceProvenanceClock(), monotonicClock: clock,
    });

    const first = await engine.advance({ agentId, wake: firstWake(), fencingToken: 11 });
    expect(first.run.phase).toBe('waiting-approval');
    expect((await store.getBudgetView(first.run.run_id)).wall_time_ms.consumed).toBe(100);

    clock.advance(86_400_000);
    const request = await store.getApprovalRequest(first.pendingApprovalRequestId!);
    await store.appendApprovalGrant({
      schema: 'arcp/approval-grant/0.1', approval_grant_id: 'grant:wall',
      approval_request_id: request!.approval_request_id, approver_entity_ref: 'entity:neo',
      granted_scope: ['write'], granted_at: { instant_id: 'local:grant', unverified: true },
      idempotency_key: 'grant:key:wall',
    });
    const resumeWake: WakeRecord = {
      schema: 'arcp/wake/0.1', wake_id: 'wake:wall:resume', trigger_type: 'state',
      trigger_ref: request!.approval_request_id,
      required_authority: `approval-resume:${request!.approval_request_id}`,
      revalidate_on_wake: true, idempotency_key: 'wake:key:wall:resume',
    };
    const resumed = await engine.advance({ agentId, wake: resumeWake, fencingToken: 12, runId: first.run.run_id });
    expect(resumed.run.phase).toBe('completed');
    expect((await store.getBudgetView(first.run.run_id)).wall_time_ms.consumed).toBe(300);
  });

  it('uses monotonic elapsed time rather than provenance changes', async () => {
    const store = new InMemoryRunStateStore();
    const clock = new FakeMonotonicClock(0);
    const model = advancingModel(clock, 40, {
      actionIntents: [], stopReason: 'done', usage: { inputTokens: 1, outputTokens: 1, costMicros: 1 },
    });
    const engine = new BoundedRunOrchestrator({
      store, hydrator, model, wakeAuthority,
      actionAuthority: new StaticActionAuthorityResolver({ grants: [] }), policy,
      budgetProvider: new FixedBudgetProvider(baseBudget(100)),
      provenanceClock: new SequenceProvenanceClock(), monotonicClock: clock,
    });
    const result = await engine.advance({ agentId, wake: firstWake(), fencingToken: 20 });
    expect((await store.getBudgetView(result.run.run_id)).wall_time_ms.consumed).toBe(40);
  });

  it('records an overrun as a violation without releasing a fake remainder', async () => {
    const store = new InMemoryRunStateStore();
    const clock = new FakeMonotonicClock(0);
    const model = advancingModel(clock, 150, {
      actionIntents: [], stopReason: 'done', usage: { inputTokens: 1, outputTokens: 1, costMicros: 1 },
    });
    const engine = new BoundedRunOrchestrator({
      store, hydrator, model, wakeAuthority,
      actionAuthority: new StaticActionAuthorityResolver({ grants: [] }), policy,
      budgetProvider: new FixedBudgetProvider(baseBudget(100)),
      provenanceClock: new SequenceProvenanceClock(), monotonicClock: clock,
    });

    await expect(engine.advance({ agentId, wake: firstWake(), fencingToken: 21 }))
      .rejects.toMatchObject({ code: 'runtime_wall_time_exhausted' });
    const run = await store.getRun('arcp:run:0');
    void run;
    const allRunId = (await store.getActionReceipts('unused')).length;
    void allRunId;
    // The run id is deterministic from agent + wake idempotency key.
    const { deriveRunId } = await import('@arcp/workflow-core');
    const view = await store.getBudgetView(deriveRunId(agentId, firstWake().idempotency_key));
    expect(view.wall_time_ms).toMatchObject({ reserved: 0, consumed: 100, released: 0 });
    expect(model.executions).toBe(1);
  });
});
