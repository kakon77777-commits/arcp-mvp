# Phase 1 Control-Plane Foundation Implementation Plan

> **For agentic workers:** Continue test-first. Do not request Cloudflare, Google OAuth, or model-provider credentials until the explicit live-integration gates below.

**Goal:** Build the credential-free Phase 1 application boundary for ARCP so Worker, Durable Object, D1, and R2 adapters can be added without changing coordinator or HTTP semantics.

**Architecture:** Keep ARCP application rules platform-neutral. `@arcp/control-plane-core` owns HTTP routing, mutation validation, response envelopes, coordinator transport contracts, and storage ports. Cloudflare-specific bindings remain adapters. The existing in-memory coordinator remains the deterministic Phase 0 simulator and executable oracle.

**Tech Stack:** TypeScript 5, Node >=22.13, pnpm 11.8, Vitest 3, Web Fetch API-compatible Request/Response.

## Global Constraints

- No Cloudflare account IDs, resource IDs, OAuth tokens, API keys, or model-provider secrets in Git.
- Every mutation requires Authorization, `Idempotency-Key`, JSON content type, and an ARCP schema-bearing body.
- The API gateway never decides canonical Agent state; the per-Agent coordinator remains authoritative for run/commit ordering.
- Queue acceptance is not a durable commit. Responses distinguish accepted/pending from committed state.
- Phase 1 code must run in local tests without Cloudflare, Google, CTCL, or model-network access.
- Keep model-provider selection outside this plan; Phase 4 live model invocation remains provider-neutral.

---

### Task 1: Harden the Phase 0 commit boundary — COMPLETE

- [x] Write a failing integration test that injects a root-hash preparation failure.
- [x] Verify the test exposes partial mutation in the original implementation.
- [x] Prepare the complete next manifest before mutating store-visible state.
- [x] Allow commit failure to transition to `Suspended`.
- [x] Write a second failing test for a superseded lease fencing token.
- [x] Enforce the fencing token at the last safe point before durable mutation.
- [x] Run the full tests and typecheck.

### Task 2: Platform-neutral control-plane HTTP core — COMPLETE

**Implemented:**
- `packages/control-plane-core/package.json`
- `packages/control-plane-core/src/contracts.ts`
- `packages/control-plane-core/src/http.ts`
- `packages/control-plane-core/src/index.ts`
- `tests/unit/control-plane-core.test.ts`

- [x] Test `/api/v1/health`, authenticated manifest reads, and mutation validation first.
- [x] Implement `CoordinatorControlPort`, `AuthorizationPort`, and Fetch-compatible handler.
- [x] Require Authorization, `Idempotency-Key`, and JSON on wake mutations.
- [x] Require HTTP/body idempotency keys to match.
- [x] Distinguish `pending_coordinator_commit` from a durable committed version.
- [x] Fail closed on malformed/unknown routes and internal failures.
- [x] Run all tests and typecheck.

### Task 3: Per-Agent coordinator transport contract — COMPLETE

**Implemented:**
- `packages/control-plane-core/src/coordinator-client.ts`
- `tests/unit/coordinator-client.test.ts`

- [x] Use a stable encoded per-Agent internal route.
- [x] Propagate `X-ARCP-Request-ID`.
- [x] Propagate wake idempotency through header and body.
- [x] Map coordinator read 404 to `null` without manufacturing state.
- [x] Fail closed on malformed successful coordinator responses.
- [x] Run all tests and typecheck.

### Task 4: Metadata/Object Store ports — COMPLETE

**Implemented:**
- `packages/control-plane-core/src/storage.ts`
- `tests/unit/storage-contracts.test.ts`

- [x] Define `MetadataStorePort` for manifest CAS and append-only event metadata.
- [x] Define `ObjectStorePort` for content-addressed bytes.
- [x] Provide in-memory executable reference implementations.
- [x] Make CAS conflict explicit and preserve authoritative state on conflict.
- [x] Make event duplicate detection explicit.
- [x] Distinguish stored/already-existing/digest-address conflict for object bytes.
- [x] Run all tests and typecheck.

### Task 5A: Cloudflare per-Agent Durable Object transport shell — COMPLETE

**Implemented:**
- `packages/adapters/cloudflare/package.json`
- `packages/adapters/cloudflare/src/index.ts`
- `tests/unit/cloudflare-adapter.test.ts`

- [x] Route only canonical `/internal/v1/agents/:agentId/{manifest|status|wakes}` requests.
- [x] Decode and validate the canonical Agent ID.
- [x] Map exactly one Agent ID to `DurableObjectNamespace.getByName(agentId)`.
- [x] Reject malformed routes and malformed percent-encoding before namespace lookup.
- [x] Keep the adapter free of account IDs, resource IDs, and secrets.
- [x] Run all tests and typecheck.

### Task 5B: Cloudflare storage/runtime bindings — COMPLETE, STILL CREDENTIAL-FREE

**Implemented:**
- `packages/adapters/cloudflare/src/d1-types.ts`, `d1-metadata-store.ts`
- `migrations/d1/0001_init.sql`
- `packages/adapters/cloudflare/src/r2-types.ts`, `r2-object-store.ts`
- `packages/adapters/cloudflare/src/agent-durable-object-core.ts` (platform-neutral turn/wake logic)
- `packages/adapters/cloudflare/src/agent-durable-object.ts` (internal HTTP surface, reuses control-plane-core's envelope format)
- `packages/adapters/cloudflare/src/coordinator-transport.ts` (extracted from index.ts to avoid a circular import from worker.ts)
- `packages/adapters/cloudflare/src/worker.ts` (public Worker entrypoint + `ArcpAgentDurableObject` class)
- `packages/adapters/cloudflare/wrangler.jsonc` (template — every ID is `REPLACE_ME_*`)
- `tests/unit/d1-metadata-store.test.ts`, `r2-object-store.test.ts`, `agent-durable-object.test.ts`, `worker.test.ts`
- `tests/integration/storage-adapter-parity.test.ts` (D1/R2 vs in-memory, same assertions, both backends)
- `tests/helpers/fake-d1-database.ts` (real `node:sqlite`-backed D1Database-shaped fake — genuine SQL execution, not a hand-rolled reimplementation), `fake-r2-bucket.ts`

- [x] Implement `D1MetadataStore` against the existing `MetadataStorePort`.
- [x] Add D1 schema/migration for manifest CAS and append-only event rows.
- [x] Implement `R2ObjectStore` against the existing `ObjectStorePort`.
- [x] Add adapter parity tests against the in-memory reference semantics.
- [x] Implement the Durable Object handler that owns per-Agent mutation ordering. Phase 1 scope: wake acceptance is durably recorded (idempotent, policy-evaluated) but does not run a full Deliberating/Acting turn yet — no model call exists until Phase 4/Gate C — so `committed_version` stays `null` (pending, not a durable manifest commit).
- [x] Implement the Worker entrypoint by composing `createControlPlaneHandler()` with the DO transport.
- [x] Add a deployment configuration template using a SQLite Durable Object namespace (`new_sqlite_classes`) and current declarative `exports` lifecycle syntax.
- [x] Keep real D1 database IDs and real R2 bucket names out of committed production configuration until provisioning.
- [x] Run local tests/typecheck and, since Wrangler was present, `wrangler deploy --dry-run` (bundles + validates bindings, never uploads) against a temporarily-filled copy of the template; the committed template keeps its `REPLACE_ME_*` placeholders.

**Bug found and fixed in already-merged Task 2/3 code, only surfaced by Task 5B's real end-to-end wire-up:** `coordinator-client.ts`'s `acceptWake` expected `policy_decision`/`committed_version` nested inside `result`, but `http.ts` actually places them at the envelope's top level (consistent with how manifest/status reads already work). Each side's own unit tests only checked it against its own assumption — `coordinator-client.test.ts` mocked a transport with the wrong shape, so nothing had exercised the real produced-by-http.ts / consumed-by-coordinator-client.ts pair together until a real Worker→DO→D1 request went through all the layers at once. Fixed the consumer (`isWakeResult` now checks only `result.status`; `policy_decision`/`committed_version` are read from the envelope) and corrected the stale test mock to match.

### Task 6: Explicit human/live-integration gates — NOT NEEDED YET

#### Gate A — first Cloudflare deployment

Only when Task 5B is green and the team is ready for the first remote deploy:

- [ ] Run `npx wrangler whoami` on the user's machine.
- [ ] If unauthenticated, perform `npx wrangler login`.
- [ ] Provision the dev D1 database and R2 bucket.
- [ ] Insert real binding identifiers through the chosen deployment configuration/secrets path.
- [ ] Deploy only after local contract tests remain green.

#### Gate B — first live Google Drive adapter test

Only in Phase 2 after the adapter is complete against fakes/contracts:

- [ ] Fix ADR #3 authentication mode.
- [ ] Complete the required OAuth consent/service-account human step.
- [ ] Store tokens outside Git.

#### Gate C — first live model call

Only in Phase 4 after bounded-run orchestration is provider-neutral and tested:

- [ ] Fix ADR #7 primary/fallback provider.
- [ ] Configure provider secrets outside Git.
- [ ] Enable the first real model call behind the existing provider-neutral boundary.

## Verified checkpoint

At the end of Task 5A (merged to master as PR #1), CI reported:

- `pnpm install --frozen-lockfile`: pass
- Vitest: **65 / 65 pass**
- `pnpm typecheck`: pass

At the end of Task 5B, local verification reports:

- `pnpm install --frozen-lockfile`: pass
- Vitest: **103 / 103 pass** (18 files)
- `pnpm typecheck`: pass
- `wrangler deploy --dry-run`: bundle builds (44.25 KiB), all three bindings resolve (`AGENTS` Durable Object, `DB` D1, `OBJECTS` R2) — run against a temporarily-filled local copy of `wrangler.jsonc`; the committed template keeps `REPLACE_ME_*` placeholders, never a real account ID, database ID, or bucket name.

No Cloudflare account, Google OAuth consent, or live model-provider credential was required to reach either checkpoint.
