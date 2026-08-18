# ARCP-MVP

Internal single-owner implementation of **ARCP × CTCL v0.1** — the Agent Residence
Continuity Protocol, built phase-by-phase from the internal MVP specification and
roadmap.

Key design documents:

- [`docs/superpowers/specs/2026-08-17-phase2-pluggable-residence-storage-design.md`](docs/superpowers/specs/2026-08-17-phase2-pluggable-residence-storage-design.md)
- [`docs/superpowers/specs/2026-08-17-phase3-temporal-provenance-shared-instant-design.md`](docs/superpowers/specs/2026-08-17-phase3-temporal-provenance-shared-instant-design.md)
- [`docs/superpowers/specs/2026-08-18-phase4-promptless-bounded-runs-design.md`](docs/superpowers/specs/2026-08-18-phase4-promptless-bounded-runs-design.md)
- [`docs/superpowers/plans/2026-08-18-phase4-promptless-bounded-runs-implementation.md`](docs/superpowers/plans/2026-08-18-phase4-promptless-bounded-runs-implementation.md)

Phase 4 is normatively constrained by [`PHASE4_GOVERNANCE_INPUT.md`](PHASE4_GOVERNANCE_INPUT.md)
and the [AREC governance framework](docs/governance/README.md).

## Status: Phase 4 — Promptless Bounded Runs

- Phase 0 — schema, deterministic policy, coordinator and fake adapters: **done**.
- Phase 1 — Cloudflare control-plane foundation, D1/R2 and per-Agent Durable Object: **done**.
- Phase 2 — provider-neutral Residence storage, synced filesystem, reconciliation bridge and optional Google Drive API backend: **done**.
- Phase 3 — temporal provenance, CTCL adapter/trust/attestation, exact wake-time compiler and shared-instant handoff: **done**.
- Phase 4 — provider-neutral bounded autonomous-run runtime, durable effect ledger, explicit authority, approval/resume, containment, reconciliation/dead-letter, D1 operational persistence and per-Agent HTTP/DO coordination: **deterministic implementation complete**.

A **live model provider is not activated by default**. Gate C remains a separately
controlled deployment activation. Normal CI uses deterministic model/action providers
and requires no model API key, OAuth secret or external network access.

The tracked Cloudflare Worker therefore does not silently substitute a fake model for
a production model. A deployment that has not injected a Phase 4 coordinator/runtime
capability fails closed for those operational endpoints rather than inventing live
authority or execution.

## Phase 4 meaning

`promptless` means:

> an authorized event may start a bounded run without a human typing a new prompt.

It does **not** mean that waking grants unlimited authority.

The fixed execution boundary is:

```text
WakeRecord
  -> wake authority
  -> hydrate/checkpoint
  -> bounded ModelPort deliberation
  -> ActionIntent
  -> affected Entity / Resource / Residence resolution
  -> AuthorityResolution
  -> deterministic policy
  -> exact approval state when required
  -> budget reservation + durable action claim
  -> executor
  -> durable ActionReceipt / explicit unknown
  -> canonical Residence commit
```

The binding governance/correctness rules include:

```text
trigger != authority
capability != permission
budget != ownership
approval != permanent subordination
suspend != identity rewrite
resource authority != identity authority
ActionIntent != AuthorityResolution
model != executor
provider effect != canonical Residence commit
unknown external effect != blind retry
```

## Durable effect ledger

Phase 4 separates external-effect accounting from the final Residence manifest commit.
Before an effect crosses the provider boundary it receives a durable claim. The
execution then moves through independent lifecycle, effect and reconciliation state.

```text
lifecycle:       claimed -> executing -> receipt-recorded -> canonically-recorded
effect:          not-observed | succeeded | failed | partial | unknown
reconciliation:  not-required | pending | reconciled | manual-required
```

A crash after `executing` but before a definitive receipt is treated conservatively.
ARCP reconciles provider state instead of blindly executing again. A succeeded receipt
followed by a canonical-commit crash retries persistence/commit only; it does not repeat
the external effect.

The D1 implementation uses dedicated Phase 4 operational tables in
`migrations/d1/0002_phase4_runs.sql`. External-action budget reservation and durable
claim share one SQLite/D1 atomic boundary so a crash cannot leave only one half applied.

## Authority, approval and Residence protection

The model only proposes structured `ActionIntent` values. It cannot self-certify an
authority source and never receives a privileged executor/connector.

The deterministic reference authority resolver requires every affected
`resource × requested scope` pair to be covered. Ordinary Resource ownership cannot by
itself authorize `migration-required` or `continuity-destructive` actions against a
Residence-bearing Resource.

Approval binds to the exact action, authority resolution, policy version, resource
scope, expiry and required parties. Waiting for approval is persisted continuation —
there is no process held open. Resume rehydrates the checkpoint and uses a fresh fencing
token before revalidating authority, policy, approval, budget and containment.

## Bounded resource governance

A missing `budget_ref` never means unlimited execution. Phase 4 resolves an explicit
bounded default (`RunBudgetSpec`) covering ten dimensions, but only some are wired to
real reservation/consumption calls today:

- **Enforced**: `turns`, `external_actions`, `model_input_tokens`, `model_output_tokens`,
  `model_cost_micros`.
- **Declared but not yet enforced**: `wall_time_ms`, `tool_calls`, `storage_writes`,
  `network_requests`, `recursive_wakes`. Their limits exist in the schema/default
  profile and `InMemoryBudgetLedger` implements the counters, but nothing in the
  orchestrator currently calls into them, so a run cannot yet be stopped on these
  grounds alone. `wall_time_ms` specifically needs a real monotonic clock injection
  point that does not exist yet (the orchestrator's own `now()` returns a CTCL
  `InstantRef`, which Phase 3's own invariants deliberately keep out of lease/timing
  math) -- this is a real gap, not an oversight, and should be closed as its own
  piece of work rather than an incidental one-line fix.

Where a dimension is enforced and concurrency/retry could overspend, the semantic
order is:

```text
check -> atomically reserve -> perform -> settle actual -> release unused
```

Persisted approval/dormant waiting is not charged as active execution wall time --
today this is true only in the sense that `wall_time_ms` is not charged at all yet.

## Containment

Containment restricts channels/scopes; it is not identity-rewrite authority. Records
carry scope, expiry/review, renewal/release/escalation semantics. The runtime checks
containment before external effects and preserves mandatory receipt/audit evidence for
an effect that already happened.

Integration coverage proves that containment activated after one external action keeps
that first receipt/canonical commit while blocking a later matching action in the same
run.

## Trigger paths and deterministic run identity

Schedule, webhook and committed-state triggers all compile into the same `WakeRecord`
contract. Trigger transport/source acceptance remains separate from wake authority.

A first run has a deterministic binding:

```text
(agent_id, wake.idempotency_key) -> run_id
```

A first `/runs/:run/advance` request is accepted only when the requested run id matches
that deterministic binding. Redelivery therefore resolves to the same logical run
rather than resetting budget or invoking the model again.

Current deterministic integration coverage includes:

- authorized schedule wake -> bounded run;
- untrusted webhook -> denied before model execution;
- authorized state trigger -> bounded run;
- approval wait -> grant -> fresh-fenced resume;
- effect succeeds -> crash before receipt -> reconcile without second execute;
- containment activates mid-run -> later effect blocked;
- real `node:sqlite` D1 semantics -> per-Agent Durable Object HTTP -> bounded deterministic model run -> persisted run readback.

## Phase 4 operational API

The platform-neutral control plane and coordinator client expose these Phase 4
capabilities when a runtime is injected:

```text
GET  /api/v1/agents/:agent/runs/:run
POST /api/v1/agents/:agent/runs/:run/advance
POST /api/v1/agents/:agent/approvals/:request/grants
POST /api/v1/agents/:agent/containments
POST /api/v1/agents/:agent/containments/:id/release
```

The Cloudflare coordinator transport routes the whole
`/internal/v1/agents/:agent/...` namespace to the one Durable Object named by the
canonical Agent ID. Leaf-route validation remains inside the internal control-plane
handler, preserving the single-writer Agent boundary without hard-coding every future
Phase 5 capability into the transport.

## Gate C — live model activation

Gate C is deliberately outside deterministic merge correctness. Activating a live
model requires a selected `ModelPort` implementation and credentials supplied only by
secret/environment configuration.

A Gate C smoke must remain disposable and low-risk:

1. one bounded turn;
2. no privileged live executor exposed to the model;
3. proposal parsing and usage accounting verified;
4. only non-secret metadata recorded;
5. provider choice cannot change Agent identity or canonical lineage.

A live model/provider outage does not invalidate the deterministic Phase 4 runtime.

Credential-free example:

```text
docs/examples/phase4-bounded-run.json
```

## Temporal provenance rules (Phase 3 preserved)

CTCL remains a **temporal evidence/shared-coordinate layer**, not the coordinator clock:

```text
CTCL shared instant / evidence
    -> event, write, commit, recall, wake provenance
    != lease validity clock
    != fencing-token ordering source
    != nanosecond global causal ordering guarantee
```

The coordinator never calls CTCL to decide lease/fencing order. Callers acquire
`InstantRef` evidence before the turn and pass it into ARCP data. Network failure never
forges a CTCL identity; permitted degraded evidence uses `local:unverified:*`.

`@arcp/temporal-wake` compiles registered Common Instants, explicit IANA-local datetime
and bounded planner constraints into exact wake instants. It does not dispatch the wake.
DST gaps fail closed and folds require explicit resolution.

Phase 3 example:

```text
docs/examples/phase3-temporal-evidence.json
```

## Packages

```text
packages/
  arcp-schema/                    core + Phase 4 persisted record types
  policy-engine/                  deterministic R0-R4 policy evaluation
  coordinator/                    canonical state machine, lease/fencing, commit semantics
  control-plane-core/             platform-neutral HTTP + coordinator client/contracts
  workflow-core/                  Phase 4 bounded-run orchestration and provider-neutral ports
  residence-storage/              provider-neutral Residence storage contract
  residence-bridge/               local observation/reconciliation publisher
  temporal-evidence/              temporal evidence/trust/degraded fallback
  temporal-wake/                  exact wake-intent compiler
  adapters/
    model/                         backwards fake + async deterministic ModelPort adapter
    cloudflare/                    D1/R2, D1 run ledger, per-Agent DO, Worker routing
    ctcl/                          CTCL v1 REST/attestation adapter
    synced-filesystem/            recommended local-first Residence backend
    google-drive-api/             optional Drive v3 Residence backend
migrations/d1/
  0001_init.sql                   Residence manifest/event metadata
  0002_phase4_runs.sql            Phase 4 operational run/effect state
```

## Residence storage selection (Phase 2 preserved)

The recommended local-first route is **synced filesystem** for Google Drive for desktop,
OneDrive, Dropbox, Syncthing, NAS sync or equivalent local synchronization clients.
The Google Drive API route is optional for headless/cloud deployments.

```text
docs/examples/residence-storage.synced-filesystem.json
docs/examples/residence-storage.google-drive-api.json
```

A successful backend write remains narrower than an ARCP canonical transition:

```text
storage/backend write success
    != cloud replica confirmation
    != ARCP canonical commit
    != policy approval
    != lineage update
```

Cloudflare is the control/coordination plane. Desktop filesystem access stays in the
local runtime/bridge rather than a Worker.

## Commands

```text
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
```

Normal tests and CI are deterministic and require **no CTCL network access, model API
key, Google OAuth, cookie or other secret**.

## Cloudflare deployment

`packages/adapters/cloudflare/wrangler.jsonc` is a tracked **template only**. Real D1/R2
identifiers remain in a gitignored local config.

```text
cd packages/adapters/cloudflare
npx wrangler d1 create arcp-mvp-metadata
npx wrangler r2 bucket create arcp-mvp-objects
# copy wrangler.jsonc -> wrangler.local.jsonc and fill actual IDs there
npx wrangler d1 migrations apply arcp-mvp-metadata --config wrangler.local.jsonc --remote
npx wrangler deploy --config wrangler.local.jsonc
```

Do not commit real IDs, tokens or provider credentials.

## Optional live gates

Phase 2 Google Drive API authorization, Phase 3 public CTCL smoke and Phase 4 live model
Gate C are deployment activations. They are intentionally separate from credential-free
architecture correctness and are not required for normal CI/PR review.
