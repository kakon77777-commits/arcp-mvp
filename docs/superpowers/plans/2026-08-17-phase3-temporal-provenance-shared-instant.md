# Phase 3 Temporal Provenance & Shared-Instant Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn ARCP's existing CTCL-shaped timestamps into a provider-neutral temporal evidence/provenance layer, compile exact wake boundaries safely, and support multi-agent handoff through registered Common Instants without making lease/fencing correctness depend on a network clock.

**Architecture:** `@arcp/temporal-evidence` owns normalized temporal evidence, errors, trust evaluation, and provider-neutral interfaces. The existing `@arcp/adapter-ctcl` package gains a credential-free CTCL v1 REST implementation behind injected Fetch plus deterministic test providers and Ed25519 verification. `@arcp/temporal-wake` consumes the temporal port to compile registered instants, IANA local datetimes, and bounded planner results into exact ARCP wake boundaries. The coordinator never calls CTCL: callers acquire evidence first and pass compact `InstantRef` values into events, object versions, wakes, and commits.

**Tech Stack:** TypeScript 5, Node >=22.13, pnpm 11.8.0, Vitest 3, Web Fetch API, WebCrypto Ed25519, `Intl.DateTimeFormat`, CTCL v1 REST at `https://commoninstant.org`.

## Global Constraints

- Keep Node compatibility at `>=22.13`; CI continues to run Node 24.
- Keep pnpm at `11.8.0` and normal CI credential-free/network-free.
- CTCL is a reference + transformation layer, not NTP, not a lease clock, and not a global total-order authority.
- Never replace `Date.now()` / local monotonic lease-fencing logic with CTCL calls.
- Never infer nanosecond accuracy from zero-padded `unix_ns` / `unix_us`; preserve `quality.precision` and `estimated_uncertainty_ns`.
- A CTCL/network failure may produce explicit `local:unverified:*` evidence only when the caller chooses degraded fallback; it must never synthesize a `ctcl:instant:*` id.
- Malformed successful CTCL responses fail closed.
- Signature mismatch is `attestation_invalid`; never silently downgrade it to provider-asserted evidence.
- No ARCP Residence = CTCL Workspace identity binding in Phase 3.
- No human OAuth is required for core Phase 3 operations.
- No free-form natural-language date parser and no scheduler execution inside the temporal adapter/compiler.
- Temporal evidence alone never mutates ARCP canonical state or bypasses policy.
- CTCL v1 response envelope is fixed as `{ ok: true, data, meta }` or `{ ok: false, error, meta }`; new optional fields may be tolerated but required fields used by ARCP are validated strictly.

---

## Locked File Structure

### Provider-neutral temporal layer

- Create `packages/temporal-evidence/package.json` — package metadata and `@arcp/schema` dependency.
- Create `packages/temporal-evidence/src/types.ts` — port, evidence, conversion, boundary, planner, trust types.
- Create `packages/temporal-evidence/src/errors.ts` — normalized temporal error taxonomy.
- Create `packages/temporal-evidence/src/degraded.ts` — explicit local-unverified evidence constructor.
- Create `packages/temporal-evidence/src/trust.ts` — risk/uncertainty trust evaluator (implemented in 3B).
- Create `packages/temporal-evidence/src/index.ts` — public exports.

### CTCL adapter

- Modify `packages/adapters/ctcl/package.json` — depend on `@arcp/temporal-evidence` and `@arcp/schema`.
- Split/replace `packages/adapters/ctcl/src/index.ts` — exports only.
- Create `packages/adapters/ctcl/src/http.ts` — CTCL v1 Fetch transport/envelope/error parsing.
- Create `packages/adapters/ctcl/src/normalize.ts` — CTCL response -> `TemporalEvidence` normalization.
- Create `packages/adapters/ctcl/src/adapter.ts` — `CtclRestTemporalAdapter`.
- Create `packages/adapters/ctcl/src/fake.ts` — deterministic provider used by tests; preserve `FakeCtclAdapter` compatibility if still imported.
- Create `packages/adapters/ctcl/src/attestation.ts` — Ed25519 verifier (implemented in 3B).

### Wake compiler

- Create `packages/temporal-wake/package.json` — depends on schema + temporal-evidence.
- Create `packages/temporal-wake/src/types.ts` — supported wake intent union.
- Create `packages/temporal-wake/src/local-time.ts` — deterministic IANA local-time resolver using `Intl.DateTimeFormat` after CTCL boundary inspection.
- Create `packages/temporal-wake/src/compiler.ts` — `TemporalWakeCompiler`.
- Create `packages/temporal-wake/src/index.ts` — exports.

### Tests / fixtures / docs

- Create `tests/helpers/fake-ctcl-fetch.ts` — queued request capture for CTCL transport tests.
- Create `tests/helpers/fake-ctcl-service.ts` — stateful in-memory CTCL register/get service for handoff integration.
- Create `tests/unit/temporal-evidence.test.ts`.
- Create `tests/unit/ctcl-http-adapter.test.ts`.
- Create `tests/unit/ctcl-attestation.test.ts`.
- Create `tests/unit/temporal-trust.test.ts`.
- Create `tests/unit/temporal-provenance.test.ts`.
- Create `tests/unit/temporal-wake-compiler.test.ts`.
- Create `tests/integration/shared-instant-handoff.test.ts`.
- Modify `tests/unit/state-machine.test.ts` only if schema fixture construction requires the new optional fields (no semantic expectation changes).
- Modify `README.md`.
- Create `docs/examples/phase3-temporal-evidence.json`.
- Create `scripts/ctcl-live-smoke.ts` — optional public live gate, never run by normal CI.
- Modify root `package.json` and `pnpm-lock.yaml` when new workspaces are added.

---

### Task 3A: Temporal Evidence Contract + Credential-Free CTCL v1 REST Adapter

**Deliverable:** A provider-neutral temporal port plus a strict, fixture-tested CTCL v1 REST adapter that can `now`, register/get instants, convert, inspect boundaries, and plan shared instants without OAuth or live network tests.

**Files:**
- Create: `packages/temporal-evidence/package.json`
- Create: `packages/temporal-evidence/src/types.ts`
- Create: `packages/temporal-evidence/src/errors.ts`
- Create: `packages/temporal-evidence/src/degraded.ts`
- Create: `packages/temporal-evidence/src/index.ts`
- Modify: `packages/adapters/ctcl/package.json`
- Create: `packages/adapters/ctcl/src/http.ts`
- Create: `packages/adapters/ctcl/src/normalize.ts`
- Create: `packages/adapters/ctcl/src/adapter.ts`
- Create: `packages/adapters/ctcl/src/fake.ts`
- Modify: `packages/adapters/ctcl/src/index.ts`
- Create: `tests/helpers/fake-ctcl-fetch.ts`
- Create: `tests/unit/temporal-evidence.test.ts`
- Create: `tests/unit/ctcl-http-adapter.test.ts`
- Modify: root `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces — exact public contract:**

```ts
import type { InstantRef, RiskLevel } from '@arcp/schema';

export type TemporalEncoding = 'unix_s' | 'unix_ms' | 'unix_us' | 'unix_ns' | 'rfc3339';
export type TemporalTimescale = 'utc' | 'posix';
export type TemporalVerification = 'verified' | 'provider-asserted' | 'degraded-local';

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
  verification: TemporalVerification;
}

export interface RegisterInstantInput {
  value?: string;
  encoding?: TemporalEncoding;
  timescale?: TemporalTimescale;
  label?: string;
  meta?: Record<string, unknown>;
}

export interface TemporalConversionInput {
  input: { value: string; encoding: TemporalEncoding; timescale?: TemporalTimescale };
  output: { encoding: TemporalEncoding; timescale?: TemporalTimescale; timezone?: string };
}

export interface TemporalConversionResult {
  value: string;
  canonicalUnixNs: string;
  lossless: boolean;
}

export interface TemporalBoundaryInput {
  timezone?: string;
  localValue?: string;
  windowHours?: number;
  systemId?: string;
  value?: string;
  encoding?: TemporalEncoding;
}

export type TemporalBoundaryStatus = 'normal' | 'gap' | 'fold' | 'pause' | 'rate_change';

export interface TemporalBoundaryResult {
  status: TemporalBoundaryStatus;
  safe: boolean;
  detail: unknown;
}

export type SharedInstantConstraintType =
  | 'weekday_hours'
  | 'avoid_window'
  | 'prefer_window'
  | 'min_lead_time'
  | 'system_not_paused'
  | 'market_hours';

export type SharedInstantConstraint = Record<string, unknown> & {
  type: SharedInstantConstraintType;
  weight?: number;
};

export interface SharedInstantPlanInput {
  window: { from: number; to: number; stepS?: number };
  constraints: SharedInstantConstraint[];
}

export interface SharedInstantCandidate {
  unixS: string;
  score: number;
  satisfied: unknown[];
  violated: unknown[];
  unsupported: unknown[];
}

export interface SharedInstantPlan {
  best: SharedInstantCandidate | null;
  alternatives: SharedInstantCandidate[];
  explanation: string | null;
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

**Normalized errors:**

```ts
export type TemporalEvidenceErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'authentication_required'
  | 'permission_denied'
  | 'rate_limited'
  | 'temporarily_unavailable'
  | 'attestation_invalid'
  | 'unsupported_operation'
  | 'unknown_backend_error';

export class TemporalEvidenceError extends Error {
  constructor(
    public readonly code: TemporalEvidenceErrorCode,
    message: string,
    public readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'TemporalEvidenceError';
  }
}
```

- [ ] **Step 1: Write RED provider-neutral contract tests**

`tests/unit/temporal-evidence.test.ts` must assert that `createDegradedLocalEvidence()` returns an explicit local namespace and never a CTCL id:

```ts
const evidence = createDegradedLocalEvidence({
  unixMs: 1786980000123,
  sequence: 7,
});

expect(evidence.instant.instant_id).toBe('local:unverified:1786980000123:7');
expect(evidence.instant.unverified).toBe(true);
expect(evidence.instant.encoding).toBe('unix_ms');
expect(evidence.instant.value).toBe('1786980000123');
expect(evidence.verification).toBe('degraded-local');
expect(evidence.canonicalUnixNs).toBe('1786980000123000000');
expect(evidence.instant.instant_id.startsWith('ctcl:instant:')).toBe(false);
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run tests/unit/temporal-evidence.test.ts
```

Expected: fail only because `@arcp/temporal-evidence` does not exist.

- [ ] **Step 3: Implement the temporal contract and degraded evidence constructor**

`createDegradedLocalEvidence()` signature:

```ts
export function createDegradedLocalEvidence(input: {
  unixMs: number;
  sequence?: number;
}): TemporalEvidence
```

Rules:

```ts
const seq = input.sequence ?? 0;
const unixMs = String(Math.trunc(input.unixMs));
return {
  instant: {
    instant_id: `local:unverified:${unixMs}:${seq}`,
    timescale: 'posix',
    encoding: 'unix_ms',
    value: unixMs,
    source_quality: {
      source_class: 'local_wall_clock',
      precision: 'millisecond_representation',
    },
    unverified: true,
  },
  canonicalUnixNs: `${unixMs}000000`,
  sourceQuality: {
    sourceClass: 'local_wall_clock',
    precision: 'millisecond_representation',
  },
  verification: 'degraded-local',
};
```

- [ ] **Step 4: Write RED CTCL HTTP/normalization tests with fake Fetch only**

Use the real v1 `/v1/now` shape as the fixture baseline:

```ts
{
  ok: true,
  data: {
    instant: {
      id: 'ctcl:instant:test-1',
      reference: { timescale: 'utc', value: '2026-08-17T15:00:00.123Z' },
    },
    encodings: {
      unix_s: '1786978800.123',
      unix_ms: '1786978800123',
      unix_us: '1786978800123000',
      unix_ns: '1786978800123000000',
      rfc3339: '2026-08-17T15:00:00.123Z',
    },
    source: { class: 'edge_wall_clock', sync_status: 'synchronized' },
    quality: {
      precision: 'millisecond_representation',
      estimated_uncertainty_ns: 5000000,
      synchronized: true,
    },
    signature: {
      alg: 'Ed25519',
      key_id: 'ctcl-ed25519-1',
      signed_fields: 'instant_id|unix_ns|timescale',
      value: 'fixture-signature',
    },
  },
  meta: { api_version: 'v1', request_id: 'req-test' },
}
```

Tests must prove:

- `now()` calls `GET https://commoninstant.org/v1/now` and maps `instant.id` to `InstantRef.instant_id`;
- persisted compact ref uses `encoding: 'unix_ns'`, `value: encodings.unix_ns`, `timescale: 'utc'`, source quality, and attestation;
- operational envelope keeps `canonicalUnixNs` and `verification: 'provider-asserted'` before signature verification;
- provider `quality.precision = millisecond_representation` survives even though `unix_ns` exists;
- `registerInstant()` POSTs only the supplied `value/encoding/timescale/label/meta` keys and normalizes the returned instant;
- `getInstant(id)` URL-encodes the id and returns the same normalized shape;
- `convert()` POSTs `{input,output}` and returns `{value,canonicalUnixNs,lossless}`;
- `inspectBoundary()` maps snake_case request fields and accepts `normal|gap|fold|pause|rate_change` only;
- `planSharedInstant()` maps `best.unix_s` to `best.unixS` and preserves constraint evidence arrays;
- 400 CTCL validation codes -> `invalid_input`, 401 -> `authentication_required`, 403 -> `permission_denied`, 404 -> `not_found`, 429 -> retryable `rate_limited`, 5xx/network -> retryable `temporarily_unavailable`;
- malformed `{ok:true}` or malformed required `data` fields -> non-retryable `unknown_backend_error`;
- `{ok:false,error:{code:'RATE_LIMITED',message:'...'}}` is normalized even if HTTP status is non-429.

- [ ] **Step 5: Implement strict CTCL v1 Fetch boundary**

`CtclRestTemporalAdapter` constructor:

```ts
export interface CtclRestTemporalAdapterOptions {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
}

export class CtclRestTemporalAdapter implements TemporalEvidencePort {
  constructor(options: CtclRestTemporalAdapterOptions = {})
}
```

Production defaults:

```ts
this.fetchImpl = options.fetch ?? globalThis.fetch;
this.baseUrl = new URL(options.baseUrl ?? 'https://commoninstant.org');
```

Reject a custom base URL unless protocol is `https:` or hostname is `localhost` / `127.0.0.1` for local tests; never accept embedded username/password.

Every JSON endpoint must call a shared request helper that:

1. sends `accept: application/json`;
2. sends `content-type: application/json` only when a body exists;
3. parses JSON exactly once;
4. validates the v1 envelope before endpoint-specific parsing;
5. maps both HTTP status and CTCL `error.code`;
6. never logs request/response bodies containing caller metadata.

- [ ] **Step 6: Implement CTCL -> ARCP normalization**

For `now/register/get`, normalize to:

```ts
{
  instant: {
    instant_id: data.instant.id,
    timescale: data.instant.reference.timescale === 'posix' ? 'posix' : 'utc',
    encoding: 'unix_ns',
    value: data.encodings.unix_ns,
    source_quality: {
      source_class: data.source.class,
      precision: data.quality.precision,
      estimated_uncertainty_ns: data.quality.estimated_uncertainty_ns,
      synchronized: data.quality.synchronized,
    },
    attestation: data.signature ? {
      alg: data.signature.alg,
      key_id: data.signature.key_id,
      signed_fields: data.signature.signed_fields,
      value: data.signature.value,
    } : undefined,
  },
  canonicalUnixNs: data.encodings.unix_ns,
  sourceQuality: {
    sourceClass: data.source.class,
    precision: data.quality.precision,
    estimatedUncertaintyNs: data.quality.estimated_uncertainty_ns,
    synchronized: data.quality.synchronized,
  },
  attestation: data.signature ? {
    alg: data.signature.alg,
    keyId: data.signature.key_id,
    signedFields: data.signature.signed_fields,
    value: data.signature.value,
  } : undefined,
  verification: 'provider-asserted',
}
```

Optional provider fields may be ignored; these required fields fail closed if absent/wrongly typed.

- [ ] **Step 7: Add deterministic test provider and preserve compatibility**

Export a new async provider:

```ts
export class DeterministicTemporalEvidenceAdapter implements TemporalEvidencePort {
  constructor(options?: { startUnixMs?: number; stepMs?: number })
}
```

`now()` increments deterministically, `registerInstant()` stores a deterministic record, `getInstant()` reads it, and unsupported transformation operations return deterministic fixture results rather than touching wall clock/network.

If `FakeCtclAdapter` is still imported anywhere in the repository, keep its old synchronous `now(): InstantRef` surface as a compatibility wrapper; otherwise export it as deprecated but do not remove it in 3A.

- [ ] **Step 8: Wire workspace dependencies and regenerate lockfile**

Add root dev dependency:

```json
"@arcp/temporal-evidence": "workspace:*"
```

Update `@arcp/adapter-ctcl` dependencies to:

```json
{
  "@arcp/schema": "workspace:*",
  "@arcp/temporal-evidence": "workspace:*"
}
```

Regenerate using pnpm 11.8.0; do not hand-author workspace lockfile sections.

- [ ] **Step 9: GREEN verification**

Run:

```bash
pnpm vitest run tests/unit/temporal-evidence.test.ts tests/unit/ctcl-http-adapter.test.ts
pnpm test
pnpm typecheck
```

Expected: all tests green, no live network call, no OAuth/session cookie.

- [ ] **Step 10: Commit and open Draft PR**

```bash
git add packages/temporal-evidence packages/adapters/ctcl tests/helpers/fake-ctcl-fetch.ts tests/unit/temporal-evidence.test.ts tests/unit/ctcl-http-adapter.test.ts package.json pnpm-lock.yaml
git commit -m "feat: add temporal evidence and CTCL v1 adapter"
```

Open a Draft PR from `phase3-temporal-provenance-shared-instant` to `master` titled:

```text
Phase 3: Temporal Provenance & Shared-Instant Integration
```

---

### Task 3B: Temporal Provenance + Ed25519 Attestation + Degraded-Time Trust

**Deliverable:** Real CTCL evidence can be authenticated, persisted as compact provenance on ARCP schema objects/commits, and evaluated against temporal risk without changing lease/fencing clock behavior.

**Files:**
- Modify: `packages/arcp-schema/src/types.ts`
- Create: `packages/adapters/ctcl/src/attestation.ts`
- Modify: `packages/adapters/ctcl/src/index.ts`
- Create: `packages/temporal-evidence/src/trust.ts`
- Modify: `packages/temporal-evidence/src/index.ts`
- Modify: `packages/coordinator/src/coordinator.ts`
- Create: `tests/unit/ctcl-attestation.test.ts`
- Create: `tests/unit/temporal-trust.test.ts`
- Create: `tests/unit/temporal-provenance.test.ts`

**Schema changes — exact backwards-compatible optional fields:**

```ts
export interface SourceQuality {
  source_class: string;
  precision: string;
  estimated_uncertainty_ns?: number;
  synchronized?: boolean;
}

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

Add to `ResidenceManifest`:

```ts
commit_instant?: InstantRef;
```

Add to `WakeRecord`:

```ts
not_before_instant?: InstantRef;
expires_at_instant?: InstantRef;
```

Add to `AgentTurnInput`:

```ts
commitInstant?: InstantRef;
```

Coordinator rule:

```ts
const manifest: ResidenceManifest = {
  ...existingFields,
  ...(input.commitInstant === undefined ? {} : { commit_instant: input.commitInstant }),
};
```

No CTCL import is permitted in `packages/coordinator`.

- [ ] **Step 1: Write RED provenance tests**

`tests/unit/temporal-provenance.test.ts` must prove:

1. a supplied verified-like `commitInstant` appears byte-for-byte in the committed manifest;
2. `input.now` still controls lease validity/fencing behavior even when `commitInstant.value` is far in the future/past;
3. omitting `commitInstant` preserves old manifest shape semantics;
4. a recall event is represented only through `EventEnvelope.observed_at`; reading memory does not create a new `ObjectVersion`.

Key regression:

```ts
const commitInstant: InstantRef = {
  instant_id: 'ctcl:instant:commit-1',
  timescale: 'utc',
  encoding: 'unix_ns',
  value: '9999999999999999999',
};

const manifest = coordinator.runTurn({ ...input, now: 1_000, commitInstant });
expect(manifest.commit_instant).toEqual(commitInstant);
expect(coordinator.lease.current?.valid_from).toBe(1_000);
```

- [ ] **Step 2: Write RED attestation tests**

Test-generated Ed25519 keys avoid committed private fixtures:

```ts
const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
```

Canonical CTCL signed payload is exactly:

```ts
`${instant.instant_id}|${canonicalUnixNs}|${instant.timescale ?? 'utc'}`
```

The verifier must require:

```text
alg = Ed25519
signed_fields = instant_id|unix_ns|timescale
```

Tests: valid signature -> `verification: 'verified'` + both attestation views `verified:true`; changed unix ns / id / timescale / signature -> `TemporalEvidenceError(code='attestation_invalid', retryable=false)`.

- [ ] **Step 3: Implement public-key fetch + Ed25519 verifier**

Add to `CtclRestTemporalAdapter`:

```ts
async getPublicKey(): Promise<JsonWebKey>
async verifyEvidence(evidence: TemporalEvidence, publicJwk?: JsonWebKey): Promise<TemporalEvidence>
```

`getPublicKey()` calls `/v1/pubkey`, requires `alg: 'Ed25519'`, non-empty `key_id`, and object `public_jwk`.

`verifyEvidence()`:

1. refuses missing attestation;
2. refuses any `alg` other than Ed25519;
3. refuses any `signedFields` other than `instant_id|unix_ns|timescale`;
4. imports JWK with `crypto.subtle.importKey('jwk', jwk, {name:'Ed25519'}, false, ['verify'])`;
5. base64-decodes signature;
6. verifies the canonical payload;
7. returns a cloned evidence object with `verification:'verified'`, operational attestation `verified:true`, and compact `InstantRef.attestation.verified:true`.

Never mutate the input evidence object.

- [ ] **Step 4: Write RED temporal-trust tests**

Public types:

```ts
export interface TemporalTrustContext {
  temporallySensitive: boolean;
  risk: RiskLevel;
  evidence: InstantRef | null;
  maxUncertaintyNs?: number;
}

export type TemporalTrustAction = 'allow' | 'allow-with-log' | 'delay' | 'require-evidence';

export interface TemporalTrustResult {
  acceptable: boolean;
  action: TemporalTrustAction;
  reason: string;
}
```

Exact baseline matrix:

```text
not temporally sensitive -> allow
R0/R1 + degraded/missing -> allow-with-log
R2 + degraded/missing -> delay
R3/R4 + degraded/missing -> require-evidence
any risk + non-degraded evidence over maxUncertaintyNs -> require-evidence
any risk + acceptable non-degraded evidence -> allow
```

`unverified:true` is degraded. A CTCL-shaped id without source quality does not count as verified merely because its prefix is `ctcl:`.

- [ ] **Step 5: Implement schema/coordinator/trust changes**

Keep all added schema fields optional. Do not change schema version strings in Phase 3.

Trust helper must use only `RiskLevel` + `InstantRef`; it may not import CTCL adapter types or call the network.

- [ ] **Step 6: GREEN verification**

Run:

```bash
pnpm vitest run tests/unit/ctcl-attestation.test.ts tests/unit/temporal-trust.test.ts tests/unit/temporal-provenance.test.ts
pnpm test
pnpm typecheck
```

Also grep:

```bash
git grep -n "adapter-ctcl\|commoninstant" packages/coordinator packages/policy-engine
```

Expected: no CTCL/commoninstant coupling in coordinator or policy engine.

- [ ] **Step 7: Commit**

```bash
git add packages/arcp-schema packages/adapters/ctcl packages/temporal-evidence packages/coordinator tests/unit/ctcl-attestation.test.ts tests/unit/temporal-trust.test.ts tests/unit/temporal-provenance.test.ts
git commit -m "feat: persist and verify temporal provenance"
```

---

### Task 3C: Exact Wake-Time Compiler

**Deliverable:** Temporal intent is compiled into exact `InstantRef` wake boundaries for registered instants, IANA local datetimes, and bounded CTCL planner results; compiler never executes the wake itself.

**Files:**
- Create: `packages/temporal-wake/package.json`
- Create: `packages/temporal-wake/src/types.ts`
- Create: `packages/temporal-wake/src/local-time.ts`
- Create: `packages/temporal-wake/src/compiler.ts`
- Create: `packages/temporal-wake/src/index.ts`
- Create: `tests/unit/temporal-wake-compiler.test.ts`
- Modify: root `package.json`
- Modify: `pnpm-lock.yaml`

**Public intent union:**

```ts
export type TemporalWakeIntent =
  | {
      kind: 'registered-instant';
      instantId: string;
    }
  | {
      kind: 'local-datetime';
      localValue: string;
      timezone: string;
      foldResolution?: 'earlier' | 'later';
      label?: string;
    }
  | {
      kind: 'bounded-constraints';
      window: { from: number; to: number; stepS?: number };
      constraints: SharedInstantConstraint[];
      label?: string;
    };

export interface CompiledWakeTime {
  notBefore: InstantRef;
  planningEvidence?: unknown;
}
```

Compiler:

```ts
export class TemporalWakeCompiler {
  constructor(private readonly temporal: TemporalEvidencePort) {}
  compile(intent: TemporalWakeIntent): Promise<CompiledWakeTime>;
}
```

- [ ] **Step 1: Write RED wake compiler tests**

Tests must prove:

1. `registered-instant` calls only `getInstant()` and returns that compact ref;
2. a normal `2026-08-18T09:30:00` + `Asia/Taipei` calls `inspectBoundary()` before any registration and produces a registered exact instant;
3. `gap` always rejects `TemporalEvidenceError('invalid_input')`;
4. `fold` rejects unless `foldResolution` is supplied;
5. `foldResolution:'earlier'` and `'later'` choose distinct exact instants when two candidates exist;
6. bounded constraints call planner, reject `best:null`, register `best.unixS` with `encoding:'unix_s'`, and return the registered instant;
7. compiler has no scheduler/wake-dispatch callback and performs no ARCP policy mutation.

- [ ] **Step 2: Implement strict local datetime parser**

Accept only:

```text
YYYY-MM-DDTHH:mm
YYYY-MM-DDTHH:mm:ss
YYYY-MM-DDTHH:mm:ss.SSS
```

Reject offset-bearing strings (`Z`, `+08:00`, `-05:00`) in `local-datetime` mode because the IANA timezone argument is the authoritative zone context.

Parser returns integer `{year,month,day,hour,minute,second,millisecond}` and rejects impossible field ranges before calling CTCL.

- [ ] **Step 3: Implement IANA resolver using `Intl.DateTimeFormat` after CTCL boundary inspection**

Helper signature:

```ts
export function resolveIanaLocalDateTime(input: {
  localValue: string;
  timezone: string;
  foldResolution?: 'earlier' | 'later';
}): number
```

Algorithm:

1. validate timezone by constructing `new Intl.DateTimeFormat('en-CA', { timeZone })` and normalize RangeError to `invalid_input`;
2. parse the local fields and compute a naive UTC millisecond number with `Date.UTC(...)`;
3. iteratively solve the timezone offset up to 4 rounds: format candidate in the target zone with `formatToParts`, convert formatted local fields back through `Date.UTC`, then adjust candidate by `targetNaiveMs - observedNaiveMs`;
4. verify the resulting candidate formats exactly back to the requested local fields;
5. for fold resolution, scan ±4 hours from the solved candidate in one-minute increments while preserving requested seconds/milliseconds, collect every exact local-field match, sort unique candidates, and choose first/last for earlier/later;
6. if no exact candidate exists, throw `invalid_input`; if multiple candidates exist without explicit fold resolution, throw `invalid_input`.

The compiler still calls CTCL `inspectBoundary()` first. The local resolver is only the deterministic conversion step after CTCL has classified the boundary; it does not replace CTCL's temporal evidence role.

- [ ] **Step 4: Implement compilation paths**

Registered instant:

```ts
const evidence = await temporal.getInstant(intent.instantId);
return { notBefore: evidence.instant };
```

Local datetime:

```ts
const boundary = await temporal.inspectBoundary({
  timezone: intent.timezone,
  localValue: intent.localValue,
});

if (boundary.status === 'gap') throw invalidInput('nonexistent local time');
if (boundary.status === 'fold' && intent.foldResolution === undefined) {
  throw invalidInput('ambiguous local time requires foldResolution');
}
if (boundary.status !== 'normal' && boundary.status !== 'fold') {
  throw invalidInput(`unsupported local-time boundary status: ${boundary.status}`);
}

const unixMs = resolveIanaLocalDateTime(intent);
const evidence = await temporal.registerInstant({
  value: String(unixMs),
  encoding: 'unix_ms',
  timescale: 'posix',
  ...(intent.label === undefined ? {} : { label: intent.label }),
});
return { notBefore: evidence.instant, planningEvidence: boundary };
```

Bounded constraints:

```ts
const plan = await temporal.planSharedInstant({
  window: intent.window,
  constraints: intent.constraints,
});
if (plan.best === null) throw invalidInput('CTCL planner found no candidate instant');
const evidence = await temporal.registerInstant({
  value: plan.best.unixS,
  encoding: 'unix_s',
  timescale: 'posix',
  ...(intent.label === undefined ? {} : { label: intent.label }),
  meta: { planner_score: plan.best.score },
});
return { notBefore: evidence.instant, planningEvidence: plan };
```

- [ ] **Step 5: Add workspace dependency and regenerate lockfile**

Root:

```json
"@arcp/temporal-wake": "workspace:*"
```

Package dependencies:

```json
{
  "@arcp/schema": "workspace:*",
  "@arcp/temporal-evidence": "workspace:*"
}
```

- [ ] **Step 6: GREEN verification**

Run:

```bash
pnpm vitest run tests/unit/temporal-wake-compiler.test.ts
pnpm test
pnpm typecheck
```

Search compiler package for scheduler/control-plane coupling:

```bash
git grep -n "DurableObject\|D1\|R2\|setTimeout\|setInterval\|control-plane" packages/temporal-wake
```

Expected: no hits.

- [ ] **Step 7: Commit**

```bash
git add packages/temporal-wake tests/unit/temporal-wake-compiler.test.ts package.json pnpm-lock.yaml
git commit -m "feat: compile exact temporal wake boundaries"
```

---

### Task 3D: Shared-Instant Handoff + Documentation + Full Verification + Optional Live Gate

**Deliverable:** Two independent ARCP temporal clients can align on the same registered Common Instant; Phase 3 docs/config are complete; normal CI is fully deterministic; optional public live smoke is separated from merge correctness.

**Files:**
- Create: `tests/helpers/fake-ctcl-service.ts`
- Create: `tests/integration/shared-instant-handoff.test.ts`
- Create: `docs/examples/phase3-temporal-evidence.json`
- Create: `scripts/ctcl-live-smoke.ts`
- Modify: `README.md`
- Modify PR body/status only after fresh verification.

- [ ] **Step 1: Build a stateful fake CTCL service for two-client tests**

`createFakeCtclService()` returns one Fetch-compatible function with an internal registry shared across clients:

```ts
export interface FakeCtclService {
  fetch: typeof globalThis.fetch;
  registeredIds(): string[];
}
```

Required routes:

```text
POST /v1/instants
GET  /v1/instant/{id}
GET  /v1/now
POST /v1/convert
POST /v1/boundaries/inspect
POST /v1/planner/shared-instant
GET  /v1/pubkey
```

Registering explicit input derives canonical ns deterministically; registering without a value uses an injected deterministic current instant. The fake must return the same `{ok,data,meta}` shape as CTCL v1.

- [ ] **Step 2: Write shared-instant handoff integration test**

Two independently constructed adapters share only the fake service:

```ts
const service = createFakeCtclService();
const clientA = new CtclRestTemporalAdapter({ fetch: service.fetch });
const clientB = new CtclRestTemporalAdapter({ fetch: service.fetch });

const created = await clientA.registerInstant({
  value: '1786978800.123',
  encoding: 'unix_s',
  timescale: 'posix',
  label: 'agent-handoff',
});
const retrieved = await clientB.getInstant(created.instant.instant_id);

expect(retrieved.instant.instant_id).toBe(created.instant.instant_id);
expect(retrieved.canonicalUnixNs).toBe(created.canonicalUnixNs);
expect(retrieved.instant.value).toBe(created.instant.value);
```

Then place `created.instant` into an `EventEnvelope.observed_at`, serialize/parse with ordinary JSON, and prove the second client still resolves that exact id to the same canonical ns.

- [ ] **Step 3: Add non-secret example configuration**

`docs/examples/phase3-temporal-evidence.json`:

```json
{
  "temporal_evidence": {
    "provider": "ctcl-rest",
    "base_url": "https://commoninstant.org",
    "verify_attestation": true,
    "degraded_local_fallback": "policy-controlled",
    "use_for_lease_clock": false
  }
}
```

No API key/cookie/OAuth fields exist for core Phase 3.

- [ ] **Step 4: Update README**

README must explicitly document:

- Phase 3 name: Temporal Provenance & Shared-Instant Integration;
- CTCL provides shared temporal coordinates/evidence, not lease/fencing time;
- `InstantRef` persistence rule: retain instant id + timescale + encoding/value + source quality, not a bare timestamp;
- event/write/commit/recall distinctions;
- recall is an event, not an `ObjectVersion` mutation;
- temporal trust/degraded-local behavior;
- exact wake compiler supported modes and natural-language non-goal;
- multi-agent registered-instant handoff;
- normal CI is network/OAuth free;
- public live smoke is optional and does not block merge.

- [ ] **Step 5: Add optional public live smoke script**

`scripts/ctcl-live-smoke.ts` must refuse to run unless:

```text
ARCP_CTCL_LIVE=1
```

Flow:

```ts
const a = new CtclRestTemporalAdapter();
const b = new CtclRestTemporalAdapter();
const now = await a.now();
const registered = await a.registerInstant({ label: `arcp-phase3-smoke-${Date.now()}` });
const retrieved = await b.getInstant(registered.instant.instant_id);
if (retrieved.canonicalUnixNs !== registered.canonicalUnixNs) process.exitCode = 1;
console.log(JSON.stringify({
  now_instant_id: now.instant.instant_id,
  registered_instant_id: registered.instant.instant_id,
  same_canonical_instant: retrieved.canonicalUnixNs === registered.canonicalUnixNs,
  source_precision: now.sourceQuality.precision,
}));
```

Never print signature values, cookies, headers, full provider metadata, or environment variables.

The script is manual only; do not add it to normal `pnpm test` or CI workflow.

- [ ] **Step 6: Fresh Phase 3 verification**

Run from repository root:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm vitest run tests/unit/temporal-evidence.test.ts tests/unit/ctcl-http-adapter.test.ts tests/unit/ctcl-attestation.test.ts tests/unit/temporal-trust.test.ts tests/unit/temporal-provenance.test.ts tests/unit/temporal-wake-compiler.test.ts tests/integration/shared-instant-handoff.test.ts
```

Then architecture regressions:

```bash
git grep -n "commoninstant\|adapter-ctcl" packages/coordinator packages/policy-engine
git grep -n "DurableObject\|D1\|R2\|control-plane" packages/temporal-evidence packages/temporal-wake packages/adapters/ctcl
```

Expected:

- first grep: zero hits;
- second grep: zero hits;
- all tests/typecheck green;
- no test needs live network or OAuth.

- [ ] **Step 7: Optional Gate P3-LIVE (non-blocking)**

Only if explicitly desired:

```bash
ARCP_CTCL_LIVE=1 pnpm tsx scripts/ctcl-live-smoke.ts
```

Success requires same registered id/canonical instant through two real clients. Failure of this optional public-service gate does not invalidate deterministic Phase 3 architecture; record service/network failure separately.

- [ ] **Step 8: Final commit and PR readiness**

```bash
git add tests/helpers/fake-ctcl-service.ts tests/integration/shared-instant-handoff.test.ts docs/examples/phase3-temporal-evidence.json scripts/ctcl-live-smoke.ts README.md
git commit -m "docs: finalize Phase 3 shared-instant integration"
```

Update the Draft PR with exact final workspace/test counts from the fresh run. Mark Ready for review only after normal frozen install + full test + typecheck are green.

---

## Phase 3 Acceptance Criteria

Phase 3 is complete only when all statements below are proven by tests/code inspection:

1. ARCP core consumes `TemporalEvidencePort`; it does not depend on CTCL REST shapes.
2. CTCL v1 adapter is strict, credential-free, injected-Fetch testable, and preserves millisecond-grade quality/uncertainty honestly.
3. Network failure never forges a CTCL id; degraded evidence uses `local:unverified:*`.
4. Ed25519 verification upgrades provider-asserted evidence to verified only after a real signature check.
5. Signature mismatch fails closed as `attestation_invalid`.
6. `ResidenceManifest.commit_instant` persists caller-supplied temporal provenance without changing lease/fencing time.
7. `WakeRecord` supports exact `not_before_instant` / `expires_at_instant` while legacy string fields remain compatible.
8. R0–R4 temporal trust is provider-neutral and does not replace the existing policy matrix.
9. Wake compiler handles registered instant, safe IANA local datetime, DST gap/fold, and bounded planner cases without dispatching wakes itself.
10. Two independent clients can register/retrieve the same Common Instant and preserve `instant_id + canonicalUnixNs` through an ARCP handoff/event.
11. Coordinator/policy engine have no CTCL/commoninstant import/call path.
12. Normal CI uses fake Fetch/service only and needs no network, OAuth, cookies, or secrets.
13. Optional live CTCL smoke is explicitly gated and non-blocking.

## Plan Self-Review Result

- **Spec coverage:** 3A covers provider-neutral contract, real CTCL v1 transport, strict envelopes/errors, degraded local evidence, and honest precision. 3B covers schema provenance, commit provenance, attestation, and temporal trust. 3C covers registered/local/planner wake compilation and ambiguity handling. 3D covers multi-agent handoff, documentation, deterministic full verification, and optional live activation.
- **Placeholder scan:** no `TBD`, `TODO`, secret value, user-specific absolute path, or unspecified production dependency is required.
- **Type consistency:** all later tasks consume the exact `TemporalEvidencePort`, `TemporalEvidence`, `InstantRef`, trust, boundary, planner, and wake types defined earlier in this plan.
- **Scope:** CTCL Workspace identity binding, full scheduler execution, natural-language scheduling, NTP/lease clocks, and sub-ms global ordering remain explicitly outside Phase 3.
