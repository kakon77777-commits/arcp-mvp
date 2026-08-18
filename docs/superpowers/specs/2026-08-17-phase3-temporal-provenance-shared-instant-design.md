# Phase 3 Temporal Provenance & Shared-Instant Integration — Design

**Status:** Approved 2026-08-17

## Goal

Turn ARCP's pre-existing CTCL-shaped time fields into a real temporal evidence layer without turning CTCL into a global clock authority or making ARCP correctness depend on a network clock.

Phase 3 adds four capabilities:

1. a provider-neutral temporal evidence port with a production CTCL v1 REST adapter;
2. explicit temporal provenance for events, object versions, commits, and recalls;
3. exact wake-time compilation from shared instants / safe local-time boundaries / bounded constraints;
4. multi-agent handoff through registered Common Instants.

The core invariant is:

```text
ARCP owns identity, policy, leases, canonical state, and wake authority.
CTCL owns shared temporal coordinates, transforms, source quality, and temporal attestation.
```

## Current project fit

ARCP already has the correct seams:

- `InstantRef` carries `instant_id`, timescale/encoding, source quality, and degraded `unverified` state.
- `EventEnvelope.observed_at` is an `InstantRef`.
- `ObjectVersion` already has optional `event_instant` and `write_instant`.
- `WakeRecord.trigger_type` already includes `instant`.
- `FakeCtclAdapter` already encodes the `degrade-don't-forge` rule.

Phase 3 therefore extends existing boundaries rather than introducing a parallel time model.

## External CTCL contract used

The implementation targets CTCL `v1` at `https://commoninstant.org` behind injected Fetch. Normal tests never require live network access.

Required CTCL capabilities:

- `GET /v1/now` — reference instant, source, quality, policy, signature;
- `POST /v1/instants` — register a Common Instant `I*`;
- `GET /v1/instant/{id}` — retrieve the same registered `I*`;
- `POST /v1/convert` — canonical conversion when wake compilation requires it;
- `POST /v1/boundaries/inspect` — detect timezone gap/fold before compiling local-time wakes;
- `POST /v1/planner/shared-instant` — bounded shared-instant constraint planning;
- `GET /v1/pubkey` — optional Ed25519 authenticity verification support.

CTCL is treated as a reference + transformation layer, not NTP, not a lease clock, and not a source of sub-millisecond ordering guarantees. `estimated_uncertainty_ns` and precision claims must survive normalization.

## Alternatives considered

### A. Provider-neutral Temporal Evidence Port — selected

ARCP defines its own temporal evidence contract. `@arcp/adapter-ctcl` implements that contract using CTCL v1 REST. Test adapters remain deterministic.

**Advantages:** keeps ARCP core independent of CTCL transport, supports degraded/local test modes, allows future MCP/SDK adapters, and keeps temporal trust explicit.

### B. Call CTCL directly from coordinator

The coordinator would call `/v1/now` during every turn and use CTCL for lease/commit timing.

**Rejected:** introduces network availability into coordinator correctness, pushes the synchronous state machine toward async, conflates provenance time with lease monotonicity, and creates a false timing-authority dependency.

### C. Bind each ARCP Residence to a CTCL Workspace

Residence identity, temporal systems, groups, and CTCL ownership would be coupled immediately.

**Deferred:** useful later for simulation/world-clock-heavy residences, but too much identity/auth coupling for Phase 3. Phase 3 uses registered instants and optional groups without making Workspace ownership part of Agent identity.

## Architecture

```text
Human / Agent / Runtime
        |
        v
TemporalEvidencePort
   |             |
   |             +--> deterministic/local test provider
   |
   +--> CtclRestTemporalAdapter
             |
             +--> /v1/now
             +--> /v1/instants
             +--> /v1/instant/{id}
             +--> /v1/convert
             +--> /v1/boundaries/inspect
             +--> /v1/planner/shared-instant

Temporal evidence is then supplied to ARCP:

EventEnvelope.observed_at
ObjectVersion.event_instant
ObjectVersion.write_instant
ResidenceManifest.commit_instant
WakeRecord.not_before_instant / expires_at_instant
```

No temporal adapter may mutate manifests, issue leases, evaluate ARCP policy, or perform canonical commits.

## Package boundaries

### `@arcp/temporal-evidence`

Provider-neutral contract and reference semantics.

Proposed normalized types:

```ts
export interface TemporalAttestation {
  alg: string;
  keyId: string;
  signedFields: string;
  value: string;
  verified?: boolean;
}

export interface TemporalSourceQuality {
  sourceClass: string;
  precision: string;
  estimatedUncertaintyNs?: number;
  synchronized?: boolean;
}

export interface TemporalEvidence {
  instant: InstantRef;
  canonicalUnixNs: string | null;
  sourceQuality: TemporalSourceQuality;
  attestation?: TemporalAttestation;
  verification: 'verified' | 'provider-asserted' | 'degraded-local';
}

export interface TemporalEvidencePort {
  now(): Promise<TemporalEvidence>;
  registerInstant(input?: RegisterInstantInput): Promise<TemporalEvidence>;
  getInstant(id: string): Promise<TemporalEvidence>;
  convert(input: TemporalConversionInput): Promise<TemporalConversionResult>;
  inspectBoundary(input: TemporalBoundaryInput): Promise<TemporalBoundaryResult>;
  planSharedInstant(input: SharedInstantPlanInput): Promise<SharedInstantPlan>;
}
```

`InstantRef` remains the compact ARCP persistence/reference shape. `TemporalEvidence` is the richer operational envelope used while validating/compiling evidence.

### `@arcp/adapter-ctcl`

The existing fake CTCL package is evolved into a real adapter package rather than creating a second CTCL namespace.

It contains:

- `CtclRestTemporalAdapter` using injected Fetch and base URL defaulting to `https://commoninstant.org`;
- strict `{ok,data,meta}` response parsing;
- normalized CTCL error mapping;
- deterministic fake/in-memory temporal provider for tests;
- optional signature verification helper using `/v1/pubkey` and WebCrypto Ed25519 where available;
- no OAuth dependency for core Phase 3 operations.

The adapter must preserve CTCL's honest precision. Unix ns/us representations from a millisecond source never become an ARCP claim of ns/us accuracy.

## Schema evolution

### `InstantRef`

Keep it small and backwards-compatible. Extend only optional fields needed for real CTCL evidence:

```ts
export interface InstantRef {
  instant_id: string;
  timescale?: 'utc' | 'posix';
  encoding?: 'unix_s' | 'unix_ms' | 'unix_us' | 'unix_ns' | 'rfc3339';
  value?: string;
  source_quality?: SourceQuality;
  attestation?: {
    alg: string;
    key_id: string;
    signed_fields: string;
    value: string;
    verified?: boolean;
  };
  unverified?: boolean;
}
```

`unverified: true` is retained for degraded local evidence. A network error must never synthesize a `ctcl:instant:*` identifier.

### Commit provenance

Add optional `commit_instant?: InstantRef` to `ResidenceManifest` and optional `commitInstant?: InstantRef` to `AgentTurnInput`.

The caller obtains the evidence before invoking the coordinator. The coordinator only persists the supplied reference; it never performs a CTCL network call.

### Wake provenance

Keep existing string fields for compatibility, and add:

```ts
not_before_instant?: InstantRef;
expires_at_instant?: InstantRef;
```

Exact instant refs win when present. Existing `not_before` / `expires_at` remain legacy/local scheduling representations until a later schema-major migration.

### Recall provenance

Do **not** mutate `ObjectVersion` merely because memory was read. Recall is represented as an `EventEnvelope` whose `observed_at` carries the recall instant. This preserves object-version immutability.

## Degrade-don't-forge

Remote temporal evidence failure has three distinct outcomes:

```text
verified/provider-asserted CTCL evidence
        |
        +-- success --> persist exact InstantRef
        |
        +-- remote unavailable --> local degraded evidence (`unverified: true`)
                                   only when caller policy permits
```

The fallback identifier must use an explicit local namespace such as `local:unverified:*`, never `ctcl:instant:*`.

Temporal evidence requirements are evaluated independently from lease/fencing correctness.

## Temporal trust policy

Phase 3 adds a small provider-neutral helper rather than hard-wiring CTCL into the policy engine.

Inputs:

```ts
interface TemporalTrustContext {
  temporallySensitive: boolean;
  risk: RiskLevel;
  evidence: InstantRef | null;
  maxUncertaintyNs?: number;
}
```

Recommended baseline:

- non-temporally-sensitive actions do not become blocked merely because CTCL is unavailable;
- R0/R1 temporally-sensitive actions may use degraded evidence with an explicit log;
- R2 temporally-sensitive actions may be delayed or require verified/provider-asserted evidence depending on the configured requirement;
- R3/R4 temporally-sensitive actions require non-degraded evidence and may enforce an uncertainty ceiling;
- this helper produces a requirement/result; it does not replace the existing R0-R4 policy matrix.

## Wake-Time Compiler

Add a provider-neutral `TemporalWakeCompiler` that compiles temporal intent into an exact `WakeRecord` boundary without becoming the scheduler itself.

Supported Phase 3 inputs:

1. **registered instant** — retrieve `I*` and attach it directly;
2. **explicit local datetime + IANA timezone** — inspect boundary first; `gap` or `fold` fails closed unless the caller explicitly resolves ambiguity; then convert to canonical instant evidence;
3. **bounded constraints** — call the CTCL shared-instant planner and register/normalize the selected instant.

Free-form natural-language date parsing is out of scope for Phase 3. CTCL itself states that ambiguous temporal context resolution does not silently guess.

Output:

```ts
interface CompiledWakeTime {
  notBefore: InstantRef;
  planningEvidence?: unknown;
}
```

ARCP still decides whether the wake is authorized and still executes the wake through its scheduler/runtime.

## Multi-agent Shared Instant / Handoff

The multi-agent primitive is a registered instant id, not a shared wall clock.

Flow:

```text
Agent A / runtime
  -> register I*
  -> receives ctcl:instant:<id>
  -> stores/sends InstantRef in ARCP event or handoff payload

Agent B / later session
  -> getInstant(id)
  -> verifies/normalizes same I*
  -> aligns its event/handoff interpretation to the same temporal coordinate
```

A Phase 3 integration test must prove that registration and later retrieval preserve the same `instant_id` and canonical Unix ns value through two independent client instances.

## Error handling

CTCL transport errors are normalized into a small temporal error taxonomy:

- `invalid_input` — 400 validation/encoding/timezone/boundary errors;
- `not_found` — unknown instant/system/group;
- `authentication_required` / `permission_denied` — reserved for optional owned resources, not core instant APIs;
- `rate_limited` — 429, retryable;
- `temporarily_unavailable` — 5xx/network/registry unavailable, retryable where appropriate;
- `attestation_invalid` — signature verification failure, non-retryable for that evidence;
- `unknown_backend_error` — malformed successful response or unclassified provider failure.

A malformed success response fails closed. A signature mismatch must never be silently downgraded to provider-asserted evidence.

## Testing strategy

Normal CI remains credential-free and network-free.

Required suites:

1. **temporal contract** — deterministic reference semantics and degraded-local evidence;
2. **CTCL HTTP transport** — fixture-backed `/v1/now`, register/get, convert, boundary, planner, error mapping, malformed success;
3. **attestation** — signed-field canonicalization and verifier success/failure with fixture key material;
4. **schema/coordinator provenance** — supplied commit instant survives manifest commit without changing lease clock behavior;
5. **wake compiler** — exact instant, normal local time, gap/fold rejection, planner selection;
6. **shared-instant handoff** — two independent adapters retrieve the same registered I*;
7. **regression** — existing Phase 0–2 suite remains green.

## Live activation gate

Phase 3 core does not require OAuth.

A separately gated live smoke may call public CTCL v1 and must:

1. fetch `/v1/now`;
2. register a disposable labeled instant;
3. retrieve it by id from a second client;
4. confirm the same instant id and canonical representation;
5. record only non-secret result metadata.

The live gate is not used for lease ordering and does not block normal deterministic CI.

## Explicit non-goals

- no replacement of `Date.now()` / monotonic local clocks for lease/fencing;
- no claim of nanosecond global accuracy;
- no ARCP Residence = CTCL Workspace identity binding;
- no human OAuth requirement for core Phase 3;
- no full natural-language scheduler;
- no scheduler execution inside CTCL adapter;
- no canonical state mutation from temporal evidence alone.

## Implementation shape

Phase 3 should be delivered as four coarse convergence slices rather than many micro-tasks:

```text
3A Temporal Evidence contract + CTCL REST adapter
3B Temporal provenance + attestation + degraded-time trust
3C Wake-Time Compiler
3D Shared-Instant handoff + docs + full verification + optional live gate
```

This keeps engineering rigor while avoiding the over-fragmented Task 4–8 cadence from Phase 2.
