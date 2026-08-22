# ARCP-MVP

Internal implementation of **ARCP × CTCL v0.1** — the Agent Residence Continuity Protocol.

## Status

- Phase 0 — schema/policy/coordinator/fake adapters: **done**
- Phase 1 — Cloudflare control plane, D1/R2, per-Agent Durable Object: **done**
- Phase 2 — pluggable Residence storage and reconciliation bridge: **done**
- Phase 3 — temporal provenance / CTCL / exact wake-time support: **done**
- Phase 4 — promptless bounded runs, authority/approval/containment, durable effect ledger: **done**
- Phase 5.0A — runtime clock separation and hard budget enforcement: **implemented on PR #8; adversarial review pending**
- Phase 5.0B — immutable `PolicyRef`: **pending**
- Phase 5.0C — production AuthN/AuthZ: **pending**
- Phase 5 MCP / adapter SDK: **not started**

A live model provider is **not** activated by default. Normal CI is deterministic, credential-free and network-free.

## Binding documents

- [`PHASE4_GOVERNANCE_INPUT.md`](PHASE4_GOVERNANCE_INPUT.md)
- [`PHASE5_ENTRY_GATE.md`](PHASE5_ENTRY_GATE.md)
- [`docs/governance/README.md`](docs/governance/README.md)
- [`docs/superpowers/specs/2026-08-19-phase5-0a-runtime-clock-hard-budget-design.md`](docs/superpowers/specs/2026-08-19-phase5-0a-runtime-clock-hard-budget-design.md)
- [`docs/superpowers/specs/2026-08-19-phase5-0a-model-call-boundary-amendment.md`](docs/superpowers/specs/2026-08-19-phase5-0a-model-call-boundary-amendment.md)
- [`docs/superpowers/plans/2026-08-22-phase5-0a-runtime-clock-hard-budget-implementation.md`](docs/superpowers/plans/2026-08-22-phase5-0a-runtime-clock-hard-budget-implementation.md)

## Core invariants

```text
trigger != authority
capability != permission
budget != ownership
approval != permanent subordination
suspend != identity rewrite
resource authority != identity authority
model != executor
provider effect != canonical Residence commit
unknown effect != blind retry
CTCL provenance != lease/fencing/runtime clock
```

Standing review invariant:

> **Works if AI remains a tool, AND does not become a cage if AI becomes more than a tool.**

## Phase 5.0A canonical model path

```text
durable getBudgetView(run)
-> atomic multi-dimensional model-call Budget Envelope
-> ModelInvocation(status=reserved)
-> prepareCall(input, ModelCallLimits)     // local preflight, zero provider I/O
-> durable CAS reserved -> calling
-> PreparedModelCall.execute()             // provider I/O may begin here
-> durable output/usage evidence
-> atomic envelope settlement or explicit recovery
```

`ModelCallLimits` is host authority, not prompt text:

```ts
interface ModelCallLimits {
  maxOutputTokens: number;
  maxInputTokens: number;
  maxCostMicros: number;
  maxActiveDurationMs: number;
}
```

Missing model usage never becomes zero. An unresolved call that crossed durable `calling` is never blindly retried; without stronger reconciliation evidence, held maxima may be conservatively consumed.

A succeeded invocation stores its structured proposal, so a crash before turn-index advancement can replay that durable result without a second provider call.

## Runtime clock separation

```text
ProvenanceClockPort / InstantRef
  -> persisted temporal evidence only

MonotonicClockPort
  -> active elapsed duration only
```

Persisted waiting/approval time is excluded from active wall-time consumption. Overrun is an explicit `runtime_wall_time_exhausted`; it is not hidden with a clamped successful settlement.

## Budget-dimension evidence

Definitions:

- **HARD_ENFORCED** — a real runtime boundary limits/denies the operation; not merely post-call reporting.
- **ACCOUNTED_ONLY** — usage is recorded but the complete pre-consumption boundary is absent.
- **DECLARED_NOT_APPLICABLE_YET** — the field/type exists but the corresponding capability boundary does not yet exist.

| Dimension | Status after 5.0A | Boundary |
|---|---|---|
| `turns` | **HARD_ENFORCED** | reserved before model execution in the model-call envelope |
| `wall_time_ms` | **HARD_ENFORCED at active-run admission/accounting and ModelPort contract** | monotonic advance envelope + finite duration ceiling; generic `ActionExecutorPort` cancellation is not claimed |
| `model_input_tokens` | **HARD_ENFORCED contract** | finite host ceiling; adapter must prove final request fits or fail preflight |
| `model_output_tokens` | **HARD_ENFORCED contract** | finite host ceiling; deterministic reference rejects known overspend before execution |
| `model_cost_micros` | **HARD_ENFORCED contract when safe deterministic pricing is available** | otherwise adapter must fail before provider I/O |
| `external_actions` | **HARD_ENFORCED** | Phase 4 claim-before-effect budget reservation |
| `tool_calls` | **DECLARED_NOT_APPLICABLE_YET** | no Phase 5 tool capability boundary yet |
| `storage_writes` | **DECLARED_NOT_APPLICABLE_YET** | no canonical storage-write metering contract yet |
| `network_requests` | **DECLARED_NOT_APPLICABLE_YET** | adapter SDK semantics not defined yet |
| `recursive_wakes` | **DECLARED_NOT_APPLICABLE_YET** | no recursive self-wake runtime yet |

Future `BudgetEnvelopeKind` names are scaffolding only. Their existence is not evidence of enforcement.

## Crash semantics

```text
reserved
-> provider definitely did not cross durable calling
-> local preflight may be repeated with held grant

calling / unknown
-> provider may have consumed resources
-> never blindly execute again
-> reconcile if possible; otherwise settle held maxima conservatively

succeeded
-> replay durable structured proposal
-> no second provider call
```

## Phase 4 preserved semantics

Phase 4 still owns authority/policy/approval/action-effect behavior. External effects use durable claim-before-effect semantics, receipts and reconciliation; containment constrains channels but does not erase evidence of an already-performed effect.

Deterministic first-run identity remains:

```text
(agent_id, wake.idempotency_key) -> run_id
```

## Packages and migrations

```text
packages/
  arcp-schema/              Phase 0-5 persisted record types
  policy-engine/            deterministic R0-R4 policy
  coordinator/              canonical state + lease/fencing
  control-plane-core/       platform-neutral control plane
  workflow-core/            Phase 4 compatibility + canonical 5.0A runtime
  residence-storage/        Residence storage contract
  residence-bridge/         reconciliation publisher
  temporal-evidence/        temporal trust/provenance
  temporal-wake/            exact wake compiler
  adapters/model/           fake + deterministic prepared-call adapter
  adapters/cloudflare/      D1/R2 + per-Agent DO + budget envelopes

migrations/d1/
  0001_init.sql
  0002_phase4_runs.sql
  0003_phase5_0a_budget_envelopes.sql
```

## Commands

```text
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
```

Phase 5.0A does not activate MCP or a live model. 5.0B and 5.0C remain entry gates before externally live Phase 5 capability activation.
