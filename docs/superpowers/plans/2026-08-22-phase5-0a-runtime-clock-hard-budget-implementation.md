# Phase 5.0A Runtime Clock & Hard Budget Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phase 4 post-call model budget accounting with crash-safe, host-enforced multi-dimensional budget envelopes, explicit provenance/monotonic clock separation, and a durable preflight → calling → provider-I/O boundary before Phase 5 MCP capabilities are exposed.

**Architecture:** `RunStateStorePort` becomes the single source of durable budget truth through complete `RunBudgetView` snapshots and atomic `BudgetEnvelopeRecord` reservation/settlement. The orchestrator derives host-owned `ModelCallLimits` from already-granted envelopes, while `ModelPort.prepareCall()` performs zero-I/O provider-specific preflight and returns a process-local `PreparedModelCall`; only after the host durably CAS-transitions the invocation from `reserved` to `calling` may `PreparedModelCall.execute()` cross provider I/O. Active runtime duration uses an injected `MonotonicClockPort`; persisted timestamps continue to come only from `ProvenanceClockPort`/`InstantRef`.

**Tech Stack:** TypeScript 5.9, Node 24 CI, pnpm 11, Vitest 3, SQLite / Cloudflare D1-compatible SQL, existing `@arcp/schema`, `@arcp/workflow-core`, `@arcp/adapter-model`, and `@arcp/adapter-cloudflare` packages.

**Spec:**
- `docs/superpowers/specs/2026-08-19-phase5-0a-runtime-clock-hard-budget-design.md`
- `docs/superpowers/specs/2026-08-19-phase5-0a-model-call-boundary-amendment.md`
- Binding entry gate: `PHASE5_ENTRY_GATE.md`

## Global Constraints

- Preserve `CTCL / InstantRef = provenance evidence`; never use CTCL evidence as runtime duration, lease validity, or fencing-order time.
- Preserve `budget authority != identity authority`, `budget exhaustion != deletion authority`, and `resource authority != identity authority`.
- `budgetView` is advisory state only; it MUST NOT grant or enlarge provider-call authority.
- A model/provider call MUST NOT begin unless durable budget reservation already covers its maximum authorized resource use.
- A provider adapter MUST NOT read or mutate `RunStateStorePort` directly.
- Provider preflight MUST perform zero provider/network I/O.
- Durable invocation transition `reserved -> calling` MUST occur after local preflight and immediately before provider I/O may begin.
- Missing usage MUST NOT settle as zero.
- Omitted optional model budgets resolve to numeric zero, never unlimited.
- Multi-dimensional envelope reservation and settlement are all-or-nothing.
- Wall-time overrun is a violation; never hide it by settling `min(elapsed, reserved)`.
- A crash while invocation is `calling` may conservatively consume the full reserved maxima; this is an explicit accepted fail-closed tradeoff.
- `BudgetEnvelopeKind` may include forward scaffolding (`tool-call`, `storage-operation`, `network-operation`, `recursive-wake`), but no such dimension may be documented as enforced until a real consumption boundary exists.
- Existing Phase 4 `reserveModelBudget` / `settleModelBudget` persistence stays readable for migration compatibility, but new orchestrated model calls MUST use Budget Envelopes.
- Normal CI remains credential-free and network-free.
- All Phase 0–4 tests remain green.

---

## File Structure Map

### Persisted schema / workflow contracts

- Modify `packages/arcp-schema/src/types.ts`
  - persisted `BudgetEnvelopeRecord` and envelope item/status types;
  - `ModelInvocationRecord.budget_envelope_id` for new records while retaining legacy reservation compatibility.
- Modify `packages/workflow-core/src/budget.ts`
  - make authoritative `RunBudgetView` complete, not partial;
  - add pure helpers for available-budget computation and envelope item validation.
- Modify `packages/workflow-core/src/types.ts`
  - add `ModelCallLimits`, `PreparedModelCall`, envelope input types if they are not persisted schema types.
- Modify `packages/workflow-core/src/ports.ts`
  - add `ProvenanceClockPort`, `MonotonicClockPort`;
  - change `ModelPort` to `prepareCall()`;
  - add budget-view/envelope/invocation lifecycle operations to `RunStateStorePort`.
- Modify `packages/workflow-core/src/errors.ts`
  - add Phase 5.0A provider-neutral error codes.
- Modify `packages/workflow-core/src/index.ts`
  - export new types/helpers.

### Stores / persistence

- Modify `packages/workflow-core/src/in-memory-store.ts`
  - complete budget view;
  - atomic envelope reserve/settle/release/recovery;
  - durable model invocation create/read/CAS lifecycle.
- Create `migrations/d1/0003_phase5_0a_budget_envelopes.sql`
  - envelope table;
  - invocation status/envelope-link migration;
  - atomic JSON-based envelope reservation/settlement triggers.
- Modify `packages/adapters/cloudflare/src/d1-run-state-store.ts`
  - implement D1 parity with in-memory store.

### Model adapter / orchestration

- Modify `packages/adapters/model/src/fake.ts`
  - deterministic local-only `prepareCall()` + process-local `PreparedModelCall.execute()`;
  - separate prepare and execute counters;
  - deterministic unsupported-limit simulation.
- Create `packages/workflow-core/src/model-call-budget.ts`
  - pure host-side helpers for envelope request and `ModelCallLimits` derivation;
  - no provider-specific tokenizer/pricing logic.
- Modify `packages/workflow-core/src/orchestrator.ts`
  - replace `now()` option with explicit provenance/monotonic clocks;
  - add advance wall-time envelope;
  - replace per-dimension model reservation/`chargeReportedUsage()` path with model-call envelope + prepared-call lifecycle;
  - add conservative model-call crash recovery.

### Test support / tests

- Create `tests/helpers/fake-clocks.ts`
  - deterministic provenance and monotonic clock fixtures.
- Create `tests/unit/run-budget-envelope.test.ts`
- Create `tests/integration/budget-envelope-parity.test.ts`
- Modify `tests/unit/d1-run-state-store.test.ts`
- Modify `tests/unit/model-port.test.ts`
- Modify `tests/unit/bounded-run-orchestrator.test.ts`
- Create `tests/integration/phase5-0a-model-budget.test.ts`
- Create `tests/integration/phase5-0a-model-crash-recovery.test.ts`
- Create `tests/integration/phase5-0a-wall-time.test.ts`
- Modify all existing tests that instantiate `BoundedRunOrchestrator` to inject the two explicit clocks; preserve their behavioral assertions unchanged otherwise.

### Documentation

- Modify `README.md`
  - document enforced/accounted/not-applicable dimensions after implementation evidence exists;
  - link 5.0A design/plan;
  - do not claim live provider activation.
- Modify `PHASE5_ENTRY_GATE.md` only if implementation evidence requires wording clarification; do not weaken binding semantics.

---

### Task 1: Lock Phase 5.0A Schema, Clock, and Model-Port Contracts

**Files:**
- Modify: `packages/arcp-schema/src/types.ts`
- Modify: `packages/workflow-core/src/budget.ts`
- Modify: `packages/workflow-core/src/types.ts`
- Modify: `packages/workflow-core/src/ports.ts`
- Modify: `packages/workflow-core/src/errors.ts`
- Modify: `packages/workflow-core/src/index.ts`
- Create: `tests/helpers/fake-clocks.ts`
- Create: `tests/unit/phase5-0a-contracts.test.ts`
- Modify: `tests/unit/model-port.test.ts`

**Interfaces:**
- Produces:
  - `ProvenanceClockPort { now(): InstantRef }`
  - `MonotonicClockPort { nowMs(): number }`
  - complete `RunBudgetView = Record<BudgetDimension, BudgetCounterView>`
  - persisted `BudgetEnvelopeRecord`
  - `ModelCallLimits`
  - `PreparedModelCall`
  - `ModelPort.prepareCall(input, limits)`
  - new `RunStateStorePort` methods used by Tasks 2–6.

- [ ] **Step 1: Write RED contract tests for complete budget views and split clocks**

Create `tests/unit/phase5-0a-contracts.test.ts` with assertions equivalent to:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOUNDED_RUN_BUDGET,
  budgetAvailable,
  type MonotonicClockPort,
  type ProvenanceClockPort,
  type RunBudgetView,
} from '@arcp/workflow-core';

it('represents every declared budget dimension in an authoritative view', () => {
  const view: RunBudgetView = {
    turns: { limit: 4, reserved: 0, consumed: 0, released: 0 },
    wall_time_ms: { limit: 120_000, reserved: 0, consumed: 0, released: 0 },
    model_input_tokens: { limit: 64_000, reserved: 0, consumed: 0, released: 0 },
    model_output_tokens: { limit: 16_000, reserved: 0, consumed: 0, released: 0 },
    model_cost_micros: { limit: 1_000_000, reserved: 0, consumed: 0, released: 0 },
    tool_calls: { limit: 12, reserved: 0, consumed: 0, released: 0 },
    external_actions: { limit: 8, reserved: 0, consumed: 0, released: 0 },
    storage_writes: { limit: 8, reserved: 0, consumed: 0, released: 0 },
    network_requests: { limit: 16, reserved: 0, consumed: 0, released: 0 },
    recursive_wakes: { limit: 2, reserved: 0, consumed: 0, released: 0 },
  };
  expect(Object.keys(view)).toHaveLength(10);
  expect(budgetAvailable(view.model_output_tokens)).toBe(16_000);
});

it('keeps provenance and monotonic clocks as separate contracts', () => {
  const provenance: ProvenanceClockPort = { now: () => ({ instant_id: 'local:test', unverified: true }) };
  const monotonic: MonotonicClockPort = { nowMs: () => 42 };
  expect(provenance.now().instant_id).toBe('local:test');
  expect(monotonic.nowMs()).toBe(42);
});
```

- [ ] **Step 2: Write RED model-port test for two-stage prepare/execute**

Replace the Phase 4 direct `deliberate(input)` expectation in `tests/unit/model-port.test.ts` with compile/runtime expectations for:

```ts
const prepared = await model.prepareCall(input, {
  maxOutputTokens: 1000,
  maxInputTokens: 5000,
  maxCostMicros: 20_000,
  maxActiveDurationMs: 8_000,
});
expect(model.preparations).toHaveLength(1);
expect(model.executions).toBe(0);
const proposal = await prepared.execute();
expect(model.executions).toBe(1);
```

Keep the existing Phase 0 synchronous `FakeModelAdapter.nextTurn()` assertion unchanged.

- [ ] **Step 3: Run the targeted tests and verify RED**

Run:

```bash
pnpm vitest run tests/unit/phase5-0a-contracts.test.ts tests/unit/model-port.test.ts
```

Expected: FAIL because clock ports, complete `RunBudgetView`, budget-envelope types, and `ModelPort.prepareCall()` do not yet exist.

- [ ] **Step 4: Add persisted envelope and invocation-link types**

In `packages/arcp-schema/src/types.ts`, add the persisted records exactly around the existing Phase 4 run/model types:

```ts
export type BudgetEnvelopeKind =
  | 'advance'
  | 'model-call'
  | 'action-call'
  | 'tool-call'
  | 'storage-operation'
  | 'network-operation'
  | 'recursive-wake';

export type BudgetEnvelopeStatus =
  | 'reserved'
  | 'settled'
  | 'released'
  | 'recovery-required';

export interface BudgetEnvelopeItem {
  dimension:
    | 'turns'
    | 'wall_time_ms'
    | 'model_input_tokens'
    | 'model_output_tokens'
    | 'model_cost_micros'
    | 'tool_calls'
    | 'external_actions'
    | 'storage_writes'
    | 'network_requests'
    | 'recursive_wakes';
  reserved: number;
  actual?: number;
}

export interface BudgetEnvelopeRecord {
  schema: 'arcp/budget-envelope/0.1';
  envelope_id: string;
  run_id: string;
  fencing_token: number;
  kind: BudgetEnvelopeKind;
  status: BudgetEnvelopeStatus;
  items: BudgetEnvelopeItem[];
  reserved_at: InstantRef;
  settled_at?: InstantRef;
}
```

Extend new `ModelInvocationRecord` writes with:

```ts
budget_envelope_id?: string;
```

Retain `budget_reservation_id?: string` as legacy Phase 4 compatibility rather than changing its meaning.

- [ ] **Step 5: Make `RunBudgetView` complete and add pure availability helper**

In `packages/workflow-core/src/budget.ts`:

```ts
export type RunBudgetView = Record<BudgetDimension, BudgetCounterView>;

export function budgetAvailable(counter: BudgetCounterView): number {
  return Math.max(0, counter.limit - counter.consumed - counter.reserved);
}
```

Update `InMemoryBudgetLedger.view()` typing so it always returns all ten dimensions. Keep optional model budget values resolving to numeric `0` in `limitFor()`.

- [ ] **Step 6: Add clock/model/store contracts**

In `packages/workflow-core/src/types.ts` add:

```ts
export interface ModelCallLimits {
  maxOutputTokens: number;
  maxInputTokens: number;
  maxCostMicros: number;
  maxActiveDurationMs: number;
}

export interface PreparedModelCall {
  execute(): Promise<ModelTurnProposal>;
}
```

In `packages/workflow-core/src/ports.ts` add:

```ts
export interface ProvenanceClockPort {
  now(): InstantRef;
}

export interface MonotonicClockPort {
  nowMs(): number;
}

export interface ModelPort {
  prepareCall(input: ModelTurnInput, limits: ModelCallLimits): Promise<PreparedModelCall>;
}
```

Add the following `RunStateStorePort` methods, using schema types for persisted envelope records:

```ts
getBudgetView(runId: string): Promise<RunBudgetView>;
reserveBudgetEnvelope(input: ReserveBudgetEnvelopeInput): Promise<BudgetEnvelopeRecord>;
settleBudgetEnvelope(input: SettleBudgetEnvelopeInput): Promise<BudgetEnvelopeRecord>;
releaseBudgetEnvelope(input: ReleaseBudgetEnvelopeInput): Promise<BudgetEnvelopeRecord>;
markBudgetEnvelopeRecoveryRequired(runId: string, envelopeId: string): Promise<BudgetEnvelopeRecord>;
getBudgetEnvelope(envelopeId: string): Promise<BudgetEnvelopeRecord | null>;
createModelInvocation(record: ModelInvocationRecord): Promise<ModelInvocationRecord>;
getModelInvocation(invocationId: string): Promise<ModelInvocationRecord | null>;
transitionModelInvocation(
  invocationId: string,
  expectedStatus: ModelInvocationRecord['status'],
  next: ModelInvocationRecord,
): Promise<ModelInvocationRecord>;
```

Define the three envelope input interfaces in `ports.ts` or `types.ts` with exact `runId`, `fencingToken` where required, `envelopeId`, `kind`, items/actuals, and provenance timestamps from the spec.

- [ ] **Step 7: Add provider-neutral 5.0A errors**

Extend `WorkflowErrorCode` in `packages/workflow-core/src/errors.ts` with:

```text
budget_envelope_invalid
budget_envelope_conflict
budget_envelope_recovery_required
model_limit_unsupported
model_limit_contract_violated
runtime_wall_time_exhausted
```

- [ ] **Step 8: Add deterministic clock test helpers**

Create `tests/helpers/fake-clocks.ts`:

```ts
import type { InstantRef } from '@arcp/schema';
import type { MonotonicClockPort, ProvenanceClockPort } from '@arcp/workflow-core';

export class FakeMonotonicClock implements MonotonicClockPort {
  constructor(private value = 0) {}
  nowMs(): number { return this.value; }
  advance(milliseconds: number): void { this.value += milliseconds; }
  set(milliseconds: number): void { this.value = milliseconds; }
}

export function fixedProvenanceClock(value: InstantRef): ProvenanceClockPort {
  return { now: () => structuredClone(value) };
}
```

- [ ] **Step 9: Run targeted tests and typecheck**

Run:

```bash
pnpm vitest run tests/unit/phase5-0a-contracts.test.ts tests/unit/model-port.test.ts
pnpm typecheck
```

Expected: model-port runtime test may remain RED until Task 4 adapter implementation, but all new contract/type imports compile; if the test intentionally instantiates the old adapter API, keep that one RED and record it as Task 4's entry test rather than faking behavior in Task 1.

- [ ] **Step 10: Commit the contract slice**

```bash
git add packages/arcp-schema/src/types.ts \
  packages/workflow-core/src/budget.ts \
  packages/workflow-core/src/types.ts \
  packages/workflow-core/src/ports.ts \
  packages/workflow-core/src/errors.ts \
  packages/workflow-core/src/index.ts \
  tests/helpers/fake-clocks.ts \
  tests/unit/phase5-0a-contracts.test.ts \
  tests/unit/model-port.test.ts
git commit -m "feat: define Phase 5.0A budget and model-call contracts"
```

---

### Task 2: Implement Atomic Budget Envelopes in the In-Memory Store

**Files:**
- Modify: `packages/workflow-core/src/in-memory-store.ts`
- Create: `tests/unit/run-budget-envelope.test.ts`

**Interfaces:**
- Consumes: Task 1 envelope/store contracts.
- Produces: reference semantics that D1 must match exactly in Task 3.

- [ ] **Step 1: Write RED tests for complete budget view**

Create a run with model output budget `1000`, call `getBudgetView()`, and assert every dimension exists and:

```ts
expect(view.model_output_tokens).toEqual({
  limit: 1000,
  reserved: 0,
  consumed: 0,
  released: 0,
});
```

Also create a profile with omitted optional model limits and assert their limits are `0`, not Infinity and not missing.

- [ ] **Step 2: Write RED all-or-nothing reservation test**

Reserve an envelope containing:

```ts
[
  { dimension: 'turns', amount: 1 },
  { dimension: 'model_output_tokens', amount: 1001 },
]
```

against a 1000 output-token budget. Assert `budget_exhausted`, no envelope record exists, and the turns counter remains unchanged.

- [ ] **Step 3: Write RED idempotency/collision tests**

Assert:

```text
same envelope_id + same canonical request -> returns same record, no double reservation
same envelope_id + different items -> budget_envelope_conflict
```

- [ ] **Step 4: Write RED atomic settlement/release tests**

Reserve output `1000` + turns `1`, settle with actual output `237` + turns `1`, and assert:

```text
output: reserved 0, consumed 237, released 763
turns:  reserved 0, consumed 1,   released 0
```

Then attempt settlement missing output actual and assert no counter changes plus `budget_envelope_recovery_required` or explicit recovery transition; never settle missing usage as zero.

- [ ] **Step 5: Run the unit test and verify RED**

```bash
pnpm vitest run tests/unit/run-budget-envelope.test.ts
```

Expected: FAIL because store envelope methods do not exist.

- [ ] **Step 6: Implement complete `getBudgetView()`**

Expose the existing ledger view through the port:

```ts
async getBudgetView(runId: string): Promise<RunBudgetView> {
  return structuredClone(this.budget(runId).view());
}
```

Treat a missing run ledger as `invalid_persisted_state`.

- [ ] **Step 7: Implement in-memory envelope reservation under one mutation boundary**

Algorithm:

```text
validate fencing
validate non-empty items
validate positive finite amounts
reject duplicate dimensions
check every dimension fits WITHOUT mutating counters
only after all checks pass, reserve every item
persist one BudgetEnvelopeRecord(status=reserved)
```

Do not call `ledger.reserve()` sequentially before all dimensions are prevalidated, because that would recreate partial reservation semantics inside the reference store.

- [ ] **Step 8: Implement atomic settlement/release/recovery**

For settlement:

```text
load reserved envelope
require exact actual for every reserved dimension
validate every actual is finite, >=0, <= reserved
only after all validate, settle every item and set envelope status=settled
```

For release, release all items only from `reserved` state. For `recovery-required`, preserve reservations until an explicit conservative settlement/recovery action resolves them.

- [ ] **Step 9: Implement in-memory model invocation lifecycle CAS**

Store invocations by `invocation_id`. `createModelInvocation()` is idempotent only for canonical-equal content. `transitionModelInvocation()` must reject an expected-status mismatch so a stale caller cannot move `succeeded`/`unknown` back to `calling`.

- [ ] **Step 10: Run unit tests**

```bash
pnpm vitest run tests/unit/run-budget-envelope.test.ts tests/unit/run-budget.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/workflow-core/src/in-memory-store.ts tests/unit/run-budget-envelope.test.ts
git commit -m "feat: add in-memory atomic budget envelopes"
```

---

### Task 3: Add D1 Migration and Atomic Envelope Semantics

**Files:**
- Create: `migrations/d1/0003_phase5_0a_budget_envelopes.sql`
- Modify: `packages/adapters/cloudflare/src/d1-run-state-store.ts`
- Modify: `tests/unit/d1-run-state-store.test.ts`
- Create: `tests/integration/budget-envelope-parity.test.ts`

**Interfaces:**
- Consumes: Task 2 reference semantics.
- Produces: D1/SQLite durable parity for budget view, envelope reservation/settlement, and invocation lifecycle.

- [ ] **Step 1: Extend D1 test setup to apply migration 0003**

Read all three migrations:

```ts
const migration3 = readFileSync(
  fileURLToPath(new URL('../../migrations/d1/0003_phase5_0a_budget_envelopes.sql', import.meta.url)),
  'utf-8',
);
```

and initialize the fake D1 database with `migration1 + migration2 + migration3`.

- [ ] **Step 2: Write RED D1 budget-view test**

After `createRunIfAbsent`, call `store.getBudgetView(runId)` and assert exact equality for all ten dimensions against in-memory semantics.

- [ ] **Step 3: Write RED D1 atomic multi-dimensional reservation test**

Construct one envelope where the turns item fits and output-token item exceeds the limit. Assert:

```text
reserve rejects with budget_exhausted
arcp_budget_envelopes has no row
turns ledger unchanged
model_output_tokens ledger unchanged
```

- [ ] **Step 4: Write RED D1 settlement and idempotency tests**

Cover:

```text
same envelope retry -> no double reserve
same ID different content -> budget_envelope_conflict
valid settlement updates all dimensions together
one invalid/missing actual -> no dimensions settle
release is all-or-nothing
```

- [ ] **Step 5: Write RED invocation CAS tests**

Assert:

```text
create reserved invocation
reserved -> calling succeeds
second reserved -> calling CAS fails
calling -> succeeded succeeds
succeeded -> calling fails
```

- [ ] **Step 6: Run targeted D1 tests and verify RED**

```bash
pnpm vitest run tests/unit/d1-run-state-store.test.ts
```

Expected: FAIL because migration/table/store methods do not exist.

- [ ] **Step 7: Create `0003_phase5_0a_budget_envelopes.sql`**

Create the envelope table without rewriting Phase 4 migration history:

```sql
CREATE TABLE IF NOT EXISTS arcp_budget_envelopes (
  envelope_id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved','settled','released','recovery-required')),
  items_json TEXT NOT NULL,
  actuals_json TEXT,
  envelope_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arcp_budget_envelopes_run
  ON arcp_budget_envelopes (run_id, status);
```

Add migration columns to `arcp_model_invocations` for host-side CAS without changing legacy JSON meaning:

```sql
ALTER TABLE arcp_model_invocations ADD COLUMN status TEXT;
ALTER TABLE arcp_model_invocations ADD COLUMN budget_envelope_id TEXT;
UPDATE arcp_model_invocations
SET status = COALESCE(status, json_extract(invocation_json, '$.status'));
```

If SQLite compatibility requires guards around an already-applied migration in the local test harness, solve that in migration application/versioning rather than silently swallowing arbitrary SQL errors.

- [ ] **Step 8: Add BEFORE INSERT envelope guard trigger**

The trigger must validate, within the same INSERT statement:

```text
run exists
fencing_token equals current run fencing token
items_json is valid JSON array
array is non-empty
every item has known dimension
reserved amount is finite positive integer/number supported by current ledger semantics
no duplicate dimensions
ledger row exists for every dimension
consumed + reserved + request <= limit for every item
```

Use `json_each(NEW.items_json)` and abort with stable sentinel strings such as:

```text
ARCP_BUDGET_ENVELOPE_INVALID
ARCP_BUDGET_EXHAUSTED
ARCP_STALE_FENCING_TOKEN
```

- [ ] **Step 9: Add AFTER INSERT reservation trigger**

Update all matching ledger rows from `json_each(NEW.items_json)` in the same INSERT transaction boundary. The SQL must not issue client-side per-dimension UPDATE round trips.

- [ ] **Step 10: Add atomic settlement/release triggers**

A status-changing UPDATE from `reserved -> settled` validates `actuals_json` contains an actual for every reserved dimension and every actual is within `[0,reserved]`, then atomically:

```text
reserved -= reserved_amount
consumed += actual_amount
released += reserved_amount - actual_amount
```

A status-changing UPDATE from `reserved -> released` atomically:

```text
reserved -= reserved_amount
released += reserved_amount
```

No other status transition may mutate ledger counters.

- [ ] **Step 11: Implement D1 store methods**

`getBudgetView()` executes one query returning all rows for the run, validates exactly the ten known dimensions are present, and constructs a complete `RunBudgetView`.

`reserveBudgetEnvelope()` uses one INSERT as the grant boundary, then reads back the stored row. For duplicate ID:

```text
canonical equal -> return existing
canonical different -> budget_envelope_conflict
```

`settleBudgetEnvelope()` / `releaseBudgetEnvelope()` use one status-changing UPDATE so triggers own the ledger mutation. `markBudgetEnvelopeRecoveryRequired()` changes envelope status but does not release counters.

Add D1 implementations of `createModelInvocation`, `getModelInvocation`, and compare-and-set `transitionModelInvocation` using the migrated `status` column.

- [ ] **Step 12: Extend `mapSqlError()`**

Map trigger sentinels to the exact workflow errors from Task 1, including `budget_exhausted`, `stale_fencing_token`, `budget_envelope_invalid`, and `budget_envelope_recovery_required` where applicable. Do not map unrelated UNIQUE/SQL failures to budget errors.

- [ ] **Step 13: Add store parity integration test**

`tests/integration/budget-envelope-parity.test.ts` must run the same logical sequence against in-memory and D1 stores:

```text
create run
read view
reserve model-call envelope
read view
settle with actuals
read view
```

Assert complete counter equality after every operation.

- [ ] **Step 14: Run D1 + parity tests**

```bash
pnpm vitest run tests/unit/d1-run-state-store.test.ts tests/integration/budget-envelope-parity.test.ts
```

Expected: PASS.

- [ ] **Step 15: Commit**

```bash
git add migrations/d1/0003_phase5_0a_budget_envelopes.sql \
  packages/adapters/cloudflare/src/d1-run-state-store.ts \
  tests/unit/d1-run-state-store.test.ts \
  tests/integration/budget-envelope-parity.test.ts
git commit -m "feat: persist atomic budget envelopes in D1"
```

---

### Task 4: Implement the Two-Stage Deterministic Model Adapter

**Files:**
- Modify: `packages/adapters/model/src/fake.ts`
- Modify: `tests/unit/model-port.test.ts`

**Interfaces:**
- Consumes: `ModelPort.prepareCall`, `PreparedModelCall`, `ModelCallLimits` from Task 1.
- Produces: deterministic adapter used by all Task 5–7 orchestration tests.

- [ ] **Step 1: Add RED zero-I/O preflight assertions**

Update `tests/unit/model-port.test.ts` so:

```ts
const prepared = await model.prepareCall(input, limits);
expect(model.preparations).toHaveLength(1);
expect(model.executions).toBe(0);
await prepared.execute();
expect(model.executions).toBe(1);
```

Also assert the adapter records the exact host limits and never mutates them upward.

- [ ] **Step 2: Add RED unsupported-limit test**

Construct the deterministic adapter with a test-only option that declares one unsupported finite limit, call `prepareCall()`, and assert:

```text
reject code = model_limit_unsupported
preparation count = 1
execution count = 0
```

- [ ] **Step 3: Run test and verify RED**

```bash
pnpm vitest run tests/unit/model-port.test.ts
```

- [ ] **Step 4: Refactor `DeterministicModelAdapter`**

Preserve `FakeModelAdapter.nextTurn()` unchanged.

Implement:

```ts
readonly preparations: Array<{ input: ModelTurnInput; limits: ModelCallLimits }> = [];
executions = 0;

async prepareCall(input: ModelTurnInput, limits: ModelCallLimits): Promise<PreparedModelCall> {
  // validate finite, non-negative host limits
  // reject configured unsupported limit before returning a prepared call
  this.preparations.push(structuredClone({ input, limits }));
  const stepIndex = this.cursor;
  return {
    execute: async () => {
      this.executions += 1;
      const step = this.script[stepIndex];
      // preserve Phase 4 transient/ambiguous scripted behavior here
      // advance cursor exactly once for one executed logical call
      return structuredClone(proposal);
    },
  };
}
```

Do not increment the script cursor during `prepareCall()`; a crash after prepare but before calling/execute must be safely repeatable with no provider effect.

- [ ] **Step 5: Preserve transient/ambiguous scripted execution semantics**

`temporarily-unavailable` and `ambiguous` scripted steps occur only from `PreparedModelCall.execute()`, never from local preflight, unless a dedicated preflight error option is explicitly used.

- [ ] **Step 6: Run model tests**

```bash
pnpm vitest run tests/unit/model-port.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/adapters/model/src/fake.ts tests/unit/model-port.test.ts
git commit -m "feat: split model preflight from provider execution"
```

---

### Task 5: Add Pure Model-Call Budget Planning Helpers

**Files:**
- Create: `packages/workflow-core/src/model-call-budget.ts`
- Modify: `packages/workflow-core/src/index.ts`
- Create: `tests/unit/model-call-budget.test.ts`

**Interfaces:**
- Consumes: complete `RunBudgetView`, `BudgetEnvelopeRecord`, `ModelCallLimits`.
- Produces:
  - `buildModelCallEnvelopeItems(view)`
  - `deriveModelCallLimits(modelEnvelope, remainingWallTimeMs)`
  - `modelActualsFromProposalUsage(envelope, usage)` or equivalent strict validator.

- [ ] **Step 1: Write RED envelope-planning test**

Given a view with:

```text
turns available=1
input available=5000
output available=1000
cost available=20000
```

assert the requested model-call items reserve exactly those maxima and omit no enabled hard dimension.

- [ ] **Step 2: Write RED zero-budget test**

If output/cost/input limit is zero, helper must reject a model call before provider preflight with `budget_exhausted`; zero never means unlimited.

- [ ] **Step 3: Write RED limit-derivation test**

Given a granted model envelope and `remainingWallTimeMs=8400`, assert:

```ts
{
  maxInputTokens: 5000,
  maxOutputTokens: 1000,
  maxCostMicros: 20000,
  maxActiveDurationMs: 8400,
}
```

and prove no returned limit can exceed its corresponding grant.

- [ ] **Step 4: Write RED strict-usage test**

For a model envelope reserving turns/input/output/cost, missing any authoritative actual from proposal usage must fail normal settlement. Usage above reserved maximum must produce `model_limit_contract_violated`, not a negative ledger adjustment.

- [ ] **Step 5: Run targeted tests and verify RED**

```bash
pnpm vitest run tests/unit/model-call-budget.test.ts
```

- [ ] **Step 6: Implement pure helpers**

Keep provider-specific tokenization/pricing out of workflow-core. Helpers only translate durable host grants to finite maxima and validate reported actuals.

For turns, normal actual is always `1` once provider execution crossed the calling boundary.

- [ ] **Step 7: Run tests**

```bash
pnpm vitest run tests/unit/model-call-budget.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/workflow-core/src/model-call-budget.ts \
  packages/workflow-core/src/index.ts \
  tests/unit/model-call-budget.test.ts
git commit -m "feat: add host-side model budget planning"
```

---

### Task 6: Refactor Orchestrator Model Calls onto Budget Envelopes

**Files:**
- Modify: `packages/workflow-core/src/orchestrator.ts`
- Modify: `tests/unit/bounded-run-orchestrator.test.ts`
- Create: `tests/integration/phase5-0a-model-budget.test.ts`
- Modify: existing integration/unit files that instantiate `BoundedRunOrchestrator` only to inject the new clocks/API.

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: canonical Phase 5.0A model call flow; new model calls no longer use `reserveModelBudget()` or `chargeReportedUsage()`.

- [ ] **Step 1: Add RED orchestrator test for truthful budget view and hard limits**

Build a run whose remaining output budget is `1000`. Advance once and assert the deterministic model adapter sees:

```text
input.budgetView.model_output_tokens.limit = configured limit
limits.maxOutputTokens <= 1000
```

and the store ledger shows a model-call envelope rather than independent post-call token reservations.

- [ ] **Step 2: Add RED no-provider-call test for zero/unsupported budget**

Assert a zero optional model budget or adapter unsupported hard limit prevents `PreparedModelCall.execute()` and leaves provider execution count `0`.

- [ ] **Step 3: Add RED normal settlement test**

Model reserves output `1000`, returns usage `237`, then assert:

```text
reserved=0
consumed=237
released=763
```

for output tokens and exact actuals for input/cost/turns.

- [ ] **Step 4: Run targeted tests and verify RED**

```bash
pnpm vitest run tests/unit/bounded-run-orchestrator.test.ts tests/integration/phase5-0a-model-budget.test.ts
```

- [ ] **Step 5: Replace ambiguous `now()` option with explicit clocks**

Change `BoundedRunOrchestratorOptions` from:

```ts
now: () => InstantRef;
```

to:

```ts
provenanceClock: ProvenanceClockPort;
monotonicClock: MonotonicClockPort;
```

Replace every persisted timestamp use with `provenanceClock.now()` only. Do not use `monotonicClock` for `InstantRef`, approval expiry, receipt timestamps, or canonical provenance.

- [ ] **Step 6: Reserve one advance wall-time envelope after fencing is valid**

At active `advance()` entry, obtain current budget view and reserve the positive remaining `wall_time_ms` as an `advance` envelope with deterministic logical ID derived from run ID + fencing token.

Capture process-local `advanceStartMs = monotonicClock.nowMs()` only after the durable wall-time reservation exists.

- [ ] **Step 7: Replace the old model reservation path**

Remove orchestrator use of:

```text
reserveModelBudget(turns)
model.deliberate(... budgetView:{})
settleModelBudget(turns)
chargeReportedUsage(input/output/cost)
```

For each turn:

```text
read durable budget view
build model-call envelope request
reserve envelope atomically
create invocation(status=reserved, budget_envelope_id)
derive remaining advance wall-time
derive ModelCallLimits
prepareCall(input with truthful budgetView, limits)
CAS invocation reserved -> calling
prepared.execute()
validate proposal usage
transition invocation to succeeded/failed/unknown
settle/recover model envelope
increment turn_index only after normal successful call outcome is durably accounted
```

- [ ] **Step 8: Handle preflight failure safely**

If `prepareCall()` fails before `calling`:

```text
provider I/O definitely did not begin
invocation reserved -> failed
release model-call envelope
provider execution count remains 0
```

Use the same logical turn only according to existing run error/retry policy; do not fabricate a successful call.

- [ ] **Step 9: Validate reported usage before settlement**

Every reserved model dimension requires an exact actual. Missing usage enters recovery semantics; usage above the granted envelope records `model_limit_contract_violated` and does not force ledger counters negative.

- [ ] **Step 10: Settle the advance wall-time envelope on every normal return path**

Before each return from active orchestration, compute:

```text
elapsed = monotonicClock.nowMs() - advanceStartMs
```

If `0 <= elapsed <= reserved`, settle wall time to exact elapsed and release remainder.

If elapsed exceeds reserved, invoke Task 7 overrun semantics instead of clamping.

Persisted time spent outside this function in `waiting`, `waiting-approval`, or `contained` is never added to elapsed.

Use a single `try/finally`/helper structure that avoids forgetting wall-time settlement on approval/wait/containment/terminal return paths, while preserving crash semantics (process death naturally leaves the envelope reserved).

- [ ] **Step 11: Update existing tests to inject clocks**

Where existing tests currently pass `now: () => now`, replace with:

```ts
provenanceClock: fixedProvenanceClock(now),
monotonicClock: new FakeMonotonicClock(0),
```

Do not change their domain assertions unless 5.0A intentionally changes budget/model call internals.

- [ ] **Step 12: Run model/orchestrator regression slice**

```bash
pnpm vitest run \
  tests/unit/bounded-run-orchestrator.test.ts \
  tests/integration/phase5-0a-model-budget.test.ts \
  tests/integration/phase4-approval-resume.test.ts \
  tests/integration/phase4-containment-mid-run.test.ts \
  tests/integration/phase4-crash-reconcile.test.ts
```

Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add packages/workflow-core/src/orchestrator.ts \
  tests/unit/bounded-run-orchestrator.test.ts \
  tests/integration/phase5-0a-model-budget.test.ts \
  tests/helpers/fake-clocks.ts \
  tests/unit tests/integration
git commit -m "feat: enforce model calls with durable budget envelopes"
```

Before committing, inspect `git diff --cached --name-only` so the broad `tests/unit tests/integration` staging does not accidentally include unrelated files; if it does, stage only the clock-injection files actually modified by this task.

---

### Task 7: Implement Crash Recovery and Wall-Time Violation Semantics

**Files:**
- Modify: `packages/workflow-core/src/orchestrator.ts`
- Create: `tests/integration/phase5-0a-model-crash-recovery.test.ts`
- Create: `tests/integration/phase5-0a-wall-time.test.ts`
- Modify: `tests/integration/phase4-do-d1-e2e.test.ts` if needed for the new clock contract.

**Interfaces:**
- Consumes: durable invocation/envelope state from Tasks 2–6.
- Produces: explicit safe retry for `reserved`, conservative recovery for `calling`, and exact active wall-time behavior.

- [ ] **Step 1: Write RED crash-after-prepare-before-calling test**

Use a test ModelPort whose `prepareCall()` succeeds but arrange a simulated crash before the store transition to `calling` completes. On resume, assert:

```text
invocation remains reserved
provider execution count = 0
same logical envelope remains safely reusable or safely recovered before retry
no conservative max consumption occurs
```

The implementation may reuse the still-reserved envelope rather than release/recreate it; whichever strategy is chosen must keep the deterministic invocation/envelope identity coherent and avoid double reservation.

- [ ] **Step 2: Write RED `calling` crash conservative-consumption test**

Simulate durable `calling` followed by process failure before authoritative usage is persisted. On resume without a reconciliation source, assert:

```text
provider is NOT blindly called again
model-call envelope resolves using reserved maxima
unknown usage is never treated as zero
```

Explicitly assert Lares's accepted consequence: because the call reserved the currently available token/cost remainder, one ambiguous `calling` crash may consume the run's entire remaining budget for those dimensions.

- [ ] **Step 3: Write RED missing-usage test**

Return a proposal missing one reserved usage dimension. Assert no normal zero-settlement; envelope enters recovery/conservative path.

- [ ] **Step 4: Write RED wall-time waiting exclusion test**

Use `FakeMonotonicClock` + fixed provenance clock:

```text
advance active = 100ms
run parks waiting-approval
provenance clock jumps one day
resume active = 200ms
```

Expected total consumed wall time is `300ms`, not one day.

- [ ] **Step 5: Write RED provenance-independence / monotonic-sensitivity tests**

Case A: change `InstantRef`, keep monotonic elapsed fixed -> wall-time unchanged.

Case B: keep `InstantRef`, change monotonic elapsed -> wall-time follows monotonic clock.

- [ ] **Step 6: Write RED wall-time-overrun test**

Reserve `100ms`, simulate `150ms` elapsed. Assert:

```text
runtime_wall_time_exhausted or explicit wall-time violation
no released wall-time remainder
no further model/effect segment starts
```

Never assert a successful `100ms` settlement by clamping.

- [ ] **Step 7: Run new tests and verify RED**

```bash
pnpm vitest run \
  tests/integration/phase5-0a-model-crash-recovery.test.ts \
  tests/integration/phase5-0a-wall-time.test.ts
```

- [ ] **Step 8: Add model-invocation recovery branch before a fresh call**

For the deterministic invocation ID `(run_id, turn_index)`:

```text
no invocation -> normal Task 6 flow
reserved -> provider definitely not called; repeat local preflight against same durable grant, then CAS to calling
calling -> never execute again blindly; mark/recover unknown usage and conservatively settle maxima if no authoritative reconciliation port exists
succeeded -> use recorded output/usage or persisted turn progression; never perform the provider call again
failed -> follow explicit run failure/retry policy, not an implicit new provider call
unknown -> no blind retry
```

5.0A does not need to invent a live provider usage-reconciliation API. The canonical MVP fallback for ambiguous `calling` is conservative-max settlement; a future adapter may add authoritative reconciliation without weakening this default.

- [ ] **Step 9: Implement wall-time violation handling**

Normal elapsed `<= reserved`: settle exact elapsed.

Elapsed `> reserved`:

```text
mark envelope recovery-required/violation evidence
consume no less than the reserved upper bound
release zero remainder
stop additional active work
surface runtime_wall_time_exhausted
```

Do not persist raw monotonic origins.

- [ ] **Step 10: Preserve containment preemption**

Re-run the Phase 4 blocking-model containment test. Budget envelope locking must not reintroduce a fetch-wide Durable Object queue; containment must still become durable while an advance is awaiting model execution.

- [ ] **Step 11: Run crash/time + containment tests**

```bash
pnpm vitest run \
  tests/integration/phase5-0a-model-crash-recovery.test.ts \
  tests/integration/phase5-0a-wall-time.test.ts \
  tests/integration/phase4-do-d1-e2e.test.ts \
  tests/integration/phase4-containment-mid-run.test.ts
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add packages/workflow-core/src/orchestrator.ts \
  tests/integration/phase5-0a-model-crash-recovery.test.ts \
  tests/integration/phase5-0a-wall-time.test.ts \
  tests/integration/phase4-do-d1-e2e.test.ts
git commit -m "feat: recover bounded model calls and active wall time"
```

---

### Task 8: Explicitly Classify All Ten Budget Dimensions Without Fake Enforcement

**Files:**
- Modify: `packages/arcp-schema/src/types.ts` comments only if necessary
- Modify: `README.md`
- Modify: `PHASE5_ENTRY_GATE.md` only for evidence-status wording if needed
- Create: `tests/unit/budget-enforcement-status.test.ts` only if status is represented programmatically; otherwise keep this as documentation verification.

**Interfaces:**
- Consumes: actual evidence from Tasks 1–7.
- Produces: an honest post-5.0A status table; no capability invented solely to make a counter green.

- [ ] **Step 1: Audit each dimension against an actual consumption boundary**

Record evidence for:

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

Use exactly these statuses:

```text
HARD_ENFORCED
ACCOUNTED_ONLY
DECLARED_NOT_APPLICABLE_YET
```

- [ ] **Step 2: Keep forward `BudgetEnvelopeKind` scaffolding consciously**

Retain `tool-call`, `storage-operation`, `network-operation`, and `recursive-wake` enum members as schema scaffolding only. Add/keep comments that their existence does not imply the corresponding budget dimension is enforced.

Do not add dummy tool/network/storage/self-wake runtime code in 5.0A.

- [ ] **Step 3: Update README status table based on evidence**

Target wording if tests support it:

```text
turns                 HARD_ENFORCED
wall_time_ms          HARD_ENFORCED at active orchestration/model boundary; executor cancellation not overclaimed
model_input_tokens    HARD_ENFORCED for a ModelPort that passes exact/conservative preflight
model_output_tokens   HARD_ENFORCED through supplied provider ceiling
model_cost_micros     HARD_ENFORCED only when deterministic safe pricing bound exists; otherwise call fails closed
external_actions      HARD_ENFORCED through Phase 4 claim-before-effect budget
```

Keep absent Phase 5 capabilities marked `DECLARED_NOT_APPLICABLE_YET` or `ACCOUNTED_ONLY` according to actual code. If implementation cannot prove a target `HARD_ENFORCED` claim, downgrade documentation instead of weakening the term.

- [ ] **Step 4: Run documentation-linked regression tests**

```bash
pnpm vitest run tests/unit/phase5-0a-contracts.test.ts tests/unit/model-call-budget.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add README.md PHASE5_ENTRY_GATE.md packages/arcp-schema/src/types.ts tests/unit/budget-enforcement-status.test.ts
git commit -m "docs: classify Phase 5.0A budget enforcement"
```

If no programmatic enforcement-status file/test is introduced, do not stage a nonexistent test path.

---

### Task 9: Full Regression, Migration Compatibility, and PR Handoff

**Files:**
- Modify: `README.md` only if final counts/commands require correction
- Modify: PR #8 body/status through GitHub after verification; no source file required.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: review-ready Phase 5.0A implementation with deterministic evidence.

- [ ] **Step 1: Verify legacy Phase 4 persistence remains readable**

Create a test database with migrations 0001 + 0002 data, then apply 0003 and assert:

```text
existing run rows readable
existing model invocation JSON readable
legacy arcp_model_budget_reservations remain intact
new envelope path works after migration
```

If this needs a new test file, use `tests/integration/phase5-0a-migration-compat.test.ts` and keep the fixture minimal.

- [ ] **Step 2: Run the complete test suite**

```bash
pnpm test
```

Expected: every test file passes, including all Phase 0–4 regression coverage and new Phase 5.0A tests.

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Run focused invariant grep/review**

Inspect the final diff and verify:

```text
orchestrator no longer calls model.deliberate directly
orchestrator no longer passes budgetView: {}
new model call path does not call reserveModelBudget/chargeReportedUsage
MonotonicClockPort values are never persisted as timestamps
adapter does not import/access RunStateStorePort
no provider/network I/O can occur in prepareCall
no missing usage defaults to zero
```

Use repository search/grep plus code review; do not rely on tests alone.

- [ ] **Step 5: Verify PR branch contains no credentials/network-only test dependency**

Search for newly added API keys, tokens, OAuth secrets, live provider URLs, or tests requiring network. Expected: none.

- [ ] **Step 6: Record final verification evidence in PR #8**

Update the PR body/comment with:

```text
final head SHA
pnpm test result: N/N files, M/M tests
pnpm typecheck: PASS
migration compatibility: PASS
D1/in-memory envelope parity: PASS
calling-crash conservative recovery: PASS
containment preemption regression: PASS
```

Do not claim a live model provider Gate C activation.

- [ ] **Step 7: Mark PR ready for Lares adversarial implementation review**

The PR may move from design draft to implementation review only after the fresh full-suite/typecheck evidence above exists.

- [ ] **Step 8: Commit any final documentation-only corrections**

```bash
git add README.md
git commit -m "docs: finalize Phase 5.0A verification notes"
```

Skip this commit if there are no file changes; never create an empty commit just to satisfy the plan.

---

## Plan Self-Review

### Spec coverage mapping

- Clock separation / active wall time: Tasks 1, 6, 7.
- Durable complete `getBudgetView`: Tasks 1–3.
- Atomic Budget Envelope reservation/settlement: Tasks 2–3.
- Host-owned `ModelCallLimits`: Tasks 1, 5, 6.
- Zero-I/O provider preflight + durable `calling`: Tasks 1, 4, 6, 7.
- Missing usage / above-grant violations: Tasks 5–7.
- Conservative `calling` crash recovery: Task 7.
- Containment preemption regression: Task 7.
- Honest dimension status / no fake capabilities: Task 8.
- Migration compatibility / credential-free CI / Phase 0–4 regressions: Task 9.
- Tool/cage governance invariant: Global Constraints + Task 8/9 review.

### Explicit non-blocking review decisions carried forward

1. Forward `BudgetEnvelopeKind` members remain as type scaffolding only; they do not imply runtime enforcement.
2. A crash after durable `calling` may consume the entire currently-reserved remaining model token/cost budget when authoritative usage cannot be recovered. This is intentionally conservative and has a named regression test in Task 7.

### Placeholder scan

This plan intentionally contains no `TBD`, `TODO`, “implement later”, or unspecified error-handling steps. Deferred Phase 5.0B/5.0C/MCP work is explicitly outside this plan rather than a placeholder.

### Type consistency

The canonical names used throughout this plan are:

```text
ProvenanceClockPort.now()
MonotonicClockPort.nowMs()
RunStateStorePort.getBudgetView()
RunStateStorePort.reserveBudgetEnvelope()
RunStateStorePort.settleBudgetEnvelope()
RunStateStorePort.releaseBudgetEnvelope()
RunStateStorePort.markBudgetEnvelopeRecoveryRequired()
RunStateStorePort.getBudgetEnvelope()
RunStateStorePort.createModelInvocation()
RunStateStorePort.getModelInvocation()
RunStateStorePort.transitionModelInvocation()
ModelPort.prepareCall()
PreparedModelCall.execute()
ModelCallLimits.maxInputTokens
ModelCallLimits.maxOutputTokens
ModelCallLimits.maxCostMicros
ModelCallLimits.maxActiveDurationMs
```

Executors may choose internal helper names, but public/task-boundary signatures must stay consistent unless a reviewed spec amendment changes them.
