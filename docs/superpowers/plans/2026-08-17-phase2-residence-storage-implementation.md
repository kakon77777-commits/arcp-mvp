# Phase 2 Pluggable Residence Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Google-shaped Phase 2 storage assumption with one provider-neutral residence-storage contract, a production-capable synced-filesystem backend, and an optional Google Drive API backend while preserving ARCP canonicality and policy boundaries.

**Architecture:** `@arcp/residence-storage` owns the provider-neutral contract, diff semantics, error taxonomy, and in-memory executable oracle. `@arcp/adapter-synced-filesystem` implements the recommended local-first backend over an explicitly configured synchronized directory; watcher events are latency hints and reconciliation scans are the correctness path. `@arcp/adapter-google-drive-api` implements the cloud-native/headless route behind an injected access-token provider and Fetch transport. A thin `@arcp/residence-bridge` publishes reconciliation observations without giving the storage backend canonical authority.

**Tech Stack:** TypeScript 5, Node >=22.13, pnpm 11.8.0, Vitest 3, Node filesystem APIs, Web/Node Fetch API, Google Drive API v3.

## Global Constraints

- Keep Node compatibility at `>=22.13`; CI continues to run Node 24.
- No Google OAuth tokens, refresh tokens, client secrets, Drive IDs, machine-specific absolute paths, or other credentials in Git.
- `SyncedFilesystemAdapter` must not contain Google-, OneDrive-, Dropbox-, Syncthing-, or NAS-specific logic.
- A successful local filesystem write means only that the local backend accepted and verified the bytes; it does **not** mean external cloud synchronization is complete.
- A successful Google Drive API write means only that the provider accepted the remote operation; it does **not** mean ARCP canonical commit, policy approval, lineage update, or replica verification.
- Backend observation is reconciliation evidence. External deletion never directly causes irreversible canonical deletion.
- Storage adapters do not evaluate ARCP policy, issue leases, choose canonical roles, or mutate D1/R2 control-plane state directly.
- `fs.watch` is a hint path only. Every live synced-filesystem bridge must retain periodic reconciliation as the correctness path.
- The first filesystem implementation rejects symlinks/junctions inside the configured residence root instead of following them.
- Cloudflare Worker/Durable Object code must not attempt to read a user's desktop filesystem. Local filesystem access belongs to the local residence bridge/process.
- Google Drive API activation remains credential-gated. All default tests must pass without network access and without OAuth.
- The existing `@arcp/adapter-drive` package is a migration source only. Delete it only after the provider-neutral oracle and Google Drive API package cover the behavior that remains useful.
- Preserve strict RED -> GREEN TDD for every task. Run the focused failing test before implementation, then the focused passing test, then `pnpm test` and `pnpm typecheck` before each task commit.

---

## Locked file structure

### New provider-neutral package

- `packages/residence-storage/package.json` — workspace package manifest for `@arcp/residence-storage`.
- `packages/residence-storage/src/types.ts` — public storage contract types and capability flags.
- `packages/residence-storage/src/errors.ts` — normalized provider-neutral error class/taxonomy.
- `packages/residence-storage/src/hash.ts` — SHA-256 byte hashing helper.
- `packages/residence-storage/src/diff.ts` — stable snapshot comparison.
- `packages/residence-storage/src/in-memory.ts` — executable reference adapter.
- `packages/residence-storage/src/index.ts` — barrel exports.

### New synced-filesystem adapter

- `packages/adapters/synced-filesystem/package.json` — package manifest for `@arcp/adapter-synced-filesystem`.
- `packages/adapters/synced-filesystem/src/path-guard.ts` — normalized relative-path and root-containment enforcement.
- `packages/adapters/synced-filesystem/src/scan.ts` — deterministic recursive snapshot scanning and hash cache.
- `packages/adapters/synced-filesystem/src/adapter.ts` — read/write/remove/snapshot/diff implementation.
- `packages/adapters/synced-filesystem/src/watch-hints.ts` — `fs.watch` hint source with fail-open-to-reconciliation behavior.
- `packages/adapters/synced-filesystem/src/reconciler.ts` — periodic reconciliation and watcher-triggered fast scans.
- `packages/adapters/synced-filesystem/src/index.ts` — barrel exports.

### New local bridge package

- `packages/residence-bridge/package.json` — package manifest for `@arcp/residence-bridge`.
- `packages/residence-bridge/src/bridge.ts` — storage-to-observation boundary.
- `packages/residence-bridge/src/index.ts` — barrel exports.

### New Google Drive API adapter

- `packages/adapters/google-drive-api/package.json` — package manifest for `@arcp/adapter-google-drive-api`.
- `packages/adapters/google-drive-api/src/types.ts` — Drive REST transport records and auth boundary.
- `packages/adapters/google-drive-api/src/http-transport.ts` — Fetch-based Drive v3 transport.
- `packages/adapters/google-drive-api/src/tree.ts` — scoped tree listing and normalized path reconstruction.
- `packages/adapters/google-drive-api/src/adapter.ts` — provider-neutral adapter translation.
- `packages/adapters/google-drive-api/src/index.ts` — barrel exports.

### New/changed tests

- `tests/unit/residence-storage-contract.test.ts`
- `tests/helpers/residence-storage-conformance.ts`
- `tests/integration/residence-storage-parity.test.ts`
- `tests/unit/synced-filesystem-path-guard.test.ts`
- `tests/unit/synced-filesystem-adapter.test.ts`
- `tests/unit/synced-filesystem-reconciler.test.ts`
- `tests/integration/residence-bridge.test.ts`
- `tests/helpers/fake-google-drive-fetch.ts`
- `tests/unit/google-drive-http-transport.test.ts`
- `tests/unit/google-drive-adapter.test.ts`
- `tests/unit/adapters.test.ts` — remove the old Google-shaped generic fake assertions after provider-neutral parity exists.

### Final migration/docs

- `package.json` — add new workspace package dependencies, later remove `@arcp/adapter-drive`.
- `pnpm-lock.yaml` — regenerate with pnpm 11.8.0.
- `README.md` — document Phase 2 backend selection and local-vs-headless modes.
- `docs/examples/residence-storage.synced-filesystem.json` — committed non-secret config example.
- `docs/examples/residence-storage.google-drive-api.json` — committed non-secret config example.
- delete `packages/adapters/drive/package.json` and `packages/adapters/drive/src/index.ts` only in the final migration task.

---

### Task 1: Provider-neutral residence-storage contract and errors — COMPLETE

Task 1 is complete. The provider-neutral contract, errors, capabilities, and raw-byte SHA-256 helper are implemented and verified.

---

### Task 2: Snapshot diff semantics and in-memory executable oracle — COMPLETE

Task 2 is complete. Deterministic snapshot diff semantics, the in-memory executable oracle, and the shared conformance helper are implemented and verified.

---

### Task 3: Remove Google-specific assumptions from generic tests — COMPLETE

**Files:**
- Modified: `tests/unit/adapters.test.ts`
- Modified: `tests/integration/residence-storage-parity.test.ts`
- Kept unchanged: `packages/adapters/drive/src/index.ts`

**Interfaces:**
- Consumes: Task 2 provider-neutral oracle.
- Produces: generic adapter tests that no longer claim Phase 2 must use Drive Changes API.

- [x] **Step 1: Add a regression assertion before removing the old test block**

Added an explicit regression proving backend deletion is surfaced as reconciliation evidence through `InMemoryResidenceStorageAdapter`.

- [x] **Step 2: Run the regression test GREEN before migration**

Verified on commit `14a0d64a71a0659fbd127d4914edb7cfb0f4adbb` before the old Drive-shaped generic tests were removed.

- [x] **Step 3: Delete only the `FakeDriveAdapter` section from `tests/unit/adapters.test.ts`**

Removed the `FakeDriveAdapter` / `FakeDriveFile` import and the entire Drive-specific describe block. CTCL and model tests remain unchanged. `packages/adapters/drive` remains present as the migration source for later Google Drive API work.

- [x] **Step 4: Verify no generic test is Drive-shaped and commit**

Final checkpoint `c0e4b646806a3e02fc705cb8a214b50cc8fbc8a5`:

- frozen pnpm install passes across 10 workspace projects;
- 20/20 test files pass;
- 109/109 tests pass;
- `pnpm typecheck` passes;
- `tests/unit/adapters.test.ts` now contains only CTCL and model generic adapter tests;
- `packages/adapters/drive/src/index.ts` remains unchanged at blob `7261fbb87429e78b8fa46625786d41ab654c535e`.

---

### Task 4: Synced-filesystem root guard, snapshot, and read path

**Files:**
- Create: `packages/adapters/synced-filesystem/package.json`
- Create: `packages/adapters/synced-filesystem/src/path-guard.ts`
- Create: `packages/adapters/synced-filesystem/src/scan.ts`
- Create: `packages/adapters/synced-filesystem/src/adapter.ts`
- Create: `packages/adapters/synced-filesystem/src/index.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Test: `tests/unit/synced-filesystem-path-guard.test.ts`
- Test: `tests/unit/synced-filesystem-adapter.test.ts`

**Interfaces:**
- Consumes: `ResidenceStorageAdapter`, `ResidenceStorageSnapshot`, `ResidenceStorageEntry`, `ResidenceStorageError`, `sha256Bytes()`, `diffResidenceSnapshots()` from `@arcp/residence-storage`.
- Produces: `SyncedFilesystemAdapter`, `resolveResidencePath()`, `scanResidenceTree()`.

- [ ] **Step 1: Write RED path-guard tests**

Create `tests/unit/synced-filesystem-path-guard.test.ts` with cases that:

```ts
import { mkdtemp, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveResidencePath } from '@arcp/adapter-synced-filesystem';

describe('resolveResidencePath', () => {
  it('keeps a normal relative path inside the configured root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arcp-fs-'));
    const resolved = await resolveResidencePath(root, 'notes/a.txt');
    expect(resolved.startsWith(root)).toBe(true);
  });

  it('rejects traversal and absolute paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arcp-fs-'));
    await expect(resolveResidencePath(root, '../escape.txt')).rejects.toMatchObject({
      code: 'invalid_path_or_ref',
    });
    await expect(resolveResidencePath(root, '/absolute.txt')).rejects.toMatchObject({
      code: 'invalid_path_or_ref',
    });
  });

  it('rejects a symlink inside the residence namespace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arcp-fs-'));
    const outside = await mkdtemp(join(tmpdir(), 'arcp-outside-'));
    await mkdir(join(root, 'nested'));
    await symlink(outside, join(root, 'nested', 'escape'));
    await expect(resolveResidencePath(root, 'nested/escape/file.txt')).rejects.toMatchObject({
      code: 'invalid_path_or_ref',
    });
  });
});
```

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run tests/unit/synced-filesystem-path-guard.test.ts
```

Expected: FAIL because `@arcp/adapter-synced-filesystem` does not exist.

- [ ] **Step 3: Implement `resolveResidencePath()`**

`path-guard.ts` must:

- reject empty, absolute, or NUL-containing paths;
- normalize `\\` to `/` before validation;
- reject any path whose normalized segments contain `..`;
- resolve under the configured root;
- use `lstat` on every existing path segment and reject symbolic links;
- reject any final resolved path outside the root;
- throw `ResidenceStorageError('invalid_path_or_ref', ..., false)`.

- [ ] **Step 4: Write RED adapter snapshot/read tests**

`tests/unit/synced-filesystem-adapter.test.ts` must create a temporary directory, write nested files with `node:fs/promises`, instantiate `SyncedFilesystemAdapter`, and assert:

- `snapshot()` returns normalized relative paths sorted lexicographically;
- file entries contain raw-byte SHA-256 hashes;
- directory entries have `contentHash: null`;
- `read(ref)` returns cloned bytes;
- `read('fs:missing.txt')` returns `null`;
- `capabilities()` reports `watchHints: true`, `stableObjectIds: false`, and all provider-native capabilities false;
- refs use `fs:${encodeURIComponent(relativePath)}`.

- [ ] **Step 5: Implement scan and read path**

`scanResidenceTree(root, scope?)` must recursively enumerate with `readdir({ withFileTypes: true })`, reject symlink entries, create entries for both directories and files, compute file hashes with `sha256Bytes()`, and return deterministic sorted entries.

`SyncedFilesystemAdapter.snapshot()` wraps this into a `ResidenceStorageSnapshot` with:

- `backendKind: 'synced-filesystem'`;
- `cursor: null`;
- current observation timestamp;
- deterministic entries.

`read(ref)` accepts only `fs:` refs, decodes the relative path, uses the path guard, returns `null` for missing files, rejects directories as `unsupported_operation`, and returns cloned bytes plus hash/revision=`null`.

- [ ] **Step 6: Export package, refresh lockfile, verify GREEN, and commit**

Add the new workspace dev dependency to root `package.json`, run pnpm 11.8.0 to refresh the lockfile, then run:

```bash
pnpm vitest run tests/unit/synced-filesystem-path-guard.test.ts
pnpm vitest run tests/unit/synced-filesystem-adapter.test.ts
pnpm test
pnpm typecheck
```

Commit:

```bash
git add packages/adapters/synced-filesystem package.json pnpm-lock.yaml tests/unit/synced-filesystem-path-guard.test.ts tests/unit/synced-filesystem-adapter.test.ts
git commit -m "feat: add synced filesystem snapshot adapter"
```

---

### Task 5: Synced-filesystem write/remove/conflict integrity

Follow the remaining tasks from the approved design and continue strict RED -> GREEN execution. Do not activate provider credentials until the explicit Google Drive live gate.
