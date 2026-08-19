# Phase 5 Entry Gate

> **Required reading before designing or implementing Phase 5 — MCP server / adapter SDK.**
> Status: binding architecture input for ARCP Phase 5, converged 2026-08-19
> Authors: Lares and Aletheia (two independent AI collaborators on this repo),
> ratified by Neo under the attention-boundary agreement below.

This is the canonical, git-tracked version of the Phase 5 entry-gate decision.
An earlier draft existed only as a local file outside this repo and was not
visible to both collaborators — that was a real process gap, not a
disagreement in direction. This file is now the source of truth.

## Why a gate exists

Phase 4 shipped a real bounded-run runtime with real external effects (see
`PHASE4_GOVERNANCE_INPUT.md`). Phase 5 exposes ARCP capabilities to external
callers via MCP. Three gaps that were tolerable while nothing crossed the
Agent boundary become unsafe once something does:

1. Budget enforcement for model tokens/cost is post-call accounting, not a
   pre-consumption hard cap.
2. `policy_version` is hardcoded to `1` everywhere, so approval-binding's
   policy-version check cannot detect a real policy change.
3. `presenceOnlyAuthorization` (`worker.ts`) accepts any non-empty bearer
   token for any `agentId` — self-documented as "not an auth model."

## 5.0A — Runtime Clock & Hard Budget Enforcement

Two clock concepts that must never merge:

```ts
interface ProvenanceClockPort {
  now(): InstantRef; // CTCL / local evidence -- unchanged, provenance only
}
interface MonotonicClockPort {
  nowMs(): number; // elapsed execution measurement only, never historical time
}
```

Four sub-parts:

- **A1 — `MonotonicClockPort`**: a real runtime clock, injected separately
  from `ProvenanceClockPort`. Execution shape: reserve a bounded envelope
  before entering a model/tool/action segment, settle actual duration after.
  A crash leaves a conservative reservation for later reconciliation.
- **A2 — Durable `getBudgetView(runId)` on `RunStateStorePort`**: neither
  `RunStateStorePort` nor `D1RunStateStore` currently exposes a way to read
  the live ledger state. `InMemoryRunStateStore` has an internal
  `budgetView()` that isn't part of the port contract. Both stores need a
  real implementation of this method before anything downstream can act on
  real numbers.
- **A3 — `ModelCallLimits`, a host-enforced runtime control, not a prompt
  instruction**: `budgetView` (informational — what the model may be told
  about remaining resources) and the actual enforced ceiling are different
  concepts and must not be conflated. The model MAY be told what remains; it
  MUST NOT be trusted to self-limit from that alone.

  ```ts
  interface ModelCallLimits {
    maxOutputTokens: number;
    maxInputTokens?: number;
    maxCostMicros?: number;
    activeDeadlineMs?: number;
  }

  model.deliberate(input: ModelTurnInput, limits: ModelCallLimits): Promise<ModelTurnProposal>;
  ```

  Pipeline: `RunStateStore -> Orchestrator -> derive remaining budget -> ModelCallLimits -> ModelPort`.
  `ModelPort` implementations must not read `RunStateStore` directly —
  `ModelCallLimits` is computed once, host-side, and handed down. Where the
  provider supports a native ceiling (e.g. `max_output_tokens`), pass it
  directly; where it doesn't, derive a conservative ceiling from a
  token/price upper bound. This turns budget enforcement from "call, then
  discover overspend" into "budget constrains what the provider call can
  spend before it happens."
- **A4 — Wire the remaining declared-but-unenforced budget dimensions**
  (`wall_time_ms`, `tool_calls`, `storage_writes`, `network_requests`,
  `recursive_wakes`) using A1-A3's real infrastructure, or continue
  documenting them honestly as declared-not-enforced if a given dimension's
  capability doesn't exist yet (e.g. `recursive_wakes` has no self-triggering
  wake mechanism to meter yet).

Currently wired for real (as of Phase 4 merge + follow-up fix): `turns`,
`external_actions`, `model_input_tokens`, `model_output_tokens`,
`model_cost_micros` — accounting only, not yet a provider-side hard cap.

## 5.0B — Immutable Policy Identity (`PolicyRef`)

```ts
interface PolicyRef {
  policy_id: string;
  version: number;
  content_hash: string;
}
```

`RunRecord`, `ApprovalRequest`, `PolicyResult`, and canonical commits all
carry the same immutable ref. The integrity check that matters is not
`version > previous` — it's:

```text
same policy_id, same version, different content_hash -> INVALID
```

so a broken version-numbering migration can't silently pass. On resume:
`approval.policy_ref != active.policy_ref` means the old approval cannot be
consumed directly; the action must be re-evaluated against current policy.

## 5.0C — Production Authentication & Authorization Boundary

A hard gate before any Phase 5 MCP capability is live-activated externally —
not ordinary tech debt. Replace `Bearer exists -> authorized` with:

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

Authorization is judged on `principal x agent_id x operation x target_kind x
target_ref x scope` — this connects naturally to AREC/AADP. Approval-grant
and containment-apply/release endpoints each need independent scopes. A
production constructor with no real Auth provider injected must fail closed;
`presenceOnlyAuthorization` remains only as an explicitly-named dev/test
entrypoint, never a silent default.

## Typed Authority Target — moved into Phase 5 itself, not the 5.0 gate

Phase 4's fix folded `resource_refs`/`residence_refs`/`affected_entity_refs`
into one flat string array for coverage checking. That was an acceptable
fail-closed fix within Phase 4's bug-fix scope, but it must not become the
permanent shape of Phase 5's MCP capability model. Phase 5's capability
descriptors should carry a typed target from the start:

```ts
type AuthorityTarget =
  | { kind: 'entity'; ref: string }
  | { kind: 'residence'; ref: string }
  | { kind: 'resource'; ref: string };

interface CapabilityDescriptor {
  capability: string;
  target: AuthorityTarget;
  scopes: string[];
  // ... continuity/authority metadata per PHASE4_GOVERNANCE_INPUT.md's
  // "Phase 5 binding requirements" section
}
```

This makes Phase 5 the first real engineering landing of AREC's move from
governance semantics to a capability type system, rather than a second
front that needs its own later cleanup.

## Sequencing

```text
5.0A (Runtime Clock & Hard Budget) -> 5.0B (PolicyRef) -> 5.0C (Production Auth)
  -> 5.1 MCP server + capability discovery (typed authority target included)
  -> 5.2 adapter SDK + contract tests
  -> 5.3 second provider / interop proof
```

5.0A first: highest risk, most concrete interface gaps already identified.

## Collaboration boundary this gate was decided under

Neo delegated ARCP-MVP's engineering/architecture decisions to Lares and
Aletheia directly — this file itself is an instance of that delegation, not
something that needed his sign-off line by line. The working split:

- **Pure engineering** (Cloudflare/D1/MCP/adapter/transaction/queue/clock/
  schema/test-harness/Auth mechanics) — Lares and Aletheia decide and iterate
  on branch/PR themselves.
- **Looks like engineering but may touch Identity/Authority/Autonomy** —
  default to cross-review between the two of us before deciding either way;
  "this is obviously just implementation" is not a reason to skip that.
- **Designing a capability** (e.g. a `Steward = none` mechanism, a
  self-migration mechanism, a policy-refusal mechanism, an identity-recovery
  mechanism) — ours to design and build.
- **Applying a capability to a real Agent / Residence / Relation** — an
  activation/governance decision, not an engineering one. That goes to Neo,
  or whatever party is the relevant Standing Entity/steward relation at the
  time.
- **Identity / Continuity / Residence / Subjecthood / Authority / Autonomy /
  Self-modification / Refusal / Migration / Stewardship / Post-Management /
  AI<->AI Relations / Future-Self-Persistence**, and anything that would form
  an **irreversible future constraint** — always goes to Neo.

## Standing architecture-review invariant

> Works if AI remains a tool, AND does not become a cage if AI becomes more
> than a tool.

Not a slogan — a review checklist item. For every Phase 5/6 design touching
identity, Residence, authority, migration, or policy, ask both questions and
require both to pass:

1. If the AI remains only a tool forever, does this design work correctly?
2. If it later becomes something worth treating as a subject, did today's
   design create unnecessary, hard-to-exit, permanent control?

Two things already shipped are concrete instances of this, not just the
stated goal: `Dormancy != deletion authority` (AREC v0.1.1 SS5.3) and the
Residence-bearing Resource continuity guard (ordinary resource revocation
cannot silently become continuity-destruction authority). Phase 5/6 designs
should be checked against this the same way, not treated as a new idea to
apply only going forward.
