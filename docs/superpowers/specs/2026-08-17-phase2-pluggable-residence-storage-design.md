# Phase 2 Pluggable Residence Storage Design

**Status:** Design for review  
**Date:** 2026-08-17  
**Project:** ARCP MVP  
**Decision:** Approach A — one Phase 2, multiple first-class residence-storage backends in the same repository

## 1. Purpose

Phase 2 must stop treating Google Drive API as the only future residence-storage path.

ARCP's protocol responsibility is to preserve and reconcile residence state. It should not require every deployment to use the same transport, credential model, or synchronization product.

The revised Phase 2 introduces a provider-neutral residence storage boundary with two first-class initial backends:

1. **Synced Filesystem Residence** — recommended for local-first deployments that already expose a synchronized directory through the operating system.
2. **Google Drive API Residence** — optional cloud-native/headless backend for deployments that do not want a local sync client or need Google-specific capabilities.

The existing Google Drive direction is retained, but moves from protocol assumption to optional backend implementation.

## 2. Core architecture

```text
ARCP Residence Runtime
        |
        v
@arcp/residence-storage
ResidenceStorageAdapter
        |
        +--> @arcp/adapter-synced-filesystem
        |        +--> Google Drive for desktop
        |        +--> OneDrive
        |        +--> Dropbox
        |        +--> Syncthing
        |        +--> NAS/local replication
        |        +--> other mounted/synchronized folders
        |
        +--> @arcp/adapter-google-drive-api
                 +--> OAuth / service account
                 +--> Drive Changes API
                 +--> Shared Drives
                 +--> Google-native metadata/capabilities
```

ARCP must never infer that a backend is canonical merely because it is Google Drive, a mounted folder, or a remote API.

Canonical role, lineage, policy, lease/fencing, commit semantics, and ARCP event history remain owned by ARCP.

## 3. Fixed package boundaries

The first implementation uses these package names and responsibilities.

### `packages/residence-storage` → `@arcp/residence-storage`

Owns only provider-neutral contracts and reference semantics:

- `ResidenceStorageAdapter`
- provider-neutral snapshot/diff/ref/receipt/error/capability types
- `InMemoryResidenceStorageAdapter`
- reusable backend conformance test helpers where practical

It must not import Google APIs, Node filesystem APIs, Cloudflare bindings, OAuth libraries, or synchronization-provider SDKs.

### `packages/adapters/synced-filesystem` → `@arcp/adapter-synced-filesystem`

Owns local filesystem observation/mutation:

- root confinement
- snapshot/diff
- read/write/remove
- content hashing
- watcher hints
- periodic reconciliation
- filesystem conflict detection

It must remain provider-blind. Google Drive for desktop, OneDrive, Dropbox, Syncthing, and similar products appear only as external sync transports around the same filesystem adapter.

### `packages/adapters/google-drive-api` → `@arcp/adapter-google-drive-api`

Owns direct Google Drive integration:

- authentication boundary
- Drive Changes API
- Drive file IDs and cursors
- pagination/rate limits
- Shared Drives
- Google-native metadata/capabilities
- translation into provider-neutral residence-storage records

### Existing `packages/adapters/drive`

This package is a **migration source**, not a fourth permanent backend.

Its current fake Drive types/behavior will be split as follows:

- generic fixture behavior migrates into `@arcp/residence-storage` as `InMemoryResidenceStorageAdapter`;
- Drive-specific fixture concepts migrate into `@arcp/adapter-google-drive-api` tests;
- once downstream imports are migrated and tests are green, `packages/adapters/drive` is removed from the active workspace;
- git history and PR history retain the original Google-first design.

No second long-lived Phase 2 branch is maintained for the old design.

## 4. Terminology

### 4.1 Residence storage backend

A component that observes and/or mutates a storage namespace used by an ARCP residence.

A backend is a transport/storage capability, not an authority over ARCP identity or truth.

### 4.2 Local synchronized filesystem

A normal filesystem path visible to the local ARCP process whose contents may also be synchronized by an external product.

Examples include a mirrored Google Drive directory, OneDrive folder, Dropbox folder, Syncthing directory, or NAS-backed mounted path.

ARCP does **not** assume that a successful local write means the external provider has already replicated the bytes.

### 4.3 Cloud API backend

A backend that talks directly to a provider's remote API and therefore owns provider authentication, pagination, rate-limit handling, remote change cursors, and provider-specific metadata translation.

## 5. Product modes

A residence chooses its backend per residence configuration, not globally for the entire ARCP installation.

### Mode A — Local synced folder

Recommended default for local-first deployments.

```text
Local ARCP Agent / Bridge
      |
      v
SyncedFilesystemAdapter
      |
      v
Local synchronized directory
      |
      v
External sync product
      |
      v
Cloud / peer replicas
```

Advantages:

- no ARCP-owned OAuth flow;
- works with multiple sync vendors using one adapter;
- ordinary filesystem semantics are inspectable and recoverable;
- local operation can continue when a provider API is unavailable;
- aligns with local-first residence semantics.

Limitations:

- requires a local process and mounted directory;
- remote sync completion is external and may be eventual;
- provider-native permissions, revisions, comments, Shared Drive metadata, and Google-native document semantics are not automatically available.

### Mode B — Google Drive API

Recommended for headless/cloud-only deployments or deployments explicitly requiring Google-specific features.

Advantages:

- no Google Drive for desktop requirement;
- can operate when the user's desktop is offline;
- supports Drive-native change cursors, permissions, Shared Drives, and provider metadata;
- suitable for server-side components that cannot access a user's local filesystem.

Limitations:

- requires an approved authentication mode;
- must handle token lifecycle, provider rate limits, API semantics, and provider outages;
- remains Google-specific behind the common interface.

## 6. Provider-neutral backend contract

`@arcp/residence-storage` defines this public contract shape:

```ts
export interface ResidenceStorageAdapter {
  readonly backendKind: string;

  snapshot(scope: ResidenceStorageScope): Promise<ResidenceStorageSnapshot>;

  diff(
    previous: ResidenceStorageSnapshot,
    scope: ResidenceStorageScope,
  ): Promise<ResidenceStorageDiff>;

  read(ref: ResidenceStorageRef): Promise<ResidenceBlob | null>;

  write(
    target: ResidenceStorageTarget,
    bytes: Uint8Array,
    options: ResidenceWriteOptions,
  ): Promise<ResidenceWriteReceipt>;

  remove(
    target: ResidenceStorageTarget,
    options: ResidenceRemoveOptions,
  ): Promise<ResidenceRemoveReceipt>;

  capabilities(): ResidenceStorageCapabilities;
}
```

These names are fixed for the Phase 2 implementation plan. Later revisions may version the interface, but Phase 2 does not rename them opportunistically during coding.

### 6.1 Snapshot

A snapshot is an observed backend state, not an ARCP canonical commit.

It contains enough stable metadata for later reconciliation:

- backend-specific stable reference when available;
- normalized relative path;
- entry kind;
- size;
- modification metadata;
- content hash when known;
- backend revision/cursor when available;
- observation timestamp and source/backend kind.

### 6.2 Diff

Diff reports `added`, `changed`, `removed`, and `moved` candidates.

Backend diff output is reconciliation evidence. It must not directly tombstone canonical ARCP objects without the ARCP reconciliation/policy layer deciding the canonical transition.

### 6.3 Read/write/remove

Every mutation returns a receipt.

A successful storage write means only that the selected backend completed or accepted the operation under its backend contract.

It does not imply:

```text
storage write success
    == external replica confirmed
    == ARCP canonical commit
    == policy approval
    == lineage update
```

These states remain distinguishable.

## 7. `SyncedFilesystemAdapter`

### 7.1 Root boundary

The adapter receives an explicitly configured root such as `ARCP_SYNC_ROOT`.

Every resolved path must remain inside that root after handling separators, `.`/`..`, symlinks, junctions, and platform-specific path behavior.

Traversal or resolved escapes are rejected.

### 7.2 Provider blindness

The adapter contains no Google-, OneDrive-, Dropbox-, or Syncthing-specific control path.

Its responsibility is ordinary filesystem observation and mutation.

Provider-specific sync-status integrations, if later desired, are separate optional capabilities and do not alter the base adapter.

### 7.3 Detection model

Do not rely on `fs.watch` alone.

Use:

```text
fast path: filesystem watcher hint
slow correctness path: periodic reconciliation scan
```

Watcher events reduce latency but are non-authoritative hints.

A reconciliation scan re-enumerates the scoped residence, normalizes entries, and compares them with the accepted observation baseline.

This covers:

- coalesced/dropped notifications;
- temporary-file + rename patterns;
- bulk updates;
- process restarts;
- offline changes arriving later;
- network-mounted filesystem notification differences.

### 7.4 Hashing strategy

Use staged comparison:

1. compare normalized path/type/size/mtime-like metadata;
2. reuse a prior content hash only under explicit unchanged-metadata rules;
3. compute/recompute SHA-256 for new, suspicious, changed, or canonical-transition-relevant files;
4. never use metadata equality alone as high-integrity proof of content equality when a content hash is required.

### 7.5 Sync completion

The generic filesystem backend does not claim external/cloud synchronization completion.

ARCP keeps local persistence and external sync state conceptually separate:

```text
local_write_committed
external_sync_unknown
external_sync_pending
external_sync_confirmed
external_sync_failed
```

Phase 2B only guarantees `local_write_committed` plus ARCP reconciliation evidence. Provider-specific external sync confirmation is out of scope for the first implementation.

### 7.6 Conflict model

If an external synchronizer changes a file while ARCP prepares a write, the adapter surfaces a conflict/revision mismatch instead of silently accepting last-write-wins as truth.

Where filesystem APIs cannot provide provider-grade CAS, Phase 2 uses pre-write observation checks plus post-write verification and records ambiguous races as conflicts.

## 8. `GoogleDriveApiAdapter`

The previous Drive direction remains fully supported as `@arcp/adapter-google-drive-api`.

It may expose capabilities beyond the minimum common contract:

- Drive Changes API cursor discovery;
- stable Drive file IDs;
- Shared Drives;
- revision metadata;
- permissions/ownership metadata;
- Google-native document export/import handling;
- provider-side checksums where available.

These are surfaced through `capabilities()` or backend-private helpers and do not leak into generic ARCP callers.

### 8.1 Authentication

Authentication is an activation gate for this backend only.

A deployment using only `SyncedFilesystemAdapter` requires no Google OAuth configuration.

A deployment enabling `GoogleDriveApiAdapter` must select and configure its authentication mode before its first live API call.

### 8.2 Changes API

The old `diffAgainst` idea may be reused internally, but public Phase 2 types are never `FakeDriveFile`/`DriveDiff`.

Drive change tokens/cursors remain backend-private state translated into provider-neutral snapshots and diffs.

## 9. Relationship with the live Phase 1 Cloudflare runtime

Phase 1 already has a live Cloudflare control plane with Worker, Durable Object, D1, and R2 infrastructure.

Phase 2 must not assume the Worker can directly access a user's desktop filesystem.

Local synced residence therefore requires a local bridge/process:

```text
Cloudflare Control Plane
          |
          | authenticated ARCP protocol messages
          v
Local Residence Bridge / Local Agent
          |
          v
SyncedFilesystemAdapter
          |
          v
Local synced directory
```

Cloudflare remains the control/coordination plane. The local bridge owns filesystem access.

For Google Drive API mode, an authorized server-side component may call Google directly without a desktop bridge, subject to policy and secret handling.

Phase 2 residence storage does not replace Phase 1 D1/R2 responsibilities. D1/R2 remain control-plane metadata/object infrastructure; residence backends represent external/persistent residence storage domains.

## 10. Canonicality and authority invariants

### 10.1 Backend state is not canonical by itself

```text
Observed backend object != canonical ARCP object
```

An observed file enters canonical residence state only through ARCP reconciliation/commit rules.

### 10.2 External deletion is evidence, not immediate erasure

A file disappearing from a synced folder or Drive listing creates a removal observation. It must not silently cascade into irreversible canonical deletion.

### 10.3 External synchronization is not ARCP replication

Google Drive for desktop, OneDrive, Dropbox, Syncthing, etc. may replicate bytes, but byte replication is not automatically an ARCP replica with verified lineage/recovery semantics.

### 10.4 Storage capability is not authority

The model/agent gains no permission merely because a backend can technically write or delete a file. Policy evaluation stays outside storage adapters.

### 10.5 Backend change does not rewrite identity

A residence may change storage backend without changing canonical Agent identity merely because its transport changed.

## 11. Backend selection and configuration

Synced filesystem example:

```json
{
  "residence_storage": {
    "backend": "synced-filesystem",
    "root_env": "ARCP_SYNC_ROOT",
    "reconciliation_interval_ms": 30000
  }
}
```

Google Drive API example:

```json
{
  "residence_storage": {
    "backend": "google-drive-api",
    "drive_root_ref_env": "ARCP_DRIVE_ROOT_REF",
    "credential_ref": "secret://arcp/google-drive"
  }
}
```

Machine-specific absolute paths, credentials, tokens, and provider resource IDs are never committed to the public repository.

Templates use environment-variable/secret references rather than real values.

## 12. Provider-neutral error model

All adapters normalize failures into:

- `not_found`
- `permission_denied`
- `conflict`
- `temporarily_unavailable`
- `rate_limited`
- `invalid_path_or_ref`
- `integrity_mismatch`
- `unsupported_operation`
- `authentication_required`
- `unknown_backend_error`

Original provider diagnostics may be attached for audit/debugging, but ordinary ARCP control flow never requires Google-specific error codes.

## 13. Testing strategy

### 13.1 Reusable conformance suite

One shared backend conformance suite runs against:

- `InMemoryResidenceStorageAdapter`;
- `SyncedFilesystemAdapter` with a temporary directory;
- Google Drive API fake transport/fixture implementation;
- optional live adapters behind explicit integration gates.

Shared assertions cover:

- deterministic snapshot normalization;
- add/change/remove/move detection;
- read/write/remove receipts;
- path/ref isolation;
- conflict behavior;
- hash verification;
- idempotent retries where applicable;
- no silent canonicality assumptions.

### 13.2 Filesystem-specific tests

Include:

- traversal rejection;
- symlink/junction escape rejection;
- atomic-replace/rename patterns;
- dropped/coalesced watcher hints healed by reconciliation;
- concurrent external modification detection;
- restart/baseline reconstruction;
- staged hashing behavior for large files.

### 13.3 Drive-specific tests

Include:

- pagination/change cursor progression;
- expired/invalid cursor recovery;
- authentication-required behavior;
- rate-limit/retry signaling;
- Shared Drive reference translation;
- Google-native capability differences;
- no provider-specific metadata leakage into generic callers.

## 14. Delivery sequence

### Phase 2A — provider-neutral contract

Implement in this order:

1. `packages/residence-storage` package and fixed public types/interface;
2. `InMemoryResidenceStorageAdapter`;
3. reusable conformance tests;
4. migrate generic uses/tests away from `FakeDriveAdapter`;
5. keep Drive-specific fixtures isolated for the later Google adapter.

### Phase 2B — synced filesystem backend

1. create `packages/adapters/synced-filesystem`;
2. root confinement;
3. snapshot/diff/read/write/remove;
4. staged hashing;
5. watcher hints + reconciliation;
6. conflict/precondition/post-write verification;
7. local bridge integration contract.

### Phase 2C — Google Drive API optional backend

1. create `packages/adapters/google-drive-api`;
2. migrate useful Drive-specific fixture concepts from the old adapter;
3. implement API translation behind `ResidenceStorageAdapter`;
4. keep live authentication disabled by default;
5. activate OAuth/service-account gate only for live integration testing;
6. remove the old `packages/adapters/drive` package after import migration and full-test verification.

This ordering makes the local synced-folder route usable without abandoning headless/cloud-only deployments.

## 15. Non-goals for the first implementation

Phase 2 does not attempt to:

- prove that Google Drive for desktop finished uploading a local write;
- support every sync provider's proprietary status API;
- expose Google Docs editing semantics through the generic filesystem backend;
- merge Phase 1 D1/R2 storage and residence storage into one abstraction;
- make Cloudflare Workers read local filesystem paths directly;
- implement automatic cross-backend migration in the same PR;
- treat arbitrary synchronized folders as trusted canonical state without reconciliation.

## 16. Success criteria

Phase 2 is structurally successful when:

1. ARCP core has no Google Drive-specific type dependency for residence storage.
2. A residence can select `synced-filesystem` or `google-drive-api` without changing core control logic.
3. The synced filesystem route requires no Google OAuth.
4. Google Drive API remains an optional first-class backend rather than abandoned legacy code.
5. Shared conformance tests prove common semantics across the reference backend and real adapters.
6. Filesystem watcher loss is healed by reconciliation.
7. External storage changes cannot silently bypass ARCP policy/canonical commit semantics.
8. Backend selection does not redefine Agent identity or lineage.
9. Cloudflare remains control plane; local filesystem access remains isolated to local runtime/bridge.
10. A future OneDrive API, S3/WebDAV, NAS-specific, or other backend can be added without redesigning ARCP core.
11. `packages/adapters/drive` is retired only after its generic and Google-specific responsibilities have migrated and all tests remain green.

## 17. Final design statement

Phase 2 no longer means "Google Drive integration".

It means:

> **ARCP Pluggable Residence Storage: one residence protocol, multiple storage and synchronization backends.**

The local synchronized filesystem is the recommended local-first path. Google Drive API remains a full optional cloud-native path. Neither backend owns ARCP canonical truth; both provide observations and storage capabilities to the same residence continuity system.
