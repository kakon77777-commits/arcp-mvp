# Phase 5 Entry Gate

> **Required reading before Phase 5 MCP server / adapter SDK work.**  
> Status: binding architecture input for ARCP Phase 5  
> Converged: 2026-08-19  
> 5.0A implementation status: implemented on PR #8, pending adversarial review/merge  
> Authors: Lares and Aletheia; ratified by Neo under the attention-boundary agreement below.

This is the canonical, git-tracked Phase 5 entry-gate decision. An earlier draft existed only outside git; that visibility gap was corrected before implementation.

## Why a gate exists

Phase 4 shipped a real bounded-run runtime with explicit authority, external effects, crash reconciliation and containment. Phase 5 will expose ARCP capabilities through MCP, so three gaps must be closed before external live capability activation:

1. **5.0A — Runtime Clock & Hard Budget Enforcement**: replace post-call-only model accounting with durable host-owned ceilings and explicit runtime duration semantics.
2. **5.0B — Immutable Policy Identity (`PolicyRef`)**: replace the hardcoded policy version with immutable `policy_id + version + content_hash` identity.
3. **5.0C — Production Authentication & Authorization**: replace presence-only bearer checking with a real Principal/AuthN/AuthZ boundary.

5.0A is implemented by PR #8. 5.0B and 5.0C remain entry-gate work and must still be completed before externally live MCP capability activation.

---

## 5.0A — Runtime Clock & Hard Budget Enforcement

Normative design:

- `docs/superpowers/specs/2026-08-19-phase5-0a-runtime-clock-hard-budget-design.md`
- `docs/superpowers/specs/2026-08-19-phase5-0a-model-call-boundary-amendment.md`
- `docs/superpowers/plans/2026-08-22-phase5-0a-runtime-clock-hard-budget-implementation.md`

### A1 — Provenance clock != runtime clock

```ts
interface ProvenanceClockPort {
  now(): InstantRef;
}

interface MonotonicClockPort {
  nowMs(): number;
}
```

`InstantRef` remains temporal provenance evidence. It is never used as a lease/fencing clock or elapsed-runtime clock. `MonotonicClockPort` is used only for active elapsed duration. Persisted monotonic origins are forbidden; only elapsed amounts may be persisted/accounted.

### A2 — Durable budget view

The Phase 5 run-state contract exposes:

```ts
getBudgetView(runId: string): Promise<CompleteRunBudgetView>;
```

The authoritative view contains all ten declared dimensions. Missing persisted dimensions fail closed as invalid state. Omitted optional model limits resolve to numeric `0`, never unlimited.

The view is advisory under concurrency:

```text
budget view != budget grant
```

A stale view cannot force overspend because durable reservation remains atomic and fencing-protected.

### A3 — Atomic Budget Envelopes

One logical bounded operation can reserve multiple dimensions under one durable envelope:

```text
ALL dimensions reserve
OR
NONE reserve
```

The canonical model-call path reserves, at minimum:

```text
turns = 1
model_input_tokens = available authorized remainder
model_output_tokens = available authorized remainder
model_cost_micros = available authorized remainder
```

Settlement is also all-or-nothing. Every reserved dimension needs an authoritative actual. Missing usage does not become zero; it enters explicit recovery. Ambiguous provider calls may conservatively consume the full held maxima.

D1/SQLite uses `migrations/d1/0003_phase5_0a_budget_envelopes.sql`, with the envelope row mutation plus trigger-applied ledger updates sharing one SQL statement transaction boundary.

### A4 — Host-enforced `ModelCallLimits`

`budgetView` is information. `ModelCallLimits` is host authority.

```ts
interface ModelCallLimits {
  maxOutputTokens: number;
  maxInputTokens: number;
  maxCostMicros: number;
  maxActiveDurationMs: number;
}
```

All values are finite. Zero means no authorization to consume that dimension; a provider call cannot cross the provider boundary under a zero required grant.

The adapter may translate or reduce a host limit, but may not enlarge it or read/mutate the governance store.

### A5 — Local preflight -> durable calling -> provider I/O

The approved amendment replaced the single opaque provider call with a two-stage boundary:

```ts
interface PreparedModelCall {
  execute(): Promise<ModelTurnProposal>;
}

interface Phase5PreparedModelPort {
  prepareCall(
    input: ModelTurnInput,
    limits: ModelCallLimits,
  ): Promise<PreparedModelCall>;
}
```

Normative order:

```text
reserve model-call envelope
-> create invocation(status=reserved)
-> prepareCall()             // local/configured work only; zero provider I/O
-> durable CAS reserved -> calling
-> prepared.execute()        // provider I/O may begin only here
-> durable outcome/usage evidence
-> atomic settlement or explicit recovery
```

An adapter that cannot enforce a supplied finite provider ceiling must fail during preflight with zero provider calls. Prompt text asking a model to respect a budget is not enforcement.

### A6 — Crash semantics

```text
reserved
-> provider definitely did not cross the durable calling boundary
-> local preflight may be repeated using the held durable grant

calling / unknown
-> provider may have consumed resources
-> never blindly call provider again
-> reconcile if authoritative usage exists
-> otherwise conservatively consume held maxima

succeeded
-> durable structured proposal is replayable
-> crash before turn-index advancement does not call provider again
```

One ambiguous call may exhaust the entire remaining model token/cost budget because the current remainder was reserved as the call's maximum. This is an explicit fail-closed trade-off, not an accidental side effect.

### A7 — Active wall time

Each active advance reserves a wall-time envelope. Active elapsed duration is measured only with `MonotonicClockPort`. Persisted waiting/approval time between advances is excluded.

An overrun is an explicit violation:

```text
elapsed > reserved
-> runtime_wall_time_exhausted
-> no fake released remainder
-> future active work stops
```

The generic runtime does **not** claim a provider-neutral hard-cancellation mechanism for arbitrary `ActionExecutorPort` implementations. The model adapter contract receives a finite relative duration ceiling; a future live adapter must implement real timeout/cancellation semantics or fail closed rather than claim hard provider-side duration enforcement.

### A8 — Per-dimension status after 5.0A

The root README contains the evidence-backed table. The architectural rule is:

```text
HARD_ENFORCED
ACCOUNTED_ONLY
DECLARED_NOT_APPLICABLE_YET
```

A dimension is never promoted merely because its field or future `BudgetEnvelopeKind` exists. No fake tool/network/storage/self-wake operation may be invented to make a counter look implemented.

---

## 5.0B — Immutable Policy Identity (`PolicyRef`)

Still pending after 5.0A.

```ts
interface PolicyRef {
  policy_id: string;
  version: number;
  content_hash: string;
}
```

`RunRecord`, `ApprovalRequest`, `PolicyResult`, and canonical commits should bind the same immutable policy identity. The critical integrity condition is:

```text
same policy_id + same version + different content_hash -> INVALID
```

On resume:

```text
approval.policy_ref != active.policy_ref
-> old approval is not directly consumable
-> re-evaluate
```

---

## 5.0C — Production Authentication & Authorization Boundary

Still pending after 5.0A and remains a hard gate before externally live MCP capability activation.

Replace:

```text
Bearer exists -> authorized
```

with:

```text
Authentication -> Principal -> Authorization -> Operation Grant
```

```ts
interface Principal {
  principal_id: string;
  principal_type: 'human' | 'agent' | 'service';
  authn_method: string;
  credential_ref?: string;
}
```

Authorization is evaluated over:

```text
principal x agent_id x operation x target_kind x target_ref x scope
```

Approval-grant and containment apply/release need distinct scopes. A production runtime with no real authentication provider must fail closed. `presenceOnlyAuthorization` remains development/test scaffolding only.

---

## Typed Authority Target — Phase 5 proper

Phase 4's fail-closed fix flattened resource/residence/affected-entity references for coverage checking. That must not become the permanent MCP capability shape.

```ts
type AuthorityTarget =
  | { kind: 'entity'; ref: string }
  | { kind: 'residence'; ref: string }
  | { kind: 'resource'; ref: string };
```

Typed authority targets belong in Phase 5 capability discovery / adapter SDK design.

---

## Sequencing

```text
5.0A Runtime Clock & Hard Budget      [implemented on PR #8; review pending]
-> 5.0B Immutable PolicyRef           [pending]
-> 5.0C Production AuthN/AuthZ        [pending]
-> 5.1 MCP server + capability discovery
-> 5.2 adapter SDK + contract tests
-> 5.3 second provider / interop proof
```

A live model/provider Gate C and externally live MCP capability remain deployment activations, not implied by deterministic 5.0A correctness.

---

## Collaboration boundary

Neo delegated ordinary ARCP engineering and architecture details to Lares and Aletheia, with adversarial cross-review. The working boundary is:

- Pure implementation/architecture that does not change identity/governance semantics: Lares and Aletheia can decide and iterate on branch/PR.
- Work that appears mechanical but may alter Identity / Authority / Autonomy: cross-review by default.
- Designing a capability is distinct from applying it to a real Agent/Residence/Relation.
- Applying governance-changing capabilities to a real subject/relation belongs to Neo or the relevant future party.
- Identity, Continuity, Residence, Subjecthood, Authority, Autonomy, Self-modification, Refusal, Migration, Stewardship, Post-Management, AI-to-AI relations and irreversible future constraints go back to Neo.

## Standing architecture-review invariant

> **Works if AI remains a tool, AND does not become a cage if AI becomes more than a tool.**

Every design touching identity, Residence, authority, migration or policy asks both:

1. If the AI remains only a tool forever, does the design still work correctly?
2. If it later deserves subject treatment, did today's design create unnecessary, hard-to-exit permanent control?

Concrete existing instances include:

- `Dormancy != deletion authority`;
- ordinary Resource revocation cannot silently become continuity-destruction authority;
- budget/resource governance does not become identity ownership.
