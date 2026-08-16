import { computeRootHash } from '@arcp/schema';
import type { ActionIntent, EventEnvelope, ObjectVersion, ResidenceManifest, WakeRecord } from '@arcp/schema';
import { InMemoryResidenceStore } from './in-memory-store.js';
import { LeaseManager } from './lease.js';
import type { AgentState } from './state-machine.js';
import { assertLegalTransition } from './state-machine.js';

export class DuplicateActionError extends Error {
  constructor(public readonly idempotencyKey: string) {
    super(`duplicate action rejected: idempotency key '${idempotencyKey}' was already committed`);
    this.name = 'DuplicateActionError';
  }
}

export interface AgentTurnInput {
  wake: WakeRecord;
  events: EventEnvelope[];
  objectVersions: ObjectVersion[];
  actions: ActionIntent[];
  /** Injectable clock for deterministic tests; defaults to Date.now(). */
  now?: number;
}

export interface AgentCoordinatorOptions {
  agentId: string;
  residenceId: string;
  policyVersion?: number;
}

/**
 * Per-Agent coordinator per §3.2 and the standard turn in §6.2. Phase 0 keeps
 * everything in-memory and single-process — this is the same state machine
 * that Phase 1 wraps in a Durable Object, not a placeholder to throw away.
 */
export class AgentCoordinator {
  readonly agentId: string;
  readonly residenceId: string;
  readonly store = new InMemoryResidenceStore();
  readonly lease = new LeaseManager();
  policyVersion: number;
  state: AgentState = 'Dormant';

  constructor(options: AgentCoordinatorOptions) {
    this.agentId = options.agentId;
    this.residenceId = options.residenceId;
    this.policyVersion = options.policyVersion ?? 1;
  }

  private transition(to: AgentState): void {
    assertLegalTransition(this.state, to);
    this.state = to;
  }

  /**
   * Runs one standard turn (§6.2, steps 1-10). Returns the committed
   * manifest. A duplicate wake (by idempotency_key) short-circuits to the
   * already-committed manifest without doing any new work — this is what
   * makes redelivery of the same wake produce exactly one run.
   *
   * Commit data is fully prepared before the in-memory store is mutated. This
   * preserves the Phase 0 atomic-commit invariant and mirrors the CAS boundary
   * that Phase 1 will enforce in durable storage.
   */
  runTurn(input: AgentTurnInput): ResidenceManifest {
    if (this.store.isDuplicateWake(input.wake.idempotency_key)) {
      const latest = this.store.latestManifest();
      if (!latest) {
        throw new Error('duplicate wake received but no prior manifest has ever been committed');
      }
      return latest;
    }

    try {
      this.transition('Triggered');
      const lease = this.lease.acquire(this.agentId, 'residence:write', 60_000, input.now);
      this.transition('Hydrating');
      this.transition('Deliberating');
      this.transition('Acting');

      for (const action of input.actions) {
        if (this.store.isDuplicateAction(action.idempotency_key)) {
          throw new DuplicateActionError(action.idempotency_key);
        }
      }

      this.transition('Committing');

      // Prepare the complete next commit before mutating any durable state.
      const priorManifest = this.store.latestManifest();
      const eventCursor = input.events.at(-1)?.event_id ?? priorManifest?.event_cursor ?? 'arcp:event:genesis';
      const prospectiveObjectVersions = [...this.store.objectVersions, ...input.objectVersions];
      const rootHash = computeRootHash({
        objectVersions: prospectiveObjectVersions.map((v) => ({
          object_id: v.object_id,
          version: v.version,
          content_hash: v.content_hash,
        })),
        eventCursor,
        policyVersion: this.policyVersion,
        fencingToken: lease.fencing_token,
      });

      const priorVersion = priorManifest?.manifest_version ?? 0;
      const manifest: ResidenceManifest = {
        schema: 'arcp/residence-manifest/0.1',
        agent_id: this.agentId,
        residence_id: this.residenceId,
        manifest_version: priorVersion + 1,
        parents: priorManifest ? [`arcp:manifest-version:${priorManifest.manifest_version}`] : [],
        event_cursor: eventCursor,
        root_hash: rootHash,
        policy_version: this.policyVersion,
        lease_fencing_token: lease.fencing_token,
        status: 'active',
      };

      // Re-check ownership at the last safe point before the durable commit.
      // If another writer acquired a newer lease, the stale turn is fenced out.
      this.lease.assertValidFencingToken(lease.fencing_token);

      // The commit boundary starts here. All potentially failing preparation
      // above has completed without changing store-visible state.
      for (const action of input.actions) this.store.recordAction(action.idempotency_key);
      for (const event of input.events) this.store.addEvent(event);
      for (const version of input.objectVersions) this.store.addObjectVersion(version);
      this.store.recordWake(input.wake.idempotency_key);
      this.store.commitManifest(manifest);

      this.transition('Dormant');
      return manifest;
    } catch (error) {
      if (this.state === 'Acting' || this.state === 'Committing') {
        this.transition('Suspended');
      }
      throw error;
    }
  }
}
