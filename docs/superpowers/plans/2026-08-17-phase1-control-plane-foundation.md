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

### Task 5B: Cloudflare storage/runtime bindings — NEXT, STILL CREDENTIAL-FREE

This is the next local-AI coding slice. Do **not** ask the user to log in yet.

- [ ] Implement `D1MetadataStore` against the existing `MetadataStorePort`.
- [ ] Add D1 schema/migration for manifest CAS and append-only event rows.
- [ ] Implement `R2ObjectStore` against the existing `ObjectStorePort`.
- [ ] Add adapter parity tests against the in-memory reference semantics.
- [ ] Implement the Durable Object handler that owns per-Agent mutation ordering.
- [ ] Implement the Worker entrypoint by composing `createControlPlaneHandler()` with the DO transport.
- [ ] Add a deployment configuration template using a SQLite Durable Object namespace and current declarative `exports` lifecycle syntax.
- [ ] Keep real D1 database IDs and real R2 bucket names out of committed production configuration until provisioning.
- [ ] Run local tests/typecheck and, if Wrangler is present, local `wrangler dev`; do not deploy.

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

At the end of Task 5A, GitHub CI reports:

- `pnpm install --frozen-lockfile`: pass
- Vitest: **65 / 65 pass**
- `pnpm typecheck`: pass

No Cloudflare account, Google OAuth consent, or live model-provider credential was required to reach this checkpoint.
