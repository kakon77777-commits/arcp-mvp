# Phase 4 Promptless Bounded Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 4 as a provider-neutral bounded autonomous-run runtime with explicit wake/action authority, multi-dimensional budgets, exact-bound approvals, crash-safe durable external-effect accounting, containment, waiting/resume, dead-letter/reconciliation, and Cloudflare/D1 integration.

**Architecture:** Add a new `@arcp/workflow-core` package that owns deterministic run orchestration and port contracts while keeping model vendors, Cloudflare runtime types, MCP, and live tool providers outside the core. Persist external-effect claims and receipts independently from the final Residence manifest commit so a crash after an external provider effect cannot cause blind re-execution. Extend the per-Agent Durable Object only as the serialization/routing boundary; it remains distinct from model/tool providers and canonical Residence commit semantics.

**Tech Stack:** TypeScript 5.9, Node >=22.13 (CI Node 24), pnpm 11.8.0, Vitest 3.2, Cloudflare Worker/Durable Object/D1 adapters, existing `@arcp/schema`, `@arcp/policy-engine`, `@arcp/coordinator`, `@arcp/temporal-evidence`.

**Spec:** `docs/superpowers/specs/2026-08-18-phase4-promptless-bounded-runs-design.md`

## Global Constraints

- `PHASE4_GOVERNANCE_INPUT.md` and AREC v0.1.1 are binding architecture inputs.
- `trigger != authority`; `capability != permission`; `budget != ownership`; `approval != permanent subordination`; `suspend != identity rewrite`; `resource authority != identity authority`.
- Preserve all Phase 0–3 invariants, especially stale-fencing rejection, atomic canonical commit preparation, CTCL-not-a-lease-clock, backend observation != canonical commit, and external deletion != canonical deletion.
- Normal CI must stay credential-free and network-free.
- `@arcp/workflow-core` must not import Cloudflare runtime types, vendor model SDKs, MCP, or CTCL transport packages.
- The model may propose `ActionIntent`; it must never receive a privileged executor or self-certify authority.
- Every potentially effectful external action must have durable pre-effect state before the provider call and durable post-effect evidence or explicit unknown state after it.
- A record already marked `executing` with no definitive receipt is never blindly re-executed unless provider-enforced idempotency semantics make the same-key retry safe.
- Missing `budget_ref` resolves to an explicit bounded default, never unlimited execution.
- Waiting/approval does not hold a process alive. Resume uses a persisted checkpoint plus a fresh authorized wake/fencing token.
- External actions execute sequentially in the Phase 4 MVP; parallel action execution is deferred.
- Live model Gate C is optional activation after deterministic Phase 4 is green and does not define merge correctness.

---

## Locked File Structure

### Schema and workflow core

- Modify `packages/arcp-schema/src/types.ts` — additive Phase 4 persisted record types and optional `ActionIntent` impact hints.
- Create `packages/workflow-core/package.json`.
- Create `packages/workflow-core/src/types.ts` — operational-only workflow types not persisted in `@arcp/schema`.
- Create `packages/workflow-core/src/ports.ts` — provider-neutral ports.
- Create `packages/workflow-core/src/state-machine.ts` — exact `RunPhase` transitions.
- Create `packages/workflow-core/src/budget.ts` — budget arithmetic and risk ordering.
- Create `packages/workflow-core/src/hashing.ts` — canonical structured action/approval binding hashes.
- Create `packages/workflow-core/src/in-memory-store.ts` — executable reference `RunStateStorePort`.
- Create `packages/workflow-core/src/execution-ledger.ts` — claim/effect/reconciliation transition helpers.
- Create `packages/workflow-core/src/authority.ts` — deterministic/static authority resolver.
- Create `packages/workflow-core/src/approvals.ts` — exact binding/quorum helpers.
- Create `packages/workflow-core/src/containment.ts` — scoped containment evaluation/review semantics.
- Create `packages/workflow-core/src/errors.ts` — normalized orchestration error taxonomy.
- Create `packages/workflow-core/src/orchestrator.ts` — bounded run engine.
- Create `packages/workflow-core/src/index.ts` — public exports.

### Model and deterministic executor

- Modify `packages/adapters/model/package.json` — depend on `@arcp/workflow-core`.
- Replace/split `packages/adapters/model/src/index.ts` — exports.
- Create `packages/adapters/model/src/fake.ts` — backwards-compatible `FakeModelAdapter` plus async `DeterministicModelAdapter implements ModelPort`.
- Create `tests/helpers/recording-action-executor.ts` — deterministic executor/reconciler with idempotency/failure injection.
- Create `tests/helpers/fake-run-dependencies.ts` — reusable deterministic hydration/authority/policy/commit fixtures.

### Cloudflare/D1 and control plane

- Create `migrations/d1/0002_phase4_runs.sql` — Phase 4 operational tables.
- Create `packages/adapters/cloudflare/src/d1-run-state-store.ts` — D1 implementation of `RunStateStorePort` using real SQL semantics.
- Modify `packages/adapters/cloudflare/src/index.ts` — export Phase 4 adapter.
- Modify `packages/adapters/cloudflare/src/agent-durable-object-core.ts` — create/advance/resume bounded runs through injected workflow dependencies; preserve wake dedup.
- Modify `packages/adapters/cloudflare/src/agent-durable-object.ts` — internal run/approval/containment routes.
- Modify `packages/control-plane-core/src/contracts.ts` — run status/advance/approval/containment port contracts.
- Modify `packages/control-plane-core/src/http.ts` — HTTP routing/envelopes.
- Modify `packages/control-plane-core/src/coordinator-client.ts` — matching client methods and strict envelope parsing.

### Tests and docs

- Create `tests/unit/workflow-run-state.test.ts`.
- Create `tests/unit/run-budget.test.ts`.
- Create `tests/unit/action-execution-ledger.test.ts`.
- Create `tests/unit/authority-resolution.test.ts`.
- Create `tests/unit/approval-binding.test.ts`.
- Create `tests/unit/containment.test.ts`.
- Create `tests/unit/model-port.test.ts`.
- Create `tests/unit/bounded-run-orchestrator.test.ts`.
- Create `tests/unit/d1-run-state-store.test.ts`.
- Create `tests/integration/phase4-bounded-run.test.ts`.
- Create `tests/integration/phase4-approval-resume.test.ts`.
- Create `tests/integration/phase4-crash-reconcile.test.ts`.
- Create `tests/integration/phase4-trigger-paths.test.ts`.
- Modify `README.md` — Phase 4 status/boundaries and Gate C.
- Create `docs/examples/phase4-bounded-run.json` — non-secret bounded default/static authority example.
- Modify root `package.json` and `pnpm-lock.yaml` when adding `@arcp/workflow-core` workspace dependency.

---

### Task 1: RED Gate — Phase 4 Contracts, State Machine, Budget and Effect-Ledger Expectations

**Files:**
- Create: `tests/unit/workflow-run-state.test.ts`
- Create: `tests/unit/run-budget.test.ts`
- Create: `tests/unit/action-execution-ledger.test.ts`
- Create: `tests/unit/authority-resolution.test.ts`
- Create: `tests/unit/approval-binding.test.ts`
- Create: `tests/unit/containment.test.ts`
- Create: `tests/unit/model-port.test.ts`

**Interfaces:**
- Consumes: existing `RiskLevel`, `ActionIntent`, `WakeRecord`, `InstantRef`.
- Produces test-defined required API surface for `@arcp/workflow-core` and new schema records.

- [ ] **Step 1: Add RED run-state tests**

The test imports `assertRunPhaseTransition` and proves exact legal/illegal transitions, including terminal phases:

```ts
expect(() => assertRunPhaseTransition('accepted', 'hydrating')).not.toThrow();
expect(() => assertRunPhaseTransition('waiting-approval', 'authorizing')).not.toThrow();
expect(() => assertRunPhaseTransition('executing', 'reconciling')).not.toThrow();
expect(() => assertRunPhaseTransition('completed', 'deliberating')).toThrow();
expect(() => assertRunPhaseTransition('dead-lettered', 'executing')).toThrow();
```

- [ ] **Step 2: Add RED budget tests**

Required API:

```ts
const ledger = new InMemoryBudgetLedger(spec);
const reservation = ledger.reserve({
  reservationId: 'r1',
  dimension: 'external_actions',
  amount: 1,
});
expect(ledger.view().external_actions.reserved).toBe(1);
ledger.settle(reservation.reservationId, 1);
expect(ledger.view().external_actions.consumed).toBe(1);
expect(() => ledger.reserve({ reservationId: 'r2', dimension: 'external_actions', amount: 1 }))
  .toThrowError(expect.objectContaining({ code: 'budget_exhausted' }));
```

Also prove omitted profile uses `DEFAULT_BOUNDED_RUN_BUDGET`, `R4` is above `R3`, and waiting wall time is not charged as active wall time.

- [ ] **Step 3: Add RED effect-ledger tests**

Required semantics:

```ts
const claimed = await store.reserveBudgetAndClaimAction(input);
expect(claimed.lifecycle_status).toBe('claimed');
const executing = await store.markActionExecuting(claimed.execution_id, token);
expect(executing.lifecycle_status).toBe('executing');
expect(executing.effect_status).toBe('not-observed');
```

Then simulate crash after `executing`: recovery must return `reconcile-required`, not `execute`.

Prove lifecycle, effect and reconciliation are independent:

```text
lifecycle_status: executing|receipt-recorded|canonically-recorded
effect_status: not-observed|succeeded|failed|partial|unknown
reconciliation_status: not-required|pending|reconciled|manual-required
```

- [ ] **Step 4: Add RED authority tests**

Static resolver test must prove ordinary resource ownership cannot authorize `continuity-destructive` action without `separate-governance` or continuity-safe precondition, while ordinary non-residence resource use can be authorized.

- [ ] **Step 5: Add RED approval tests**

Use `computeApprovalBindingHash()` over canonical structured data. Same semantic input must hash equally regardless of object property insertion order; changing action hash, scope, authority hash, policy version, expiry, or required parties must change the binding.

- [ ] **Step 6: Add RED containment tests**

Prove active scoped containment blocks a matching external action but does not block mandatory `record-effect-evidence`; expired containment becomes `review-due`, never silently released.

- [ ] **Step 7: Add RED ModelPort tests**

`DeterministicModelAdapter` must implement async `deliberate()` and preserve a backwards-compatible scripted fake. Model output must be structured proposal data only; executor is not part of model input or adapter dependencies.

- [ ] **Step 8: Push RED-only commit and open Draft PR**

Commit message:

```text
test: define Phase 4 bounded-run invariants
```

Open Draft PR titled:

```text
Phase 4: Promptless Bounded Runs
```

Expected CI: FAIL because `@arcp/workflow-core` and Phase 4 schema/types do not yet exist. Confirm failure is caused by missing Phase 4 implementation, not test syntax or unrelated regressions.

---

### Task 2: 4A GREEN — Schema, Run State, Budget, Effect Ledger and In-Memory Reference Store

**Files:**
- Modify: `packages/arcp-schema/src/types.ts`
- Create: `packages/workflow-core/package.json`
- Create: `packages/workflow-core/src/types.ts`
- Create: `packages/workflow-core/src/ports.ts`
- Create: `packages/workflow-core/src/state-machine.ts`
- Create: `packages/workflow-core/src/budget.ts`
- Create: `packages/workflow-core/src/hashing.ts`
- Create: `packages/workflow-core/src/execution-ledger.ts`
- Create: `packages/workflow-core/src/in-memory-store.ts`
- Create: `packages/workflow-core/src/errors.ts`
- Create: `packages/workflow-core/src/index.ts`
- Modify: root `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces persisted records `RunRecord`, `RunCheckpoint`, `RunBudgetSpec`, `ModelInvocationRecord`, `AuthorityResolution`, `ApprovalRequest`, `ApprovalGrant`, `ActionExecutionRecord`, `ActionReceipt`, `ContainmentRecord`, `DeadLetterRecord`.
- Produces `RunStateStorePort`, `InMemoryRunStateStore`, `InMemoryBudgetLedger`, `assertRunPhaseTransition`, `computeActionHash`, `computeApprovalBindingHash`, `recoverExecutionDecision`.

- [ ] **Step 1: Add additive Phase 4 schema types**

Keep all pre-Phase-4 fields backward-compatible. Widen `ActionIntent` only with optional impact hints. Define `AuthoritySource`, `RunPhase`, `ActionLifecycleStatus`, `ExternalEffectStatus`, and `ReconciliationStatus` exactly as in the design self-reviewed form.

- [ ] **Step 2: Implement exact run phase transitions**

Use an explicit `Record<RunPhase, RunPhase[]>`; terminals `completed`, `dead-lettered`, `failed` have no outgoing automatic transitions.

- [ ] **Step 3: Implement budget semantics**

`DEFAULT_BOUNDED_RUN_BUDGET` is intentionally conservative:

```ts
{
  max_turns: 4,
  max_wall_time_ms: 120_000,
  max_model_input_tokens: 64_000,
  max_model_output_tokens: 16_000,
  max_model_cost_micros: 1_000_000,
  max_tool_calls: 12,
  max_external_actions: 8,
  max_storage_writes: 8,
  max_network_requests: 16,
  max_recursive_wakes: 2,
  max_risk: 'R2',
}
```

Active wall time is supplied/settled by active execution segments; persisted waiting time is not automatically added.

- [ ] **Step 4: Implement canonical structured hashes**

Use existing schema canonical serialization/hash utilities if available; otherwise canonicalize JSON recursively with sorted object keys and hash the serialized structured object. Never bind approvals with delimiter-joined strings.

- [ ] **Step 5: Implement in-memory atomic reference store**

`reserveBudgetAndClaimAction()` performs in one synchronous critical section:

1. verify run current fencing token;
2. reject duplicate action hash/idempotency mismatch;
3. reserve external-action budget;
4. create or return the deterministic execution record;
5. persist `lifecycle_status='claimed'`.

- [ ] **Step 6: Implement effect recovery helper**

Rules:

```text
claimed + no effect evidence -> execute
executing + no definitive receipt + provider-enforced -> adapter-safe-retry-or-reconcile
executing + no definitive receipt + best-effort/none -> reconcile
receipt-recorded -> commit-only
canonically-recorded -> done
```

- [ ] **Step 7: Run targeted CI after GREEN implementation**

Expected targeted suites: Task 1 tests all PASS; existing full suite still PASS.

- [ ] **Step 8: Commit 4A**

```text
feat: add Phase 4 run and effect-ledger core
```

---

### Task 3: 4B RED/GREEN — Provider-Neutral Model, Authority, Hydration and Bounded Orchestrator

**Files:**
- Create: `packages/workflow-core/src/authority.ts`
- Create: `packages/workflow-core/src/containment.ts`
- Create: `packages/workflow-core/src/orchestrator.ts`
- Modify: `packages/workflow-core/src/ports.ts`
- Modify: `packages/workflow-core/src/index.ts`
- Modify: `packages/adapters/model/package.json`
- Create: `packages/adapters/model/src/fake.ts`
- Modify: `packages/adapters/model/src/index.ts`
- Create: `tests/helpers/fake-run-dependencies.ts`
- Create: `tests/unit/bounded-run-orchestrator.test.ts`
- Modify: `tests/unit/model-port.test.ts`

**Interfaces:**
- Produces `ModelPort`, `ContextHydratorPort`, `WakeAuthorityResolverPort`, `ActionAuthorityResolverPort`, `PolicyPort`, `RunBudgetProviderPort`, `CommitPort`, `BoundedRunOrchestrator`.

- [ ] **Step 1: Write RED orchestrator happy-path test**

One wake, one fake model turn, one authorized no-effect proposal or deterministic effect executor placeholder. Prove ordering by observing persisted phases and that authority is resolved after proposal, not supplied by model.

- [ ] **Step 2: Write RED bounded-stop tests**

Prove max turns, max risk and model budget stop the loop without treating ordinary budget exhaustion as corrupt state.

- [ ] **Step 3: Write RED wake-authority denial test**

Invalid `required_authority` produces durable denial and zero model invocations.

- [ ] **Step 4: Implement provider-neutral ports and static resolvers**

`StaticWakeAuthorityResolver` maps explicit accepted authority strings/scopes. `StaticActionAuthorityResolver` consumes explicit grants; it never falls back to universal `admin` authority.

- [ ] **Step 5: Evolve fake model**

Maintain old `FakeModelAdapter.nextTurn()` compatibility for Phase 0 tests. Add `DeterministicModelAdapter.deliberate()` for Phase 4 with deterministic scripted usage/failure modes.

- [ ] **Step 6: Implement proposal validation**

Reject duplicate action IDs/idempotency keys, invalid impact references, and risk above supported schema. Do not accept an `authority_source` field from model output as execution authority.

- [ ] **Step 7: Implement bounded orchestration through authorization stage**

The orchestrator performs:

```text
wake authority -> hydrate -> model reservation/invocation -> validate proposals -> resolve affected refs/authority -> deterministic policy -> result
```

It does not yet implement human approval waiting or live external provider execution; those land in 4C.

- [ ] **Step 8: Run targeted/full CI and commit 4B**

Commit:

```text
feat: orchestrate bounded provider-neutral model runs
```

---

### Task 4: 4C RED/GREEN — Approval, Executor, Receipt, Waiting/Resume, Containment and Dead Letter

**Files:**
- Create: `packages/workflow-core/src/approvals.ts`
- Modify: `packages/workflow-core/src/containment.ts`
- Modify: `packages/workflow-core/src/orchestrator.ts`
- Create: `tests/helpers/recording-action-executor.ts`
- Create: `tests/integration/phase4-approval-resume.test.ts`
- Create: `tests/integration/phase4-crash-reconcile.test.ts`
- Modify: `tests/unit/approval-binding.test.ts`
- Modify: `tests/unit/containment.test.ts`
- Modify: `tests/unit/action-execution-ledger.test.ts`

**Interfaces:**
- Produces `ActionExecutorPort`, `ExecutionAuthorization`, approval satisfaction helpers and full action execution/reconciliation flow.

- [ ] **Step 1: Write RED approval-wait/resume integration test**

Expected sequence:

```text
webhook wake
-> model ActionIntent
-> authority authorized but policy request-approval
-> ApprovalRequest persisted
-> RunPhase waiting-approval
-> return without executor call
-> exact ApprovalGrant appended
-> new approval-resume wake
-> fresh fencing + revalidation
-> exactly one executor effect
-> receipt persisted
```

- [ ] **Step 2: Write RED crash-after-effect-before-receipt test**

Recording executor performs one side effect then injects a crash before the orchestrator persists the receipt. On restart the durable execution is `executing`; the second run calls `reconcile()` and never calls `execute()` again. Reconcile confirms succeeded, receipt is persisted, then commit continues.

- [ ] **Step 3: Write RED containment-mid-run test**

After one effect is attempted, activate containment before next action. Mandatory receipt/audit evidence for the first effect persists, the second action is not executed, and run moves to `contained`/waiting semantics.

- [ ] **Step 4: Implement exact approval satisfaction**

Grant must match approval request, approver must be a required unique party, grant scope must not widen requested scope, and binding hash/expiry/policy/action/authority hashes are revalidated on resume.

- [ ] **Step 5: Implement full executor/effect-ledger flow**

Before `execute()`:

```text
current fencing -> authority/policy/approval -> containment -> atomic budget reserve + claim -> mark executing -> execute
```

After result:

```text
append immutable receipt -> settle budget -> canonical commit -> mark canonically-recorded
```

Unknown result goes to reconciliation/manual/dead-letter, never blind execution.

- [ ] **Step 6: Implement containment TTL/review and evidence exception**

Containment can block new model/action/residence mutation scopes, but cannot block `record-effect-evidence` or minimal canonicalization needed to preserve already-attempted effect/audit evidence.

- [ ] **Step 7: Implement dead-letter records**

Persist stage, attempts, error code, `effect_state: none|known|unknown`, and manual resolution flag. Dead-letter never deletes the run/effect evidence.

- [ ] **Step 8: Run targeted/full CI and commit 4C**

Commit:

```text
feat: add approvals crash-safe execution and containment
```

---

### Task 5: 4D RED/GREEN — D1 Run-State Adapter and SQL Migration

**Files:**
- Create: `migrations/d1/0002_phase4_runs.sql`
- Create: `packages/adapters/cloudflare/src/d1-run-state-store.ts`
- Modify: `packages/adapters/cloudflare/src/index.ts`
- Create: `tests/unit/d1-run-state-store.test.ts`

**Interfaces:**
- Produces `D1RunStateStore implements RunStateStorePort`.

- [ ] **Step 1: Write RED real-SQL D1 adapter tests**

Follow the existing `node:sqlite` D1 fake pattern. Apply both `0001` and `0002` migrations. Run the same core assertions as the in-memory run store, including duplicate wake/run creation, atomic budget+action claim, receipt append, approval grants, containment and dead-letter.

- [ ] **Step 2: Write migration schema**

Create tables:

```text
arcp_runs
arcp_run_checkpoints
arcp_run_budget_ledger
arcp_model_invocations
arcp_authority_resolutions
arcp_approval_requests
arcp_approval_grants
arcp_action_executions
arcp_action_receipts
arcp_containments
arcp_dead_letters
```

Use primary/unique constraints to enforce stable IDs/idempotency and foreign keys/references where the existing D1 style permits.

- [ ] **Step 3: Implement D1 serialization and atomic operations**

Complex record bodies may be canonical JSON columns in MVP, but indexed identity/status/fencing/idempotency fields stay first-class columns. Do not persist secrets.

- [ ] **Step 4: Prove store parity and commit 4D-storage**

Commit:

```text
feat: persist Phase 4 run state in D1
```

---

### Task 6: 4D RED/GREEN — Durable Object and Control-Plane Run/Approval/Containment APIs

**Files:**
- Modify: `packages/control-plane-core/src/contracts.ts`
- Modify: `packages/control-plane-core/src/http.ts`
- Modify: `packages/control-plane-core/src/coordinator-client.ts`
- Modify: `packages/adapters/cloudflare/src/agent-durable-object-core.ts`
- Modify: `packages/adapters/cloudflare/src/agent-durable-object.ts`
- Modify: Worker/runtime composition if required by current adapter entrypoint.
- Create/modify: `tests/unit/agent-durable-object.test.ts`
- Modify: `tests/unit/control-plane-core.test.ts`
- Modify: `tests/unit/coordinator-client.test.ts`
- Create: `tests/integration/phase4-bounded-run.test.ts`

**Interfaces:**
- Public/internal semantics: read run, advance run, submit approval grant, apply/release containment. Existing manifest/status/wake contracts remain compatible.

- [ ] **Step 1: Write RED HTTP contract tests**

Strictly test request/response envelope symmetry so the Phase 1 wire-shape bug cannot recur.

- [ ] **Step 2: Extend coordinator control port**

Add run methods without breaking callers that only use manifest/status/wake. Keep authorization operations explicit per route.

- [ ] **Step 3: Inject Phase 4 workflow into DO core**

DO owns serialization and current run fencing. It does not directly import vendor model/executor implementations; runtime composition injects deterministic/test providers in CI.

- [ ] **Step 4: Implement bounded advance semantics**

One advance request does bounded progress and returns a persisted state (`completed`, `waiting-approval`, `contained`, `dead-lettered`, etc.); it never waits indefinitely for a human approval.

- [ ] **Step 5: Integration-test wake -> run -> effect -> receipt -> canonical manifest**

Use deterministic providers only.

- [ ] **Step 6: Run full CI and commit**

Commit:

```text
feat: integrate Phase 4 runs with the control plane
```

---

### Task 7: Trigger Paths — Schedule, Webhook and State Wake Compilation/Denial

**Files:**
- Create: `tests/integration/phase4-trigger-paths.test.ts`
- Add minimal trigger helper modules only where current code lacks a seam; do not build a general scheduling platform.

**Interfaces:**
- All sources produce existing `WakeRecord` and pass through `WakeAuthorityResolverPort`.

- [ ] **Step 1: Write RED schedule trigger test**

Phase 3 exact wake result -> standard WakeRecord -> authorized bounded run.

- [ ] **Step 2: Write RED webhook test**

Stable delivery id drives wake idempotency; verified transport/source authority permits wake, payload content alone grants no action authority.

- [ ] **Step 3: Write RED state trigger test**

`event_id + rule_id` derives stable wake idempotency. Invalid state-rule authority is durably denied with zero model/executor calls.

- [ ] **Step 4: Implement minimal trigger compilers and run tests**

No natural-language scheduler. No MCP dependency.

- [ ] **Step 5: Commit**

```text
feat: add bounded schedule webhook and state triggers
```

---

### Task 8: Documentation, Full Crash Matrix, Architectural Audit, Optional Gate C Stub and PR Convergence

**Files:**
- Modify: `README.md`
- Create: `docs/examples/phase4-bounded-run.json`
- Optionally create: `scripts/model-live-smoke.ts` only if a provider-neutral/live adapter already exists by this task; otherwise document Gate C without adding a fake vendor implementation.
- Add/expand crash tests in existing Phase 4 unit/integration files.

**Interfaces:** none new; this task proves convergence.

- [ ] **Step 1: Complete crash-injection matrix**

Cover the 15 design checkpoints, prioritizing effect boundaries. Explicitly prove crash-after-receipt retries commit only and crash-after-`executing` reconciles rather than re-executing.

- [ ] **Step 2: Update README**

Document Phase 4 architecture, AREC boundaries, durable effect ledger, waiting/resume, containment, deterministic CI, and Gate C as optional activation.

- [ ] **Step 3: Add non-secret example**

Example contains only bounded budget/static authority identifiers and no provider secret/token/user path.

- [ ] **Step 4: Run full verification through normal PR CI**

Required commands:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
```

Required architecture audits by actual imports/symbols:

```text
workflow-core: no DurableObject/D1/R2/vendor SDK/MCP imports
coordinator: no live model/action provider imports
policy-engine: no model provider import
model adapter: no executor/tool connector dependency
lease/fencing code: no CTCL/commoninstant dependency
```

- [ ] **Step 5: Verify acceptance criteria line-by-line**

Map all 33 Phase 4 design acceptance criteria to tests/code inspection. Do not mark Phase 4 complete if any criterion lacks evidence.

- [ ] **Step 6: Update PR body with exact fresh counts**

Report workspace count, test file/test counts, typecheck, crash/reconcile tests, architecture audit, and whether Gate C was or was not executed.

- [ ] **Step 7: Mark PR ready for local Claude review**

Do not merge automatically in this execution pass. The requested handoff is a complete PR for the local AI to inspect; fixes can land on the same branch afterward.

---

## Plan Self-Review Result

- **Spec coverage:** Tasks 1–2 cover run/schema/budget/effect-ledger foundations; Task 3 covers provider-neutral bounded model orchestration and authority; Task 4 covers approval/execution/waiting/reconcile/containment/dead-letter; Tasks 5–7 cover D1, Durable Object/control-plane and trigger paths; Task 8 covers the crash matrix, documentation, audits and PR convergence. Phase 5 MCP, full Relation/Contract persistence and Phase 6 migration remain out of scope.
- **TDD:** Production work starts only after Task 1 RED tests have failed in PR CI for the expected missing-implementation reason. Each later slice begins with its own new failing behavior tests before implementation.
- **Type consistency:** `RunPhase`, `AuthoritySource`, budget, execution lifecycle/effect/reconciliation, approval binding and port names are fixed by the Phase 4 design and reused consistently here.
- **No placeholders:** Vendor choice is intentionally deferred as Gate C configuration. No implementation task depends on an unspecified live provider.
- **Pragmatic scope:** External actions remain sequential; static authority and deterministic providers are enough to prove architecture. The plan avoids building MCP, a full social graph, a public SaaS, or parallel orchestration in Phase 4.
