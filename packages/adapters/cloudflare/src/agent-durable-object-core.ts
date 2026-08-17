import { evaluate } from '@arcp/policy-engine';
import { sha256Hex } from '@arcp/schema';
import type { EventEnvelope, PolicyInput, ResidenceManifest, WakeRecord } from '@arcp/schema';
import type {
  AgentStatusSnapshot,
  CoordinatorControlPort,
  MetadataStorePort,
  WakeAcceptance,
} from '@arcp/control-plane-core';

/**
 * Deterministic from the wake's own idempotency_key (not a random ULID) so
 * that redelivering the same wake always resolves to the same event_id and
 * is caught by MetadataStorePort's own append-only duplicate detection —
 * that dedup check IS the idempotency ledger here, not a separate table.
 */
function wakeAcceptedEventId(agentId: string, idempotencyKey: string): string {
  const digest = sha256Hex(`wake.accepted::${agentId}::${idempotencyKey}`).toUpperCase();
  return `arcp:event:${digest.slice(0, 26)}`;
}

/**
 * Platform-neutral core of the per-Agent Durable Object (Task 5B). Scope is
 * intentionally narrow: wake acceptance is durably recorded and policy-
 * evaluated, but does not run a full Deliberating/Acting turn yet — no model
 * call exists until Phase 4 / Gate C. Accepted wakes therefore report
 * `committed_version: null` (pending, not yet a new manifest commit) per the
 * "queue acceptance is not a durable commit" constraint in the Phase 1 plan.
 * Full turn processing (§6.2's ten-step standard turn) lands in Phase 4 and
 * will extend this class rather than replace it.
 */
export class AgentDurableObjectCore implements CoordinatorControlPort {
  constructor(private readonly metadata: MetadataStorePort) {}

  async getManifest(agentId: string): Promise<ResidenceManifest | null> {
    return this.metadata.getManifest(agentId);
  }

  async getStatus(agentId: string): Promise<AgentStatusSnapshot | null> {
    const manifest = await this.metadata.getManifest(agentId);
    if (!manifest) return null;
    return {
      agent_id: manifest.agent_id,
      // Phase 1 does not yet track live turn state (Triggered/Acting/...) at
      // this layer; a committed manifest with no turn in flight is Dormant.
      state: 'Dormant',
      manifest_version: manifest.manifest_version,
      root_hash: manifest.root_hash,
    };
  }

  async acceptWake(agentId: string, wake: WakeRecord): Promise<WakeAcceptance> {
    const policyInput: PolicyInput = {
      actor: agentId,
      intent: 'wake.accept',
      target: agentId,
      sensitivity: 'P0',
      risk: 'R0',
      reversibility: 'reversible',
      requested_scopes: [],
      // Phase 1 does not yet issue a real per-turn lease at wake-acceptance
      // time (that begins with Phase 4's full turn processing); a fixed
      // valid placeholder keeps this policy check meaningful without
      // claiming a lease negotiation that doesn't exist yet.
      lease_fencing_token: 1,
      budget: { remaining: 1, unit: 'wake-accept' },
      policy_version: 1,
    };
    const decision = evaluate(policyInput);

    const wakeEvent: EventEnvelope = {
      schema: 'arcp/event/0.1',
      event_id: wakeAcceptedEventId(agentId, wake.idempotency_key),
      agent_id: agentId,
      event_type: 'wake.accepted',
      causal_parent: null,
      producer: 'coordinator',
      idempotency_key: wake.idempotency_key,
      payload_hash: `sha256:${sha256Hex(JSON.stringify(wake))}`,
      observed_at: { instant_id: `local:unverified:wake:${wake.idempotency_key}`, unverified: true },
      received_local_time: new Date().toISOString(),
    };

    const appendResult = await this.metadata.appendEvent(wakeEvent);
    return {
      status: appendResult.status === 'appended' ? 'accepted' : 'duplicate',
      policy_decision: decision.decision,
      committed_version: null,
    };
  }
}
