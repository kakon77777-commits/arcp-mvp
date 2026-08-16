# Phase 1 Control-Plane Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the credential-free Phase 1 application boundary for ARCP so Worker, Durable Object, D1, and R2 adapters can be added without changing coordinator or HTTP semantics.

**Architecture:** Keep ARCP application rules platform-neutral. A `@arcp/control-plane-core` package owns HTTP routing, mutation validation, response envelopes, and the coordinator port; Cloudflare-specific bindings remain adapters. The existing in-memory coordinator remains the deterministic Phase 0 simulator and is not replaced.

**Tech Stack:** TypeScript 5, Node >=22.13, pnpm 11.8, Vitest 3, Web Fetch API-compatible Request/Response.

## Global Constraints

- No Cloudflare account IDs, resource IDs, OAuth tokens, API keys, or model-provider secrets in Git.
- Every mutation requires Authorization, `Idempotency-Key`, JSON content type, and an ARCP schema-bearing body.
- The API gateway never decides canonical Agent state; the per-Agent coordinator remains authoritative for run/commit ordering.
- Queue acceptance is not a durable commit. Responses must distinguish accepted/pending from committed state.
- Phase 1 code must run in local tests without Cloudflare, Google, CTCL, or model-network access.
- Keep model-provider selection outside this plan; Phase 4 live model invocation remains provider-neutral.

---

### Task 1: Harden the Phase 0 commit boundary

**Files:**
- Modify: `packages/coordinator/src/coordinator.ts`
- Modify: `packages/coordinator/src/state-machine.ts`
- Test: `tests/integration/atomic-commit.test.ts`

**Interfaces:**
- Consumes: existing `AgentTurnInput`, `ResidenceManifest`, `computeRootHash()`.
- Produces: `AgentCoordinator.runTurn()` that exposes no store mutation when commit preparation fails.

- [x] **Step 1: Write a failing integration test that injects a root-hash preparation failure.**
- [x] **Step 2: Run CI and verify the new test fails while the prior 46 tests pass.**
- [x] **Step 3: Prepare the complete next manifest before mutating store-visible state.**
- [x] **Step 4: Allow a commit failure to transition to `Suspended`.**
- [x] **Step 5: Run the full tests and typecheck.**

### Task 2: Introduce the platform-neutral control-plane HTTP core

**Files:**
- Create: `packages/control-plane-core/package.json`
- Create: `packages/control-plane-core/src/contracts.ts`
- Create: `packages/control-plane-core/src/http.ts`
- Create: `packages/control-plane-core/src/index.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Test: `tests/unit/control-plane-core.test.ts`

**Interfaces:**
- Consumes: `WakeRecord`, `ResidenceManifest`, `PolicyDecision` from `@arcp/schema`.
- Produces: `CoordinatorControlPort`, `AuthorizationPort`, `createControlPlaneHandler()`.

- [ ] **Step 1: Write failing tests for `/api/v1/health`, authenticated manifest read, and mutation validation.**
- [ ] **Step 2: Verify failure is caused by the missing control-plane package.**
- [ ] **Step 3: Implement contracts and the minimal Fetch-compatible handler.**
- [ ] **Step 4: Require Authorization, `Idempotency-Key`, and `application/json` on wake mutations; require HTTP/body idempotency keys to match.**
- [ ] **Step 5: Return the spec error envelope and distinguish `pending_coordinator_commit` from a committed manifest version.**
- [ ] **Step 6: Run all tests and typecheck.**

### Task 3: Add the per-Agent coordinator transport contract

**Files:**
- Create: `packages/control-plane-core/src/coordinator-client.ts`
- Test: `tests/unit/coordinator-client.test.ts`

**Interfaces:**
- Consumes: a Fetch-compatible transport with `fetch(Request): Promise<Response>`.
- Produces: a coordinator client implementing `CoordinatorControlPort` without importing Cloudflare types.

- [ ] **Step 1: Write failing tests for stable per-Agent request paths and propagation of request/idempotency IDs.**
- [ ] **Step 2: Implement the minimal transport client.**
- [ ] **Step 3: Verify malformed coordinator responses fail closed.**
- [ ] **Step 4: Run all tests and typecheck.**

### Task 4: Define Metadata/Object Store ports before D1/R2 bindings

**Files:**
- Create: `packages/control-plane-core/src/storage.ts`
- Test: `tests/unit/storage-contracts.test.ts`

**Interfaces:**
- Produces: `MetadataStorePort` for manifest/event/task metadata and `ObjectStorePort` for content-addressed blobs.
- Invariant: metadata storage does not become a blob store; object storage does not make policy/canonical-role decisions.

- [ ] **Step 1: Write contract tests against in-memory fake implementations.**
- [ ] **Step 2: Define minimal port methods needed by Phase 1 only: manifest get/CAS, event append/list, blob put/get by SHA-256 address.**
- [ ] **Step 3: Verify CAS conflict and missing-blob results are explicit, not silent success.**
- [ ] **Step 4: Run all tests and typecheck.**

### Task 5: Add the Cloudflare adapter shell without credentials

**Files:**
- Create: `apps/control-plane/package.json`
- Create: `apps/control-plane/src/index.ts`
- Create: `apps/control-plane/wrangler.jsonc`
- Create: `apps/control-plane/README.md`
- Modify: `pnpm-workspace.yaml`
- Modify: `tsconfig.json`
- Modify: `pnpm-lock.yaml`
- Test: `tests/contract/cloudflare-control-plane.test.ts`

**Interfaces:**
- Consumes: `createControlPlaneHandler()` and Cloudflare bindings generated by `wrangler types` once Wrangler is installed/enabled locally.
- Produces: Worker `fetch` entrypoint and binding names for `AGENT_COORDINATOR`, D1 metadata, and R2 objects.

- [ ] **Step 1: Write a contract test proving the Worker adapter delegates to the platform-neutral handler.**
- [ ] **Step 2: Add `wrangler.jsonc` using a SQLite Durable Object namespace and current declarative `exports` lifecycle syntax.**
- [ ] **Step 3: Keep D1 database ID and R2 deployment resources out of source-controlled production values until account provisioning.**
- [ ] **Step 4: Document `npx wrangler whoami` as the deployment gate, not an implementation prerequisite.**
- [ ] **Step 5: Run local tests and typecheck; do not deploy in this task.**

### Task 6: Deployment and live integrations are explicit gates

**Files:**
- Create later when credentials exist: `migrations/d1/0001_phase1.sql`
- Create later when OAuth is approved: live Drive adapter files under `packages/adapters/drive/`
- Create later at Phase 4: live provider adapters under `packages/adapters/model/`

**Interfaces:**
- Cloudflare gate: authenticated Wrangler account plus provisioned dev D1/R2 resources.
- Drive gate: chosen ADR #3 auth mode and completed OAuth/service-account setup.
- Model gate: ADR #7 primary/fallback provider choice plus secret-store keys.

- [ ] **Step 1: Before first Cloudflare deployment, run `npx wrangler whoami`; authenticate only if needed.**
- [ ] **Step 2: Before first live Drive test, complete the chosen OAuth consent flow.**
- [ ] **Step 3: Before first Phase 4 live model call, record ADR #7 and configure provider secrets outside Git.**
