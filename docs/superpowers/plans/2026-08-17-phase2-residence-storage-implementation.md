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

### Task 1: Provider-neutral residence-storage contract and errors

**Files:**
- Create: `packages/residence-storage/package.json`
- Create: `packages/residence-storage/src/types.ts`
- Create: `packages/residence-storage/src/errors.ts`
- Create: `packages/residence-storage/src/hash.ts`
- Create: `packages/residence-storage/src/index.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Test: `tests/unit/residence-storage-contract.test.ts`

**Interfaces:**
- Produces: `ResidenceStorageAdapter`, `ResidenceStorageSnapshot`, `ResidenceStorageDiff`, `ResidenceStorageReconciliation`, `ResidenceStorageEntry`, `ResidenceStorageCapabilities`, `ResidenceStorageError`, `ResidenceStorageErrorCode`, `sha256Bytes()`.
- Consumes: no new Phase 2 code.

- [ ] **Step 1: Write the failing contract-shape test**

Create `tests/unit/residence-storage-contract.test.ts` with imports that do not exist yet:

```ts
import { describe, expect, it } from 'vitest';
import {
  ResidenceStorageError,
  sha256Bytes,
  type ResidenceStorageCapabilities,
} from '@arcp/residence-storage';

describe('@arcp/residence-storage public contract', () => {
  it('hashes bytes as sha256:<hex>', async () => {
    const digest = await sha256Bytes(new TextEncoder().encode('abc'));
    expect(digest).toBe('sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('normalizes backend failures into an explicit retryable error', () => {
    const error = new ResidenceStorageError('temporarily_unavailable', 'backend unavailable', true);
    expect(error.code).toBe('temporarily_unavailable');
    expect(error.retryable).toBe(true);
  });

  it('keeps capability claims explicit', () => {
    const capabilities: ResidenceStorageCapabilities = {
      watchHints: false,
      changeCursor: false,
      stableObjectIds: false,
      providerReplicationConfirmation: false,
      sharedDrives: false,
      nativeDocuments: false,
      remotePermissions: false,
    };
    expect(capabilities.changeCursor).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm vitest run tests/unit/residence-storage-contract.test.ts
```

Expected: FAIL because `@arcp/residence-storage` does not exist.

- [ ] **Step 3: Create the package manifest**

`packages/residence-storage/package.json`:

```json
{
  "name": "@arcp/residence-storage",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts",
      "default": "./src/index.ts"
    }
  }
}
```

- [ ] **Step 4: Define the exact public types**

`packages/residence-storage/src/types.ts` must export these names and fields:

```ts
export type ResidenceEntryKind = 'file' | 'directory';
export type ProviderReplicationStatus = 'unknown' | 'provider-confirmed';

export interface ResidenceStorageScope {
  prefix: string;
}

export interface ResidenceStorageEntry {
  ref: string;
  path: string;
  kind: ResidenceEntryKind;
  size: number | null;
  modifiedAt: string | null;
  contentHash: string | null;
  revision: string | null;
}

export interface ResidenceStorageSnapshot {
  backendKind: string;
  observedAt: string;
  cursor: string | null;
  entries: ResidenceStorageEntry[];
}

export interface ResidenceStorageMove {
  before: ResidenceStorageEntry;
  after: ResidenceStorageEntry;
}

export interface ResidenceStorageChange {
  before: ResidenceStorageEntry;
  after: ResidenceStorageEntry;
}

export interface ResidenceStorageDiff {
  added: ResidenceStorageEntry[];
  changed: ResidenceStorageChange[];
  removed: ResidenceStorageEntry[];
  moved: ResidenceStorageMove[];
}

export interface ResidenceStorageReconciliation {
  snapshot: ResidenceStorageSnapshot;
  diff: ResidenceStorageDiff;
}

export interface ResidenceStorageCapabilities {
  watchHints: boolean;
  changeCursor: boolean;
  stableObjectIds: boolean;
  providerReplicationConfirmation: boolean;
  sharedDrives: boolean;
  nativeDocuments: boolean;
  remotePermissions: boolean;
}

export interface ResidenceBlob {
  ref: string;
  path: string;
  bytes: Uint8Array;
  contentHash: string;
  revision: string | null;
}

export interface ResidenceWriteTarget {
  path: string;
}

export interface ResidenceWriteOptions {
  ifAbsent?: boolean;
  ifContentHash?: string;
  ifRevision?: string;
}

export interface ResidenceWriteReceipt {
  status: 'written' | 'unchanged';
  ref: string;
  path: string;
  contentHash: string;
  revision: string | null;
  providerReplication: ProviderReplicationStatus;
}

export interface ResidenceRemoveOptions {
  ifContentHash?: string;
  ifRevision?: string;
}

export interface ResidenceRemoveReceipt {
  status: 'removed' | 'already_absent';
  ref: string | null;
  path: string;
  providerReplication: ProviderReplicationStatus;
}

export interface ResidenceStorageAdapter {
  readonly backendKind: string;
  snapshot(scope?: ResidenceStorageScope): Promise<ResidenceStorageSnapshot>;
  diff(
    previous: ResidenceStorageSnapshot,
    scope?: ResidenceStorageScope,
  ): Promise<ResidenceStorageReconciliation>;
  read(ref: string): Promise<ResidenceBlob | null>;
  write(
    target: ResidenceWriteTarget,
    bytes: Uint8Array,
    options?: ResidenceWriteOptions,
  ): Promise<ResidenceWriteReceipt>;
  remove(
    target: ResidenceWriteTarget,
    options?: ResidenceRemoveOptions,
  ): Promise<ResidenceRemoveReceipt>;
  capabilities(): ResidenceStorageCapabilities;
}
```

- [ ] **Step 5: Define the normalized error taxonomy**

`packages/residence-storage/src/errors.ts`:

```ts
export type ResidenceStorageErrorCode =
  | 'not_found'
  | 'permission_denied'
  | 'conflict'
  | 'temporarily_unavailable'
  | 'rate_limited'
  | 'invalid_path_or_ref'
  | 'integrity_mismatch'
  | 'unsupported_operation'
  | 'authentication_required'
  | 'unknown_backend_error';

export class ResidenceStorageError extends Error {
  constructor(
    readonly code: ResidenceStorageErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ResidenceStorageError';
  }
}
```

- [ ] **Step 6: Implement byte hashing without changing canonical JSON hashing**

`packages/residence-storage/src/hash.ts`:

```ts
export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}
```

Do not reuse `@arcp/schema`'s canonical JSON hash for file bytes; the semantics are different.

- [ ] **Step 7: Export the package and wire the workspace dependency**

`packages/residence-storage/src/index.ts`:

```ts
export * from './types.js';
export * from './errors.js';
export * from './hash.js';
```

Add `"@arcp/residence-storage": "workspace:*"` to root `devDependencies`, then run:

```bash
pnpm install
```

- [ ] **Step 8: Verify GREEN and commit**

Run:

```bash
pnpm vitest run tests/unit/residence-storage-contract.test.ts
pnpm test
pnpm typecheck
```

Expected: all pass.

Commit:

```bash
git add packages/residence-storage package.json pnpm-lock.yaml tests/unit/residence-storage-contract.test.ts
git commit -m "feat: define provider-neutral residence storage contract"
```

---

### Task 2: Snapshot diff semantics and in-memory executable oracle

**Files:**
- Create: `packages/residence-storage/src/diff.ts`
- Create: `packages/residence-storage/src/in-memory.ts`
- Modify: `packages/residence-storage/src/index.ts`
- Create: `tests/helpers/residence-storage-conformance.ts`
- Create: `tests/integration/residence-storage-parity.test.ts`

**Interfaces:**
- Consumes: all Task 1 types.
- Produces: `diffResidenceSnapshots()`, `emptyResidenceDiff()`, `InMemoryResidenceStorageAdapter`, `runResidenceStorageConformance()`.

- [ ] **Step 1: Write RED tests for stable-ref diffing and common adapter behavior**

The helper `tests/helpers/residence-storage-conformance.ts` must export:

```ts
import { expect } from 'vitest';
import type { ResidenceStorageAdapter } from '@arcp/residence-storage';

export async function runResidenceStorageConformance(makeAdapter: () => Promise<ResidenceStorageAdapter>): Promise<void> {
  const adapter = await makeAdapter();
  const bytes = new TextEncoder().encode('hello');
  const first = await adapter.write({ path: 'notes/a.txt' }, bytes, { ifAbsent: true });
  expect(first.status).toBe('written');
  expect(first.contentHash.startsWith('sha256:')).toBe(true);

  const blob = await adapter.read(first.ref);
  expect(blob?.bytes).toEqual(bytes);

  await expect(adapter.write({ path: 'notes/a.txt' }, new TextEncoder().encode('other'), { ifAbsent: true }))
    .rejects.toMatchObject({ code: 'conflict' });

  const baseline = await adapter.snapshot();
  await adapter.write({ path: 'notes/b.txt' }, new TextEncoder().encode('second'));
  const reconciliation = await adapter.diff(baseline);
  expect(reconciliation.diff.added.map((entry) => entry.path)).toContain('notes/b.txt');

  const removed = await adapter.remove({ path: 'notes/b.txt' });
  expect(removed.status).toBe('removed');
  const removedAgain = await adapter.remove({ path: 'notes/b.txt' });
  expect(removedAgain.status).toBe('already_absent');
}
```

`tests/integration/residence-storage-parity.test.ts` initially imports the not-yet-created in-memory adapter and invokes the helper inside a Vitest test.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run tests/integration/residence-storage-parity.test.ts
```

Expected: FAIL because `InMemoryResidenceStorageAdapter` and diff helpers do not exist.

- [ ] **Step 3: Implement deterministic diff semantics**

`diffResidenceSnapshots(previous, current)` must:

1. index entries by `ref`;
2. classify a stable `ref` whose path changed as `moved`;
3. classify a stable `ref` whose path stayed the same but content hash, size, modified timestamp, or revision changed as `changed`;
4. classify unseen refs as `added` and vanished refs as `removed`;
5. sort every output array deterministically by the relevant path.

Use this public signature:

```ts
export function diffResidenceSnapshots(
  previous: ResidenceStorageSnapshot,
  current: ResidenceStorageSnapshot,
): ResidenceStorageDiff;
```

- [ ] **Step 4: Implement the in-memory reference adapter**

Use an internal `Map<string, { ref: string; bytes: Uint8Array; modifiedAt: string; revision: number }>` keyed by normalized relative path. The adapter must:

- return `backendKind = 'memory'`;
- create refs as `memory:${encodeURIComponent(path)}`;
- compute content hashes with `sha256Bytes()`;
- return entries sorted by path;
- clone all returned byte arrays;
- enforce `ifAbsent`, `ifContentHash`, and `ifRevision` before mutation;
- report `providerReplication: 'unknown'`;
- throw `ResidenceStorageError('conflict', ..., false)` on failed preconditions;
- return `already_absent` without throwing when deleting a missing path;
- use `diffResidenceSnapshots()` for `diff()`.

Expose a test-only mutation helper named exactly:

```ts
applyExternalWrite(path: string, bytes: Uint8Array): Promise<void>
```

It represents backend-side change evidence and does not perform ARCP canonical mutation.

- [ ] **Step 5: Export, verify conformance, and commit**

Run:

```bash
pnpm vitest run tests/integration/residence-storage-parity.test.ts
pnpm test
pnpm typecheck
```

Commit:

```bash
git add packages/residence-storage tests/helpers/residence-storage-conformance.ts tests/integration/residence-storage-parity.test.ts
git commit -m "feat: add residence storage reference semantics"
```

---

### Task 3: Remove Google-specific assumptions from generic tests

**Files:**
- Modify: `tests/unit/adapters.test.ts`
- Keep unchanged for now: `packages/adapters/drive/src/index.ts`

**Interfaces:**
- Consumes: Task 2 provider-neutral oracle.
- Produces: generic adapter tests that no longer claim Phase 2 must use Drive Changes API.

- [ ] **Step 1: Add a regression assertion before removing the old test block**

In `tests/integration/residence-storage-parity.test.ts`, add an explicit test that an external deletion appears only as reconciliation evidence:

```ts
it('reports backend removal as evidence without performing any canonical action', async () => {
  const adapter = new InMemoryResidenceStorageAdapter();
  await adapter.write({ path: 'paper.md' }, new TextEncoder().encode('draft'));
  const baseline = await adapter.snapshot();
  await adapter.remove({ path: 'paper.md' });
  const result = await adapter.diff(baseline);
  expect(result.diff.removed.map((entry) => entry.path)).toEqual(['paper.md']);
});
```

- [ ] **Step 2: Run the regression test GREEN before migration**

```bash
pnpm vitest run tests/integration/residence-storage-parity.test.ts
```

- [ ] **Step 3: Delete only the `FakeDriveAdapter` section from `tests/unit/adapters.test.ts`**

Remove the import of `FakeDriveAdapter`/`FakeDriveFile` and the entire `describe('FakeDriveAdapter', ...)` block. Keep CTCL and model tests unchanged.

Do not delete `packages/adapters/drive` yet; Google Drive API behavior is migrated in Task 9 before removal.

- [ ] **Step 4: Verify no generic test is Drive-shaped and commit**

Run:

```bash
pnpm test
pnpm typecheck
```

Commit:

```bash
git add tests/unit/adapters.test.ts tests/integration/residence-storage-parity.test.ts
git commit -m "test: move residence semantics out of Google-shaped fake"
```

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
- Create: `tests/unit/synced-filesystem-path-guard.test.ts`
- Create: `tests/unit/synced-filesystem-adapter.test.ts`
- Modify: `tests/integration/residence-storage-parity.test.ts`

**Interfaces:**
- Consumes: `ResidenceStorageAdapter`, `ResidenceStorageSnapshot`, `ResidenceStorageError`, `sha256Bytes()`, `diffResidenceSnapshots()`.
- Produces: `SyncedFilesystemAdapter`, `assertResidenceRelativePath()`, `resolveResidencePath()`.

- [ ] **Step 1: Write failing path-boundary tests**

Create a temporary root with `mkdtemp()` and assert rejection for each of these target paths:

```ts
[
  '../escape.txt',
  'nested/../../escape.txt',
  '/absolute.txt',
  '\\server\\share\\escape.txt',
  'C:\\escape.txt',
  'nested\\windows-style.txt',
  'bad\0name.txt',
]
```

Also create a symlink inside the root pointing outside the root when the platform permits it; accessing through that symlink must reject with `code: 'invalid_path_or_ref'`. If the OS denies symlink creation due to permissions, skip only that one assertion with Vitest's runtime skip mechanism; do not weaken the production guard.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run tests/unit/synced-filesystem-path-guard.test.ts
```

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Implement strict normalized relative paths**

`assertResidenceRelativePath(path)` must accept only POSIX-style relative paths. It must reject empty write paths, absolute paths, Windows drive-qualified strings, backslashes, NUL, `.` segments, and `..` segments.

`resolveResidencePath(rootRealPath, relativePath)` must:

- call `assertResidenceRelativePath(relativePath)`;
- join path segments under the real root;
- use `lstat`/`realpath` for existing entries;
- reject any symbolic link/junction encountered in the path;
- for a not-yet-existing write target, resolve and verify the real parent directory before returning the child target path.

The first implementation does not follow symlinks.

- [ ] **Step 4: Write failing snapshot/read tests**

`tests/unit/synced-filesystem-adapter.test.ts` must create:

```text
root/
  notes/
    a.txt  -> "hello"
  z.txt    -> "last"
```

Assert:

- snapshot entries are deterministic and path-sorted;
- directory and file kinds are distinct;
- file content hashes are SHA-256 hashes of raw bytes;
- refs are `fs:${encodeURIComponent(relativePath)}`;
- `read(ref)` returns copied bytes;
- missing refs return `null`;
- capabilities advertise `watchHints: true`, `changeCursor: false`, `stableObjectIds: false`, and `providerReplicationConfirmation: false`.

- [ ] **Step 5: Implement scan and read**

`scanResidenceRoot(rootRealPath, prefix)` must use `readdir({ withFileTypes: true })`, fail closed on symlinks, create normalized `/`-separated relative paths, compute hashes for files, and sort entries by path.

`SyncedFilesystemAdapter` constructor:

```ts
constructor(options: { root: string; now?: () => Date })
```

Resolve `root` to an absolute real path during initialization. If the root is missing or not a directory, throw `ResidenceStorageError('invalid_path_or_ref', ..., false)`.

`read(ref)` must accept only `fs:` refs created by this adapter and re-run containment checks before reading.

- [ ] **Step 6: Add synced filesystem to the common conformance suite**

In `tests/integration/residence-storage-parity.test.ts`, add a backend factory that creates a fresh temporary directory and returns a `SyncedFilesystemAdapter` rooted there. Run the same `runResidenceStorageConformance()` helper once Task 5 completes writes/removes; until then add only snapshot/read assertions in this task's focused test.

- [ ] **Step 7: Verify and commit**

```bash
pnpm vitest run tests/unit/synced-filesystem-path-guard.test.ts tests/unit/synced-filesystem-adapter.test.ts
pnpm test
pnpm typecheck
```

Commit:

```bash
git add packages/adapters/synced-filesystem package.json pnpm-lock.yaml tests/unit/synced-filesystem-path-guard.test.ts tests/unit/synced-filesystem-adapter.test.ts tests/integration/residence-storage-parity.test.ts
git commit -m "feat: add root-scoped synced filesystem observation"
```

---

### Task 5: Synced-filesystem writes, removals, conflict detection, and integrity verification

**Files:**
- Modify: `packages/adapters/synced-filesystem/src/adapter.ts`
- Modify: `packages/adapters/synced-filesystem/src/scan.ts`
- Modify: `tests/unit/synced-filesystem-adapter.test.ts`
- Modify: `tests/integration/residence-storage-parity.test.ts`

**Interfaces:**
- Consumes: Task 4 adapter and Task 1 write/remove contracts.
- Produces: complete common-contract conformance for synced filesystem.

- [ ] **Step 1: Write failing mutation/precondition tests**

Add tests for:

1. first write creates parent directories and returns `written`;
2. writing identical bytes returns `unchanged` after hash verification;
3. `ifAbsent: true` conflicts when the target exists;
4. `ifContentHash` conflicts when an external writer changed the file;
5. remove with matching `ifContentHash` succeeds;
6. repeated remove returns `already_absent`;
7. every successful local write/remove receipt reports `providerReplication: 'unknown'`;
8. post-write hash mismatch raises `integrity_mismatch` and never claims success.

For item 8, inject a test hook into the adapter:

```ts
interface SyncedFilesystemAdapterOptions {
  root: string;
  now?: () => Date;
  afterWriteBeforeVerify?: (absolutePath: string) => Promise<void>;
}
```

The production default is no hook. The test hook overwrites the file between the atomic replacement and verification to prove the mismatch path.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run tests/unit/synced-filesystem-adapter.test.ts
```

- [ ] **Step 3: Implement pre-write verification and same-directory atomic replacement**

For a file write:

1. validate/resolve the target and real parent;
2. read current content hash if a precondition requires it;
3. reject stale `ifAbsent`/`ifContentHash`/`ifRevision` before mutation;
4. compute intended SHA-256;
5. if existing verified hash already equals intended hash, return `unchanged`;
6. write bytes to a temporary file in the same target directory using a name containing `process.pid` and `randomUUID()`;
7. close the temp file before replacement;
8. rename the temp file to the target;
9. invoke the optional test hook;
10. force-read and hash the final target;
11. throw `integrity_mismatch` if final hash differs from intended hash;
12. return `written`, with `providerReplication: 'unknown'`.

Always clean up an unrenamed temp file in `finally`.

- [ ] **Step 4: Implement staged hash reuse for scans**

Maintain an adapter-local cache keyed by path with `{ size, mtimeMs, contentHash }`.

During an ordinary scan, reuse the prior hash only when `size` and `mtimeMs` are unchanged. During write preconditions and post-write verification, force a real byte hash even if metadata is unchanged.

This optimization must never be used as proof for a high-integrity write precondition without a forced hash.

- [ ] **Step 5: Implement remove semantics**

`remove({ path }, options)` must:

- resolve the root-contained path;
- return `already_absent` if missing;
- reject directory removal with `unsupported_operation` in this MVP;
- force-hash and enforce `ifContentHash` before unlinking;
- reject non-null `ifRevision` when no matching filesystem revision exists;
- unlink the file and return `providerReplication: 'unknown'`.

- [ ] **Step 6: Run shared conformance against both backends**

Enable the `SyncedFilesystemAdapter` factory in `tests/integration/residence-storage-parity.test.ts` so the same helper runs for memory and filesystem.

Run:

```bash
pnpm vitest run tests/unit/synced-filesystem-adapter.test.ts tests/integration/residence-storage-parity.test.ts
pnpm test
pnpm typecheck
```

- [ ] **Step 7: Commit**

```bash
git add packages/adapters/synced-filesystem tests/unit/synced-filesystem-adapter.test.ts tests/integration/residence-storage-parity.test.ts
git commit -m "feat: make synced filesystem mutations conflict-aware"
```

---

### Task 6: Watcher hints plus periodic reconciliation

**Files:**
- Create: `packages/adapters/synced-filesystem/src/watch-hints.ts`
- Create: `packages/adapters/synced-filesystem/src/reconciler.ts`
- Modify: `packages/adapters/synced-filesystem/src/index.ts`
- Create: `tests/unit/synced-filesystem-reconciler.test.ts`

**Interfaces:**
- Consumes: `SyncedFilesystemAdapter.diff()`.
- Produces: `ResidenceWatchHintSource`, `NodeFsWatchHintSource`, `ResidenceReconciler`.

- [ ] **Step 1: Write RED tests using a fake hint source**

Define the public hint interface:

```ts
export interface ResidenceWatchHintSource {
  start(onHint: () => void, signal: AbortSignal): Promise<void>;
}
```

Tests must prove:

- `reconcileOnce(previous)` finds a missed change even when no watcher hint fired;
- a hint requests a fast reconciliation;
- multiple hints within one debounce window collapse into one scan;
- periodic reconciliation still runs after the hint source fails;
- aborting stops future scans cleanly.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run tests/unit/synced-filesystem-reconciler.test.ts
```

- [ ] **Step 3: Implement `NodeFsWatchHintSource`**

Use `fs.watch(root, { recursive: true, signal })` only to call `onHint()`.

If `fs.watch` throws because the filesystem/platform cannot provide the watcher, resolve `start()` without converting that into storage failure. Periodic reconciliation remains active.

Do not use watcher event filenames as authoritative paths and do not translate a watcher `rename` event directly into deletion.

- [ ] **Step 4: Implement `ResidenceReconciler`**

Constructor:

```ts
constructor(options: {
  adapter: ResidenceStorageAdapter;
  hintSource?: ResidenceWatchHintSource;
  intervalMs: number;
  debounceMs: number;
})
```

Public methods:

```ts
reconcileOnce(previous: ResidenceStorageSnapshot): Promise<ResidenceStorageReconciliation>;
start(
  initial: ResidenceStorageSnapshot,
  onReconciliation: (result: ResidenceStorageReconciliation) => Promise<void>,
  signal: AbortSignal,
): Promise<void>;
```

`start()` must run the interval path whether or not watcher startup succeeds. Emit only non-empty diffs, but always advance the internal snapshot baseline after a successful scan.

- [ ] **Step 5: Verify and commit**

```bash
pnpm vitest run tests/unit/synced-filesystem-reconciler.test.ts
pnpm test
pnpm typecheck
```

Commit:

```bash
git add packages/adapters/synced-filesystem tests/unit/synced-filesystem-reconciler.test.ts
git commit -m "feat: reconcile synced filesystem beyond watcher hints"
```

---

### Task 7: Local residence bridge boundary

**Files:**
- Create: `packages/residence-bridge/package.json`
- Create: `packages/residence-bridge/src/bridge.ts`
- Create: `packages/residence-bridge/src/index.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `tests/integration/residence-bridge.test.ts`

**Interfaces:**
- Consumes: `ResidenceStorageAdapter`, `ResidenceStorageSnapshot`, `ResidenceStorageReconciliation`.
- Produces: `ResidenceObservation`, `ResidenceObservationSink`, `ResidenceBridge`.

- [ ] **Step 1: Write RED bridge tests**

Define the expected observation contract in the test:

```ts
export interface ResidenceObservation {
  residenceId: string;
  backendKind: string;
  observedAt: string;
  reconciliation: ResidenceStorageReconciliation;
}

export interface ResidenceObservationSink {
  publish(observation: ResidenceObservation): Promise<void>;
}
```

Test with `InMemoryResidenceStorageAdapter` and a fake sink. Assert:

- unchanged reconciliation publishes nothing;
- a backend-side write publishes one observation;
- a backend-side removal publishes one removal observation rather than deleting any ARCP manifest;
- the bridge returns the new snapshot baseline after each run.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run tests/integration/residence-bridge.test.ts
```

- [ ] **Step 3: Implement the bridge without Cloudflare coupling**

`ResidenceBridge` constructor:

```ts
constructor(options: {
  residenceId: string;
  adapter: ResidenceStorageAdapter;
  sink: ResidenceObservationSink;
})
```

Public method:

```ts
async reconcile(previous: ResidenceStorageSnapshot): Promise<ResidenceStorageSnapshot>
```

It calls `adapter.diff(previous)`, publishes only when at least one of `added/changed/removed/moved` is non-empty, and returns `result.snapshot`.

Do not import `@arcp/control-plane-core`, Cloudflare bindings, or D1/R2 from this package. The network transport that eventually implements `ResidenceObservationSink` belongs to a later control-plane integration slice.

- [ ] **Step 4: Verify and commit**

```bash
pnpm vitest run tests/integration/residence-bridge.test.ts
pnpm test
pnpm typecheck
```

Commit:

```bash
git add packages/residence-bridge package.json pnpm-lock.yaml tests/integration/residence-bridge.test.ts
git commit -m "feat: add local residence observation bridge"
```

---

### Task 8: Google Drive v3 credential-free HTTP transport

**Files:**
- Create: `packages/adapters/google-drive-api/package.json`
- Create: `packages/adapters/google-drive-api/src/types.ts`
- Create: `packages/adapters/google-drive-api/src/http-transport.ts`
- Create: `packages/adapters/google-drive-api/src/index.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `tests/helpers/fake-google-drive-fetch.ts`
- Create: `tests/unit/google-drive-http-transport.test.ts`

**Interfaces:**
- Consumes: `ResidenceStorageError` only for normalized transport failures.
- Produces: `AccessTokenProvider`, `GoogleDriveFileRecord`, `GoogleDriveChangeRecord`, `GoogleDriveTransport`, `FetchGoogleDriveTransport`.

- [ ] **Step 1: Write RED transport tests with no network**

Public auth boundary:

```ts
export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}
```

Public transport boundary:

```ts
export interface GoogleDriveTransport {
  getStartPageToken(driveId?: string): Promise<string>;
  listChanges(pageToken: string, driveId?: string): Promise<{
    changes: GoogleDriveChangeRecord[];
    nextPageToken: string | null;
    newStartPageToken: string | null;
  }>;
  listChildren(parentId: string, pageToken?: string, driveId?: string): Promise<{
    files: GoogleDriveFileRecord[];
    nextPageToken: string | null;
  }>;
  download(fileId: string): Promise<Uint8Array>;
  createFile(parentId: string, name: string, bytes: Uint8Array): Promise<GoogleDriveFileRecord>;
  updateFile(fileId: string, bytes: Uint8Array): Promise<GoogleDriveFileRecord>;
  deleteFile(fileId: string): Promise<void>;
}
```

Tests must prove:

- `Authorization: Bearer token-for-test` is attached;
- `getStartPageToken()` parses `startPageToken`;
- `listChanges()` preserves `nextPageToken` and `newStartPageToken`;
- child listings request `supportsAllDrives=true` and `includeItemsFromAllDrives=true`;
- 401 maps to `authentication_required`;
- 403 maps to `permission_denied` unless the response represents a retryable quota/rate condition;
- 429 maps to retryable `rate_limited`;
- 5xx maps to retryable `temporarily_unavailable`;
- malformed successful JSON fails closed as `unknown_backend_error`.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run tests/unit/google-drive-http-transport.test.ts
```

- [ ] **Step 3: Implement exact Drive transport records**

`GoogleDriveFileRecord`:

```ts
export interface GoogleDriveFileRecord {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  modifiedTime: string | null;
  size: string | null;
  md5Checksum: string | null;
  sha256Checksum: string | null;
  trashed: boolean;
}
```

`GoogleDriveChangeRecord`:

```ts
export interface GoogleDriveChangeRecord {
  fileId: string;
  removed: boolean;
  file: GoogleDriveFileRecord | null;
}
```

- [ ] **Step 4: Implement Fetch transport against Drive API v3**

Base origin is fixed internally to `https://www.googleapis.com` and path prefix to `/drive/v3`.

Use `changes.getStartPageToken` semantics through `GET /drive/v3/changes/startPageToken`, and use `GET /drive/v3/changes?pageToken=...` for change polling. Follow `nextPageToken` in the adapter layer, not inside one transport call.

Use `files.list` with an escaped parent-id query, explicit `fields`, and Drive-support flags for tree traversal. Use `alt=media` for ordinary binary/text downloads.

For create/update, use Drive upload endpoints through the same injected Fetch function. The first adapter supports ordinary byte-backed files; Google-native Docs/Sheets/Slides remain explicitly `nativeDocuments: false` and `read()` raises `unsupported_operation` for their MIME types.

- [ ] **Step 5: Export, verify, and commit**

```bash
pnpm vitest run tests/unit/google-drive-http-transport.test.ts
pnpm test
pnpm typecheck
```

Commit:

```bash
git add packages/adapters/google-drive-api package.json pnpm-lock.yaml tests/helpers/fake-google-drive-fetch.ts tests/unit/google-drive-http-transport.test.ts
git commit -m "feat: add credential-free Google Drive v3 transport"
```

---

### Task 9: Google Drive API adapter, scoped tree snapshot, cursor-driven reconciliation, and common conformance

**Files:**
- Create: `packages/adapters/google-drive-api/src/tree.ts`
- Create: `packages/adapters/google-drive-api/src/adapter.ts`
- Modify: `packages/adapters/google-drive-api/src/index.ts`
- Create: `tests/unit/google-drive-adapter.test.ts`
- Modify: `tests/integration/residence-storage-parity.test.ts`

**Interfaces:**
- Consumes: `GoogleDriveTransport`, provider-neutral storage contract/diff helper.
- Produces: `GoogleDriveApiAdapter`.

- [ ] **Step 1: Write RED adapter tests over a fake transport**

Constructor:

```ts
constructor(options: {
  transport: GoogleDriveTransport;
  rootId: string;
  driveId?: string;
  now?: () => Date;
})
```

Tests must prove:

- a recursive Drive tree becomes normalized relative paths beneath `rootId`;
- refs use stable Drive file IDs: `gdrive:${fileId}`;
- moved files with the same file ID are classified as `moved`, not removed+added;
- snapshot cursor is acquired **before** full tree enumeration;
- `diff(previous)` drains all `nextPageToken` pages from the previous snapshot cursor;
- when the change feed has no changes, it returns the previous entries with the advanced cursor and an empty diff without rebuilding the entire tree;
- when the feed reports one or more changes, the adapter rebuilds the scoped tree, compares stable IDs, and uses the drained `newStartPageToken` as the next baseline cursor;
- removals are output evidence only;
- ordinary files support read/write/remove;
- Google-native MIME types reject byte `read()` with `unsupported_operation`;
- capabilities advertise `changeCursor: true`, `stableObjectIds: true`, `providerReplicationConfirmation: true`, `watchHints: false`, `nativeDocuments: false`;
- `sharedDrives` is true when `driveId` is configured and false otherwise.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run tests/unit/google-drive-adapter.test.ts
```

- [ ] **Step 3: Implement scoped tree reconstruction**

`listGoogleDriveTree(transport, rootId, driveId)` must breadth-first traverse folders using `listChildren()`, following every list-page token. It must:

- never expose `rootId` itself as a child path;
- build child paths from parent paths using `/` separators;
- reject duplicate normalized paths that refer to different Drive IDs as `conflict` instead of silently choosing one;
- ignore records marked `trashed` in the current tree snapshot;
- sort results by path.

Map Drive records to provider-neutral entries:

- `ref = gdrive:${id}`;
- folder MIME type -> `kind: 'directory'`;
- byte-backed file -> `kind: 'file'`;
- `size` parsed safely to a number when representable, otherwise `null`;
- `revision` uses the strongest available provider metadata string available from the returned record;
- `contentHash` prefers `sha256Checksum`, then `md5Checksum` prefixed with `md5:`; if no provider checksum exists, keep `null` until a byte read is required.

- [ ] **Step 4: Implement race-safe baseline cursor ordering**

`snapshot()` must call `getStartPageToken()` before the full tree enumeration. That may cause a later diff to re-observe a change that happened during the full listing, which is acceptable; the provider-neutral diff removes duplicates by comparing the resulting states. It must not obtain the start token only after the tree listing, because that could create a blind interval.

- [ ] **Step 5: Implement change-cursor reconciliation**

`diff(previous)`:

1. if `previous.cursor === null`, fall back to a new full snapshot plus `diffResidenceSnapshots()`;
2. call `listChanges(previous.cursor, driveId)` and follow `nextPageToken` until exhausted;
3. remember the terminal `newStartPageToken`;
4. if zero relevant changes were reported, return a snapshot with the previous entries and terminal cursor plus an empty diff;
5. if relevant changes exist, rebuild the scoped tree and use the terminal cursor for the rebuilt snapshot;
6. calculate the provider-neutral diff by stable Drive refs.

Do not use a change event itself as proof of canonical deletion.

- [ ] **Step 6: Implement ordinary byte-file mutations**

For `write({ path }, bytes, options)`:

- resolve existing path from the current Drive tree;
- enforce `ifAbsent`, `ifContentHash`, and `ifRevision` from provider metadata/read hash where available;
- update the existing file when present or create it under the resolved parent folder when absent;
- after provider response, read back/hash when the provider did not return a SHA-256 checksum;
- return `providerReplication: 'provider-confirmed'` only after the provider operation succeeds;
- never claim ARCP canonical commit.

For `remove()`, enforce preconditions, call provider delete, and return `provider-confirmed`; missing targets return `already_absent`.

- [ ] **Step 7: Run the shared conformance suite against a fixture-backed Drive transport**

Add a `GoogleDriveApiAdapter` factory to `tests/integration/residence-storage-parity.test.ts` using an in-memory/fake `GoogleDriveTransport`, not the network.

Run:

```bash
pnpm vitest run tests/unit/google-drive-adapter.test.ts tests/integration/residence-storage-parity.test.ts
pnpm test
pnpm typecheck
```

- [ ] **Step 8: Commit**

```bash
git add packages/adapters/google-drive-api tests/unit/google-drive-adapter.test.ts tests/integration/residence-storage-parity.test.ts
git commit -m "feat: implement optional Google Drive residence backend"
```

---

### Task 10: Retire the old fake Drive package and document backend selection

**Files:**
- Delete: `packages/adapters/drive/package.json`
- Delete: `packages/adapters/drive/src/index.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `README.md`
- Create: `docs/examples/residence-storage.synced-filesystem.json`
- Create: `docs/examples/residence-storage.google-drive-api.json`

**Interfaces:**
- Consumes: all Phase 2 packages.
- Produces: one public Phase 2 architecture with two selectable first-class backends and no fourth legacy API.

- [ ] **Step 1: Write a package-import regression test before deleting the old package**

Add to `tests/unit/residence-storage-contract.test.ts` imports of both final adapters and assert their backend kinds:

```ts
import { SyncedFilesystemAdapter } from '@arcp/adapter-synced-filesystem';
import { GoogleDriveApiAdapter } from '@arcp/adapter-google-drive-api';
```

Use temporary/fake constructor dependencies so the test does not need a local user path or network.

- [ ] **Step 2: Remove `@arcp/adapter-drive` from root dependencies and delete the package**

Delete only after Task 9 tests are GREEN. Regenerate the lockfile:

```bash
pnpm install
```

Search the repository:

```bash
git grep -n "FakeDriveAdapter\|FakeDriveFile\|@arcp/adapter-drive\|the real adapter (Phase 2) implements"
```

Expected: no hits.

- [ ] **Step 3: Add non-secret example configurations**

`docs/examples/residence-storage.synced-filesystem.json`:

```json
{
  "residence_storage": {
    "backend": "synced-filesystem",
    "root_env": "ARCP_RESIDENCE_ROOT",
    "reconciliation_interval_ms": 30000,
    "watch_debounce_ms": 500
  }
}
```

`docs/examples/residence-storage.google-drive-api.json`:

```json
{
  "residence_storage": {
    "backend": "google-drive-api",
    "root_id_env": "ARCP_GOOGLE_DRIVE_ROOT_ID",
    "drive_id_env": "ARCP_GOOGLE_DRIVE_SHARED_DRIVE_ID",
    "credential_provider": "external-access-token-provider"
  }
}
```

Do not commit values for any of those environment variables.

- [ ] **Step 4: Update README architecture/status**

README must explicitly say:

- synced filesystem is the recommended local-first route for users who already run a sync client;
- Google Drive API is optional for headless/cloud-only users or users who do not want a desktop sync client;
- a local write does not mean cloud upload confirmation;
- Google Drive API OAuth is not needed for the synced-filesystem route;
- Cloudflare remains the control plane and does not read the desktop filesystem;
- `@arcp/adapter-drive` has been replaced by the provider-neutral contract plus the optional Drive API adapter.

- [ ] **Step 5: Verify and commit**

```bash
pnpm test
pnpm typecheck
git grep -n "@arcp/adapter-drive\|FakeDriveAdapter\|FakeDriveFile" -- . ':!docs/superpowers/specs/2026-08-17-phase2-pluggable-residence-storage-design.md' ':!docs/superpowers/plans/2026-08-17-phase2-residence-storage-implementation.md'
```

Expected: no code/config hits.

Commit:

```bash
git add -A
git commit -m "docs: finalize pluggable Phase 2 residence backends"
```

---

### Task 11: Full verification, PR readiness, and explicit live Google gate

**Files:**
- Modify only documentation if verification reveals documentation drift.

**Interfaces:**
- Produces: verified credential-free Phase 2 PR checkpoint.

- [ ] **Step 1: Fresh install verification**

Run from repository root:

```bash
pnpm install --frozen-lockfile
```

Expected: success.

- [ ] **Step 2: Fresh full test verification**

```bash
pnpm test
```

Expected: every test file and test passes, including the shared residence-storage parity suite for memory, synced filesystem, and fixture-backed Google Drive API.

- [ ] **Step 3: Fresh typecheck**

```bash
pnpm typecheck
```

Expected: success with no TypeScript errors.

- [ ] **Step 4: Security/path regression verification**

Run:

```bash
pnpm vitest run tests/unit/synced-filesystem-path-guard.test.ts tests/unit/synced-filesystem-adapter.test.ts
```

Expected: all traversal, absolute-path, symlink/junction, stale-precondition, and integrity mismatch cases pass.

- [ ] **Step 5: Google transport regression verification without credentials**

```bash
pnpm vitest run tests/unit/google-drive-http-transport.test.ts tests/unit/google-drive-adapter.test.ts
```

Expected: all tests pass using fake Fetch/transport only. No network or OAuth consent is required.

- [ ] **Step 6: Update PR #3 body with the verified counts and mark implementation complete**

Keep PR Draft while Tasks 1-10 are in progress. Once the fresh checks above are green, update PR #3 with the exact test-file/test counts from the run and mark it ready for review.

### Gate B — first live Google Drive API activation

Do **not** block merge of the credential-free Phase 2 architecture on this gate.

Run this gate only when a real deployment chooses `google-drive-api`:

1. choose the production auth implementation that satisfies `AccessTokenProvider`;
2. complete the required human Google authorization/consent outside Git;
3. configure `ARCP_GOOGLE_DRIVE_ROOT_ID` and, only for Shared Drive mode, `ARCP_GOOGLE_DRIVE_SHARED_DRIVE_ID` outside Git;
4. add a separately gated live integration test that creates a disposable file under the configured test root, reads it, updates it, observes it through the change cursor, and deletes it;
5. verify cleanup even after a failed assertion;
6. record only non-secret verification results in the PR/operations log.

The synced-filesystem route never enters Gate B.

---

## Plan self-review result

- **Spec coverage:** provider-neutral contract, both first-class backend routes, canonicality separation, local bridge boundary, watcher + reconciliation, root/symlink safety, hashing/conflicts, optional Google auth, change cursors, migration of the old Drive fake, config/docs, and explicit live gate all have concrete tasks.
- **Placeholder scan:** no implementation step depends on a `TBD`, `TODO`, secret value, user-specific absolute path, or unspecified provider choice.
- **Type consistency:** later tasks use the exact Task 1 `ResidenceStorageAdapter`/snapshot/diff/receipt names; Google and filesystem adapters both target the same contract and the same conformance helper.
- **Scope:** D1/R2/Worker control-plane implementation and model-provider work remain outside Phase 2. The only bridge work here is the provider-neutral observation boundary; network publishing into the control plane remains a later integration slice.
