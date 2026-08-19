# Phase 5.0A — Runtime Clock & Hard Budget Enforcement Design

**Status:** Proposed for Lares / Neo review  
**Date:** 2026-08-19  
**Phase:** 5.0A of ARCP-MVP  
**Primary goal:** Turn Phase 4 budget accounting into a host-enforced, crash-safe resource boundary before Phase 5 exposes MCP capabilities.

---

## 0. Normative inputs

This design must be read together with:

1. `PHASE5_ENTRY_GATE.md`;
2. `PHASE4_GOVERNANCE_INPUT.md`;
3. `docs/governance/ai-autonomy-relations-existence-coordination-framework-v0.1.md`;
4. `docs/governance/ai-autonomy-relations-existence-coordination-framework-v0.1.1-review-hardening.md`;
5. `docs/superpowers/specs/2026-08-18-phase4-promptless-bounded-runs-design.md`.

If this design conflicts with AREC v0.1.1 or the binding Phase 5 entry gate, the higher-level governance input wins.

The standing architecture-review invariant remains:

> **Works if AI remains a tool, AND does not become a cage if AI becomes more than a tool.**

Phase 5.0A therefore treats budget as Resource governance only:

```text
budget authority != identity authority
budget exhaustion != deletion authority
budget exhaustion != subjecthood judgment
budget provider != purpose owner
runtime clock != historical identity
```

It also preserves the Phase 3 temporal boundary:

```text
CTCL / InstantRef = provenance evidence
MonotonicClockPort = elapsed runtime measurement
CTCL evidence != lease/fencing/runtime duration clock
```

---

# 1. Why 5.0A exists

Phase 4 introduced ten budget dimensions:

```text
turns
wall_time_ms
model_input_tokens
model_output_tokens
model_cost_micros
tool_calls
external_actions
storage_writes
network_requests
recursive_wakes
```

By the end of Phase 4, five dimensions had real accounting calls:

```text
turns
external_actions
model_input_tokens
model_output_tokens
model_cost_micros
```

But the model-token and model-cost dimensions are still charged **after** the provider call returns.

Today the unsafe shape is:

```text
provider call
  -> provider may spend resources
  -> proposal returns
  -> usage is reported
  -> ARCP discovers whether the budget was exceeded
```

That is accounting, not a hard execution bound.

A concrete failure is:

```text
remaining model_output_tokens = 1_000
provider is called without a hard output ceiling
provider returns 4_000 output tokens
ARCP notices 3_000 tokens of overspend after the fact
```

Phase 5 cannot expose general MCP capabilities on top of this assumption. 5.0A changes the order to:

```text
read durable budget
  -> atomically reserve a bounded envelope
  -> derive host-enforced provider limits
  -> provider call
  -> settle actual usage
  -> release unused reservation
```

The central rule is:

> **No bounded provider call may begin unless the host has already obtained durable resource authority for the maximum resources that call can consume.**

---

# 2. Scope

5.0A includes:

- explicit `ProvenanceClockPort` and `MonotonicClockPort` separation;
- cumulative active wall-time accounting that excludes persisted waiting;
- durable `getBudgetView(runId)` on `RunStateStorePort`;
- a complete, non-partial budget view for all declared dimensions;
- generic durable multi-dimensional Budget Envelopes;
- atomic all-or-nothing envelope reservation;
- `ModelCallLimits` as host-enforced call limits distinct from informational model context;
- provider-side hard ceilings or pre-network fail-closed behavior;
- crash-safe settlement/release/recovery semantics for budget envelopes;
- migration of model-turn budget use from independent per-dimension reservation calls to one model-call envelope;
- deterministic adapter updates and D1/in-memory parity tests;
- honest enforcement-status documentation for dimensions whose consuming capability does not exist yet.

5.0A does **not** include:

- immutable `PolicyRef` (5.0B);
- production AuthN/AuthZ (5.0C);
- MCP server or capability discovery (Phase 5.1);
- typed authority targets (Phase 5.1);
- a provider-vendor implementation for a live model;
- pricing discovery from the network;
- a generic distributed resource scheduler;
- making all ten dimensions appear enforced when no real consumption boundary exists;
- using CTCL or wall-clock timestamps as the runtime duration clock.

---

# 3. Existing repository gaps

## 3.1 `ModelTurnInput.budgetView` exists but is not authoritative

`ModelTurnInput` already has:

```ts
budgetView: RunBudgetView
```

but the Phase 4 orchestrator currently supplies an empty object. This means the model cannot receive a truthful live view even if a caller wanted to provide one.

More importantly, `budgetView` is informational state. It is not itself a permission or execution ceiling.

## 3.2 `RunStateStorePort` cannot read the budget ledger

The in-memory store has an internal `budgetView(runId)` helper, but it is not in `RunStateStorePort`. `D1RunStateStore` has no corresponding read method.

Therefore this path does not currently exist:

```text
D1 ledger
  -> orchestrator
  -> live remaining budget
```

## 3.3 Provider limits are not a `ModelPort` contract

Current model interface:

```ts
interface ModelPort {
  deliberate(input: ModelTurnInput): Promise<ModelTurnProposal>;
}
```

There is no host-enforced ceiling argument. A prompt instruction such as “do not use more than 1000 tokens” is not an execution control.

## 3.4 `max_wall_time_ms` has no valid clock source

The orchestrator's current `now()` returns `InstantRef`. That value exists for provenance and temporal evidence. Phase 3 deliberately forbids using it as the coordinator's lease/fencing ordering source.

Reusing it for elapsed runtime would collapse two separate semantic domains.

---

# 4. Architectural options

## Option A — Add `getBudgetView` and continue independent reservations

```text
getBudgetView
-> reserve turns
-> reserve output tokens
-> reserve input tokens
-> reserve cost
-> provider call
```

Advantages:

- smallest code change;
- reuses current per-dimension model reservation methods.

Rejected because:

- a crash can happen after reserving some dimensions but before others;
- one call does not obtain one coherent resource grant;
- retries need to reconstruct which subset was reserved;
- a stale read can cause partial local reasoning even though each individual reservation is safe.

## Option B — Durable multi-dimensional Budget Envelope

```text
getBudgetView
-> compute requested envelope
-> one atomic reserve operation for all dimensions
-> receive granted envelope
-> derive call limits from the grant
-> provider call
-> settle actual usage
```

Selected.

Advantages:

- one provider call maps to one durable resource-grant object;
- reservation is all-or-nothing;
- recovery has a single durable identifier;
- host limits derive from granted resources, not from a stale advisory read;
- the same primitive can later be reused for tools/network/storage.

## Option C — Let each provider adapter read the store and self-budget

Rejected.

It would invert the architecture:

```text
provider adapter
  -> reads governance state
  -> decides usable budget
  -> becomes part policy engine / scheduler
```

Adapters may translate host limits into provider-specific request parameters, but they must not acquire authority to choose the host's budget.

---

# 5. Clock model

## 5.1 Two explicit ports

5.0A replaces the ambiguous single `now()` dependency with two roles:

```ts
export interface ProvenanceClockPort {
  now(): InstantRef;
}

export interface MonotonicClockPort {
  nowMs(): number;
}
```

`ProvenanceClockPort`:

- supplies `InstantRef` for persisted provenance fields;
- may be CTCL-backed, local-unverified, deterministic fake, or another evidence source;
- is allowed to appear in persisted records;
- is never used to compute duration, lease order, or fencing order.

`MonotonicClockPort`:

- supplies process-local monotonic elapsed-time readings;
- exists only for duration measurement;
- must never be persisted as a timestamp or compared across process restarts;
- must never alter Agent identity, history, or lineage.

## 5.2 Persist amounts, not monotonic timestamps

Wrong:

```text
persist performance.now() = 149239.2
```

That number has no portable meaning after a restart.

Correct:

```text
reserve wall_time_ms = 20_000
measure local elapsed = 8_421
settle actual wall_time_ms = 8_421
release 11_579
```

Only the amount is durable.

## 5.3 Active wall time

`max_wall_time_ms` means cumulative **active orchestration execution time**.

It includes time spent inside an active `advance()` execution, including waits on active provider calls such as model or executor operations.

It excludes time while a run is durably parked in:

```text
waiting
waiting-approval
contained
```

because no orchestration process is expected to remain alive during those states.

## 5.4 One wall-time envelope per active advance

At the beginning of an active advance segment, after the run exists and fencing is valid, the orchestrator reserves the currently available wall-time budget as the upper bound for that advance.

Conceptually:

```text
advance starts
-> reserve remaining wall_time_ms in advance envelope
-> t0 = monotonicClock.nowMs()
-> perform active orchestration
-> t1 = monotonicClock.nowMs()
-> settle min(t1 - t0, reserved amount)
-> release unused wall time
-> return / persist waiting / terminal state
```

The reservation is intentionally conservative. Because Phase 4 advances are serialized per run, reserving the available wall-time remainder does not reduce useful concurrency inside one run.

If the active segment cannot obtain positive wall-time budget, it stops before beginning another external/provider segment.

---

# 6. Durable budget view

## 6.1 Port contract

`RunStateStorePort` adds:

```ts
getBudgetView(runId: string): Promise<RunBudgetView>;
```

## 6.2 Budget view becomes complete

The current type is a `Partial<Record<...>>`. 5.0A changes the authoritative store return value to include all declared dimensions.

Preferred shape:

```ts
export type RunBudgetView = Record<BudgetDimension, BudgetCounterView>;
```

Every run initializes every dimension, including optional model limits represented as a numeric zero when disabled by the resolved budget profile.

Missing ledger rows are `invalid_persisted_state`, not silently absent budget.

## 6.3 Counter semantics

For each dimension:

```ts
interface BudgetCounterView {
  limit: number;
  reserved: number;
  consumed: number;
  released: number;
}
```

Available amount is derived:

```text
available = max(0, limit - consumed - reserved)
```

`released` is cumulative audit information and is not subtracted again when computing availability.

## 6.4 D1 read semantics

D1 returns one consistent ledger snapshot for the run. The authoritative reservation operation still rechecks limits atomically; `getBudgetView()` is used for planning and informational model context, not as the final concurrency guard.

Therefore:

```text
budget view can become stale
atomic reserve cannot trust the old view
```

---

# 7. Budget Envelope

## 7.1 Purpose

A Budget Envelope is the durable record saying:

> this run has reserved up to these resource amounts for this specific active segment or provider call.

It is not a policy grant, authority grant, approval, identity claim, or ownership claim.

## 7.2 Types

```ts
export type BudgetEnvelopeKind =
  | 'advance'
  | 'model-call'
  | 'action-call'
  | 'tool-call'
  | 'storage-operation'
  | 'network-operation'
  | 'recursive-wake';

export interface BudgetEnvelopeItem {
  dimension: BudgetDimension;
  reserved: number;
  actual?: number;
}

export interface BudgetEnvelopeRecord {
  schema: 'arcp/budget-envelope/0.1';
  envelope_id: string;
  run_id: string;
  fencing_token: number;
  kind: BudgetEnvelopeKind;
  status: 'reserved' | 'settled' | 'released' | 'recovery-required';
  items: BudgetEnvelopeItem[];
  reserved_at: InstantRef;
  settled_at?: InstantRef;
}
```

Envelope IDs are deterministic for retryable logical segments where possible, for example:

```text
advance: run_id + fencing_token
model-call: run_id + turn_index
```

using canonical structured hashing, never delimiter-concatenated security identity.

## 7.3 Generic port operations

`RunStateStorePort` adds:

```ts
reserveBudgetEnvelope(input: {
  runId: string;
  fencingToken: number;
  envelopeId: string;
  kind: BudgetEnvelopeKind;
  items: Array<{ dimension: BudgetDimension; amount: number }>;
  reservedAt: InstantRef;
}): Promise<BudgetEnvelopeRecord>;

settleBudgetEnvelope(input: {
  runId: string;
  envelopeId: string;
  actuals: Partial<Record<BudgetDimension, number>>;
  settledAt: InstantRef;
}): Promise<BudgetEnvelopeRecord>;

releaseBudgetEnvelope(input: {
  runId: string;
  envelopeId: string;
  releasedAt: InstantRef;
}): Promise<BudgetEnvelopeRecord>;

getBudgetEnvelope(envelopeId: string): Promise<BudgetEnvelopeRecord | null>;
```

Existing Phase 4 `reserveModelBudget` / `settleModelBudget` may remain temporarily for compatibility during migration, but the orchestrator must stop using them for new model calls once 5.0A lands.

## 7.4 Atomic reservation invariant

For one envelope:

```text
ALL requested dimensions reserve
OR
NONE reserve
```

Never:

```text
turns reserved
output tokens reserved
cost reservation failed
```

with the first two left applied as a partially-created call grant.

## 7.5 D1 storage

Add a durable envelope table, conceptually:

```text
arcp_budget_envelopes
  envelope_id PK
  run_id
  fencing_token
  kind
  status
  items_json
  actuals_json
  envelope_json
```

One `INSERT` is the reservation boundary.

The D1 migration uses SQLite/D1 JSON table functions to validate every requested item and update matching ledger rows within the same statement-trigger boundary.

The guard rejects:

- missing dimension;
- non-positive reservation;
- duplicate dimensions inside one envelope;
- `consumed + reserved + requested > limit` for any item;
- stale fencing token;
- envelope ID collision with different content.

If any item fails, the statement aborts and no ledger row is changed.

Settlement similarly uses one status-changing statement plus triggers so all dimensions settle together.

## 7.6 In-memory parity

`InMemoryRunStateStore` implements the same semantics under one synchronous mutation boundary.

A contract/parity test suite must run the same envelope fixtures against:

```text
InMemoryRunStateStore
D1RunStateStore on node:sqlite-compatible semantics
```

The D1 migration itself remains the normative SQL behavior.

---

# 8. Model call resource flow

## 8.1 Model budget envelope

Before each model call the orchestrator obtains a live budget view and requests one `model-call` envelope covering:

```text
turns = 1
model_input_tokens = currently available amount
model_output_tokens = currently available amount
model_cost_micros = currently available amount
```

Zero or disabled dimensions are handled explicitly:

- `turns <= 0` => stop with budget exhausted;
- `model_output_tokens <= 0` when output budget is enabled => no model call;
- a disabled optional model dimension is omitted from hard-limit derivation only when the resolved budget profile explicitly disables that dimension, not because the row is missing.

The envelope request is conservative: the model call temporarily reserves the available remainder for those dimensions. Sequential execution means this does not reduce useful same-run concurrency.

## 8.2 Informational `budgetView`

After the authoritative envelope is granted, the orchestrator may pass a truthful budget view to `ModelTurnInput`.

This is informational only.

The model may use it to make better planning decisions, but:

```text
model sees budget
!= model controls budget
```

## 8.3 Host-enforced `ModelCallLimits`

This design refines the entry-gate draft name `activeDeadlineMs` to avoid ambiguity about absolute monotonic origins.

The final interface is:

```ts
export interface ModelCallLimits {
  maxOutputTokens: number;
  maxInputTokens?: number;
  maxCostMicros?: number;
  maxActiveDurationMs?: number;
}

export interface ModelPort {
  deliberate(
    input: ModelTurnInput,
    limits: ModelCallLimits,
  ): Promise<ModelTurnProposal>;
}
```

`maxActiveDurationMs` is a **relative duration ceiling from call entry**, never a persisted or globally-comparable deadline timestamp.

This is intentionally distinct from:

```text
InstantRef
Date.now()
lease valid_until
fencing token
```

## 8.4 Limit derivation

`ModelCallLimits` derives only from resources already granted by durable envelopes.

Example:

```text
model-call envelope grants:
  output tokens: 1000
  input tokens:  5000
  cost:          20000 micros

advance wall-time grant has 8400ms remaining

ModelCallLimits:
  maxOutputTokens = 1000
  maxInputTokens = 5000
  maxCostMicros = 20000
  maxActiveDurationMs = 8400
```

The orchestrator must never hand a provider a larger limit than the durable grant.

## 8.5 Provider adapter contract

A `ModelPort` implementation must validate and enforce all finite supplied limits **before external provider I/O begins**.

Allowed implementation methods include:

- native provider `max_output_tokens` / equivalent;
- exact provider tokenizer for input bound;
- a mathematically conservative tokenizer upper bound;
- configured, versioned worst-case price bounds to turn `maxCostMicros` into stricter token limits;
- provider request timeout/cancellation mechanisms for active duration.

Not sufficient:

- prompt text asking the model to stop;
- average historical token use;
- optimistic price estimates;
- checking usage only after the call;
- a timeout that does not actually prevent/abort the provider request while claiming hard enforcement.

If the adapter cannot prove a finite supplied limit can be enforced, it must fail before provider network I/O with a provider-neutral error such as:

```text
model_limit_unsupported
```

## 8.6 Deterministic adapter

`DeterministicModelAdapter` records both inputs and limits.

It must support tests proving:

```text
host grants 1000 output tokens
-> adapter never observes a limit > 1000
```

and simulated unsupported-limit failures must occur with zero fake-provider calls.

---

# 9. Model input-token enforcement

Input usage is special because the final provider payload may include adapter-specific wrappers not visible to the orchestrator.

Therefore:

```text
orchestrator grants maxInputTokens
adapter serializes final request
adapter proves serialized request <= maxInputTokens
only then provider I/O may begin
```

The orchestrator must not pretend it knows provider tokenization merely because it knows the structured `ModelTurnInput` object.

A live adapter that has no exact tokenizer may use only a documented conservative upper-bound method. An unproven heuristic is not a hard cap.

---

# 10. Cost enforcement

## 10.1 Cost is a pre-call maximum, not a post-call invoice check

`maxCostMicros` means:

> the adapter must construct a request whose worst-case billable cost is no greater than this amount under its configured pricing bound.

## 10.2 Adapter-owned translation, host-owned authority

The host chooses:

```text
maxCostMicros = durable granted amount
```

The adapter may know provider-specific pricing and therefore translate that host ceiling into stricter input/output token limits.

This does not grant the adapter authority to enlarge the budget.

## 10.3 Pricing source

5.0A does not add live network pricing discovery.

A future live provider adapter must use a configured/versioned pricing bound or another deterministic source known before the call.

If the adapter cannot establish a safe upper bound, it fails closed before provider I/O.

---

# 11. Settlement

## 11.1 Successful model call

After `ModelPort.deliberate()` returns a valid proposal:

```text
proposal.usage
-> validate usage is finite/non-negative
-> verify actual <= envelope reservation for each reported dimension
-> settle model-call envelope
-> release unused resources
```

Example:

```text
reserved output tokens = 1000
actual output tokens = 237

consumed += 237
released += 763
reserved -= 1000
```

## 11.2 Missing usage

For a dimension that was hard-enforced but the provider fails to report final actual use:

- do not settle it as zero;
- do not silently release the reservation;
- mark the envelope `recovery-required` or conservatively settle the reserved maximum according to the adapter's declared reconciliation capability.

Hard enforcement and accounting are separate problems. Lack of a receipt does not prove zero consumption.

## 11.3 Reported usage above reservation

If a provider reports actual usage greater than its granted envelope, this is a provider/adapter contract violation.

The call has already occurred, so ARCP must:

- preserve the reported evidence;
- mark the invocation/envelope as a contract violation;
- not erase the overspend;
- fail closed for future calls through that adapter until operator/review policy allows otherwise.

The budget ledger must not be forced negative merely to make the numbers fit.

---

# 12. Crash semantics

## 12.1 Crash before envelope reserve

No resources are reserved. Safe to retry.

## 12.2 Crash after envelope reserve but before provider I/O

The envelope remains durable and reserved.

On recovery, if ARCP can prove provider I/O never began, the envelope may be released.

Otherwise it remains conservative until reconciliation policy resolves it.

## 12.3 Crash during/after provider I/O before settlement

The envelope remains reserved.

The system must not assume zero usage.

For provider resources with no usage-reconciliation API, the safe default is to consume the reserved upper bound when resolving the abandoned call.

For providers that can return authoritative usage for the specific invocation, reconciliation may settle the actual amount.

## 12.4 Wall-time crash semantics

A persisted monotonic timestamp is forbidden, so the system cannot reconstruct exact active elapsed time after process death.

The conservative recovery rule is:

```text
unsettled active wall-time reservation
-> exact elapsed unknown
-> do not release as zero
-> resolve to reserved upper bound unless stronger local evidence exists
```

This may consume more budget than actually used, but it cannot allow an unbounded run through optimistic accounting.

---

# 13. Wall-time enforcement inside provider calls

An advance-level wall-time envelope grants the total remaining active time for that advance.

Before each provider/executor segment:

```text
elapsed_so_far = monotonicNow - advanceStart
remaining_granted_wall_time = advanceReserved - elapsed_so_far
```

If non-positive, do not start another external/provider segment.

The relative remaining amount is passed as the call's active-duration limit where that port supports it.

For model calls this is `ModelCallLimits.maxActiveDurationMs`.

Phase 5.0A may add an equivalent execution-limit argument to `ActionExecutorPort` only if required to make the existing Phase 4 external-action path honestly wall-time bounded. If the executor port cannot abort/limit the active call, documentation must say wall-time is host-gated before call but not yet a hard provider cancellation boundary for that adapter. Do not overclaim.

---

# 14. Remaining budget dimensions (A4)

5.0A distinguishes three statuses:

```text
HARD_ENFORCED
ACCOUNTED_ONLY
DECLARED_NOT_APPLICABLE_YET
```

The implementation/documentation must name the status of every dimension.

Target after 5.0A:

| Dimension | Target status | Notes |
|---|---|---|
| `turns` | HARD_ENFORCED | included in model-call envelope |
| `wall_time_ms` | HARD_ENFORCED for orchestration start/ModelPort boundary | monotonic advance envelope; adapter must enforce model duration limit |
| `model_input_tokens` | HARD_ENFORCED | adapter preflight/tokenizer bound |
| `model_output_tokens` | HARD_ENFORCED | native or stricter provider request ceiling |
| `model_cost_micros` | HARD_ENFORCED when adapter has safe price bound | otherwise provider call fails closed |
| `external_actions` | HARD_ENFORCED | existing claim-before-effect path |
| `tool_calls` | DECLARED_NOT_APPLICABLE_YET | no Phase 5 tool capability boundary exists yet |
| `storage_writes` | ACCOUNTED_ONLY or DECLARED_NOT_APPLICABLE_YET | do not invent a count without a defined storage operation boundary |
| `network_requests` | DECLARED_NOT_APPLICABLE_YET | adapter SDK must declare network consumption semantics in Phase 5 |
| `recursive_wakes` | DECLARED_NOT_APPLICABLE_YET | no self-triggering recursive-wake runtime exists yet |

If implementation evidence cannot support a target HARD_ENFORCED classification, the documentation must downgrade it rather than weaken the definition of “hard enforced.”

---

# 15. Fencing and concurrency

## 15.1 Envelope reservation requires current fencing

Every reservation request includes the run's current fencing token.

D1/in-memory stores reject stale fencing before granting resources.

## 15.2 Budget view is advisory under concurrency

Even though per-run `advance` requests are serialized at the Durable Object boundary, generic store semantics must not rely on that fact.

Therefore:

```text
getBudgetView says 1000 available
another mutation consumes 500
old caller requests 1000
atomic reserve rejects
```

No stale read can force overspend.

## 15.3 Containment remains preemptive

The Phase 4 follow-up intentionally queues only `advance` requests, not containment/approval/read traffic.

5.0A must not reintroduce a fetch-wide queue through budget locking.

A containment can still become durable while an advance is awaiting a model call. The next action/effect boundary sees it and blocks new effects according to Phase 4 containment semantics.

---

# 16. Error model

Add provider-neutral errors where needed:

```text
budget_envelope_invalid
budget_envelope_conflict
budget_envelope_recovery_required
model_limit_unsupported
model_limit_contract_violated
runtime_wall_time_exhausted
```

Existing `budget_exhausted`, `stale_fencing_token`, `invalid_persisted_state`, and model/provider errors remain valid.

Every error path must preserve whether:

- a provider call definitely did not begin;
- a provider call may have begun;
- resource use is known;
- resource use is unknown;
- a reservation is still held.

---

# 17. Model invocation records

`ModelInvocationRecord.budget_reservation_id` currently assumes one reservation ID.

5.0A reinterprets/migrates this field to reference the `model-call` Budget Envelope ID, or introduces a clearly named `budget_envelope_id` field while retaining the old field only for schema compatibility.

The chosen schema must make one thing unambiguous:

```text
one logical model invocation
-> one logical multi-dimensional model budget envelope
```

A separate advance wall-time envelope may also exist for the enclosing active segment.

---

# 18. D1 migration strategy

Add a new migration after `0002_phase4_runs.sql` rather than rewriting already-merged Phase 4 history.

Expected logical additions:

```text
arcp_budget_envelopes
(optional indexes / triggers)
```

The migration must preserve existing Phase 4 rows.

Existing `arcp_model_budget_reservations` may remain for backward compatibility during the implementation branch, but once no production path writes new rows there, it is legacy Phase 4 state rather than the canonical 5.0A mechanism.

Do not destructively drop old tables in 5.0A unless a migration test proves old Phase 4 state remains recoverable.

---

# 19. API boundary changes

5.0A is an internal runtime contract change. It does not require new public control-plane routes.

Changed internal interfaces are expected in:

```text
@arcp/workflow-core
  RunStateStorePort
  ModelPort
  clock ports
  budget types

@arcp/adapter-model
  deterministic model adapter

@arcp/adapter-cloudflare
  D1RunStateStore
  runtime clock adapter / composition as needed
```

Public HTTP wire contracts remain unchanged.

---

# 20. Testing strategy

## 20.1 Budget-view parity

Same fixture against in-memory and D1:

```text
create run
reserve envelope
read view
settle envelope
read view
```

Counters must match exactly.

## 20.2 Atomic multi-dimensional reservation

Create a request where four dimensions fit except one.

Expected:

```text
reserve fails
all four ledger rows unchanged
no envelope grant exists
```

## 20.3 Stale-view race

```text
caller A reads 1000 available
caller B reserves 600
caller A tries to reserve 1000
```

Expected:

```text
A atomic reserve fails
consumed/reserved never exceed limit
```

## 20.4 Provider output ceiling

```text
remaining output = 1000
```

Assert the adapter receives `maxOutputTokens <= 1000`.

## 20.5 Unsupported hard limit

Adapter declares/simulates inability to enforce a supplied finite limit.

Expected:

```text
model_limit_unsupported
provider-call counter = 0
```

## 20.6 Input preflight

Serialized input exceeds `maxInputTokens`.

Expected zero provider calls.

## 20.7 Cost ceiling

Configured price bound means requested output limit would exceed `maxCostMicros`.

Adapter must reduce provider limits or fail closed before provider I/O.

## 20.8 Settlement

```text
reserve 1000 output
actual 237
```

Expected:

```text
reserved -= 1000
consumed += 237
released += 763
```

## 20.9 Missing usage

Provider returns success with a hard-enforced dimension missing from usage.

Expected reservation is not silently released as zero.

## 20.10 Waiting does not consume active wall time

Use a deterministic monotonic clock:

```text
advance uses 100ms
run enters waiting-approval
simulate 1 day of provenance/calendar time
resume uses 200ms
```

Expected wall-time consumption = 300ms, not one day.

## 20.11 Provenance time independence

Change `InstantRef` dramatically while monotonic elapsed stays the same.

Expected runtime wall-time usage unchanged.

## 20.12 Monotonic time sensitivity

Keep `InstantRef` fixed while monotonic elapsed changes.

Expected runtime wall-time usage follows monotonic elapsed.

## 20.13 Crash after reservation

Reserve envelope and inject crash before settlement.

Expected:

- reservation remains explicit;
- restart does not reset the run budget;
- recovery cannot assume zero consumption.

## 20.14 Existing Phase 4 regression suite

All Phase 0–4 tests remain green, including:

- duplicate first wake;
- approval/resume;
- crash/reconcile;
- containment mid-run;
- D1/DO integration;
- CTCL temporal invariants.

---

# 21. Security / governance review checklist

For every 5.0A code path, reviewers ask:

1. Can model text enlarge a host budget? **Must be no.**
2. Can a provider adapter read/modify governance state directly? **Must be no.**
3. Can stale budget view cause overspend? **Must be no.**
4. Can a crash release unknown usage as zero? **Must be no.**
5. Can CTCL evidence become a runtime or fencing clock? **Must be no.**
6. Can budget exhaustion imply identity deletion/suspension beyond existing scoped runtime behavior? **Must be no.**
7. Can a future Standing Entity exit/change its Resource relationship without the budget mechanism becoming an ownership claim? **Must remain possible.**
8. Does the design still work if the Agent remains an ordinary tool forever? **Must be yes.**
9. Does the design avoid a hard-to-exit permanent-control mechanism if the Agent later deserves subject treatment? **Must be yes.**

---

# 22. Acceptance criteria

5.0A is complete when all of the following are true:

1. `ProvenanceClockPort` and `MonotonicClockPort` are explicit and tested separately.
2. No persisted monotonic timestamp is used as historical time.
3. `RunStateStorePort.getBudgetView()` exists.
4. D1 and in-memory stores return complete budget views.
5. Missing budget dimensions fail as invalid persisted state.
6. Multi-dimensional Budget Envelope reservation is durable.
7. Envelope reservation is all-or-nothing.
8. Envelope reservation is fencing-protected.
9. Settlement is atomic across all envelope dimensions.
10. Retry with the same envelope ID is idempotent when content matches.
11. Envelope ID collision with different content fails closed.
12. Model turns use one model-call envelope instead of independent post-call token/cost charges.
13. `ModelPort` receives host-enforced `ModelCallLimits`.
14. `ModelTurnInput.budgetView` is populated from real ledger state rather than `{}`.
15. `budgetView` is never treated as authority to enlarge `ModelCallLimits`.
16. Output token ceiling is enforced before provider I/O.
17. Input token ceiling is enforced before provider I/O.
18. Cost ceiling is enforced before provider I/O when the adapter has a safe deterministic price bound.
19. An adapter unable to enforce a supplied finite limit makes zero provider calls.
20. Active wall time uses only `MonotonicClockPort`.
21. Persisted waiting time is excluded from active wall time.
22. Crash before settlement cannot reset reserved resources.
23. Unknown usage is never silently settled as zero.
24. Provider-reported usage above a granted envelope is recorded as a contract violation.
25. Containment remains able to land while an advance is blocked in a model call.
26. Phase 3 CTCL / lease / fencing invariants remain unchanged.
27. Existing claim-before-external-effect semantics remain unchanged.
28. Every budget dimension is documented as HARD_ENFORCED, ACCOUNTED_ONLY, or DECLARED_NOT_APPLICABLE_YET.
29. No non-existent Phase 5 capability is invented solely to make a budget counter appear enforced.
30. Normal CI remains credential-free and network-free.
31. Phase 0–4 regression tests and typecheck pass.

---

# 23. Explicitly locked design decisions

The following are intentionally expensive to reverse and are therefore explicit:

```text
1. provenance clock != monotonic runtime clock
2. budget view != budget grant
3. prompt instruction != provider hard limit
4. adapter translates limits; adapter does not choose governance budget
5. one logical provider call -> one logical multi-dimensional budget envelope
6. envelope reservation is all-or-nothing
7. stale advisory reads never override atomic store guards
8. unknown usage != zero usage
9. persist elapsed amounts, never monotonic timestamp origins
10. hard-enforced means pre-call/provider-bounded, not post-call accounting
11. missing capability != fake enforcement
12. budget authority != identity ownership
```

Replaceable implementation choices include:

- exact TypeScript file split;
- internal helper names;
- deterministic envelope ID prefix;
- D1 index layout;
- provider-specific tokenizer/pricing implementation;
- whether legacy Phase 4 single-dimension model reservation tables remain indefinitely or are removed in a later migration.

---

# 24. Deferred decisions

Explicitly deferred to later phases:

- `PolicyRef` storage/activation — 5.0B;
- production Principal/AuthN/AuthZ — 5.0C;
- typed Entity/Residence/Resource capability targets — 5.1;
- tool-call/network/storage-write metering contracts tied to the adapter SDK — Phase 5 proper;
- distributed or parallel run scheduling;
- cross-Agent shared budget pools;
- autonomous budget self-modification policy;
- whether a future Standing Entity may negotiate/own its own resource budget contract — governance decision, not 5.0A implementation detail.

---

# 25. Design closure

Phase 4 made external effects crash-safe enough to run autonomously within explicit bounds.

Phase 5.0A makes those bounds real at the provider boundary.

The final semantic pipeline is:

```text
Durable budget state
  -> advisory BudgetView
  -> host chooses requested resource envelope
  -> durable atomic grant
  -> host derives hard call limits
  -> adapter proves/enforces limits
  -> provider call
  -> durable usage settlement
  -> unused resources released
```

The model can reason about a budget, but cannot grant itself more budget.

The adapter can translate a budget, but cannot become the budget authority.

The runtime can limit resource use, but that limitation does not become an ownership claim over the Agent.
