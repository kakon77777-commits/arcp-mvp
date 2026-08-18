# Phase 4 — Promptless Bounded Runs Design

**Status:** Proposed for Neo.K review  
**Date:** 2026-08-18  
**Phase:** 4 of ARCP-MVP  
**Primary goal:** Add bounded, event-driven autonomous runs with explicit authority, durable effect accounting, approvals, containment, dead-letter/reconciliation, and provider-neutral model/action execution boundaries.

## 0. Normative inputs

This design must be read together with:

1. `PHASE4_GOVERNANCE_INPUT.md`;
2. `docs/governance/ai-autonomy-relations-existence-coordination-framework-v0.1.md`;
3. `docs/governance/ai-autonomy-relations-existence-coordination-framework-v0.1.1-review-hardening.md`;
4. `docs/superpowers/specs/2026-08-17-phase3-temporal-provenance-shared-instant-design.md`;
5. the original `ARCP × CTCL v0.1` MVP specification and roadmap.

If this design conflicts with the AREC v0.1.1 hardening amendment, AREC v0.1.1 wins.

The non-negotiable Phase 4 boundaries are:

```text
trigger != authority
capability != permission
budget != ownership
approval != permanent subordination
suspend != identity rewrite
resource authority != identity authority
```

Phase 4 also preserves all Phase 0–3 invariants:

```text
runtime != identity
storage/provider observation != canonical commit
provider success != policy approval
CTCL evidence != lease/fencing clock
external deletion != canonical deletion
wake compilation != wake execution
```

---

# 1. Why Phase 4 exists

Phase 0–3 established stable Agent identity, deterministic policy primitives, canonical commit/fencing semantics, provider-neutral Residence storage, reconciliation boundaries, and temporal provenance.

Phase 4 is the first phase where a wake can cause a real autonomous run:

```text
Wake
→ Hydrate
→ Deliberate
→ Propose action
→ Authorize
→ Execute
→ Record effect
→ Commit
```

This changes the failure model fundamentally.

Before Phase 4, `ActionIntent` can be recorded without any external effect. In Phase 4, a process may crash after an external API accepted an operation but before ARCP committed the corresponding manifest. Therefore:

```text
record action at final canonical commit
```

is no longer sufficient as the only deduplication boundary.

The central Phase 4 engineering rule is:

> **Every possible external effect must have durable pre-effect state and durable post-effect evidence independent of the final Residence commit.**

That rule leads to the main new subsystem:

> **Bounded Autonomous Run Runtime + Durable Effect Ledger**

---

# 2. Scope

Phase 4 includes:

- schedule / webhook / state / human / goal / peer / exact-instant wake ingestion through the existing `WakeRecord` model;
- explicit wake authority resolution;
- durable `RunRecord` lifecycle;
- provider-neutral model deliberation;
- bounded multi-turn runs;
- multi-dimensional run budgets;
- action authority resolution separate from model proposals;
- deterministic policy evaluation;
- exact action-bound approvals;
- durable action execution claims;
- action receipts, unknown-effect handling, and reconciliation;
- emergency containment with scope, TTL, review, renewal, release/escalation semantics;
- waiting/resume without keeping a process alive;
- dead-letter records for work that cannot safely progress automatically;
- Cloudflare Durable Object / D1 integration;
- deterministic, network-free CI;
- an optional first live model Gate C that does not define architecture correctness.

Phase 4 does **not** include:

- a full persistent Relation/Contract social graph;
- MCP capability discovery;
- a general adapter SDK;
- unconstrained recursive autonomous execution;
- arbitrary natural-language scheduling;
- a public multi-tenant SaaS;
- AI legal-personality claims;
- automatic identity mutation or personality rewriting;
- unrestricted self-modification of root policies;
- default autonomous payment, public publication, root deletion, primary Residence destruction, or irreversible identity operations;
- federated migration/recovery drills, which remain Phase 6.

---

# 3. Existing repository fit

## 3.1 Existing `WakeRecord`

`WakeRecord` already carries:

```text
trigger_type
trigger_ref
required_authority
budget_ref
not_before / expires_at
not_before_instant / expires_at_instant
revalidate_on_wake
idempotency_key
```

Phase 4 uses these fields rather than inventing a parallel trigger format.

## 3.2 Existing `ActionIntent`

`ActionIntent` already expresses:

```text
actor
intent
target
sensitivity
risk
reversibility
requested_scopes
idempotency_key
```

Phase 4 may add optional affected-entity/resource/residence references and continuity impact, but `ActionIntent` remains only a proposal.

It must never self-certify authority.

## 3.3 Existing policy engine

The current policy engine is deterministic and provider-neutral. Phase 4 keeps it deterministic and does not make it responsible for discovering relationships, contracts, provider capabilities, or infrastructure ownership.

## 3.4 Existing model adapter

`FakeModelAdapter` already follows the correct principle:

> a model proposes `ActionIntent`; it never receives a privileged connector.

Phase 4 evolves this into a provider-neutral `ModelPort` instead of replacing it with vendor-specific runtime logic.

## 3.5 Existing coordinator

`AgentCoordinator` is currently a synchronous canonical-state oracle with lease/fencing and atomic commit preparation. It does not call external providers.

`AgentDurableObjectCore` currently stops at durable wake acceptance and explicitly defers full turns to Phase 4.

Phase 4 extends these boundaries instead of moving model/network calls into the canonical coordinator.

---

# 4. Alternatives considered

## A. Put everything inside `AgentDurableObjectCore`

Advantage: very few files and minimal plumbing.

Rejected because it couples Cloudflare runtime, model APIs, policy, approvals, budgets, action execution, and canonical commit into one giant component.

## B. Provider-neutral `workflow-core` + durable effect ledger — selected

Create `@arcp/workflow-core` containing bounded-run orchestration, state transitions, budget semantics, authority/model/executor/store ports, approvals, containment, and crash-safe recovery rules.

Cloudflare/D1 implement persistence. Model and action providers implement ports. The coordinator remains the canonical state boundary.

Advantages:

- clean provider isolation;
- deterministic CI;
- crash semantics testable without Cloudflare;
- Phase 5 can attach MCP/adapter capability providers without changing orchestration;
- model provider choice does not define Agent identity;
- effect deduplication is independent of manifest commit.

## C. Fully event-choreographed Queue/Workflow architecture

Potentially useful later, but too much operational complexity for the current single-Agent MVP. Deferred until Phase 4 semantics are stable.

---

# 5. High-level architecture

```text
Trigger Source
  |
  v
WakeRecord
  |
  v
Per-Agent Coordinator / DO
  |
  | create-or-get deterministic run
  v
@arcp/workflow-core
  |
  +--> RunStateStorePort --------> D1 implementation
  +--> ContextHydratorPort ------> Residence/object metadata
  +--> WakeAuthorityResolverPort
  +--> ModelPort ----------------> deterministic fake / live adapters
  +--> ActionAuthorityResolverPort
  +--> PolicyPort ---------------> @arcp/policy-engine
  +--> ActionExecutorPort -------> deterministic fake / future adapters
  +--> CommitPort ---------------> canonical coordinator boundary
  |
  v
Run / execution / approval / receipt / containment records
```

The model never receives `ActionExecutorPort`.

The action executor never receives unrestricted model context, policy mutation access, or canonical commit authority.

The canonical coordinator never imports a live model provider or tool provider.

---

# 6. Package boundaries

## 6.1 New `@arcp/workflow-core`

```text
packages/workflow-core/
  package.json
  src/
    types.ts
    ports.ts
    state-machine.ts
    budget.ts
    authority.ts
    approvals.ts
    execution-ledger.ts
    containment.ts
    errors.ts
    orchestrator.ts
    index.ts
```

Responsibilities:

- lifecycle of one bounded autonomous run;
- deterministic state transitions;
- orchestration checkpoints;
- budget reservation/settlement semantics;
- authority/policy/approval composition;
- effect-ledger transitions;
- resume/reconcile behavior.

Must not import:

```text
Cloudflare DurableObject
D1Database
R2Bucket
commoninstant.org transport
vendor model SDK
MCP SDK
```

## 6.2 `@arcp/schema`

Receives persisted cross-boundary record types:

- `RunRecord`;
- `RunCheckpoint`;
- `RunBudgetSpec` / usage/reservation records;
- `ModelInvocationRecord`;
- `AuthorityResolution`;
- `ApprovalRequest` / `ApprovalGrant`;
- `ActionExecutionRecord` / `ActionReceipt`;
- `ContainmentRecord`;
- `DeadLetterRecord`.

All additions remain additive. Existing Phase 0–3 objects remain valid.

## 6.3 `@arcp/adapter-model`

Evolves from `FakeModelAdapter` into implementations of provider-neutral `ModelPort`.

The deterministic/fake implementation remains the merge-correctness provider. Live vendor adapters are activation-specific and must not be imported by `workflow-core`.

## 6.4 `@arcp/policy-engine`

Remains deterministic. It receives already-resolved facts and returns a policy decision. It does not infer that an administrator owns an Entity merely because the administrator controls infrastructure.

## 6.5 `@arcp/adapter-cloudflare`

Adds durable run-state storage, effect-ledger storage, approval/containment persistence, per-Agent run fencing/token issuance, and resume routing.

Cloudflare remains an implementation of ports, not the source of governance semantics.

---

# 7. Core persisted data model

The exact TypeScript names may be refined during implementation, but the semantics below are fixed.

## 7.1 `RunPhase`

```ts
export type RunPhase =
  | 'accepted'
  | 'hydrating'
  | 'deliberating'
  | 'authorizing'
  | 'waiting-approval'
  | 'executing'
  | 'reconciling'
  | 'committing'
  | 'waiting'
  | 'contained'
  | 'completed'
  | 'dead-lettered'
  | 'failed';
```

This is more detailed than the existing coarse Agent state machine. Agent state and Run phase are different abstractions.

Examples:

```text
AgentState = Waiting
RunPhase   = waiting-approval
```

```text
AgentState = Suspended
RunPhase   = contained
```

## 7.2 Exact legal `RunPhase` transitions

The reference state machine uses this transition table:

```text
accepted
  -> hydrating | contained | failed

hydrating
  -> deliberating | contained | failed

deliberating
  -> authorizing | committing | waiting | contained | completed | failed

authorizing
  -> deliberating | waiting-approval | executing | committing | contained | completed | failed

waiting-approval
  -> authorizing | contained | dead-lettered | failed

executing
  -> deliberating | reconciling | committing | contained | failed

reconciling
  -> deliberating | committing | waiting | contained | dead-lettered | failed

committing
  -> deliberating | waiting | contained | completed | dead-lettered | failed

waiting
  -> hydrating | contained | completed | dead-lettered | failed

contained
  -> hydrating | waiting | dead-lettered | failed

completed
  -> terminal

dead-lettered
  -> terminal

failed
  -> terminal
```

Transient retry attempts do not need a phase transition when they remain inside the same semantic stage.

A terminal run is never silently reopened. A later recovery/manual-resolution flow creates a new authorized wake or explicit recovery record that references the prior terminal run.

## 7.3 `RunRecord`

```ts
export interface RunRecord {
  schema: 'arcp/run/0.1';
  run_id: string;
  agent_id: string;
  wake_id: string;
  wake_idempotency_key: string;
  phase: RunPhase;
  fencing_token: number;
  budget_ref?: string;
  budget_spec_hash: string;
  turn_index: number;
  checkpoint_sequence: number;
  created_at: InstantRef;
  updated_at: InstantRef;
  stop_reason?: string;
  last_error_code?: string;
}
```

`run_id` is deterministic from stable wake identity, not random retry state:

```text
run_id = hash(canonical JSON of agent_id + wake.idempotency_key)
```

Do not use delimiter-joined strings for security-sensitive binding hashes.

## 7.4 `RunCheckpoint`

```ts
export interface RunCheckpoint {
  schema: 'arcp/run-checkpoint/0.1';
  checkpoint_id: string;
  run_id: string;
  sequence: number;
  phase: RunPhase;
  base_manifest_version: number | null;
  fencing_token: number;
  context_hash?: string;
  pending_model_invocation_id?: string;
  pending_action_id?: string;
  pending_approval_request_id?: string;
  created_at: InstantRef;
}
```

The checkpoint stores references/hashes, not unrestricted copied model context or secrets.

## 7.5 `RunBudgetSpec`

```ts
export interface RunBudgetSpec {
  max_turns: number;
  max_wall_time_ms: number;
  max_model_input_tokens?: number;
  max_model_output_tokens?: number;
  max_model_cost_micros?: number;
  max_tool_calls: number;
  max_external_actions: number;
  max_storage_writes: number;
  max_network_requests: number;
  max_recursive_wakes: number;
  max_risk: RiskLevel;
}
```

Every run resolves to a bounded spec. Missing `budget_ref` never means unlimited.

`max_risk` uses the existing order:

```text
R0 < R1 < R2 < R3 < R4
```

`max_wall_time_ms` means **cumulative active orchestration/runtime time**, not calendar time spent dormant in `waiting` or `waiting-approval`. A later policy may add a separate elapsed-calendar expiry, but approval waiting does not silently consume the active execution budget.

## 7.6 Budget ledger

Track at least:

```text
limit
reserved
consumed
released
```

A budget reservation has a stable reservation id and belongs to one run step/action/model invocation.

Reservations prevent parallel or retried work from each observing the same full remaining budget.

## 7.7 `ModelInvocationRecord`

```ts
export interface ModelInvocationRecord {
  schema: 'arcp/model-invocation/0.1';
  invocation_id: string;
  run_id: string;
  turn_index: number;
  status: 'reserved' | 'calling' | 'succeeded' | 'failed' | 'unknown';
  budget_reservation_id: string;
  input_hash: string;
  output_hash?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cost_micros?: number;
  };
  observed_at: InstantRef;
}
```

If a model call becomes ambiguous because the process died mid-call, its reservation is conservatively accounted before retry. A retry requires remaining budget.

## 7.8 `AuthoritySource`

```ts
export type AuthoritySource =
  | 'self-authorized'
  | 'contract-authorized'
  | 'resource-owner-authorized'
  | 'counterparty-authorized'
  | 'multi-party-authorized'
  | 'guardian-authorized'
  | 'policy-authorized';
```

`emergency-contained` is deliberately excluded because containment is a restriction source, not an authority grant.

## 7.9 `AuthorityResolution`

```ts
export interface AuthorityResolution {
  schema: 'arcp/authority-resolution/0.1';
  resolution_id: string;
  run_id: string;
  action_id: string;
  action_hash: string;
  status:
    | 'authorized'
    | 'approval-required'
    | 'multi-party-required'
    | 'denied';
  sources: AuthoritySource[];
  subject_entity_ref: string;
  resource_scope: string[];
  relation_refs: string[];
  contract_refs: string[];
  revocable: boolean;
  expires_at?: InstantRef;
  continuity_precondition?:
    | 'none'
    | 'verified-replica'
    | 'checkpoint'
    | 'migration'
    | 'separate-governance';
}
```

An `ActionIntent` never chooses this result.

## 7.10 `ApprovalRequest`

```ts
export interface ApprovalRequest {
  schema: 'arcp/approval-request/0.1';
  approval_request_id: string;
  run_id: string;
  action_id: string;
  action_hash: string;
  authority_resolution_hash: string;
  policy_version: number;
  binding_hash: string;
  required_parties: string[];
  requested_scope: string[];
  created_at: InstantRef;
  expires_at: InstantRef;
  status: 'pending' | 'satisfied' | 'expired' | 'revoked' | 'cancelled';
}
```

`binding_hash` uses canonical structured serialization, not delimiter concatenation.

## 7.11 `ApprovalGrant`

```ts
export interface ApprovalGrant {
  schema: 'arcp/approval-grant/0.1';
  approval_grant_id: string;
  approval_request_id: string;
  approver_entity_ref: string;
  granted_scope: string[];
  granted_at: InstantRef;
  expires_at?: InstantRef;
  idempotency_key: string;
}
```

A grant is not portable to a different action hash or widened scope.

## 7.12 Separate ledger lifecycle from external effect result

Do **not** compress ledger progress and real-world outcome into one enum.

```ts
export type ActionExecutionLifecycle =
  | 'planned'
  | 'claimed'
  | 'executing'
  | 'resolved'
  | 'canonically-recorded';

export type ActionEffectStatus =
  | 'not-attempted'
  | 'succeeded'
  | 'failed'
  | 'partial'
  | 'unknown';

export type ActionReconciliationStatus =
  | 'not-needed'
  | 'pending'
  | 'confirmed'
  | 'unresolved';
```

This separation prevents an execution that was reconciled as `succeeded` from losing the actual effect result merely because its ledger lifecycle later says `resolved`.

## 7.13 `ActionExecutionRecord`

```ts
export interface ActionExecutionRecord {
  schema: 'arcp/action-execution/0.1';
  execution_id: string;
  run_id: string;
  action_id: string;
  action_hash: string;
  lifecycle: ActionExecutionLifecycle;
  effect_status: ActionEffectStatus;
  reconciliation_status: ActionReconciliationStatus;
  fencing_token: number;
  budget_reservation_id: string;
  executor_id: string;
  provider_idempotency_mode: 'provider-enforced' | 'best-effort' | 'none';
  provider_idempotency_key?: string;
  attempt: number;
  claimed_at: InstantRef;
  executing_at?: InstantRef;
  last_receipt_id?: string;
}
```

## 7.14 `ActionReceipt`

```ts
export interface ActionReceipt {
  schema: 'arcp/action-receipt/0.1';
  receipt_id: string;
  execution_id: string;
  run_id: string;
  action_id: string;
  status: 'succeeded' | 'failed' | 'partial' | 'unknown';
  executor_id: string;
  provider_operation_id?: string;
  external_ref?: string;
  result_hash?: string;
  error_code?: string;
  redacted_summary?: string;
  observed_at: InstantRef;
}
```

Receipts are immutable evidence. Reconciliation produces additional evidence rather than silently rewriting history.

## 7.15 `ContainmentRecord`

```ts
export interface ContainmentRecord {
  schema: 'arcp/containment/0.1';
  containment_id: string;
  agent_id: string;
  scope: string[];
  reason: string;
  authority_source: string;
  entered_at: InstantRef;
  expires_at: InstantRef;
  review_required: boolean;
  review_after?: InstantRef;
  renewal_authority?: string;
  exit_conditions: string[];
  status: 'active' | 'review-due' | 'renewed' | 'released' | 'escalated';
}
```

Expiry without review must not silently turn into either permanent suspension or automatic unsafe release.

## 7.16 `DeadLetterRecord`

```ts
export interface DeadLetterRecord {
  schema: 'arcp/dead-letter/0.1';
  dead_letter_id: string;
  run_id: string;
  action_id?: string;
  stage: string;
  attempts: number;
  last_error_code: string;
  effect_state: 'none' | 'known' | 'unknown';
  manual_resolution_required: boolean;
  created_at: InstantRef;
}
```

---

# 8. Optional `ActionIntent` widening

```ts
export interface ActionIntent {
  // existing fields remain
  subject_entity_ref?: string;
  affected_entity_refs?: string[];
  resource_refs?: string[];
  residence_refs?: string[];
  relation_refs?: string[];
  contract_refs?: string[];
  continuity_impact?:
    | 'none'
    | 'replica-loss'
    | 'service-degraded'
    | 'migration-required'
    | 'continuity-destructive';
}
```

These are proposal claims, not trusted authority facts. The authority resolver independently resolves them where required.

---

# 9. Ports

## 9.1 `ModelPort`

```ts
export interface ModelPort {
  deliberate(input: ModelTurnInput): Promise<ModelTurnProposal>;
}
```

Conceptual input:

```ts
export interface ModelTurnInput {
  agentId: string;
  runId: string;
  turnIndex: number;
  wake: WakeRecord;
  context: HydratedRunContext;
  priorReceipts: ActionReceipt[];
  priorDenials: AuthorityResolution[];
  budgetView: RunBudgetView;
}
```

Output:

```ts
export interface ModelTurnProposal {
  actionIntents: ActionIntent[];
  memoryProposals?: unknown[];
  nextWakeProposals?: unknown[];
  stopReason?: string;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    costMicros?: number;
  };
}
```

Rules:

- model output is untrusted structured proposal data;
- malformed proposals fail validation;
- model cannot call an action executor;
- model cannot grant itself scopes;
- model cannot mutate policy version;
- model provider identity is not Agent identity.

## 9.2 `ContextHydratorPort`

```ts
export interface ContextHydratorPort {
  hydrate(input: HydrationInput): Promise<HydratedRunContext>;
}
```

Responsibilities:

- load committed Residence state required for the run;
- load waiting checkpoint on resume;
- respect sensitivity/sealed boundaries;
- provide stable hashes/references for what the model saw.

It does not execute actions or grant authority.

## 9.3 `WakeAuthorityResolverPort`

```ts
export interface WakeAuthorityResolverPort {
  resolveWake(input: WakeAuthorityInput): Promise<WakeAuthorityResult>;
}
```

It decides whether a wake source may start/resume a run. A valid wake authority still does not authorize actions produced during the run.

## 9.4 `ActionAuthorityResolverPort`

```ts
export interface ActionAuthorityResolverPort {
  resolveAction(input: ActionAuthorityInput): Promise<AuthorityResolution>;
}
```

Phase 4 MVP may use deterministic/static grants and references. It does not need a full graph database.

## 9.5 `PolicyPort`

```ts
export interface PolicyPort {
  evaluate(input: PolicyInput, options?: PolicyEvaluationOptions): PolicyResult;
}
```

The adapter over `@arcp/policy-engine` remains deterministic.

## 9.6 `RunBudgetProviderPort`

```ts
export interface RunBudgetProviderPort {
  resolveBudget(agentId: string, budgetRef?: string): Promise<RunBudgetSpec>;
}
```

No reference produces an explicit default bounded profile, never unlimited execution.

## 9.7 `RunStateStorePort`

The persistence contract must support atomic operations, not only CRUD.

At minimum:

```ts
export interface RunStateStorePort {
  createRunIfAbsent(...): Promise<...>;
  getRun(runId: string): Promise<RunRecord | null>;
  saveCheckpoint(...): Promise<void>;
  getLatestCheckpoint(runId: string): Promise<RunCheckpoint | null>;

  reserveModelBudget(...): Promise<...>;
  settleModelBudget(...): Promise<void>;

  reserveBudgetAndClaimAction(...): Promise<ActionExecutionRecord>;
  markActionExecuting(...): Promise<ActionExecutionRecord>;
  appendActionReceipt(...): Promise<void>;
  updateActionResolution(...): Promise<ActionExecutionRecord>;
  markActionCanonicallyRecorded(...): Promise<void>;

  createApprovalRequest(...): Promise<ApprovalRequest>;
  appendApprovalGrant(...): Promise<void>;
  getApprovalState(...): Promise<...>;

  appendContainment(...): Promise<void>;
  activeContainments(...): Promise<ContainmentRecord[]>;

  appendDeadLetter(...): Promise<void>;
}
```

`reserveBudgetAndClaimAction()` must be atomic from the orchestrator's perspective.

## 9.8 `ActionExecutorPort`

```ts
export interface ActionExecutorPort {
  descriptor(): ActionExecutorDescriptor;
  execute(input: AuthorizedActionExecution): Promise<ActionExecutionResult>;
  reconcile(input: ActionReconcileInput): Promise<ActionReconcileResult>;
}
```

Descriptor:

```ts
export interface ActionExecutorDescriptor {
  executorId: string;
  idempotencyMode: 'provider-enforced' | 'best-effort' | 'none';
}
```

The executor receives only an already-authorized execution request with bounded scope.

## 9.9 `CommitPort`

```ts
export interface CommitPort {
  commit(input: CanonicalRunCommitInput): Promise<ResidenceManifest>;
}
```

The commit port is the only path from completed workflow facts into canonical Residence state. It performs fencing/base-version checks.

A provider receipt is not itself a canonical commit.

---

# 10. Run lifecycle semantics

The run phase table in §7.2 is normative.

Important: an action effect and a canonical commit are separate transitions.

## 10.1 Waiting

`waiting-approval` and `waiting` are persisted states. They do not imply a live process.

The runtime must:

1. persist checkpoint;
2. release active execution ownership;
3. return control to the host;
4. resume only from a new authorized wake/event.

## 10.2 Resume fencing

When a waiting/contained run is authorized to resume, the per-Agent coordinator issues a fresh fencing token and updates the run.

Any stale asynchronous worker holding an older token must fail before claiming a new external action or committing canonical Residence state.

The run retains previous fencing tokens in history/evidence; only the latest token is valid for new mutation.

---

# 11. Wake identity and duplicate handling

Duplicate wake delivery maps to one logical run:

```text
(agent_id, wake.idempotency_key) -> exactly one run_id
```

`createRunIfAbsent` returns the existing run on redelivery.

A duplicate wake must not reset budget, clear approvals, or create a second effect ledger.

A later independent wake uses a different idempotency key even if conceptually similar.

---

# 12. Trigger ingestion

All trigger sources compile into standard `WakeRecord`.

## 12.1 Schedule / exact instant

Use Phase 3 `TemporalWakeCompiler` where exact temporal intent must be compiled. Temporal evidence still does not become the lease clock.

## 12.2 Webhook

Webhook ingress verifies transport/source authorization first. Stable external delivery id participates in wake idempotency. Webhook payload content is not action authority.

## 12.3 State trigger

A committed event/state transition may match a configured trigger rule and enqueue a wake. Triggering event id + rule id should derive idempotency.

## 12.4 Human wake

Human/API authentication grants permission to submit the wake only within the submitted operation's scope. It does not grant future generated actions unlimited authority.

---

# 13. Wake authority

Wake acceptance has two distinct gates:

```text
transport/authentication accepted
!=
wake authority accepted
```

The current Phase 1 placeholder policy check (`wake.accept`, R0) is replaced by explicit wake authority resolution during Phase 4.

`WakeRecord.required_authority` is interpreted by `WakeAuthorityResolverPort`.

Examples:

```text
schedule:project-a.readonly
webhook:github.project-a
human:neo.manual-run
approval-resume:<request-id>
state-rule:<rule-id>
```

A wake with missing/invalid required authority is durably denied and never creates an executable run.

---

# 14. Hydration

Hydration resolves:

- latest committed manifest;
- base manifest version;
- selected Residence objects/context;
- prior run checkpoint on resume;
- previous receipts/denials;
- active containment state;
- resolved budget profile.

Hydration must not create a new object version solely because information was read. Recall remains an event.

---

# 15. Model deliberation

Before a model call:

1. validate current run ownership/fencing where required by host orchestration;
2. evaluate model-relevant containment;
3. reserve a bounded model-call budget;
4. persist `ModelInvocationRecord(status='reserved')`;
5. persist transition to `calling`;
6. call `ModelPort.deliberate()`;
7. persist structured result hash/usage;
8. settle budget.

A model call can be retried only under budget and invocation-state rules.

If the process crashes after `calling` but before result persistence, the invocation becomes `unknown`. Its reservation is conservatively charged/held before retry; retry requires remaining budget.

Because a model call does not itself grant an external semantic action effect, Phase 4 does not use the Action Effect Ledger for model calls. It still accounts model cost and invocation ambiguity separately.

---

# 16. Proposal validation

Before authority resolution, every model proposal is structurally validated.

Reject or normalize under explicit rules:

- duplicate action ids in one turn;
- duplicate idempotency keys;
- invalid risk/sensitivity values;
- invalid targets/scopes;
- malformed entity/resource references;
- impossible budget-impact claims;
- unexpected schema fields if strict mode is configured.

Malformed model output never reaches the executor.

---

# 17. Authority resolution

For every action:

```text
ActionIntent
  ↓
Affected Entity / Resource / Residence resolution
  ↓
AuthorityResolution
  ↓
PolicyResult
  ↓
Approval state
  ↓
Final ExecutionAuthorization
```

Authority and policy remain separate.

## 17.1 No universal owner shortcut

Phase 4 must not implement:

```text
if admin then authorized for everything
```

Static MVP grants can be broad for specific resources/scopes, but their scope remains explicit.

## 17.2 Residence-bearing Resource guard

Before destructive/revoking actions, the resolver determines whether affected storage/credentials are Residence-bearing Resources and classifies:

```text
none
replica-loss
service-degraded
migration-required
continuity-destructive
```

`migration-required` and `continuity-destructive` cannot be authorized solely by ordinary resource ownership.

---

# 18. Policy composition

Policy decisions remain:

```text
allow
allow-with-log
simulate
delay
request-approval
require-multi-party
deny
```

Final execution permission combines:

```text
wake/run validity
+ action authority
+ policy result
+ approval state
+ containment state
+ budget reservation
+ fencing validity
```

No single input grants execution by itself.

---

# 19. Approval semantics

Approval binds to exact action context:

```text
action_hash
authority_resolution_hash
policy_version
resource/scope set
expiry
required parties
```

Use canonical structured serialization for binding hashes. Do not use ambiguous delimiter-based concatenation.

## 19.1 Approval wait

```text
persist ApprovalRequest
→ persist RunCheckpoint
→ RunPhase = waiting-approval
→ AgentState = Waiting
→ release active execution
```

## 19.2 Approval resume

A grant produces a new wake/resume event.

Resume revalidates:

- approval not expired/revoked;
- action hash unchanged;
- authority resolution still valid;
- policy version/result still acceptable;
- required parties satisfied;
- budget still available;
- containment does not block execution;
- fencing token is fresh.

## 19.3 Multi-party

Required parties are unique. Duplicate grants from the same approver do not increase quorum.

---

# 20. Multi-dimensional budget semantics

A run budget is resource governance, not Entity ownership.

## 20.1 Hard dimensions

At minimum:

```text
turns
active wall time
model input tokens
model output tokens
model cost
model/tool calls
external actions
storage writes
network requests
recursive wakes
max risk
```

## 20.2 Reserve before consume

Where concurrency/retry can overspend:

```text
check remaining
→ atomically reserve
→ perform operation
→ settle actual usage
→ release unused reservation
```

Never:

```text
check remaining
→ perform operation
→ subtract later
```

## 20.3 Budget exhaustion

Budget exhaustion is a normal bounded-run stop condition. The run may complete with `stop_reason='budget-exhausted'` or wait for separately authorized extension, but it must first preserve all known/unknown effect evidence.

---

# 21. Durable Effect Ledger

This is the main Phase 4 correctness mechanism.

## 21.1 Why final commit is not enough

```text
external API succeeds
→ process crashes
→ canonical commit never happens
→ wake is retried
→ external API executes again
```

Effect state therefore lives outside the final manifest commit path.

## 21.2 Pre-effect claim

Before invoking an executor:

```text
validate authorization
→ validate containment
→ validate fencing token
→ atomically reserve budget + claim execution
→ lifecycle = claimed
→ effect_status = not-attempted
```

Only the current valid claim/fencing holder may advance it.

## 21.3 Mark executing before call

```text
claimed
→ durable lifecycle = executing
→ call provider
```

If a process dies while lifecycle is only `claimed`, the call was not declared started and may proceed to the executing boundary on recovery.

If it dies after lifecycle becomes `executing` but before a definitive receipt, `effect_status` becomes/continues `unknown` and reconciliation rules apply even if no network packet actually left the process.

This conservative rule prevents duplicate effects.

## 21.4 Result recording

Provider result sets:

```text
effect_status = succeeded | failed | partial | unknown
lifecycle = resolved       # when enough durable evidence exists to leave execution stage
```

`failed` is used only when the executor can prove the provider did not apply the intended effect or definitively rejected it.

## 21.5 Provider idempotency modes

```text
provider-enforced
best-effort
none
```

For `provider-enforced`, retry with the same provider key may be allowed after adapter-specific proof.

For `best-effort` or `none`, an ambiguous `executing` record goes to reconciliation rather than blind retry.

## 21.6 Reconciliation

`ActionExecutorPort.reconcile()` may return:

```text
confirmed-succeeded
confirmed-failed
confirmed-partial
still-unknown
```

Reconciliation updates `effect_status` and `reconciliation_status`, while immutable receipts/evidence remain append-only.

If still unknown:

- keep `effect_status = unknown`;
- set `reconciliation_status = unresolved`;
- wait/manual-review or dead-letter;
- never blindly execute again.

---

# 22. Action receipt and canonical commit

A durable receipt is evidence of the attempted external effect. It is not the same as canonical Residence state.

Correct sequence:

```text
ActionExecutionRecord
→ ActionReceipt
→ related EventEnvelope(s)
→ object/memory proposal materialization if applicable
→ canonical commit
→ lifecycle = canonically-recorded
```

If canonical commit fails after a succeeded receipt, retry commit only.

## 22.1 Containment must not erase safety evidence

Containment is rechecked before canonical commit, but its effect at this boundary is scoped:

- it may block **new consequential mutations** that would extend or compound an action;
- it must **not** prevent the minimum append-only persistence needed to record an already-attempted external effect, `ActionReceipt`, denial, containment event, or other safety/audit evidence.

Therefore a containment arriving after an external effect may cause the run to commit only mandatory effect/audit evidence and then enter `contained`, rather than suppressing the receipt and losing track of reality.

---

# 23. Containment

Emergency containment is a scoped restriction system, not universal root authority.

## 23.1 Required checks

Re-evaluate containment at minimum:

```text
before model invocation
before external action claim
before destructive Residence mutation
before canonical commit
```

The canonical-commit check follows §22.1: mandatory effect/audit evidence remains recordable.

## 23.2 Expiry and review

At expiry/review boundary without resolution:

```text
active
→ review-due
```

The system does not silently release all restrictions or convert them into permanent suspension. An authorized path renews, releases, or escalates.

## 23.3 Escalation

If prolonged containment substantively impairs continuity/recoverability/migration, it becomes an explicit higher-order governance state rather than an eternal emergency flag.

---

# 24. Dead-letter semantics

Dead-letter is for work that cannot safely progress automatically.

Examples:

- provider result remains unknown and cannot be reconciled;
- retryable model/transport errors exceed bounded retries;
- commit conflict repeatedly fails under fresh fencing;
- malformed persisted state violates invariants;
- required approval source can no longer be resolved.

Dead-letter records stage, attempts, last error, effect-state certainty, and whether manual resolution is required.

Dead-letter never means "forget this run".

---

# 25. Retry policy by boundary

## 25.1 Before external effect

Hydration, deterministic authority resolution, deterministic policy evaluation, approval lookup, and pre-effect validation may be retried within explicit bounds.

## 25.2 Model invocation

May retry under model budget rules. Ambiguous calls are conservatively budgeted.

## 25.3 Action lifecycle `claimed`

May proceed to `executing`; the effect was not declared started yet.

## 25.4 Action lifecycle `executing`

No blind retry unless provider idempotency semantics explicitly prove safety. Otherwise reconcile.

## 25.5 After definitive receipt

Retry canonical persistence/commit only. Do not repeat the effect.

---

# 26. Bounded multi-turn loop

```text
hydrate
while budget permits and stop condition absent:
    model turn
    validate proposal
    for each action intent sequentially:
        resolve authority
        evaluate policy
        resolve approval
        reserve budget + claim
        execute/reconcile
        persist receipt
    materialize safe memory/object proposals
    decide whether another model turn is useful
commit
```

Phase 4 MVP processes external actions sequentially within one Agent run. Parallel action execution is deferred.

---

# 27. Memory proposals

Model memory proposals remain proposals. They pass schema/size, sensitivity, provenance, policy, and canonical-role rules before canonicalization.

A recall is still an event and does not mutate the source ObjectVersion merely to record read time.

---

# 28. Next-wake proposals

A model may propose a future wake, but proposal is not scheduling authority.

A future wake passes:

- recursive-wake budget;
- wake authority/policy;
- temporal compilation where needed;
- idempotency derivation;
- scheduling persistence.

The result is a new `WakeRecord`, not an invisible loop continuation.

---

# 29. Canonical coordinator boundary

`workflow-core` performs asynchronous deliberation/effects. The coordinator/commit boundary verifies base version + fencing and persists canonical events/object versions/manifest.

The current synchronous `AgentCoordinator.runTurn()` may be refactored or wrapped to expose a narrower commit-oriented surface, but all Phase 0–3 deterministic semantics/tests remain valid.

The coordinator still rejects stale fencing tokens at the last safe point before canonical mutation.

---

# 30. Durable Object integration

The per-Agent Durable Object remains the serialization/ownership boundary.

Phase 4 extends it to support:

```text
accept wake
create/get run
issue/refresh run fencing token
advance bounded run
resume waiting/contained run
read run status
submit approval grant
apply/release containment
```

It does not hold one HTTP request open across approval waiting.

Suggested internal semantics include routes for run status/advance, approval grants, and containment apply/release. Exact URLs may be refined without changing the architecture.

---

# 31. D1 persistence strategy

Use dedicated operational tables/records rather than treating the append-only event log as mutable run state.

Logical tables:

```text
runs
run_checkpoints
run_budget_ledger
model_invocations
authority_resolutions
approval_requests
approval_grants
action_executions
action_receipts
containments
dead_letters
```

Events remain append-only audit/lineage evidence.

Atomic port operations map to D1 transactions or equivalent single-writer transaction boundaries.

---

# 32. Temporal evidence

Phase 3 invariants remain unchanged.

Phase 4 records temporal provenance on run/checkpoint, model invocation, approval, action claim/receipt, containment, and canonical commit boundaries.

The workflow does not use CTCL as the lease/fencing clock.

Local degraded evidence remains explicit when policy permits. High-risk temporal requirements may use the Phase 3 temporal trust helper.

---

# 33. Security and privacy

## 33.1 Secrets

Do not persist raw provider keys, OAuth refresh tokens, cookies, private signing keys, or full secret-bearing HTTP payloads.

Receipts use hashes, provider ids, external refs, and redacted summaries.

## 33.2 Model context

Model context follows sensitivity/sealed-core rules. Implementing `ModelPort` does not grant access to all Residence data.

## 33.3 Approval replay

Approval grants bind to exact requests/actions and use idempotency keys. Expired/revoked grants fail closed.

## 33.4 Executor scope

Executors receive only authorized scope/action material. They do not receive general policy mutation privileges.

---

# 34. Error taxonomy

Suggested provider-neutral codes:

```text
invalid_wake
duplicate_wake
wake_authority_denied
hydration_failed
containment_active
model_budget_exhausted
model_temporarily_unavailable
model_invalid_output
action_authority_denied
approval_required
approval_expired
approval_invalid
budget_exhausted
stale_fencing_token
execution_failed
execution_partial
execution_unknown
reconciliation_failed
commit_conflict
commit_failed
retry_exhausted
invalid_persisted_state
```

Every error path preserves whether an external effect may already have occurred.

---

# 35. Deterministic reference implementations

Normal CI uses only deterministic/fake providers.

## 35.1 Deterministic model

Supports scripted actions, no-op/stop, malformed output, usage/cost, transient failure, and ambiguous invocation failure.

## 35.2 Static authority resolver

Uses explicit grant tables. No implicit universal admin authority.

## 35.3 Recording action executor

Supports provider-enforced idempotency simulation, no-idempotency mode, success, definitive failure, partial effect, crash-after-effect-before-receipt, and reconcile success/failure/unknown.

## 35.4 In-memory run store

Implements the same atomic semantic contract as D1 storage.

---

# 36. Crash-injection test matrix

Inject failure/crash at minimum:

1. after wake accepted, before run creation;
2. after run creation, before hydration checkpoint;
3. after model budget reservation, before model call;
4. after model call returns, before model result persistence;
5. after ActionIntent persistence, before authority resolution;
6. after authority/policy approval, before budget/action claim;
7. after `claimed`, before `executing`;
8. after `executing`, before provider call;
9. after provider effect succeeds, before receipt persistence;
10. after receipt persistence, before canonical commit;
11. after canonical commit, before run terminal status update;
12. while waiting approval, before resume wake;
13. after approval grant, before resumed action claim;
14. during containment transition;
15. during reconciliation.

Expected invariants:

- no duplicate logical run;
- no blind duplicate external effect;
- unknown effect stays explicit;
- budget cannot silently reset;
- approvals cannot widen after crash;
- canonical commit retries independently from external effect.

---

# 37. Testing layers

## 37.1 Schema tests

Persisted shapes, canonical hashing, compatibility, optional widening.

## 37.2 Run state-machine tests

Every legal/illegal transition from §7.2.

## 37.3 Budget tests

Reservation arithmetic, competing reservations, settlement/release, retry accounting, active-wall-time semantics, max risk, budget exhaustion.

## 37.4 Authority tests

No self-certified authority; resource scope; Residence-bearing Resource guard; continuity preconditions; expiry.

## 37.5 Approval tests

Exact binding; scope/hash mismatch; expiry; revocation; multi-party uniqueness; resumed revalidation.

## 37.6 Effect-ledger tests

Claim before effect; `claimed` recovery; `executing` ambiguity; lifecycle/effect/reconciliation separation; provider idempotency modes; receipt immutability; reconciliation; commit-after-effect crash.

## 37.7 Containment tests

Active/scoped block; review due; renewal; release; escalation; no identity mutation authority; mandatory audit/effect evidence remains recordable.

## 37.8 Integration tests

At least:

```text
schedule wake → fake model → authorized action → fake effect → receipt → canonical commit
webhook wake → approval required → Waiting → approval grant → resume → one effect → commit
state wake → no authority → denial with no executor call
external effect succeeds → crash before receipt → reconcile → commit without re-execution
containment activates after effect → receipt/audit persists → further effects blocked
```

## 37.9 Regression

All Phase 0–3 tests remain green.

---

# 38. Architectural boundary checks

Final verification checks actual imports/symbols for:

```text
workflow-core imports no Cloudflare runtime types
coordinator imports no vendor model/action provider
policy-engine imports no model provider
model adapter has no executor/tool connector reference
CTCL/commoninstant does not appear in lease/fencing implementation
```

Avoid naive ambiguous grep patterns.

---

# 39. Gate C — first live model activation

Phase 4 architecture and merge correctness do not depend on a live model provider.

Gate C is optional after deterministic Phase 4 is green.

A live model gate:

1. selects one `ModelPort` implementation;
2. loads credentials only from secret/environment configuration;
3. runs one disposable low-risk bounded turn;
4. exposes no privileged executor to the model;
5. confirms proposal parsing, usage accounting, and stop semantics;
6. records only non-secret metadata;
7. never changes Agent identity/lineage based on provider choice.

Provider outage does not invalidate deterministic workflow correctness.

---

# 40. Optional later live action gate

A separately controlled low-risk action smoke may be added after deterministic effect-ledger maturity. It is not required for Phase 4 merge correctness. Never use an irreversible/destructive action as a smoke test.

---

# 41. Phase 4 convergence slices

## 4A — Run / Authority / Budget Contracts + Durable Effect Ledger

Deliver schema records, `workflow-core` contracts, exact Run phase machine, budget ledger, action claim/receipt/reconciliation semantics, in-memory reference store, and crash tests.

## 4B — Provider-neutral bounded-run orchestrator

Deliver `ModelPort`, deterministic model adapter, hydration, wake/action authority ports, policy composition, bounded multi-turn loop, proposal validation, and model budget accounting.

## 4C — Approval / Execution / Waiting Resume / Containment / Dead Letter

Deliver approval records/binding, Waiting/resume, action executor + deterministic executor, full effect-ledger integration, containment, and dead-letter logic.

## 4D — Cloudflare/control-plane integration + trigger paths

Deliver D1 run/effect storage and migrations, Durable Object run creation/advance/resume, control-plane routes, schedule/webhook/state integration, full integration tests, docs/examples, and optional Gate C live model activation.

---

# 42. Phase 4 acceptance criteria

Phase 4 is complete only when all statements below are proven by code/tests/inspection.

1. A trigger never grants action authority by itself.
2. Wake authority and action authority are distinct checks.
3. The model never receives a live privileged connector/executor.
4. `ActionIntent` cannot self-certify authority.
5. Every external action has durable pre-effect claim state.
6. Every attempted external effect ends with a definitive or explicit `unknown` effect status.
7. Crash after an external effect cannot cause blind re-execution.
8. `claimed` and `executing` lifecycle states have different recovery semantics.
9. Ledger lifecycle, external effect status, and reconciliation status remain separately represented.
10. Provider idempotency behavior is declared, not assumed.
11. Approval binds to exact action/authority/scope/policy/expiry context.
12. Waiting does not require a live process.
13. Resume rehydrates checkpoint and revalidates authority/policy/approval/budget/containment.
14. Budget is multi-dimensional and bounded even when `budget_ref` is omitted.
15. Active wall-time budget excludes persisted approval/dormant waiting.
16. Budget reservation occurs before resource consumption where retry/concurrency can overspend.
17. Residence-bearing Resource destruction cannot pass ordinary resource-owner authority alone.
18. Containment has scope, expiry/review, renewal, release/escalation semantics.
19. Containment cannot silently grant identity rewrite authority.
20. Containment cannot suppress mandatory durable recording of already-attempted effect/audit evidence.
21. Duplicate wake produces at most one logical run.
22. Duplicate action produces at most one external effect when provider idempotency supports it; otherwise ambiguous state is reconciled/manual rather than blindly repeated.
23. A succeeded receipt followed by commit crash retries only commit/reconciliation, not the external effect.
24. Dead-letter preserves whether effect state is none/known/unknown.
25. Model provider selection cannot change Agent identity or canonical lineage.
26. Normal CI is network-free and credential-free.
27. `workflow-core` has no Cloudflare/vendor model/MCP dependency.
28. Phase 0–3 regression suite remains green.
29. Schedule, webhook, and state-trigger integration each prove one end-to-end bounded run or denial path.
30. Emergency containment is testable during an in-flight run.
31. Canonical coordinator still enforces stale fencing rejection before durable canonical mutation.
32. CTCL temporal evidence is never used as lease/fencing ordering authority.
33. Phase 5 can attach MCP/adapter capability discovery without rewriting the Phase 4 authority/execution boundary.

---

# 43. Explicit design decisions

Expensive-to-change decisions locked now:

```text
1. effect ledger exists separately from final manifest commit
2. model != executor
3. action intent != authority resolution
4. authority != policy
5. approval != authority discovery
6. budget reserves before effectful resource use
7. waiting = persisted continuation, not a live process
8. unknown external effect never becomes blind retry
9. containment is scoped/time-aware
10. provider choice is outside core architecture
11. run phase is separate from coarse Agent state
12. no universal admin==subject-owner shortcut
13. effect outcome is separate from ledger lifecycle
14. mandatory effect/audit evidence survives containment
```

Deliberately replaceable:

```text
specific live model vendor
specific action provider
specific UI layout
full Relation/Contract persistence implementation
whether later steps run inside DO, Queue, or Cloudflare Workflows
future MCP capability descriptor schema
future multi-Agent/federated orchestration
```

---

# 44. Practicality rule

> **Implement the smallest design that makes irreversible mistakes difficult and reversible implementation choices easy.**

Therefore exact-once-looking effect semantics and authority/identity boundaries get strong design now, while provider vendors, full social-governance databases, and parallel action execution remain replaceable/deferred.

---

# 45. Expected repository shape after Phase 4

```text
packages/
  arcp-schema/
  policy-engine/
  coordinator/
  workflow-core/                 # NEW
  control-plane-core/
  residence-storage/
  residence-bridge/
  temporal-evidence/
  temporal-wake/
  adapters/
    model/                        # evolves into ModelPort implementations
    cloudflare/                   # D1 run/effect ledger + DO integration
    synced-filesystem/
    google-drive-api/
    ctcl/

tests/
  helpers/
  unit/
    workflow-run-state...
    run-budget...
    authority-resolution...
    approval...
    action-execution-ledger...
    containment...
  integration/
    phase4-bounded-run...
    phase4-approval-resume...
    phase4-crash-reconcile...
    phase4-trigger-paths...
```

No MCP package is required until Phase 5.

---

# 46. Design self-review result

The written design was re-read specifically for placeholders, internal contradictions, scope creep, and ambiguous semantics.

Self-review changes made before requesting approval:

1. replaced the original single `ActionExecutionStatus` with separate lifecycle/effect/reconciliation states;
2. added the exact legal `RunPhase` transition table;
3. defined `AuthoritySource` explicitly;
4. defined `max_risk` ordering and active-wall-time semantics;
5. clarified resume fencing after persisted waiting/containment;
6. clarified that containment cannot suppress mandatory receipt/audit persistence after an effect already occurred.

Placeholder scan: no unresolved placeholder is required to understand implementation semantics. Vendor selection is intentionally deferred as a named activation/configuration decision, not left unspecified accidentally.

Scope check: Phase 4 remains one coherent subsystem because all four convergence slices implement the same bounded-run/effect-accounting runtime. Full Relation/Contract persistence, MCP discovery, adapter SDK, multi-Agent federation, and recovery/migration drills remain outside this spec.

---

# 47. Design closure

Phase 4 turns ARCP from a continuity/control-plane foundation into a system that can safely begin doing work without a human typing every prompt.

"Promptless" means:

> an authorized event may start a bounded run.

It does **not** mean:

> a wake grants unlimited action authority.

"Autonomous" means:

> the run may deliberate and execute within explicitly resolved authority, policy, budget, approval, containment, and continuity constraints.

The defining Phase 4 correctness property is not merely "the Agent can act".

It is:

> **The Agent can act, crash, wait, resume, be contained, or lose a provider without the system forgetting who authorized what, what may already have happened in the world, or what can safely happen next.**
