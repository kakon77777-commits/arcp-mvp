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

Phase 0–3 established:

- stable Agent identity and schema;
- deterministic policy primitives;
- canonical commit and fencing semantics;
- provider-neutral Residence storage;
- local/cloud reconciliation boundaries;
- temporal provenance and exact wake-time compilation.

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

Before Phase 4, `ActionIntent` can be recorded without any external effect. In Phase 4, a process may crash after an external API accepted an operation but before ARCP committed the corresponding manifest. Therefore the old assumption:

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
- emergency containment with scope, TTL, review, renewal, and release/escalation semantics;
- waiting/resume without keeping a process alive;
- dead-letter records for irrecoverable/retry-exhausted work;
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

The current code already contains useful seams.

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

Phase 4 will use these fields rather than inventing a parallel trigger format.

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

Phase 4 may add optional affected-entity/resource/residence references and continuity impact, but an `ActionIntent` remains only a proposal.

It must never self-certify authority.

## 3.3 Existing policy engine

The current policy engine is deterministic and provider-neutral. It knows risk, sensitivity, approvals, lease validity, budget, and policy version.

Phase 4 keeps it deterministic and does not make it responsible for discovering relationships, contracts, provider capabilities, or infrastructure ownership.

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

The Durable Object would:

- accept wakes;
- call the model;
- resolve authority;
- wait for approvals;
- execute tools;
- track budgets;
- write receipts;
- commit manifests.

### Advantage

Very few files and minimal plumbing.

### Rejection reason

It creates one giant component coupling Cloudflare runtime, provider APIs, policy, approvals, budgets, action execution, and canonical commit semantics. It also makes deterministic testing and later Phase 5 MCP integration harder.

Rejected.

---

## B. Provider-neutral `workflow-core` + durable effect ledger — selected

Create a new `@arcp/workflow-core` package containing:

- bounded-run orchestration;
- run state machine;
- budget semantics;
- authority/model/executor/store ports;
- approval and containment logic;
- crash-safe recovery rules.

Cloudflare/D1 implement persistence. Model and action providers implement ports. The coordinator remains the canonical state boundary.

### Advantages

- clean provider isolation;
- deterministic CI;
- crash semantics can be tested without Cloudflare;
- Phase 5 can attach MCP/adapter capability providers without changing orchestration;
- model provider choice does not define Agent identity;
- effect deduplication can be designed independently of manifest commit.

Selected.

---

## C. Fully event-choreographed Queue/Workflow architecture

Each stage becomes a separate message/job:

```text
wake queue
→ hydrate job
→ model job
→ authority job
→ execution job
→ reconcile job
→ commit job
```

### Advantage

Maximum horizontal scaling and fault isolation.

### Rejection reason

Too much operational complexity for the current single-Agent MVP. Phase 4 should establish correct semantics first. The chosen `workflow-core` interfaces leave room to map stages onto Cloudflare Workflows/Queues later.

Deferred.

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

Proposed files:

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

Evolves from `FakeModelAdapter` into implementations of the provider-neutral `ModelPort`.

The deterministic/fake implementation remains the merge-correctness provider.

Live vendor adapters are activation-specific and must not be imported by `workflow-core`.

## 6.4 `@arcp/policy-engine`

Remains deterministic.

It receives already-resolved facts and returns a policy decision.

It does not infer that an administrator owns an Entity merely because the administrator controls infrastructure.

## 6.5 `@arcp/adapter-cloudflare`

Adds:

- durable run-state storage backed by D1;
- execution-ledger storage;
- approval/containment persistence;
- per-Agent run fencing/token issuance and resume routing;
- internal control-plane routes required to advance/resume runs.

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

This is intentionally more detailed than the existing coarse Agent state machine.

Agent state and Run phase are different abstractions.

Example:

```text
AgentState = Waiting
RunPhase   = waiting-approval
```

or:

```text
AgentState = Suspended
RunPhase   = contained
```

## 7.2 `RunRecord`

Conceptual shape:

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

`run_id` is deterministic from stable wake identity, not random retry state.

Recommended derivation:

```text
run_id = hash(canonical JSON of agent_id + wake.idempotency_key)
```

Do not use delimiter-joined strings for security-sensitive binding hashes.

## 7.3 `RunCheckpoint`

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

## 7.4 `RunBudgetSpec`

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

Every run must resolve to a bounded spec.

Missing `budget_ref` never means unlimited.

## 7.5 Budget ledger

Track at least:

```text
limit
reserved
consumed
released
```

A budget reservation has a stable reservation id and belongs to one run step/action/model invocation.

Reservations prevent parallel or retried work from each observing the same full remaining budget.

## 7.6 `ModelInvocationRecord`

Model calls consume resources and may fail ambiguously.

Conceptual shape:

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

If a model call becomes ambiguous because the process died mid-call, Phase 4 may conservatively charge the reservation before retrying. A retry requires remaining budget.

## 7.7 `AuthorityResolution`

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

## 7.8 `ApprovalRequest`

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

## 7.9 `ApprovalGrant`

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

## 7.10 `ActionExecutionStatus`

```ts
export type ActionExecutionStatus =
  | 'planned'
  | 'claimed'
  | 'executing'
  | 'succeeded'
  | 'failed'
  | 'partial'
  | 'unknown'
  | 'reconciled'
  | 'canonically-recorded';
```

## 7.11 `ActionExecutionRecord`

```ts
export interface ActionExecutionRecord {
  schema: 'arcp/action-execution/0.1';
  execution_id: string;
  run_id: string;
  action_id: string;
  action_hash: string;
  status: ActionExecutionStatus;
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

## 7.12 `ActionReceipt`

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

## 7.13 `ContainmentRecord`

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

## 7.14 `DeadLetterRecord`

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

The model/upstream proposal may include additional descriptive impact hints:

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

These are claims/proposals, not trusted authority facts.

The authority resolver must independently resolve them where required.

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

- load the committed Residence state required for the run;
- load a waiting checkpoint when resuming;
- respect sensitivity/sealed boundaries;
- provide stable hashes/references for what the model saw.

It does not execute actions or grant authority.

## 9.3 `WakeAuthorityResolverPort`

```ts
export interface WakeAuthorityResolverPort {
  resolveWake(input: WakeAuthorityInput): Promise<WakeAuthorityResult>;
}
```

It determines whether a wake source is allowed to start/resume a run.

Examples:

```text
human authenticated request
signed webhook sender
registered schedule rule
state-trigger rule
approval-grant resume event
peer delegation
```

A valid wake authority still does not authorize actions produced during the run.

## 9.4 `ActionAuthorityResolverPort`

```ts
export interface ActionAuthorityResolverPort {
  resolveAction(input: ActionAuthorityInput): Promise<AuthorityResolution>;
}
```

Phase 4 MVP implementation may use deterministic/static grants and references.

It does not need a full graph database.

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
  markActionReconciled(...): Promise<void>;
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

Descriptor includes:

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

The commit port is the only path from completed workflow facts into canonical Residence state.

It performs fencing/base-version checks.

A provider receipt is not itself a canonical commit.

---

# 10. Run state machine

The workflow state machine is intentionally resumable.

```text
accepted
  ↓
hydrating
  ↓
deliberating
  ↓
authorizing
  ├─ denied → deliberating / completed
  ├─ approval required → waiting-approval
  ├─ contained → contained
  └─ authorized
        ↓
      executing
        ├─ definitive failure → deliberating / completed
        ├─ ambiguous effect → reconciling
        └─ receipt
              ↓
            committing
              ├─ retry commit only
              └─ completed / deliberating / waiting
```

Important: an action effect and a canonical commit are separate transitions.

## 10.1 Waiting

`waiting-approval` and `waiting` are persisted states.

They do not imply a live process.

The runtime must:

1. persist checkpoint;
2. release active execution lease/fencing ownership as appropriate;
3. return control to the host;
4. resume only from a new authorized wake/event.

## 10.2 Resume fencing

When a waiting run resumes, the per-Agent coordinator issues a fresh fencing token and updates the run.

Any stale asynchronous worker holding an older token must fail before:

- claiming a new external action;
- appending a canonical receipt state transition that requires current ownership;
- committing the Residence.

---

# 11. Wake identity and duplicate handling

Duplicate wake delivery must map to one logical run.

Recommended invariant:

```text
(agent_id, wake.idempotency_key) -> exactly one run_id
```

`createRunIfAbsent` returns the existing run on redelivery.

A duplicate wake must not reset budget, clear approvals, or create a second effect ledger.

A later independent wake uses a different idempotency key even if its trigger is conceptually similar.

---

# 12. Trigger ingestion

All trigger sources compile into a standard `WakeRecord`.

## 12.1 Schedule / exact instant

Use Phase 3 `TemporalWakeCompiler` where exact temporal intent must be compiled.

The scheduler submits a WakeRecord when due.

Temporal evidence still does not become the lease clock.

## 12.2 Webhook

Webhook ingress must verify its own transport/source authorization first.

The delivery id or equivalent stable external id must participate in wake idempotency.

Webhook payload content is not action authority.

## 12.3 State trigger

A committed event/state transition can match a configured trigger rule and enqueue a wake.

The triggering event id + rule id should derive idempotency.

## 12.4 Human wake

Human/API authentication grants permission to submit the wake only within the submitted operation's scope.

It does not grant future generated actions unlimited authority.

---

# 13. Wake authority

Wake acceptance becomes a two-step concept:

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

Hydration establishes the run's starting state.

It must resolve:

- latest committed manifest;
- base manifest version;
- selected Residence objects/context;
- prior run checkpoint on resume;
- relevant previous receipts/denials;
- active containment state;
- resolved budget profile.

Hydration must not silently create a new object version solely because information was read.

Recall remains an event, consistent with Phase 3.

---

# 15. Model deliberation

Model deliberation is bounded by both run turns and model-specific budget dimensions.

Before a model call:

1. validate run still owns current fencing token if required by host orchestration;
2. evaluate containment that blocks model execution;
3. reserve a bounded model-call budget;
4. persist `ModelInvocationRecord(status='reserved')`;
5. persist transition to `calling`;
6. call `ModelPort.deliberate()`;
7. persist structured result hash/usage;
8. settle budget.

A model call can be retried only under budget and invocation-state rules.

If the process crashes after `calling` but before a receipt-like result is recorded, that invocation is `unknown`. Its reservation is conservatively accounted until explicitly resolved/released.

---

# 16. Proposal validation

Before authority resolution, every model proposal must be structurally validated.

Reject or normalize according to explicit rules:

- duplicate action ids in one turn;
- duplicate idempotency keys;
- invalid risk/sensitivity values;
- target/scope values outside schema;
- malformed entity/resource references;
- impossible budget-impact claims;
- unexpected schema fields if strict mode is configured.

A malformed model output never reaches the executor.

---

# 17. Authority resolution

Authority and policy remain separate.

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

Potential authority sources include:

```text
self-authorized
contract-authorized
resource-owner-authorized
counterparty-authorized
multi-party-authorized
guardian-authorized
policy-authorized
```

`emergency-contained` is a restriction source, not permission to broaden action authority.

## 17.1 No universal owner shortcut

Phase 4 must not implement:

```text
if admin then authorized for everything
```

Static MVP grants can be broad for specific resources/scopes, but their scope must remain explicit.

## 17.2 Residence-bearing Resource guard

Before destructive/revoking actions, the resolver must determine whether affected storage/credentials are Residence-bearing Resources.

At minimum it must classify continuity impact:

```text
none
replica-loss
service-degraded
migration-required
continuity-destructive
```

`migration-required` and `continuity-destructive` cannot be authorized solely by ordinary resource ownership.

They require an appropriate continuity precondition or separate governance.

---

# 18. Policy composition

Policy engine decisions remain:

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

No single one of those inputs grants execution by itself.

---

# 19. Approval semantics

Approval must bind to the exact action being approved.

The binding includes at least:

```text
action_hash
authority_resolution_hash
policy_version
resource/scope set
expiry
required parties
```

Use canonical structured serialization for binding hashes.

Do not use ambiguous delimiter-based concatenation.

## 19.1 Approval wait

When approval is required:

```text
persist ApprovalRequest
→ persist RunCheckpoint
→ RunPhase = waiting-approval
→ AgentState = Waiting
→ release active execution
```

## 19.2 Approval resume

A grant produces a new wake/resume event.

On resume Phase 4 must revalidate:

- approval not expired/revoked;
- action hash unchanged;
- authority resolution still valid;
- policy version and result still acceptable;
- required parties satisfied;
- budget still available;
- containment does not block execution;
- fencing token is fresh.

Approval does not freeze the world forever.

## 19.3 Multi-party

Required parties must be unique and explicitly counted.

Duplicate grants from the same approver do not increase quorum.

---

# 20. Multi-dimensional budget semantics

A run budget is resource governance, not ownership of the Entity.

## 20.1 Hard dimensions

At minimum Phase 4 tracks:

```text
turns
wall time
model input tokens
model output tokens
model cost
model calls/tool calls
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

Budget exhaustion is a normal bounded-run stop condition, not automatically an error.

The run may:

- complete with `stop_reason='budget-exhausted'`;
- wait for a separately authorized budget extension;
- commit all already-known receipts/effects before stopping.

Budget exhaustion never justifies discarding unknown effect state.

---

# 21. Durable effect ledger

This is the most important new correctness mechanism in Phase 4.

## 21.1 Why final commit is not enough

Bad sequence:

```text
external API succeeds
→ process crashes
→ canonical commit never happens
→ wake is retried
→ external API executes again
```

Therefore effect state must live outside the final manifest commit path.

## 21.2 Pre-effect claim

Before invoking an executor:

```text
validate authorization
→ validate containment
→ validate fencing token
→ atomically reserve budget + claim execution
→ durable status = claimed
```

Only the holder of the current valid claim/fencing token may advance it.

## 21.3 Mark executing before call

Immediately before crossing the external-effect boundary:

```text
claimed
→ durable status = executing
→ call provider
```

If a process dies while status is only `claimed`, the call was not yet declared started and the run may continue to the executing boundary.

If a process dies after status becomes `executing` but before a definitive receipt, the effect is treated as ambiguous even if in reality no network packet left the process.

This conservative rule prevents duplicate effects.

## 21.4 Result states

Provider result becomes one of:

```text
succeeded
failed
partial
unknown
```

Never convert an ambiguous timeout/network failure into `failed` unless the executor can prove the provider did not apply the effect.

## 21.5 Provider idempotency modes

```text
provider-enforced
best-effort
none
```

For `provider-enforced`, retry with the same provider key may be allowed after adapter-specific proof of idempotent semantics.

For `best-effort` or `none`, an `executing` record with no definitive receipt goes to reconciliation rather than blind retry.

## 21.6 Reconciliation

`ActionExecutorPort.reconcile()` attempts to discover the real external state.

Possible outcomes:

```text
confirmed-succeeded
confirmed-failed
confirmed-partial
still-unknown
```

If still unknown:

- keep the durable unknown state;
- wait/manual-review or dead-letter according to policy;
- do not blindly execute again.

---

# 22. Action receipt and canonical commit

A durable action receipt is evidence of the attempted external effect.

It is not the same as a canonical Residence state transition.

Correct sequence:

```text
ActionExecutionRecord
→ ActionReceipt
→ related EventEnvelope(s)
→ object/memory proposal materialization if applicable
→ canonical commit
→ execution status = canonically-recorded
```

If canonical commit fails after a succeeded receipt:

- retry the commit;
- do not re-execute the external action.

If commit eventually cannot converge, dead-letter the commit/reconciliation path while preserving the receipt.

---

# 23. Containment

Emergency containment remains required.

It is a scoped restriction system, not universal root authority.

## 23.1 Required boundaries

The orchestrator re-evaluates active containment at minimum:

```text
before model invocation
before external action claim
before destructive Residence mutation
before canonical commit
```

## 23.2 Expiry and review

When an active containment reaches its expiry/review boundary without resolution:

```text
active
→ review-due
```

The system does not silently:

- release all restrictions;
- convert them into permanent suspension;
- delete Residence state.

A reviewer/authorized policy path must renew, release, or escalate.

## 23.3 Escalation

If prolonged containment substantively impairs continuity/recoverability/migration, it must become an explicit higher-order governance state rather than remaining an eternal emergency flag.

---

# 24. Dead-letter semantics

Dead-letter is for work that cannot safely make progress automatically.

Examples:

- provider result remains unknown and cannot be reconciled;
- repeated retryable model/transport errors exceed a bounded retry profile;
- commit conflict repeatedly fails under fresh fencing;
- malformed persisted state violates invariants;
- required approval source can no longer be resolved.

Dead-letter must include:

- stage;
- attempts;
- last error;
- whether an external effect is known/unknown;
- whether manual resolution is required.

Dead-letter never means "forget this run".

---

# 25. Retry policy by boundary

## 25.1 Before any external effect

Safe retry candidates:

- hydration read;
- deterministic authority resolution;
- deterministic policy evaluation;
- approval lookup;
- pre-effect validation.

All remain bounded by retry limits.

## 25.2 Model invocation

May retry under model budget rules.

Ambiguous model calls are conservatively budgeted.

## 25.3 External action before `executing`

A durable `claimed` state can proceed.

## 25.4 External action after `executing`

No blind retry unless executor/provider idempotency semantics explicitly make it safe.

Otherwise reconcile.

## 25.5 After definitive receipt

Retry only canonical persistence/commit work.

Do not repeat the effect.

---

# 26. Bounded multi-turn loop

A Phase 4 run may include multiple model turns, but remains bounded.

Suggested loop:

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

Phase 4 MVP processes external actions sequentially within one Agent run.

Parallel action execution is deferred because it complicates budget reservation, ordering, partial failure, and relation-sensitive authority without being required to prove the architecture.

---

# 27. Memory proposals

Model memory proposals remain proposals.

They are not written directly by the model.

Before canonicalization they must pass:

- schema/size checks;
- sensitivity classification;
- provenance assignment;
- policy as required;
- canonical-role rules.

A recall is still an event and does not mutate source ObjectVersion merely to record read time.

---

# 28. Next-wake proposals

A model may propose a future wake, but a proposal is not scheduling authority.

A future wake must pass:

- recursive-wake budget;
- wake authority/policy;
- temporal compilation where needed;
- idempotency derivation;
- scheduling persistence.

The resulting `WakeRecord` is a new independent wake, not an invisible loop continuation.

---

# 29. Canonical coordinator boundary

Phase 4 must not turn the canonical coordinator into a vendor/network orchestrator.

Recommended refactor direction:

```text
workflow-core
  does async deliberation/effects

coordinator/commit boundary
  verifies base version + fencing
  persists canonical events/object versions/manifest
```

The current synchronous `AgentCoordinator.runTurn()` may be refactored or wrapped to expose a narrower commit-oriented surface, but Phase 0–3 deterministic semantics and tests must remain valid.

The coordinator must still reject stale fencing tokens at the last safe point before canonical mutation.

---

# 30. Durable Object integration

The per-Agent Durable Object remains the serialization/ownership boundary.

Phase 4 extends it to support:

```text
accept wake
create/get run
issue/refresh run fencing token
advance bounded run
resume waiting run
read run status
submit approval grant
apply/release containment
```

The Durable Object does not need to hold one HTTP request open across approval waiting.

## 30.1 Suggested internal routes

Exact paths can be adjusted during implementation, but semantics should include:

```text
GET  /internal/v1/agents/:agent/runs/:run
POST /internal/v1/agents/:agent/runs/:run/advance
POST /internal/v1/agents/:agent/approvals/:request/grants
POST /internal/v1/agents/:agent/containments
POST /internal/v1/agents/:agent/containments/:id/release
```

Public exposure remains behind the Worker authorization boundary.

---

# 31. D1 persistence strategy

Phase 4 persistence should use dedicated tables/records for operational run state rather than overloading the event log as a mutable state table.

Likely logical tables:

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

Operational rows may have controlled state transitions, with append-only evidence where required.

Atomic operations required by the port must map to D1 transactions or equivalent single-writer transaction boundaries.

---

# 32. Temporal evidence

Phase 3 invariants remain unchanged.

Phase 4 records temporal provenance on:

- run creation/checkpoints;
- model invocation evidence;
- approval request/grant;
- action claim/receipt;
- containment enter/review/release;
- canonical commit.

The workflow does not use CTCL as the lease/fencing clock.

Caller/runtime may attach CTCL evidence where available.

Local degraded evidence remains explicit when policy permits.

High-risk temporal requirements may use the Phase 3 temporal trust helper.

---

# 33. Security and privacy

## 33.1 Secrets

Do not persist:

- raw provider API keys;
- OAuth refresh tokens;
- session cookies;
- private signing keys;
- full secret-bearing HTTP payloads.

Receipts use hashes, provider ids, external refs, and redacted summaries.

## 33.2 Model context

Model context must follow sensitivity/sealed-core rules.

A model adapter does not gain access to all Residence data merely because it implements `ModelPort`.

## 33.3 Approval replay

Approval grants bind to exact requests/actions and use idempotency keys.

Expired/revoked grants fail closed.

## 33.4 Executor scope

Executors receive only authorized scopes and the action material needed for that operation.

They do not receive general policy mutation privileges.

---

# 34. Error taxonomy

Phase 4 normalizes orchestration failures into a small provider-neutral set.

Suggested codes:

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

The error taxonomy must preserve whether an external effect may already have occurred.

---

# 35. Deterministic reference implementations

Normal CI uses only deterministic/fake providers.

Required test implementations:

## 35.1 Deterministic model

Supports scripted:

- action proposals;
- no-op/stop turns;
- malformed output;
- usage/cost values;
- transient failure;
- ambiguous invocation failure.

## 35.2 Static authority resolver

Explicit grant table, for example:

```text
entity X may use resource Y for scope Z
human approval source may grant action hash H
self scope only applies to explicitly owned/controlled resource refs
```

No implicit universal admin authority.

## 35.3 Recording action executor

Supports:

- provider-enforced idempotency simulation;
- no-idempotency mode;
- successful effect;
- definitive failure;
- partial effect;
- effect succeeds then process/test crashes before receipt;
- reconcile success/failure/unknown.

## 35.4 In-memory run store

Must implement the same atomic semantic contract as D1 storage.

---

# 36. Crash-injection test matrix

Phase 4 correctness depends on failure placement, not only happy paths.

At minimum inject failure/crash at:

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
- unknown effect remains explicitly unknown;
- budget cannot be silently reset;
- approvals cannot widen scope after crash;
- canonical commit can be retried independently from external effect.

---

# 37. Testing layers

## 37.1 Schema tests

Validate persisted shapes, canonical hashing, compatibility, and optional widening.

## 37.2 Run state-machine tests

Every legal/illegal `RunPhase` transition.

## 37.3 Budget tests

- reservation arithmetic;
- atomic competing reservations;
- settlement/release;
- retry accounting;
- max risk enforcement;
- budget-exhausted stop.

## 37.4 Authority tests

- action cannot self-authorize;
- resource ownership stays resource-scoped;
- Residence-bearing Resource guard;
- continuity preconditions;
- expired authority.

## 37.5 Approval tests

- exact binding;
- hash/scope mismatch rejection;
- expiry;
- revocation;
- multi-party uniqueness;
- resumed revalidation.

## 37.6 Execution ledger tests

- claim before effect;
- `claimed` recovery;
- `executing` ambiguity;
- provider idempotency modes;
- receipt immutability;
- reconciliation;
- commit-after-effect crash.

## 37.7 Containment tests

- active block;
- scoped block;
- review due;
- renewal;
- release;
- escalation;
- no identity mutation authority.

## 37.8 Integration tests

At least:

```text
schedule wake → fake model → authorized action → fake external effect → receipt → canonical commit
webhook wake → approval required → Waiting → approval grant → resume → one effect → commit
state wake → no authority → denial with no executor call
external effect succeeds → crash before receipt → reconcile → commit without re-execution
containment activates mid-run → blocks next effect → persists resumable state
```

## 37.9 Regression

All Phase 0–3 tests remain green.

---

# 38. Architectural grep/boundary checks

Final Phase 4 verification should include semantic boundary checks such as:

```text
workflow-core imports no Cloudflare runtime types
coordinator imports no vendor model/action provider
policy-engine imports no model provider
model adapter has no executor/tool connector reference
CTCL/commoninstant does not appear in lease/fencing implementation
```

Avoid naive ambiguous grep patterns; check actual symbols/imports.

---

# 39. Gate C — first live model activation

Phase 4 architecture and merge correctness do not depend on a live model provider.

Gate C is optional and separately activated after deterministic Phase 4 is green.

A live model gate must:

1. select one `ModelPort` implementation;
2. load credentials only from secret/environment configuration;
3. run one disposable low-risk bounded turn;
4. expose no live privileged executor to the model;
5. confirm proposal parsing, usage accounting, and stop semantics;
6. record only non-secret result metadata;
7. not mutate Agent identity/lineage based on provider choice.

A live model outage does not invalidate deterministic workflow correctness.

Provider choice remains an activation/configuration decision, not an architectural dependency.

---

# 40. Optional later live action gate

A separately controlled low-risk action smoke may be added after the deterministic executor/ledger implementation is mature.

It is not required for Phase 4 merge correctness.

A real irreversible/destructive action is never used as a smoke test.

---

# 41. Phase 4 convergence slices

Implementation should converge in four coarse slices.

## 4A — Run / Authority / Budget Contracts + Durable Effect Ledger

Deliver:

- schema records;
- `workflow-core` package skeleton/contracts;
- Run phase machine;
- budget ledger;
- execution claim/receipt/reconcile semantics;
- in-memory reference store;
- deterministic crash tests for the effect ledger.

No live model or Cloudflare dependency required.

## 4B — Provider-neutral bounded-run orchestrator

Deliver:

- `ModelPort`;
- evolved deterministic model adapter;
- context hydration port;
- wake/action authority ports;
- policy composition;
- bounded multi-turn loop;
- proposal validation;
- model budget accounting.

## 4C — Approval / Execution / Waiting Resume / Containment / Dead Letter

Deliver:

- approval requests/grants;
- exact approval binding;
- Waiting/resume;
- action executor contract + deterministic executor;
- full receipt/reconcile integration;
- containment records/guards;
- dead-letter logic.

## 4D — Cloudflare/control-plane integration + trigger paths

Deliver:

- D1 run/effect ledger adapter/migrations;
- Durable Object run creation/advance/resume;
- control-plane routes;
- schedule/webhook/state trigger integration;
- end-to-end integration tests;
- README/examples/docs;
- optional Gate C live model script/config.

---

# 42. Phase 4 acceptance criteria

Phase 4 is complete only when all statements below are proven by code/tests/inspection.

1. A trigger never grants action authority by itself.
2. Wake authority and action authority are distinct checks.
3. The model never receives a live privileged connector/executor.
4. `ActionIntent` cannot self-certify `authority_source`.
5. Every external action has durable pre-effect claim state.
6. Every attempted external effect ends with a definitive or explicit `unknown` receipt state.
7. Crash after an external effect cannot cause blind re-execution.
8. `claimed` and `executing` have different recovery semantics.
9. Provider idempotency behavior is declared, not assumed.
10. Approval binds to exact action/authority/scope/policy/expiry context.
11. Waiting does not require a live process.
12. Resume rehydrates checkpoint and revalidates authority/policy/approval/budget/containment.
13. Budget is multi-dimensional and bounded even when `budget_ref` is omitted.
14. Budget reservation occurs before resource consumption where retry/concurrency can overspend.
15. Residence-bearing Resource destruction cannot pass ordinary resource-owner authority alone.
16. Containment has scope, expiry/review, renewal, release/escalation semantics.
17. Containment cannot silently grant identity rewrite authority.
18. Duplicate wake produces at most one logical run.
19. Duplicate action produces at most one external effect when provider idempotency supports it; otherwise ambiguous state is reconciled/manual rather than blindly repeated.
20. A succeeded receipt followed by commit crash retries only commit/reconciliation, not the external effect.
21. Dead-letter preserves whether effect state is none/known/unknown.
22. Model provider selection cannot change Agent identity or canonical lineage.
23. Normal CI is network-free and credential-free.
24. `workflow-core` has no Cloudflare/vendor model/MCP dependency.
25. Phase 0–3 regression suite remains green.
26. Schedule, webhook, and state-trigger integration each prove one end-to-end bounded run or denial path.
27. Emergency containment is testable during an in-flight run.
28. Canonical coordinator still enforces stale fencing rejection before durable canonical mutation.
29. CTCL temporal evidence is never used as lease/fencing ordering authority.
30. Phase 5 can attach MCP/adapter capability discovery without rewriting the Phase 4 authority/execution boundary.

---

# 43. Explicit design decisions

The following are intentionally decided now because changing them later would be expensive:

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
```

The following remain deliberately replaceable:

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

Phase 4 follows a pragmatic rule:

> **Implement the smallest design that makes irreversible mistakes difficult and reversible implementation choices easy.**

Therefore:

- exact-once-looking effect semantics get strong design now;
- authority/identity boundaries get strong design now;
- provider vendors remain replaceable;
- full social-governance databases are deferred;
- parallel action execution is deferred;
- deterministic fakes prove architecture before live activation.

This preserves room to iterate without making early MVP shortcuts become permanent sovereignty or correctness bugs.

---

# 45. Expected repository shape after Phase 4

Conceptually:

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
    deterministic-model...
    recording-action-executor...
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

# 46. Design closure

Phase 4 turns ARCP from a continuity/control-plane foundation into a system that can safely begin doing work without a human typing every prompt.

The intended meaning of "promptless" is narrow and operational:

> an authorized event may start a bounded run.

It does **not** mean:

> a wake grants unlimited action authority.

The intended meaning of "autonomous" is also bounded:

> the run may deliberate and execute within explicitly resolved authority, policy, budget, approval, containment, and continuity constraints.

The defining Phase 4 correctness property is therefore not "the Agent can act".

It is:

> **The Agent can act, crash, wait, resume, be contained, or lose a provider without the system forgetting who authorized what, what may already have happened in the world, or what can safely happen next.**
