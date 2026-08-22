# Phase 5.0A Runtime Clock & Hard Budget Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phase 4 post-call model budget accounting with crash-safe, host-enforced multi-dimensional budget envelopes, explicit provenance/monotonic clock separation, and a durable local-preflight → `calling` → provider-I/O boundary before Phase 5 MCP capabilities are exposed.

**Architecture:** Durable budget state stays behind `RunStateStorePort`. The stores expose a complete live budget snapshot and all-or-nothing `BudgetEnvelopeRecord` reservation/settlement; the host derives finite `ModelCallLimits` only from already-granted resources. Provider-specific adapters perform zero-I/O `prepareCall()` preflight, the host durably CAS-transitions `ModelInvocationRecord` from `reserved` to `calling`, and only then may the process-local `PreparedModelCall.execute()` cross provider I/O. Persisted time remains `InstantRef` provenance; elapsed execution uses only an injected `MonotonicClockPort`.

**Tech Stack:** TypeScript 5.9, Node 24 CI, pnpm 11, Vitest 3, SQLite / Cloudflare D1-compatible SQL, existing `@arcp/schema`, `@arcp/workflow-core`, `@arcp/adapter-model`, and `@arcp/adapter-cloudflare` packages.

**Spec:**
- `docs/superpowers/specs/2026-08-19-phase5-0a-runtime-clock-hard-budget-design.md`
- `docs/superpowers/specs/2026-08-19-phase5-0a-model-call-boundary-amendment.md`
- `PHASE5_ENTRY_GATE.md`

## Global Constraints

- Preserve `CTCL / InstantRef = provenance evidence`; never use CTCL evidence as runtime duration, lease validity, or fencing-order time.
- Preserve `budget authority != identity authority`, `budget exhaustion != deletion authority`, and `resource authority != identity authority`.
- `budgetView` is advisory state only; it never grants or enlarges execution authority.
- A bounded provider call may not begin until durable budget reservation covers the maximum authorized use.
- A provider adapter may translate host limits but may not read or mutate `RunStateStorePort`.
- `prepareCall()` performs zero provider/network I/O.
- Durable `reserved -> calling` occurs after local preflight and immediately before provider I/O may begin.
- Missing usage never settles as zero.
- Omitted optional model budgets resolve to numeric zero, never unlimited.
- Multi-dimensional envelope reservation and settlement are all-or-nothing.
- Wall-time overrun is a violation; never hide it with `min(elapsed, reserved)`.
- A crash after durable `calling` may conservatively consume the entire remaining reserved model token/cost budget; this is an accepted fail-closed tradeoff and must have a regression test.
- Forward `BudgetEnvelopeKind` members may exist as type scaffolding, but no absent capability may be documented as enforced.
- Legacy Phase 4 `arcp_model_budget_reservations` remains readable. New orchestrated model calls become canonical through Budget Envelopes only after the cutover task.
- Every task ends with targeted tests plus `pnpm typecheck` green. Do not intentionally carry a RED build into the next task.
- Normal CI remains credential-free and network-free.

---

## File Structure Map

### Schema / workflow-core

- Modify `packages/arcp-schema/src/types.ts`
  - persisted envelope types;
  - optional `ModelInvocationRecord.budget_envelope_id` for new records.
- Modify `packages/workflow-core/src/budget.ts`
  - complete authoritative budget-view type;
  - availability helpers.
- Modify `packages/workflow-core/src/types.ts`
  - `ModelCallLimits`, `PreparedModelCall`, envelope request inputs.
- Modify `packages/workflow-core/src/ports.ts`
  - clock ports;
  - store methods;
  - staged then final `ModelPort.prepareCall()` contract.
- Modify `packages/workflow-core/src/errors.ts`
  - Phase 5.0A provider-neutral error codes.
- Create `packages/workflow-core/src/model-call-budget.ts`
  - pure host-side envelope/limit/usage helpers.
- Modify `packages/workflow-core/src/in-memory-store.ts`
  - budget view, envelope state, invocation lifecycle.
- Modify `packages/workflow-core/src/orchestrator.ts`
  - explicit clocks, wall-time envelope, prepared model-call flow, crash recovery.

### D1 / adapters

- Create `migrations/d1/0003_phase5_0a_budget_envelopes.sql`
- Modify `packages/adapters/cloudflare/src/d1-run-state-store.ts`
- Modify `packages/adapters/model/src/fake.ts`

### Tests

- Create `tests/helpers/fake-clocks.ts`
- Create `tests/unit/phase5-0a-contracts.test.ts`
- Create `tests/integration/budget-view-parity.test.ts`
- Create `tests/unit/run-budget-envelope.test.ts`
- Create `tests/integration/budget-envelope-parity.test.ts`
- Modify `tests/unit/d1-run-state-store.test.ts`
- Create `tests/unit/model-invocation-lifecycle.test.ts`
- Modify `tests/unit/model-port.test.ts`
- Create `tests/unit/model-call-budget.test.ts`
- Modify `tests/unit/bounded-run-orchestrator.test.ts`
- Create `tests/integration/phase5-0a-model-budget.test.ts`
- Create `tests/integration/phase5-0a-model-crash-recovery.test.ts`
- Create `tests/integration/phase5-0a-wall-time.test.ts`
- Modify existing orchestrator-constructing tests only for explicit clock injection.

---

### Task 1: Add Non-Breaking Phase 5.0A Foundation Types

**Files:**
- Modify: `packages/arcp-schema/src/types.ts`
- Modify: `packages/workflow-core/src/budget.ts`
- Modify: `packages/workflow-core/src/types.ts`
- Modify: `packages/workflow-core/src/ports.ts`
- Modify: `packages/workflow-core/src/errors.ts`
- Modify: `packages/workflow-core/src/index.ts`
- Create: `tests/helpers/fake-clocks.ts`
- Create: `tests/unit/phase5-0a-contracts.test.ts`

**Interfaces:**
- Produces persisted `BudgetEnvelopeRecord` types, `CompleteRunBudgetView`, `ModelCallLimits`, `PreparedModelCall`, clock ports, envelope request input types, and new error codes.
- Does **not** yet change `RunStateStorePort` or the canonical `ModelPort.deliberate()` method, so existing implementations stay green.

- [ ] **Step 1: Write RED tests for the new pure contracts**

Create `tests/unit/phase5-0a-contracts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  budgetAvailable,
  type CompleteRunBudgetView,
  type MonotonicClockPort,
  type ProvenanceClockPort,
} from '@arcp/workflow-core';

it('models all ten dimensions in an authoritative budget view', () => {
  const view: CompleteRunBudgetView = {
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

it('keeps provenance and monotonic clocks distinct', () => {
  const p: ProvenanceClockPort = { now: () => ({ instant_id: 'local:test', unverified: true }) };
  const m: MonotonicClockPort = { nowMs: () => 42 };
  expect(p.now().instant_id).toBe('local:test');
  expect(m.nowMs()).toBe(42);
});
```

- [ ] **Step 2: Run RED test**

```bash
pnpm vitest run tests/unit/phase5-0a-contracts.test.ts
```

Expected: FAIL because the new types/helpers do not exist.

- [ ] **Step 3: Add persisted envelope types**

In `packages/arcp-schema/src/types.ts` add:

```ts
export type BudgetEnvelopeKind =
  | 'advance'
  | 'model-call'
  | 'action-call'
  | 'tool-call'
  | 'storage-operation'
  | 'network-operation'
  | 'recursive-wake';

export type BudgetEnvelopeStatus = 'reserved' | 'settled' | 'released' | 'recovery-required';

export interface BudgetEnvelopeItem {
  dimension:
    | 'turns' | 'wall_time_ms' | 'model_input_tokens' | 'model_output_tokens'
    | 'model_cost_micros' | 'tool_calls' | 'external_actions'
    | 'storage_writes' | 'network_requests' | 'recursive_wakes';
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

Extend `ModelInvocationRecord` with optional:

```ts
budget_envelope_id?: string;
```

Keep the existing `budget_reservation_id` field unchanged for Phase 4 rows.

- [ ] **Step 4: Add complete budget-view and availability helper without breaking current `RunBudgetView`**

In `packages/workflow-core/src/budget.ts`:

```ts
export type CompleteRunBudgetView = Record<BudgetDimension, BudgetCounterView>;

export function budgetAvailable(counter: BudgetCounterView): number {
  return Math.max(0, counter.limit - counter.consumed - counter.reserved);
}
```

Keep the old `RunBudgetView` alias temporarily so Phase 4 `budgetView: {}` still compiles until Task 7. The final cutover changes `RunBudgetView` to the complete shape.

- [ ] **Step 5: Add non-breaking clock/model/envelope input types**

In `packages/workflow-core/src/ports.ts` add:

```ts
export interface ProvenanceClockPort { now(): InstantRef; }
export interface MonotonicClockPort { nowMs(): number; }
```

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

Also add exact envelope request/settlement/release input interfaces carrying `runId`, `fencingToken` where required, `envelopeId`, `kind`, items/actuals, and provenance timestamps.

- [ ] **Step 6: Add Phase 5.0A error codes**

Extend `WorkflowErrorCode` with:

```text
budget_envelope_invalid
budget_envelope_conflict
budget_envelope_recovery_required
model_limit_unsupported
model_limit_contract_violated
runtime_wall_time_exhausted
```

- [ ] **Step 7: Add deterministic clock helpers**

Create `tests/helpers/fake-clocks.ts`:

```ts
import type { InstantRef } from '@arcp/schema';
import type { MonotonicClockPort, ProvenanceClockPort } from '@arcp/workflow-core';

export class FakeMonotonicClock implements MonotonicClockPort {
  constructor(private value = 0) {}
  nowMs(): number { return this.value; }
  advance(ms: number): void { this.value += ms; }
  set(ms: number): void { this.value = ms; }
}

export function fixedProvenanceClock(value: InstantRef): ProvenanceClockPort {
  return { now: () => structuredClone(value) };
}
```

- [ ] **Step 8: Run targeted test + typecheck**

```bash
pnpm vitest run tests/unit/phase5-0a-contracts.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/arcp-schema/src/types.ts \
  packages/workflow-core/src/budget.ts \
  packages/workflow-core/src/types.ts \
  packages/workflow-core/src/ports.ts \
  packages/workflow-core/src/errors.ts \
  packages/workflow-core/src/index.ts \
  tests/helpers/fake-clocks.ts \
  tests/unit/phase5-0a-contracts.test.ts
git commit -m "feat: add Phase 5.0A runtime budget foundations"
```

---

### Task 2: Expose a Complete Durable Budget View in Both Stores

**Files:**
- Modify: `packages/workflow-core/src/ports.ts`
- Modify: `packages/workflow-core/src/in-memory-store.ts`
- Modify: `packages/adapters/cloudflare/src/d1-run-state-store.ts`
- Create: `tests/integration/budget-view-parity.test.ts`

**Interfaces:**
- Produces `RunStateStorePort.getBudgetView(runId): Promise<CompleteRunBudgetView>`.

- [ ] **Step 1: Write RED parity test**

Create the same run in an in-memory store and a D1 store. Assert both `getBudgetView()` results contain exactly ten dimensions and are deeply equal. Include a profile with omitted optional model limits and assert:

```text
model_input_tokens.limit = 0
model_output_tokens.limit = 0
model_cost_micros.limit = 0
```

- [ ] **Step 2: Run RED test**

```bash
pnpm vitest run tests/integration/budget-view-parity.test.ts
```

Expected: FAIL because the port method does not exist.

- [ ] **Step 3: Add the store port method**

In `RunStateStorePort`:

```ts
getBudgetView(runId: string): Promise<CompleteRunBudgetView>;
```

- [ ] **Step 4: Implement in-memory view**

Expose `InMemoryBudgetLedger.view()` and validate all ten counters are present. Missing run/ledger => `invalid_persisted_state`.

- [ ] **Step 5: Implement one-query D1 view**

Query all ledger rows for the run, validate exactly the ten known dimensions, reject duplicate/missing rows, and build a complete view. `released` remains cumulative audit information and is not subtracted from availability again.

- [ ] **Step 6: Run parity + existing budget tests + typecheck**

```bash
pnpm vitest run tests/integration/budget-view-parity.test.ts tests/unit/run-budget.test.ts tests/unit/d1-run-state-store.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/workflow-core/src/ports.ts \
  packages/workflow-core/src/in-memory-store.ts \
  packages/adapters/cloudflare/src/d1-run-state-store.ts \
  tests/integration/budget-view-parity.test.ts
git commit -m "feat: expose durable run budget views"
```

---

### Task 3: Implement Atomic Budget Envelopes in Memory and D1

**Files:**
- Modify: `packages/workflow-core/src/ports.ts`
- Modify: `packages/workflow-core/src/in-memory-store.ts`
- Create: `migrations/d1/0003_phase5_0a_budget_envelopes.sql`
- Modify: `packages/adapters/cloudflare/src/d1-run-state-store.ts`
- Create: `tests/unit/run-budget-envelope.test.ts`
- Modify: `tests/unit/d1-run-state-store.test.ts`
- Create: `tests/integration/budget-envelope-parity.test.ts`

**Interfaces:**
- Produces `reserveBudgetEnvelope`, `settleBudgetEnvelope`, `releaseBudgetEnvelope`, `markBudgetEnvelopeRecoveryRequired`, `getBudgetEnvelope` on `RunStateStorePort`.

- [ ] **Step 1: Write RED in-memory all-or-nothing tests**

Test an envelope requesting turns `1` plus output tokens `1001` against a `1000` limit. Assert `budget_exhausted`, no envelope record, and no turns reservation. Add same-ID/same-content idempotency and same-ID/different-content conflict tests.

- [ ] **Step 2: Write RED settlement tests**

Reserve turns `1` + output `1000`, settle turns `1` + output `237`, assert:

```text
output reserved=0 consumed=237 released=763
turns  reserved=0 consumed=1   released=0
```

Settlement missing one actual must fail/recovery without partially mutating counters.

- [ ] **Step 3: Write RED D1 atomicity tests**

Apply migrations 0001+0002+0003 and prove one failing dimension leaves both ledger rows unchanged and creates no grant row. Add settlement parity and stale-fencing tests.

- [ ] **Step 4: Run RED tests**

```bash
pnpm vitest run tests/unit/run-budget-envelope.test.ts tests/unit/d1-run-state-store.test.ts
```

- [ ] **Step 5: Add store methods and in-memory implementation**

Before any mutation, validate:

```text
current fencing
non-empty items
known dimensions
finite positive amounts
no duplicate dimensions
every item fits consumed + reserved + request <= limit
```

Only after every check passes may all counters reserve and one `BudgetEnvelopeRecord(status=reserved)` be stored.

Normal settlement requires an actual for **every** reserved dimension and validates all actuals before any counter mutation. `recovery-required` keeps reservations held.

- [ ] **Step 6: Create D1 envelope table in migration 0003**

Use:

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

Also reserve migration space for model invocation lifecycle columns used by Task 4:

```sql
ALTER TABLE arcp_model_invocations ADD COLUMN status TEXT;
ALTER TABLE arcp_model_invocations ADD COLUMN budget_envelope_id TEXT;
UPDATE arcp_model_invocations
SET status = COALESCE(status, json_extract(invocation_json, '$.status'));
```

Do not rewrite `0002_phase4_runs.sql`.

- [ ] **Step 7: Add one-statement D1 reservation triggers**

The `arcp_budget_envelopes` INSERT is the atomic grant boundary. BEFORE INSERT, use `json_each(NEW.items_json)` to reject:

```text
invalid/empty JSON
unknown dimension
non-positive amount
duplicate dimension
missing ledger row
stale fencing
any dimension over limit
```

AFTER INSERT, update all matching ledger rows from the JSON items within the same SQLite statement transaction. No client-side per-dimension UPDATE loop may be the authority boundary.

- [ ] **Step 8: Add atomic D1 settlement/release triggers**

On `reserved -> settled`, validate exact actuals for all reserved dimensions, then atomically decrement reserved, increment consumed, and increment released by unused remainder. On `reserved -> released`, atomically release every item. `reserved -> recovery-required` leaves the ledger held.

- [ ] **Step 9: Implement D1 store methods and SQL error mapping**

Map stable trigger sentinels to `budget_exhausted`, `stale_fencing_token`, `budget_envelope_invalid`, or `budget_envelope_conflict`. Do not convert unrelated SQL/UNIQUE errors into budget errors.

- [ ] **Step 10: Add in-memory/D1 parity test**

Run identical create → reserve → read → settle → read sequences and deep-compare budget views plus envelope states.

- [ ] **Step 11: Run envelope suite + typecheck**

```bash
pnpm vitest run \
  tests/unit/run-budget-envelope.test.ts \
  tests/unit/d1-run-state-store.test.ts \
  tests/integration/budget-envelope-parity.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add packages/workflow-core/src/ports.ts \
  packages/workflow-core/src/in-memory-store.ts \
  migrations/d1/0003_phase5_0a_budget_envelopes.sql \
  packages/adapters/cloudflare/src/d1-run-state-store.ts \
  tests/unit/run-budget-envelope.test.ts \
  tests/unit/d1-run-state-store.test.ts \
  tests/integration/budget-envelope-parity.test.ts
git commit -m "feat: add atomic multi-dimensional budget envelopes"
```

---

### Task 4: Add Durable Model Invocation Lifecycle CAS

**Files:**
- Modify: `packages/workflow-core/src/ports.ts`
- Modify: `packages/workflow-core/src/in-memory-store.ts`
- Modify: `packages/adapters/cloudflare/src/d1-run-state-store.ts`
- Create: `tests/unit/model-invocation-lifecycle.test.ts`
- Modify: `tests/unit/d1-run-state-store.test.ts`

**Interfaces:**
- Produces `createModelInvocation`, `getModelInvocation`, and `transitionModelInvocation(invocationId, expectedStatus, next)`.
- Keeps legacy `appendModelInvocation()` readable for Phase 4 history until final cleanup is separately reviewed.

- [ ] **Step 1: Write RED lifecycle tests**

Assert:

```text
create reserved -> succeeds
same create/canonical content -> idempotent
reserved -> calling -> succeeds
second reserved -> calling -> stale CAS fails
calling -> succeeded -> succeeds
succeeded -> calling -> rejected
```

Run the same semantic fixture against in-memory and D1 implementations.

- [ ] **Step 2: Run RED test**

```bash
pnpm vitest run tests/unit/model-invocation-lifecycle.test.ts tests/unit/d1-run-state-store.test.ts
```

- [ ] **Step 3: Add store contract methods**

```ts
createModelInvocation(record: ModelInvocationRecord): Promise<ModelInvocationRecord>;
getModelInvocation(invocationId: string): Promise<ModelInvocationRecord | null>;
transitionModelInvocation(
  invocationId: string,
  expectedStatus: ModelInvocationRecord['status'],
  next: ModelInvocationRecord,
): Promise<ModelInvocationRecord>;
```

- [ ] **Step 4: Implement in-memory CAS**

Canonical-equal duplicate creation is idempotent; divergent same-ID creation is `invalid_persisted_state`. Transition checks the exact expected status before replacing the record.

- [ ] **Step 5: Implement D1 CAS using migration-0003 status column**

Persist `status` and `budget_envelope_id` next to `invocation_json`. Transition with:

```sql
UPDATE arcp_model_invocations
SET status = ?, budget_envelope_id = ?, invocation_json = ?
WHERE invocation_id = ? AND status = ?
```

Require exactly one changed row. Zero changes => stale/invalid lifecycle transition; never blindly overwrite a terminal result.

- [ ] **Step 6: Run lifecycle tests + typecheck**

```bash
pnpm vitest run tests/unit/model-invocation-lifecycle.test.ts tests/unit/d1-run-state-store.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/workflow-core/src/ports.ts \
  packages/workflow-core/src/in-memory-store.ts \
  packages/adapters/cloudflare/src/d1-run-state-store.ts \
  tests/unit/model-invocation-lifecycle.test.ts \
  tests/unit/d1-run-state-store.test.ts
git commit -m "feat: persist model invocation lifecycle transitions"
```

---

### Task 5: Stage the Two-Stage Deterministic Model Adapter Without Breaking Phase 4 Orchestrator

**Files:**
- Modify: `packages/workflow-core/src/ports.ts`
- Modify: `packages/adapters/model/src/fake.ts`
- Modify: `tests/unit/model-port.test.ts`

**Interfaces:**
- Temporarily extends `ModelPort` with optional `prepareCall(...)` while retaining `deliberate(...)` for the still-Phase-4 orchestrator.
- `DeterministicModelAdapter.deliberate()` delegates to its own prepare/execute path so one implementation defines both semantics during migration.

- [ ] **Step 1: Write RED two-stage test**

```ts
const prepared = await model.prepareCall!(input, limits);
expect(model.preparations).toHaveLength(1);
expect(model.executions).toBe(0);
const proposal = await prepared.execute();
expect(model.executions).toBe(1);
```

Keep the existing Phase 0 `FakeModelAdapter.nextTurn()` test.

- [ ] **Step 2: Write RED unsupported-limit test**

Configure the deterministic adapter to reject one finite limit during preparation. Assert:

```text
error code = model_limit_unsupported
preparation observed
execute/provider count = 0
```

- [ ] **Step 3: Run RED model test**

```bash
pnpm vitest run tests/unit/model-port.test.ts
```

- [ ] **Step 4: Stage the interface compatibly**

Temporarily:

```ts
export interface ModelPort {
  deliberate(input: ModelTurnInput): Promise<ModelTurnProposal>; // legacy until Task 7
  prepareCall?(input: ModelTurnInput, limits: ModelCallLimits): Promise<PreparedModelCall>;
}
```

- [ ] **Step 5: Implement local-only preparation**

`prepareCall()` validates finite non-negative limits, records `{input, limits}`, performs no provider/network I/O, and does **not** advance the script cursor. It returns a process-local object whose `execute()` advances the scripted provider step exactly once.

Transient/ambiguous scripted provider failures occur from `execute()`, not local preflight, unless a dedicated configured preflight failure is used.

- [ ] **Step 6: Keep legacy `deliberate()` behavior by delegation**

For migration only:

```ts
async deliberate(input: ModelTurnInput): Promise<ModelTurnProposal> {
  const prepared = await this.prepareCall(input, permissiveLegacyTestLimits);
  return prepared.execute();
}
```

`permissiveLegacyTestLimits` is deterministic adapter compatibility only; production orchestration stops using this path in Task 7. Do not interpret it as a runtime security boundary.

- [ ] **Step 7: Run model test + full typecheck**

```bash
pnpm vitest run tests/unit/model-port.test.ts
pnpm typecheck
```

Expected: PASS and old orchestrator still compiles.

- [ ] **Step 8: Commit**

```bash
git add packages/workflow-core/src/ports.ts packages/adapters/model/src/fake.ts tests/unit/model-port.test.ts
git commit -m "feat: stage zero-io prepared model calls"
```

---

### Task 6: Add Pure Host-Side Model Budget Planning

**Files:**
- Create: `packages/workflow-core/src/model-call-budget.ts`
- Modify: `packages/workflow-core/src/index.ts`
- Create: `tests/unit/model-call-budget.test.ts`

**Interfaces:**
- Produces `buildModelCallEnvelopeItems`, `deriveModelCallLimits`, and strict usage-to-actuals validation helpers.
- Contains no provider tokenizer/pricing code and no store access.

- [ ] **Step 1: Write RED planning test**

Given available:

```text
turns=1
input=5000
output=1000
cost=20000
```

assert envelope items reserve exactly those maxima.

- [ ] **Step 2: Write RED zero-budget test**

Any required model dimension with authoritative limit/availability `0` must prevent a provider call. Zero never maps to Infinity/unlimited.

- [ ] **Step 3: Write RED limit derivation test**

Given model envelope grants and `remainingWallTimeMs=8400`, expect:

```ts
{
  maxInputTokens: 5000,
  maxOutputTokens: 1000,
  maxCostMicros: 20000,
  maxActiveDurationMs: 8400,
}
```

No returned value may exceed its durable grant.

- [ ] **Step 4: Write RED strict usage test**

Normal settlement requires turns/input/output/cost actuals. Missing usage => recovery-required semantics. Actual > reserved => `model_limit_contract_violated`; never force a ledger negative.

- [ ] **Step 5: Run RED test**

```bash
pnpm vitest run tests/unit/model-call-budget.test.ts
```

- [ ] **Step 6: Implement pure helpers and run GREEN**

```bash
pnpm vitest run tests/unit/model-call-budget.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/workflow-core/src/model-call-budget.ts packages/workflow-core/src/index.ts tests/unit/model-call-budget.test.ts
git commit -m "feat: derive host-owned model call limits"
```

---

### Task 7: Cut the Orchestrator Over to Envelopes, Explicit Clocks, and Prepared Calls

**Files:**
- Modify: `packages/workflow-core/src/budget.ts`
- Modify: `packages/workflow-core/src/types.ts`
- Modify: `packages/workflow-core/src/ports.ts`
- Modify: `packages/workflow-core/src/orchestrator.ts`
- Modify: `packages/adapters/model/src/fake.ts`
- Modify: `tests/unit/bounded-run-orchestrator.test.ts`
- Create: `tests/integration/phase5-0a-model-budget.test.ts`
- Modify: every existing test that constructs `BoundedRunOrchestrator`, only for new clock/model signatures.

**Interfaces:**
- Finalizes `RunBudgetView` as the complete shape.
- Finalizes `ModelPort` as required `prepareCall()` only; direct orchestrator `deliberate()` is removed.
- Replaces `BoundedRunOrchestratorOptions.now` with `provenanceClock` + `monotonicClock`.

- [ ] **Step 1: Write RED hard-limit integration test**

Create a run with output availability `1000`. Assert the deterministic adapter receives truthful `budgetView` and `limits.maxOutputTokens <= 1000`, and that the model-call envelope—not post-call `chargeReportedUsage()`—owns turns/input/output/cost accounting.

- [ ] **Step 2: Write RED normal settlement test**

Reserve output `1000`, return actual `237`; assert output ledger becomes `reserved=0, consumed=237, released=763` and turns/input/cost settle from exact actuals.

- [ ] **Step 3: Write RED zero/unsupported no-execute test**

Zero hard budget or unsupported finite limit must leave deterministic adapter `executions=0`.

- [ ] **Step 4: Run RED tests**

```bash
pnpm vitest run tests/unit/bounded-run-orchestrator.test.ts tests/integration/phase5-0a-model-budget.test.ts
```

- [ ] **Step 5: Finalize the model port**

Replace the staged interface with:

```ts
export interface ModelPort {
  prepareCall(input: ModelTurnInput, limits: ModelCallLimits): Promise<PreparedModelCall>;
}
```

Remove `DeterministicModelAdapter.deliberate()` compatibility after all orchestrator tests are migrated. Preserve Phase 0 `FakeModelAdapter.nextTurn()`.

- [ ] **Step 6: Finalize `RunBudgetView` as complete**

Make the canonical `RunBudgetView` the complete ten-dimension record and update `ModelTurnInput.budgetView` accordingly. The orchestrator can no longer pass `{}`.

- [ ] **Step 7: Replace orchestrator time option**

```ts
export interface BoundedRunOrchestratorOptions {
  // existing ports...
  provenanceClock: ProvenanceClockPort;
  monotonicClock: MonotonicClockPort;
}
```

Every persisted `InstantRef` uses only `provenanceClock.now()`.

- [ ] **Step 8: Reserve one advance wall-time envelope**

After run creation/resume and fencing validation:

```text
read complete budget
reserve current positive wall_time_ms remainder as kind=advance
capture advanceStartMs = monotonicClock.nowMs()
```

The persisted envelope stores only the reserved amount and provenance timestamp; never persist the monotonic origin.

- [ ] **Step 9: Replace the Phase 4 model loop accounting**

Delete orchestrator use of:

```text
reserveModelBudget(turns)
model.deliberate(... budgetView:{})
settleModelBudget(turns)
chargeReportedUsage(input/output/cost)
```

New flow:

```text
getBudgetView
build model-call envelope items
reserve model-call envelope
create invocation(status=reserved, budget_envelope_id)
derive remaining advance wall time
derive ModelCallLimits
prepareCall(input with truthful budgetView, limits)
CAS reserved -> calling
prepared.execute()
validate exact usage
CAS calling -> succeeded/failed/unknown
settle or recover envelope
only then advance turn_index
```

- [ ] **Step 10: Implement safe preflight failure**

If `prepareCall()` fails before `calling`, transition invocation `reserved -> failed`, release the model-call envelope, and prove provider execution count remains zero.

- [ ] **Step 11: Settle advance wall time on normal exits**

Use one helper/finally structure covering completion, approval wait, policy wait, and containment returns:

```text
elapsed = monotonicClock.nowMs() - advanceStartMs
0 <= elapsed <= reserved -> settle exact elapsed and release remainder
```

Persisted waiting outside the active `advance()` call is excluded by construction.

- [ ] **Step 12: Update all orchestrator construction tests**

Replace `now: () => now` with:

```ts
provenanceClock: fixedProvenanceClock(now),
monotonicClock: new FakeMonotonicClock(0),
```

Do not change unrelated domain assertions.

- [ ] **Step 13: Run targeted Phase 4 + 5.0A regressions**

```bash
pnpm vitest run \
  tests/unit/bounded-run-orchestrator.test.ts \
  tests/integration/phase5-0a-model-budget.test.ts \
  tests/integration/phase4-approval-resume.test.ts \
  tests/integration/phase4-containment-mid-run.test.ts \
  tests/integration/phase4-crash-reconcile.test.ts \
  tests/integration/phase4-do-d1-e2e.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 14: Commit**

Stage only the orchestrator/model/clock test files actually modified, inspect `git diff --cached --name-only`, then:

```bash
git commit -m "feat: enforce model calls through durable budget envelopes"
```

---

### Task 8: Implement Model-Call Crash Recovery and Wall-Time Violations

**Files:**
- Modify: `packages/workflow-core/src/orchestrator.ts`
- Create: `tests/integration/phase5-0a-model-crash-recovery.test.ts`
- Create: `tests/integration/phase5-0a-wall-time.test.ts`
- Modify: `tests/integration/phase4-do-d1-e2e.test.ts` only if the blocking-model fixture needs the finalized ModelPort API.

**Interfaces:**
- Produces safe reuse/retry for invocation=`reserved`, no-blind-retry conservative recovery for `calling`, and explicit wall-time-overrun behavior.

- [ ] **Step 1: Write RED crash-after-prepare-before-calling test**

Simulate prepare success followed by failure before durable CAS. On resume assert:

```text
invocation remains reserved
provider execution count=0
no conservative max consumption
same logical durable grant is reused or safely recovered without double reservation
```

- [ ] **Step 2: Write RED `calling` crash test**

Simulate durable `calling` followed by process failure before authoritative usage. On resume without reconciliation source:

```text
provider is not called again
unknown usage is not zero
reserved maxima are conservatively consumed
```

Assert the accepted consequence: one ambiguous crash may exhaust the entire remaining token/cost budget because the call reserved the current remainder.

- [ ] **Step 3: Write RED missing-usage test**

A provider result missing one reserved usage dimension must not normal-settle. The envelope stays/re-enters recovery and resolves conservatively if no stronger evidence exists.

- [ ] **Step 4: Write RED waiting-time exclusion test**

With deterministic clocks:

```text
active advance 100ms
park waiting-approval
provenance/calendar jumps 1 day
resume active 200ms
```

Expected cumulative consumed wall time: `300ms`.

- [ ] **Step 5: Write RED clock independence tests**

- Change `InstantRef`, keep monotonic elapsed fixed => wall time unchanged.
- Keep `InstantRef` fixed, change monotonic elapsed => wall time follows monotonic clock.

- [ ] **Step 6: Write RED overrun test**

Reserve `100ms`, simulate `150ms` elapsed. Assert:

```text
runtime_wall_time_exhausted
released remainder=0
no additional provider/effect segment starts
```

Never accept a clamped successful `100ms` settlement.

- [ ] **Step 7: Run RED crash/time suite**

```bash
pnpm vitest run tests/integration/phase5-0a-model-crash-recovery.test.ts tests/integration/phase5-0a-wall-time.test.ts
```

- [ ] **Step 8: Add invocation-state recovery before fresh model calls**

For deterministic `(run_id, turn_index)` invocation identity:

```text
missing  -> normal call flow
reserved -> provider definitely did not cross calling; repeat local preflight using the held grant, then CAS
calling  -> never execute blindly; no reconciliation in 5.0A deterministic baseline => conservative-max settlement
succeeded -> never execute again; continue from durable result/turn state
failed/unknown -> follow explicit failure/recovery state, never implicit provider retry
```

- [ ] **Step 9: Implement conservative-max resolution**

For unresolved `calling`, settle every reserved model-call dimension to its reserved amount without fabricating exact provider usage fields. Preserve invocation status/evidence as `unknown` or equivalent explicit ambiguity.

- [ ] **Step 10: Implement wall-time violation path**

If elapsed exceeds the advance reservation, mark violation/recovery evidence, release zero remainder, consume no less than the reserved maximum, stop further active work, and surface `runtime_wall_time_exhausted`.

- [ ] **Step 11: Preserve containment preemption**

Re-run the blocking-model containment test. Budget locking must not reintroduce a fetch-wide Durable Object queue.

- [ ] **Step 12: Run GREEN crash/time/preemption suite + typecheck**

```bash
pnpm vitest run \
  tests/integration/phase5-0a-model-crash-recovery.test.ts \
  tests/integration/phase5-0a-wall-time.test.ts \
  tests/integration/phase4-do-d1-e2e.test.ts \
  tests/integration/phase4-containment-mid-run.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add packages/workflow-core/src/orchestrator.ts \
  tests/integration/phase5-0a-model-crash-recovery.test.ts \
  tests/integration/phase5-0a-wall-time.test.ts \
  tests/integration/phase4-do-d1-e2e.test.ts
git commit -m "feat: recover ambiguous model budget and wall time"
```

---

### Task 9: Classify All Ten Budget Dimensions Without Fake Enforcement

**Files:**
- Modify: `README.md`
- Modify: `PHASE5_ENTRY_GATE.md` only if evidence-status wording needs synchronization.
- Modify: comments in `packages/arcp-schema/src/types.ts` only if they still claim more enforcement than implemented.

**Interfaces:**
- Produces an evidence-backed dimension table using only `HARD_ENFORCED`, `ACCOUNTED_ONLY`, and `DECLARED_NOT_APPLICABLE_YET`.

- [ ] **Step 1: Audit actual boundaries**

For each dimension, point to the code/test that meters it:

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

- [ ] **Step 2: Keep forward envelope kinds as scaffolding only**

Retain future `tool-call`, `storage-operation`, `network-operation`, `recursive-wake` kind names if useful for schema stability, but do not create dummy runtime operations or call them enforced.

- [ ] **Step 3: Update README with evidence-backed wording**

Target only if tests prove it:

```text
turns               HARD_ENFORCED
wall_time_ms        HARD_ENFORCED at active orchestration/model boundary; executor cancellation not overclaimed
model_input_tokens  HARD_ENFORCED when adapter preflight proves the final request bound
model_output_tokens HARD_ENFORCED through provider request ceiling
model_cost_micros   HARD_ENFORCED only with deterministic safe pricing bound; otherwise provider call fails closed
external_actions    HARD_ENFORCED through Phase 4 claim-before-effect budget
```

Absent Phase 5 capability boundaries remain `DECLARED_NOT_APPLICABLE_YET` or `ACCOUNTED_ONLY`. If code cannot prove a target hard claim, downgrade documentation rather than weaken the definition of “hard enforced.”

- [ ] **Step 4: Run contract tests + typecheck**

```bash
pnpm vitest run tests/unit/phase5-0a-contracts.test.ts tests/unit/model-call-budget.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md PHASE5_ENTRY_GATE.md packages/arcp-schema/src/types.ts
git commit -m "docs: classify Phase 5.0A budget enforcement"
```

Stage only files that actually changed.

---

### Task 10: Migration Compatibility, Full Verification, and Lares Handoff

**Files:**
- Create: `tests/integration/phase5-0a-migration-compat.test.ts`
- Modify: `README.md` only if final evidence requires correction.
- Update: PR #8 metadata/body/comment after fresh verification.

**Interfaces:**
- Produces review-ready Phase 5.0A evidence; does not activate a live model provider.

- [ ] **Step 1: Write migration compatibility test**

Create DB state using migrations 0001+0002, insert representative Phase 4 run/model reservation/invocation data, apply 0003, then assert:

```text
old run readable
old invocation JSON readable
legacy arcp_model_budget_reservations intact
new budget envelope path usable
```

- [ ] **Step 2: Run migration compatibility test**

```bash
pnpm vitest run tests/integration/phase5-0a-migration-compat.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

```bash
pnpm test
```

Expected: every Phase 0–4 and Phase 5.0A test passes.

- [ ] **Step 4: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Perform invariant code audit**

Search/final-review must confirm:

```text
orchestrator has no direct model.deliberate call
orchestrator never passes budgetView: {}
new model path does not use reserveModelBudget/chargeReportedUsage
monotonic values are never persisted as historical timestamps
adapter does not import/access RunStateStorePort
prepareCall cannot perform provider/network I/O in deterministic implementation
missing usage never defaults to zero
no new live provider credentials/network dependency
```

- [ ] **Step 6: Record final evidence on PR #8**

Post/update:

```text
final head SHA
pnpm test: N/N files, M/M tests PASS
pnpm typecheck: PASS
D1/in-memory envelope parity: PASS
migration 0002 -> 0003 compatibility: PASS
reserved-vs-calling crash recovery: PASS
containment preemption regression: PASS
```

Do not claim Gate C/live model activation.

- [ ] **Step 7: Move PR #8 to implementation review**

Only after Step 3–6 fresh evidence exists, mark the PR ready for Lares adversarial implementation review.

- [ ] **Step 8: Commit final documentation corrections only if present**

If README evidence text changed after full verification:

```bash
git add README.md
git commit -m "docs: finalize Phase 5.0A verification evidence"
```

Skip an empty commit.

---

## Plan Self-Review

### Spec coverage

- Clock separation / active wall time: Tasks 1, 7, 8.
- Complete durable `getBudgetView`: Task 2.
- Atomic envelope reservation/settlement: Task 3.
- Durable model invocation lifecycle: Task 4.
- Amendment `prepareCall -> calling -> execute`: Tasks 5, 7, 8.
- Host-owned `ModelCallLimits`: Tasks 1, 6, 7.
- Missing usage / above-grant violation: Tasks 6–8.
- Conservative `calling` crash recovery: Task 8.
- Containment preemption regression: Task 8.
- Honest per-dimension enforcement / no fake capability: Task 9.
- Phase 4 migration compatibility / full regression / credential-free CI: Task 10.

### Lares non-blocking review decisions carried forward

1. `BudgetEnvelopeKind` may predeclare later capability kinds, but they remain scaffolding only until a real consumption boundary exists.
2. An unresolved crash after durable `calling` may consume the full currently-reserved remaining model token/cost budget. Task 8 contains a named regression test for this accepted fail-closed consequence.

### Plan execution invariant

Every task ends GREEN. Compatibility is staged deliberately:

```text
Task 1: types only, no breaking port changes
Task 2: getBudgetView added to both stores together
Task 3: envelope methods added to both stores together
Task 4: invocation lifecycle added to both stores together
Task 5: prepareCall staged alongside legacy deliberate
Task 7: orchestrator cutover + final removal of deliberate canonical path
```

No task is permitted to leave the repository intentionally uncompilable for a later task to repair.

### Placeholder scan

No unresolved `TBD`, `TODO`, “implement later”, or generic “add error handling” steps are part of this plan. Phase 5.0B/5.0C/MCP work is explicit out-of-scope, not a placeholder.

### Canonical interface names

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
