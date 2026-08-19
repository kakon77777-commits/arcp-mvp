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

Phase 5.0A treats budget as Resource governance only:

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

Concrete failure:

```text
remaining model_output_tokens = 1_000
provider is called without a hard output ceiling
provider returns 4_000 output tokens
ARCP notices 3_000 tokens of overspend after the fact
```

5.0A changes the order to:

```text
read durable budget
  -> atomically reserve a bounded envelope
  -> derive host-enforced provider limits
  -> record the durable pre-call boundary
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
- atomic all-or-nothing envelope reservation and settlement;
- durable pre-call model invocation lifecycle (`reserved -> calling -> terminal/unknown`);
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
- live pricing discovery;
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

but the Phase 4 orchestrator currently supplies `{}`.

More importantly, `budgetView` is informational state. It is not itself a permission or execution ceiling.

## 3.2 `RunStateStorePort` cannot read the budget ledger

The in-memory store has an internal `budgetView(runId)` helper, but it is not part of `RunStateStorePort`. `D1RunStateStore` has no corresponding read method.

Therefore this path does not currently exist:

```text
D1 ledger
  -> orchestrator
  -> live budget snapshot
```

## 3.3 Provider limits are not a `ModelPort` contract

Current interface:

```ts
interface ModelPort {
  deliberate(input: ModelTurnInput): Promise<ModelTurnProposal>;
}
```

There is no host-enforced ceiling argument. A prompt instruction such as “do not use more than 1000 tokens” is not an execution control.

## 3.4 `max_wall_time_ms` has no valid duration clock

The orchestrator's current `now()` returns `InstantRef`. That value exists for provenance and temporal evidence. Reusing it for elapsed runtime would collapse two semantic domains that Phase 3 deliberately separated.

## 3.5 Model invocation statuses exist but are not a durable call boundary

`ModelInvocationStatus` already includes:

```text
reserved
calling
succeeded
failed
unknown
```

but the current store API only appends invocation records after or around outcomes; there is no authoritative persisted transition proving whether provider I/O had definitely not begun or may already have begun.

Without this distinction, an abandoned budget envelope cannot safely decide whether it may be released.

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

Rejected because:

- a crash can happen after reserving some dimensions but before others;
- one call does not obtain one coherent resource grant;
- retries need to reconstruct which subset was reserved;
- resource authority becomes fragmented across multiple records.

## Option B — Durable multi-dimensional Budget Envelope

```text
getBudgetView
-> compute requested envelope
-> one atomic reserve operation for all dimensions
-> receive granted envelope
-> derive call limits from the grant
-> durable calling boundary
-> provider call
-> settle actual usage
```

**Selected.**

Advantages:

- one provider call maps to one durable resource-grant object;
- reservation is all-or-nothing;
- recovery has a single durable identifier;
- host limits derive from granted resources, not from a stale advisory read;
- the primitive can later be reused for tools/network/storage.

## Option C — Let each provider adapter read the store and self-budget

Rejected.

It would invert the architecture:

```text
provider adapter
  -> reads governance state
  -> decides usable budget
  -> becomes part policy engine / scheduler
```

Adapters may translate host limits into provider-specific request parameters, but they must not acquire authority to choose or enlarge the host's budget.

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
- may appear in persisted records;
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

Correct:

```text
reserve wall_time_ms = 20_000
measure local elapsed = 8_421
settle actual wall_time_ms = 8_421
release 11_579
```

Only resource amounts are durable.

## 5.3 Active wall time

`max_wall_time_ms` means cumulative **active orchestration execution time**.

It includes time spent inside an active `advance()` execution, including waits on active provider calls.

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
-> active orchestration
-> before each provider/effect segment, verify remaining granted time > 0
-> pass remaining relative duration to bounded provider ports
-> t1 = monotonicClock.nowMs()
-> settle exact elapsed when elapsed <= reserved amount
-> return / persist waiting / terminal state
```

If observed elapsed exceeds the reservation, ARCP **must not clamp it with `min()` and pretend the bound held**. That is a runtime-limit contract violation:

```text
elapsed > reserved
-> record runtime_wall_time_exhausted / contract violation
-> consume at least the entire reserved amount
-> do not release any wall-time remainder
-> fail closed for further active work in that run
```

The reservation is intentionally conservative. Because Phase 4 advances are serialized per run, reserving the available wall-time remainder does not reduce useful same-run concurrency.

---

# 6. Durable budget view

## 6.1 Port contract

`RunStateStorePort` adds:

```ts
getBudgetView(runId: string): Promise<RunBudgetView>;
```

## 6.2 Budget view becomes complete

The current type is a `Partial<Record<...>>`. 5.0A changes the authoritative store return value to include all declared dimensions:

```ts
export type RunBudgetView = Record<BudgetDimension, BudgetCounterView>;
```

Every run initializes every dimension.

For optional model limits, an omitted resolved `RunBudgetSpec` field becomes a numeric **zero**, preserving the existing rule:

```text
missing budget != unlimited budget
```

A zero limit means no consumption is authorized for that dimension. It is never interpreted as “unbounded” or silently omitted from hard-limit checks.

Missing ledger rows are `invalid_persisted_state`.

## 6.3 Counter semantics

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

`released` is cumulative audit information and is not subtracted again.

## 6.4 D1 read semantics

D1 returns one consistent ledger snapshot for the run. The authoritative reservation operation still rechecks limits atomically.

Therefore:

```text
budget view can become stale
atomic reserve cannot trust the old view
```

`getBudgetView()` is for planning and informational model context; it is not the concurrency guard.

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

Envelope IDs are deterministic for retryable logical segments where possible, using canonical structured hashing rather than delimiter-concatenated identity.

Examples:

```text
advance envelope = hash(run_id, fencing_token, kind=advance)
model envelope = hash(run_id, turn_index, kind=model-call)
```

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
  actuals: Array<{ dimension: BudgetDimension; amount: number }>;
  settledAt: InstantRef;
}): Promise<BudgetEnvelopeRecord>;

releaseBudgetEnvelope(input: {
  runId: string;
  envelopeId: string;
  releasedAt: InstantRef;
}): Promise<BudgetEnvelopeRecord>;

getBudgetEnvelope(envelopeId: string): Promise<BudgetEnvelopeRecord | null>;
```

Settlement requires an exact actual-value entry for **every reserved dimension**. Missing actuals cannot silently become zero.

For a model-call envelope this means, for example:

```text
turns -> actual 1
input tokens -> authoritative reported/reconciled actual
output tokens -> authoritative reported/reconciled actual
cost -> authoritative reported/reconciled actual
```

If an actual cannot be established, the envelope moves to `recovery-required` instead of normal settlement.

Existing Phase 4 `reserveModelBudget` / `settleModelBudget` may remain temporarily for compatibility, but the orchestrator must stop using them for new model calls once 5.0A lands.

## 7.4 Atomic reservation invariant

For one envelope:

```text
ALL requested dimensions reserve
OR
NONE reserve
```

Never leave:

```text
turns reserved
output tokens reserved
cost reservation failed
```

## 7.5 Atomic settlement invariant

For a normally settled envelope:

```text
ALL reserved dimensions settle/release remainder
OR
NONE transition to settled
```

No subset may settle independently under one envelope.

## 7.6 D1 storage

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
- structurally invalid envelope data.

If any item fails, the statement aborts and no ledger row is changed.

An idempotent retry with the same envelope ID and same canonical content returns the existing envelope. Same ID with different content is an `invalid_persisted_state` / envelope conflict.

Settlement uses one status-changing statement plus validation/settlement triggers so all dimensions move together.

## 7.7 In-memory parity

`InMemoryRunStateStore` implements the same semantics under one synchronous mutation boundary.

A contract/parity suite runs the same envelope fixtures against:

```text
InMemoryRunStateStore
D1RunStateStore on node:sqlite-compatible semantics
```

The D1 migration remains the normative persisted SQL behavior.

---

# 8. Durable model-call boundary

## 8.1 Why envelope state alone is not enough

An envelope can tell us “resources were reserved,” but not whether a crash happened:

```text
before provider I/O
or
after provider I/O began
```

That distinction decides whether releasing the reservation is safe.

## 8.2 Promote existing invocation statuses to a real persisted lifecycle

Before provider I/O:

```text
reserve model-call envelope
-> create ModelInvocationRecord(status=reserved, budget_envelope_id=...)
-> adapter performs local preflight only
-> durable transition invocation status: reserved -> calling
-> provider I/O may begin
```

After return/failure:

```text
calling -> succeeded | failed | unknown
```

Required store operations are conceptually:

```ts
createModelInvocation(record): Promise<ModelInvocationRecord>;
getModelInvocation(invocationId): Promise<ModelInvocationRecord | null>;
updateModelInvocationStatus(invocationId, expectedStatus, nextRecord): Promise<ModelInvocationRecord>;
```

The exact method names may differ, but the transition must be durable and compare-and-set/idempotent enough that a stale worker cannot move a completed call backward.

## 8.3 Recovery meaning

```text
invocation=reserved
-> provider I/O definitely did not cross the durable calling boundary
-> envelope may be safely released after normal validation

invocation=calling
-> provider may have consumed resources
-> envelope must not be released as zero
-> reconcile usage if possible, otherwise conservatively consume reserved maxima

invocation=succeeded/failed/unknown
-> follow recorded/reconciled usage semantics
```

The durable `calling` transition must occur immediately before provider I/O and after all local limit checks that can fail without network/provider effects.

---

# 9. Model call resource flow

## 9.1 Model budget envelope

Before each model call the orchestrator obtains a live budget view and requests one `model-call` envelope covering:

```text
turns = 1
model_input_tokens = currently available amount
model_output_tokens = currently available amount
model_cost_micros = currently available amount
```

Because omitted optional model limits resolve to zero:

```text
available model dimension = 0
-> no consumption authorized
-> no provider call that would consume that dimension
```

There is no “undefined means unlimited” escape hatch.

The envelope request is conservative: the call temporarily reserves the available remainder for those dimensions. Sequential execution means this does not reduce useful same-run concurrency.

## 9.2 Informational `budgetView`

`ModelTurnInput.budgetView` is populated from real durable ledger state, not `{}`.

The exact snapshot point is documented: the orchestrator may pass the post-reservation view so the model sees truthful current `reserved/consumed/limit` counters. The current call's actual enforceable grant is represented by the separate `ModelCallLimits`; a model never needs to infer authority from the advisory view.

```text
model sees budget state
!= model controls budget
```

## 9.3 Host-enforced `ModelCallLimits`

This design refines the entry-gate draft name `activeDeadlineMs` to avoid ambiguity about absolute monotonic origins.

Final interface:

```ts
export interface ModelCallLimits {
  maxOutputTokens: number;
  maxInputTokens: number;
  maxCostMicros: number;
  maxActiveDurationMs: number;
}

export interface ModelPort {
  deliberate(
    input: ModelTurnInput,
    limits: ModelCallLimits,
  ): Promise<ModelTurnProposal>;
}
```

All four limits are finite numeric values for a model call. A zero value means the call is not authorized to consume that resource and therefore must not cross provider I/O.

`maxActiveDurationMs` is a **relative duration ceiling from call entry**, never a persisted or globally-comparable deadline timestamp.

It is intentionally distinct from:

```text
InstantRef
Date.now()
lease valid_until
fencing token
```

## 9.4 Limit derivation

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

## 9.5 Provider adapter contract

A `ModelPort` implementation must validate and enforce all supplied limits **before external provider I/O begins**.

Allowed implementation methods include:

- native provider output-token ceiling;
- exact provider tokenizer for input bound;
- a mathematically conservative tokenizer upper bound;
- configured, versioned worst-case price bounds to turn `maxCostMicros` into stricter token limits;
- provider request timeout/cancellation mechanisms for active duration.

Not sufficient:

- prompt text asking the model to stop;
- average historical token use;
- optimistic price estimates;
- checking usage only after the call;
- a timeout wrapper that does not actually prevent/abort provider resource consumption while claiming hard enforcement.

If the adapter cannot prove a supplied finite limit can be enforced, it fails **before the durable `calling` transition and before provider I/O** with a provider-neutral error such as:

```text
model_limit_unsupported
```

## 9.6 Deterministic adapter

`DeterministicModelAdapter` records both inputs and limits.

It supports tests proving:

```text
host grants 1000 output tokens
-> adapter never observes a limit > 1000
```

and simulated unsupported-limit failures occur with zero fake-provider calls.

---

# 10. Input-token enforcement

The final provider payload may include adapter-specific wrappers not visible to the orchestrator.

Therefore:

```text
orchestrator grants maxInputTokens
adapter serializes final request
adapter proves serialized request <= maxInputTokens
only then durable calling boundary + provider I/O
```

The orchestrator must not pretend it knows provider tokenization merely because it knows the structured `ModelTurnInput` object.

A live adapter with no exact tokenizer may use only a documented conservative upper-bound method. An unproven heuristic is not a hard cap.

---

# 11. Cost enforcement

## 11.1 Cost is a pre-call maximum

`maxCostMicros` means:

> the adapter must construct a request whose worst-case billable cost is no greater than this amount under its configured deterministic pricing bound.

## 11.2 Adapter-owned translation, host-owned authority

The host chooses:

```text
maxCostMicros = durable granted amount
```

The adapter may know provider-specific pricing and translate that host ceiling into stricter input/output token limits.

It may only reduce the provider request. It cannot enlarge the host grant.

## 11.3 Pricing source

5.0A does not add live network pricing discovery.

A future live provider adapter uses a configured/versioned worst-case pricing bound or another deterministic source known before the call.

If the adapter cannot establish a safe upper bound, it fails closed before the `calling` transition and provider I/O.

---

# 12. Normal settlement

## 12.1 Successful model call

After `ModelPort.deliberate()` returns a valid proposal:

```text
proposal.usage
-> validate finite/non-negative
-> obtain actual for every reserved model dimension
-> verify actual <= reservation
-> transition invocation to succeeded
-> atomically settle model-call envelope
-> release unused reservation
```

Example:

```text
reserved output tokens = 1000
actual output tokens = 237

reserved -= 1000
consumed += 237
released += 763
```

## 12.2 Missing usage

For a hard-enforced dimension whose final actual use is missing:

- do not settle it as zero;
- do not silently release the reservation;
- mark invocation/envelope recovery-required or unknown;
- reconcile authoritative usage if the adapter supports it;
- otherwise conservatively resolve to the reserved upper bound.

Hard enforcement and exact accounting are separate problems. Lack of a receipt does not prove zero consumption.

## 12.3 Reported usage above reservation

If a provider reports actual usage greater than its granted envelope, this is a provider/adapter contract violation.

ARCP must:

- preserve the reported evidence;
- mark the invocation/envelope as violated/recovery-required;
- not erase the overspend;
- not force the budget ledger negative merely to make the numbers fit;
- fail closed for future calls through that adapter until explicit review/recovery policy resolves it.

---

# 13. Crash semantics

## 13.1 Crash before envelope reserve

No resources are reserved. Safe to retry.

## 13.2 Crash after envelope reserve, invocation still `reserved`

Provider I/O definitely did not cross the durable call boundary.

After validating the same logical invocation/envelope, recovery may release the envelope and retry.

## 13.3 Crash after invocation becomes `calling`

Provider may have consumed resources.

The envelope remains reserved.

For providers with authoritative usage reconciliation, settle reconciled actuals.

Without such reconciliation, the safe default is to consume the reserved upper bounds rather than assume zero.

## 13.4 Crash after provider returns but before settlement

The invocation outcome/usage record and envelope lifecycle determine recovery. If exact usage was durably recorded, settle from that evidence. If not, treat it as unknown consumption.

## 13.5 Wall-time crash semantics

A persisted monotonic timestamp is forbidden, so exact elapsed time cannot be reconstructed after process death.

The conservative recovery rule is:

```text
unsettled active wall-time reservation
-> exact elapsed unknown
-> do not release as zero
-> resolve to reserved upper bound unless stronger local durable evidence exists
```

This may consume more budget than actually used, but it cannot allow an unbounded run through optimistic accounting.

---

# 14. Wall-time enforcement inside calls

The advance-level wall-time envelope grants the total active time available for that advance.

Before each provider/effect segment:

```text
elapsed_so_far = monotonicNow - advanceStart
remaining_granted_wall_time = advanceReserved - elapsed_so_far
```

If non-positive, do not start another external/provider segment.

For model calls, the positive relative remainder becomes `ModelCallLimits.maxActiveDurationMs`.

A ModelPort that cannot enforce/abort within that duration cannot claim hard wall-time enforcement and must fail before provider I/O.

The existing `ActionExecutorPort` remains governed by Phase 4's claim-before-effect semantics. If 5.0A implementation adds an equivalent action-call duration limit, it must be tested as a real abort/provider bound. Otherwise documentation must classify executor-call wall time honestly rather than claiming a hard cancellation boundary that does not exist.

---

# 15. Remaining budget dimensions (A4)

5.0A uses three statuses:

```text
HARD_ENFORCED
ACCOUNTED_ONLY
DECLARED_NOT_APPLICABLE_YET
```

Every dimension must have an explicit status.

Target after 5.0A:

| Dimension | Target status | Notes |
|---|---|---|
| `turns` | HARD_ENFORCED | included in model-call envelope |
| `wall_time_ms` | HARD_ENFORCED for active orchestration start + ModelPort boundary | monotonic advance envelope; model adapter must enforce duration |
| `model_input_tokens` | HARD_ENFORCED | adapter preflight/tokenizer bound |
| `model_output_tokens` | HARD_ENFORCED | native or stricter provider request ceiling |
| `model_cost_micros` | HARD_ENFORCED when adapter has deterministic safe price bound | otherwise model call fails closed |
| `external_actions` | HARD_ENFORCED | existing claim-before-effect path |
| `tool_calls` | DECLARED_NOT_APPLICABLE_YET | no Phase 5 tool capability boundary exists yet |
| `storage_writes` | ACCOUNTED_ONLY or DECLARED_NOT_APPLICABLE_YET | do not invent a count without a defined operation boundary |
| `network_requests` | DECLARED_NOT_APPLICABLE_YET | adapter SDK must define network consumption semantics |
| `recursive_wakes` | DECLARED_NOT_APPLICABLE_YET | no self-triggering recursive-wake runtime exists yet |

If implementation evidence cannot support a target HARD_ENFORCED classification, documentation downgrades it rather than weakening the definition of “hard enforced.”

---

# 16. Fencing and concurrency

## 16.1 Envelope reservation requires current fencing

Every reservation request includes the run's current fencing token.

D1/in-memory stores reject stale fencing before granting resources.

## 16.2 Budget view is advisory under concurrency

Generic store semantics must not rely only on the Durable Object's per-run advance queue.

Example:

```text
getBudgetView says 1000 available
another mutation consumes 500
old caller requests 1000
atomic reserve rejects
```

No stale read can force overspend.

## 16.3 Containment remains preemptive

5.0A must not reintroduce a fetch-wide queue through budget locking.

Containment/approval/read requests continue to bypass the advance queue. A containment may become durable while an advance awaits a model call; later action/effect boundaries re-read containment according to Phase 4 semantics.

---

# 17. Error model

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

Every error path preserves whether:

- provider I/O definitely did not begin;
- provider I/O may have begun;
- resource use is known;
- resource use is unknown;
- a reservation is still held.

---

# 18. Model invocation schema/store changes

`ModelInvocationRecord.budget_reservation_id` currently assumes one reservation ID.

5.0A either:

1. introduces `budget_envelope_id` and retains `budget_reservation_id` only for backward schema compatibility; or
2. explicitly migrates the meaning of the old field.

**Selected semantic requirement:** the schema must have an unambiguous `budget_envelope_id` for new 5.0A records. The old field may remain optional for reading Phase 4 records but must not be the canonical new meaning.

One logical model invocation maps to one logical multi-dimensional model-call envelope:

```text
ModelInvocationRecord
  -> budget_envelope_id
  -> BudgetEnvelopeRecord(kind=model-call)
```

The enclosing advance wall-time envelope is separate.

The store must support durable invocation lifecycle transitions instead of append-only outcome recording.

---

# 19. D1 migration strategy

Add a new migration after `0002_phase4_runs.sql`; do not rewrite merged Phase 4 history.

Expected logical additions:

```text
arcp_budget_envelopes
model invocation lifecycle columns or equivalent persisted fields
indexes / validation / settlement triggers
```

The envelope implementation may use D1/SQLite JSON table functions to validate/update all dimension items from one JSON payload within one statement-trigger transaction boundary.

Existing Phase 4 rows remain readable.

Existing `arcp_model_budget_reservations` may remain during compatibility/migration, but once new model calls use Budget Envelopes it is legacy Phase 4 state rather than the canonical 5.0A path.

Do not destructively drop old tables in 5.0A unless explicit migration tests prove old Phase 4 state remains recoverable.

---

# 20. API boundary changes

5.0A is an internal runtime contract change. It does not require new public control-plane routes.

Expected changed interfaces:

```text
@arcp/workflow-core
  RunStateStorePort
  ModelPort
  clock ports
  budget-envelope types
  model invocation lifecycle

@arcp/adapter-model
  deterministic ModelPort

@arcp/adapter-cloudflare
  D1RunStateStore
  D1 migration
  runtime clock composition as needed
```

Public HTTP wire contracts remain unchanged.

---

# 21. Testing strategy

## 21.1 Budget-view parity

Same fixture against in-memory and D1:

```text
create run
reserve envelope
read view
settle envelope
read view
```

Counters must match exactly.

## 21.2 Atomic multi-dimensional reservation

Create an envelope where every dimension fits except one.

Expected:

```text
reserve fails
all ledger rows unchanged
no envelope grant exists
```

## 21.3 Atomic settlement

Attempt settlement with one invalid actual among otherwise-valid dimensions.

Expected:

```text
settlement fails
no dimension settles
```

## 21.4 Stale-view race

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

## 21.5 Provider output ceiling

```text
remaining output = 1000
```

Assert the adapter receives `maxOutputTokens <= 1000`.

## 21.6 Unsupported hard limit

Adapter cannot enforce one finite supplied limit.

Expected:

```text
model_limit_unsupported
invocation never reaches calling
provider-call counter = 0
```

## 21.7 Input preflight

Serialized input exceeds `maxInputTokens`.

Expected zero provider calls and no `calling` transition.

## 21.8 Cost ceiling

Configured price bound means the requested output/input maxima would exceed `maxCostMicros`.

Adapter must reduce provider limits or fail closed before `calling`/provider I/O.

## 21.9 Settlement

```text
reserve output 1000
actual output 237
```

Expected:

```text
reserved -= 1000
consumed += 237
released += 763
```

## 21.10 Missing usage

Provider returns without authoritative actual for a reserved dimension.

Expected reservation is not silently released as zero.

## 21.11 Waiting does not consume active wall time

Use deterministic clocks:

```text
advance active time = 100ms
run enters waiting-approval
provenance/calendar jumps by 1 day
resume active time = 200ms
```

Expected wall-time consumption = 300ms, not one day.

## 21.12 Provenance-time independence

Change `InstantRef` dramatically while monotonic elapsed stays the same.

Expected runtime wall-time usage unchanged.

## 21.13 Monotonic sensitivity

Keep `InstantRef` fixed while monotonic elapsed changes.

Expected runtime wall-time usage follows monotonic elapsed.

## 21.14 Wall-time overrun is not clamped

Reserve 100ms, simulate 150ms elapsed.

Expected:

```text
runtime_wall_time_exhausted / contract violation
no released wall-time remainder
no further active work
```

## 21.15 Crash while invocation is `reserved`

Expected safe release/retry after validating provider I/O never crossed the durable boundary.

## 21.16 Crash while invocation is `calling`

Expected envelope remains held; no zero-consumption assumption; reconcile or conservatively consume maximum.

## 21.17 Containment preemption regression

Use a blocking model call. While it is in flight, a containment request must still become durable without waiting behind the advance queue.

## 21.18 Existing regression suite

All Phase 0–4 tests remain green, including:

- duplicate first wake;
- approval/resume;
- crash/reconcile;
- containment mid-run;
- D1/DO integration;
- CTCL temporal invariants.

---

# 22. Security / governance review checklist

For every 5.0A code path, reviewers ask:

1. Can model text enlarge a host budget? **Must be no.**
2. Can a provider adapter read/modify governance state directly? **Must be no.**
3. Can stale budget view cause overspend? **Must be no.**
4. Can a crash release unknown usage as zero? **Must be no.**
5. Can CTCL evidence become a runtime or fencing clock? **Must be no.**
6. Can elapsed wall time be clamped to hide a hard-limit violation? **Must be no.**
7. Can an invocation in `calling` be treated as “provider definitely never ran”? **Must be no.**
8. Can omitted model-budget fields become unlimited? **Must be no.**
9. Can budget exhaustion imply identity deletion or a subjecthood judgment? **Must be no.**
10. Can a future Standing Entity exit/change its Resource relationship without the budget mechanism becoming an ownership claim? **Must remain possible.**
11. Does the design work if the Agent remains an ordinary tool forever? **Must be yes.**
12. Does the design avoid hard-to-exit permanent control if the Agent later deserves subject treatment? **Must be yes.**

---

# 23. Acceptance criteria

5.0A is complete when all are true:

1. `ProvenanceClockPort` and `MonotonicClockPort` are explicit and tested separately.
2. No persisted monotonic timestamp is used as historical time.
3. `RunStateStorePort.getBudgetView()` exists.
4. D1 and in-memory stores return complete budget views.
5. Missing budget dimensions fail as invalid persisted state.
6. Omitted optional model budget fields resolve to zero, never unlimited.
7. Multi-dimensional Budget Envelope reservation is durable.
8. Envelope reservation is all-or-nothing.
9. Envelope reservation is fencing-protected.
10. Envelope settlement is all-or-nothing across dimensions.
11. Retry with same envelope ID/content is idempotent.
12. Envelope ID collision with different content fails closed.
13. Model turns use one model-call envelope instead of independent post-call token/cost charges.
14. `ModelInvocationRecord` has an unambiguous new `budget_envelope_id` path.
15. Model invocation lifecycle has a durable `reserved -> calling` boundary before provider I/O.
16. Crash recovery distinguishes `reserved` from `calling`.
17. `ModelPort` receives host-enforced `ModelCallLimits`.
18. `ModelTurnInput.budgetView` is populated from durable ledger state rather than `{}`.
19. `budgetView` is never treated as authority to enlarge `ModelCallLimits`.
20. Output token ceiling is enforced before provider I/O.
21. Input token ceiling is enforced before provider I/O.
22. Cost ceiling is enforced before provider I/O when the adapter has a deterministic safe price bound.
23. An adapter unable to enforce any supplied finite limit makes zero provider calls.
24. Active wall time uses only `MonotonicClockPort`.
25. Persisted waiting time is excluded from active wall time.
26. Wall-time overrun is recorded as a violation rather than clamped away.
27. Crash before settlement cannot reset reserved resources.
28. Unknown usage is never silently settled as zero.
29. Provider-reported usage above a granted envelope is recorded as a contract violation.
30. Containment remains able to land while an advance is blocked in a model call.
31. Phase 3 CTCL / lease / fencing invariants remain unchanged.
32. Existing claim-before-external-effect semantics remain unchanged.
33. Every budget dimension is documented as HARD_ENFORCED, ACCOUNTED_ONLY, or DECLARED_NOT_APPLICABLE_YET.
34. No non-existent Phase 5 capability is invented solely to make a budget counter appear enforced.
35. Normal CI remains credential-free and network-free.
36. Phase 0–4 regression tests and typecheck pass.

---

# 24. Explicitly locked design decisions

```text
1. provenance clock != monotonic runtime clock
2. budget view != budget grant
3. prompt instruction != provider hard limit
4. adapter translates limits; adapter does not choose governance budget
5. one logical provider call -> one logical multi-dimensional budget envelope
6. envelope reservation is all-or-nothing
7. envelope settlement is all-or-nothing
8. stale advisory reads never override atomic store guards
9. unknown usage != zero usage
10. reserved invocation != calling invocation
11. persist elapsed amounts, never monotonic timestamp origins
12. wall-time overrun != clamped success
13. omitted model budget != unlimited budget
14. hard-enforced means pre-call/provider-bounded, not post-call accounting
15. missing capability != fake enforcement
16. budget authority != identity ownership
```

Replaceable implementation choices include:

- exact TypeScript file split;
- internal helper names;
- deterministic envelope ID prefix;
- D1 index layout;
- provider-specific tokenizer/pricing implementation;
- whether legacy Phase 4 single-dimension model reservation tables remain indefinitely or are removed in a later migration.

---

# 25. Deferred decisions

Explicitly deferred:

- `PolicyRef` storage/activation — 5.0B;
- production Principal/AuthN/AuthZ — 5.0C;
- typed Entity/Residence/Resource capability targets — 5.1;
- full tool-call/network/storage-write metering contracts tied to the adapter SDK — Phase 5 proper;
- distributed or parallel run scheduling;
- cross-Agent shared budget pools;
- autonomous budget self-modification policy;
- whether a future Standing Entity may negotiate/own its own resource budget contract — governance decision, not 5.0A implementation detail.

---

# 26. Self-review hardening applied

Before review handoff, this spec was re-read against the current Phase 4 code and tightened in four places:

1. **Wall-time overrun:** removed the unsafe idea of settling `min(elapsed, reserved)`, which would hide a real overrun. Overrun is now an explicit violation with no released remainder.
2. **Crash boundary:** promoted existing `ModelInvocationStatus` values into a required durable `reserved -> calling` transition so recovery can distinguish “provider definitely not called” from “provider may have consumed resources.”
3. **Missing usage:** normal envelope settlement now requires actual values for every reserved dimension; missing values enter recovery instead of becoming zero.
4. **Optional model budgets:** omitted optional model limits resolve to zero, preserving `missing budget != unlimited`.

No unresolved `TBD` or `TODO` semantics are intentionally left in this design. Provider-vendor details, 5.0B/5.0C, and Phase 5 capability metering are explicit deferred scope rather than placeholders.

---

# 27. Design closure

Phase 4 made external effects crash-safe enough to run autonomously within explicit bounds.

Phase 5.0A makes those bounds real at the provider boundary.

Final semantic pipeline:

```text
Durable budget state
  -> advisory BudgetView
  -> host chooses requested resource envelope
  -> durable atomic grant
  -> durable invocation reserved state
  -> adapter local preflight
  -> durable calling boundary
  -> host-derived hard call limits
  -> provider call
  -> durable usage/outcome evidence
  -> atomic envelope settlement
  -> unused resources released
```

The model can reason about a budget, but cannot grant itself more budget.

The adapter can translate a budget, but cannot become the budget authority.

The runtime can limit resource use, but that limitation does not become an ownership claim over the Agent.
