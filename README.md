# ARCP-MVP

Internal single-owner implementation of **ARCP × CTCL v0.1** — the Agent Residence
Continuity Protocol, scoped to the MVP defined in
[`arcp_ctcl_internal_web_mvp_implementation_spec_v0.1.md`](../arcp/arcp_ctcl_internal_web_mvp_implementation_spec_v0.1.md).

See [`arcp_series_dependency_map_and_build_roadmap_v0.1.md`](../arcp/arcp_series_dependency_map_and_build_roadmap_v0.1.md)
for the full document dependency map and phase-by-phase build plan,
[`docs/superpowers/specs/2026-08-17-phase2-pluggable-residence-storage-design.md`](docs/superpowers/specs/2026-08-17-phase2-pluggable-residence-storage-design.md)
for the Phase 2 residence-storage design, and
[`docs/superpowers/specs/2026-08-17-phase3-temporal-provenance-shared-instant-design.md`](docs/superpowers/specs/2026-08-17-phase3-temporal-provenance-shared-instant-design.md)
for the Phase 3 temporal design.

**Before starting Phase 4**, read [`PHASE4_GOVERNANCE_INPUT.md`](PHASE4_GOVERNANCE_INPUT.md) —
binding authority/continuity/containment semantics from the
[AREC governance framework](docs/governance/README.md) that constrain promptless
autonomous execution.

## Status: Phase 3 — Temporal Provenance & Shared-Instant Integration

- Phase 0 (schema, policy engine, in-memory coordinator, fake adapters): done.
- Phase 1 control-plane foundation and Gate A: done and live on Cloudflare.
- Phase 2 provider-neutral residence storage, synced-filesystem backend, reconciliation,
  local observation bridge, and optional Google Drive API backend: done.
- Phase 3 adds provider-neutral temporal evidence, a credential-free CTCL v1 REST adapter,
  Ed25519 attestation verification, degraded-time trust evaluation, exact wake-time
  compilation, and registered Common Instant handoff between independent clients.

CTCL is a **temporal evidence/shared-coordinate layer**, not the coordinator clock:

```text
CTCL shared instant / evidence
    -> event, write, commit, recall, wake provenance
    != lease validity clock
    != fencing-token ordering source
    != nanosecond global causal ordering guarantee
```

The coordinator never calls CTCL. Callers acquire temporal evidence first and pass
compact `InstantRef` values into ARCP data. Lease/fencing behavior remains controlled
by the local coordinator clock (`input.now` in deterministic tests).

## Temporal provenance rules

A persisted temporal reference retains the shared instant identity and the context
needed to interpret its representation:

```text
instant_id
+ timescale
+ encoding/value
+ source quality / uncertainty
+ optional attestation
```

Do not reduce a long-lived temporal reference to a bare timestamp. In particular,
`unix_ns` is an encoding width, not a claim of nanosecond source accuracy. CTCL source
precision and estimated uncertainty remain explicit.

ARCP distinguishes several temporal roles rather than collapsing them into one field:

- **event instant** — `EventEnvelope.observed_at`;
- **write instant** — `ObjectVersion.write_instant`;
- **commit instant** — optional `ResidenceManifest.commit_instant`;
- **recall instant** — represented by the recall event's `observed_at`, not by mutating
  the recalled `ObjectVersion`;
- **wake instant** — optional exact `WakeRecord.not_before_instant` /
  `expires_at_instant` alongside legacy string fields.

A memory read therefore does not manufacture a new object version merely to record
when recall happened. Recall is an event.

## Temporal trust and degraded operation

Network failure never forges a CTCL identity. When caller policy permits degraded
operation, fallback evidence uses an explicit `local:unverified:*` namespace.

The provider-neutral baseline temporal trust matrix is:

```text
not temporally sensitive      -> allow
R0/R1 + degraded/missing      -> allow-with-log
R2    + degraded/missing      -> delay
R3/R4 + degraded/missing      -> require-evidence
uncertainty above ceiling     -> require-evidence
acceptable non-degraded data  -> allow
```

A string that merely looks like `ctcl:...` is not automatically trusted; source
quality and verification state remain part of the decision.

## Exact wake-time compiler

`@arcp/temporal-wake` compiles temporal intent into an exact `InstantRef`; it does not
execute or dispatch wakes. Supported modes are:

1. an already registered Common Instant;
2. an explicit local datetime plus an IANA timezone;
3. bounded temporal constraints resolved by the shared-instant planner.

Local datetime input is deliberately strict. Offset-bearing strings are rejected in
IANA-local mode, nonexistent DST gap times fail closed, and repeated DST fold times
require explicit `earlier` or `later` selection. Natural-language scheduling is
outside Phase 3; upstream callers must make temporal intent explicit before compile.

## Multi-agent shared-instant handoff

A client can register one Common Instant, place its compact `InstantRef` into an ARCP
event/handoff, and another independently constructed client can resolve the same
`instant_id` back to the same canonical instant. The shared temporal coordinate does
not transfer ARCP identity, policy authority, lease ownership, or canonical-state
authority.

## Packages

```text
packages/
  arcp-schema/                    stable IDs, canonical JSON + SHA-256 hashing, core types
  policy-engine/                  R0-R4 risk matrix, deterministic Permit() evaluation
  coordinator/                    per-Agent state machine, lease/fencing, in-memory store
  control-plane-core/             platform-neutral HTTP core, coordinator transport, storage ports
  residence-storage/              provider-neutral residence contract, diff/error/hash semantics
  residence-bridge/               local storage-observation publishing boundary; no canonical authority
  temporal-evidence/              provider-neutral temporal evidence, errors, degraded fallback, trust
  temporal-wake/                  exact registered/IANA/planner wake-boundary compiler
  adapters/
    ctcl/                          CTCL v1 REST adapter, deterministic compatibility provider, attestation
    model/                         fake model adapter (scripted decisions)
    cloudflare/                    D1/R2 storage adapters, Durable Object, Worker entrypoint
    synced-filesystem/             recommended local-first residence backend
    google-drive-api/              optional Drive v3 transport + residence backend
migrations/d1/                    D1 schema migrations
```

## Residence storage selection

The default/recommended local-first route remains **synced filesystem** for users who
already run Google Drive for desktop, OneDrive, Dropbox, Syncthing, NAS sync, or
another local synchronization client.

The **Google Drive API** route remains optional for headless/cloud-only deployments or
users who do not want to depend on a desktop sync client. Google OAuth is **not
required** for the synced-filesystem route; real Google authorization is an activation
gate only when `google-drive-api` is explicitly selected.

Synced filesystem example:

```text
docs/examples/residence-storage.synced-filesystem.json
```

Optional Google Drive API example:

```text
docs/examples/residence-storage.google-drive-api.json
```

Phase 3 temporal evidence example:

```text
docs/examples/phase3-temporal-evidence.json
```

No token, cookie, OAuth client secret, Drive ID, user path, or other credential belongs
in tracked examples.

A successful backend write is deliberately narrower than an ARCP canonical commit:

```text
storage/backend write success
    != cloud replica confirmation
    != ARCP canonical commit
    != policy approval
    != lineage update
```

For the synced-filesystem backend, a successful local write does **not** claim that
an external cloud provider has uploaded or replicated the file; provider replication
status remains unknown. The Google Drive API backend may report provider-confirmed
storage operations after Drive accepts them, but that still does not imply an ARCP
canonical transition.

Cloudflare remains the control/coordination plane. A Cloudflare Worker does not read
the user's desktop filesystem; desktop filesystem access belongs to the local runtime
and `@arcp/residence-bridge` publishes provider-neutral reconciliation observations.

The old `@arcp/adapter-drive` Phase 0 fake has been retired. Drive-specific operation
now sits behind the provider-neutral `@arcp/residence-storage` contract and the
optional `@arcp/adapter-google-drive-api` implementation.

## Commands

```text
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
```

Normal tests and CI are deterministic, injected-Fetch based, and require **no CTCL
network access, OAuth flow, cookie, API key, or secret**.

## Optional public CTCL live smoke

The public-service smoke is intentionally separate from merge correctness. It refuses
to run unless explicitly enabled:

```text
ARCP_CTCL_LIVE=1 pnpm tsx scripts/ctcl-live-smoke.ts
```

It obtains a public current instant, registers one Common Instant with client A, and
resolves that id with an independently constructed client B. Output is intentionally
minimal and does not print signatures, cookies, headers, provider metadata, or
environment variables. A public-service/network failure is recorded separately and
does not invalidate the deterministic Phase 3 architecture.

## Deploying the Cloudflare control plane

`packages/adapters/cloudflare/wrangler.jsonc` is a **template only** — every
database ID, bucket name, and the `compatibility_date` are `REPLACE_ME_*`
placeholders, and it stays that way in git (this is a public repo).

Real deploys use a gitignored `wrangler.local.jsonc` in the same directory,
built from the template with actual resource IDs filled in:

```text
cd packages/adapters/cloudflare
npx wrangler d1 create arcp-mvp-metadata          # once, if not already provisioned
npx wrangler r2 bucket create arcp-mvp-objects    # once, if not already provisioned
# copy wrangler.jsonc -> wrangler.local.jsonc, fill in the real IDs it printed
npx wrangler d1 migrations apply arcp-mvp-metadata --config wrangler.local.jsonc --remote
npx wrangler deploy --config wrangler.local.jsonc
```

Never fill real IDs into the tracked `wrangler.jsonc`; regenerate
`wrangler.local.jsonc` instead.

## Optional live Google Drive activation gate

Credential-free Phase 2 tests use injected fake transports only and do not require
network access or OAuth consent. A real deployment selecting `google-drive-api`
performs authorization outside Git, supplies `ARCP_GOOGLE_DRIVE_ROOT_ID` (and, for
Shared Drive mode only, `ARCP_GOOGLE_DRIVE_SHARED_DRIVE_ID`) outside Git, and runs a
separately gated disposable-file integration check. This live activation gate does
not block the credential-free Phase 2 architecture or the synced-filesystem route.
