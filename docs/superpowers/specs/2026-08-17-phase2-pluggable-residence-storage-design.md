# Phase 2 Pluggable Residence Storage Design

**Status:** Design for review  
**Date:** 2026-08-17  
**Project:** ARCP MVP  
**Decision:** Approach A — one Phase 2, multiple first-class residence-storage backends in the same repository

## 1. Purpose

Phase 2 must stop treating Google Drive API as the only future residence-storage path.

ARCP's protocol responsibility is to preserve and reconcile residence state. It should not require every deployment to use the same transport, credential model, or synchronization product.

The revised Phase 2 therefore introduces a provider-neutral residence storage boundary with two first-class initial backends:

1. **Synced Filesystem Residence** — recommended for local-first deployments that already expose a synchronized directory through the operating system.
2. **Google Drive API Residence** — optional cloud-native/headless backend for deployments that do not want a local sync client or need Google-specific capabilities.

The existing Google Drive direction is retained, but demoted from protocol assumption to optional backend implementation.

## 2. Core architectural decision

ARCP core must depend on a provider-neutral contract:

```text
ARCP Residence Runtime
        |
        v
ResidenceStorageAdapter
        |
        +--> SyncedFilesystemAdapter
        |        +--> Google Drive for desktop
        |        +--> OneDrive
        |        +--> Dropbox
        |        +--> Syncthing
        |        +--> NAS/local replication
        |        +--> other mounted/synchronized folders
        |
        +--> GoogleDriveApiAdapter
                 +--> OAuth / service account
                 +--> Drive Changes API
                 +--> Shared Drives
                 +--> Google-native metadata/capabilities
```

The protocol must never infer that a specific backend is canonical merely because it is Google Drive, a mounted folder, or a remote API.

Canonical role, lineage, policy, lease/fencing, commit semantics, and ARCP event history remain owned by ARCP.

## 3. Terminology

### 3.1 Residence storage backend

A component that can observe and/or mutate a storage namespace used by an ARCP residence.

A backend is a transport/storage capability, not an authority over ARCP identity or truth.

### 3.2 Local synchronized filesystem

A normal filesystem path visible to the local ARCP process whose contents may also be synchronized by an external product.

Examples include a mirrored Google Drive directory, OneDrive folder, Dropbox folder, Syncthing directory, or NAS-backed mounted path.

ARCP does **not** assume that a successful local write means the cloud provider has already uploaded the bytes.

### 3.3 Cloud API backend

A backend that talks directly to a provider's remote API and therefore owns provider authentication, pagination, rate-limit handling, remote change cursors, and provider-specific metadata translation.

## 4. Product modes

A residence chooses a backend per residence configuration, not globally for the entire ARCP installation.

### Mode A — Local synced folder

Recommended default for local-first deployments.

```text
Local ARCP Agent
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
- ordinary filesystem semantics are easy to inspect and recover;
- keeps local operation available when the cloud API is unavailable;
- aligns with ARCP local-first residence semantics.

Limitations:

- requires a local machine/process and a mounted directory;
- remote sync completion is external and may be eventual;
- provider-native permissions, revisions, comments, Shared Drive metadata, and Google-native document semantics are not automatically available.

### Mode B — Google Drive API

Recommended for headless/cloud-only deployments or deployments that explicitly need Google-specific features.

Advantages:

- does not require Google Drive for desktop;
- can operate when no user's desktop machine is online;
- supports Drive-native change cursors, permissions, Shared Drives, and provider metadata;
- suitable for server-side workers/bridges that cannot access a user's local filesystem.

Limitations:

- requires OAuth or another approved authentication mode;
- must handle token lifecycle, provider rate limits, API semantics, and provider outages;
- is Google-specific and therefore must remain behind the common interface.

## 5. Backend contract

Phase 2 should introduce a new package-level contract instead of extending the current `FakeDriveAdapter` directly.

Suggested conceptual interface:

```ts
interface ResidenceStorageAdapter {
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

Exact names may change during implementation, but the following semantics are required.

### 5.1 Snapshot

A snapshot is an observed backend state, not an ARCP canonical commit.

It should contain enough stable metadata to reconcile later:

- backend-specific stable reference when available;
- normalized relative path;
- file/directory type;
- size;
- modification metadata;
- content hash when known;
- backend revision/cursor when available;
- observation timestamp and source.

### 5.2 Diff

Diff reports observed `added`, `changed`, `removed`, and where necessary `renamed/moved` candidates.

Backend diff output is evidence for reconciliation. It must not directly tombstone canonical ARCP objects without the ARCP reconciliation/policy layer deciding that outcome.

### 5.3 Read/write/remove

Every mutation returns a receipt. A successful storage write means only that the selected backend accepted/completed the operation according to its own contract.

It does not by itself mean:

```text
storage write success
    == cloud replica confirmed
    == ARCP canonical commit
    == policy approval
    == lineage update
```

These states must remain distinguishable.

## 6. SyncedFilesystemAdapter design

### 6.1 Root boundary

The adapter receives an explicitly configured root, e.g. `ARCP_SYNC_ROOT`.

Every normalized path must remain inside that root after resolving separators, `.`/`..`, symlinks, junctions, and platform-specific path forms.

Directory traversal outside the configured residence root is rejected.

### 6.2 Provider blindness

The adapter must not contain Google-, OneDrive-, Dropbox-, or Syncthing-specific logic in its core path.

Its job is ordinary filesystem observation and mutation.

Provider-specific status integrations, if ever added, belong in optional capability/status adapters.

### 6.3 Detection model

Do not rely on `fs.watch` alone.

The adapter uses two complementary mechanisms:

```text
fast path: filesystem watcher
slow correctness path: periodic reconciliation scan
```

Watcher events reduce latency but are treated as hints.

A reconciliation scan re-enumerates the scoped residence, normalizes entries, and compares hashes/metadata with the last accepted observation baseline.

This protects against:

- coalesced or dropped filesystem notifications;
- cloud-sync tools that perform temporary-file + rename sequences;
- bulk updates;
- process restarts;
- offline changes arriving later;
- network-mounted filesystem notification differences.

### 6.4 Hashing strategy

Content hash is the strongest portable identity signal for file content, but hashing every large file on every scan is unnecessarily expensive.

The implementation should support staged comparison:

1. compare normalized path/type/size/mtime-like metadata;
2. reuse prior content hash when metadata proves unchanged under the adapter's local rules;
3. compute/recompute SHA-256 when a file is new, suspicious, changed, or required for a canonical transition;
4. never treat metadata equality alone as proof of content equality in a high-integrity transition if the content hash is required.

### 6.5 Sync completion

The generic filesystem adapter does not claim remote synchronization completion.

If the residence needs a stronger signal, that signal must be represented separately, for example:

```text
local_write_committed
external_sync_unknown
external_sync_pending
external_sync_confirmed
external_sync_failed
```

The first Phase 2 implementation does not need to implement provider-specific sync-status detection. It only needs to avoid falsely claiming it.

### 6.6 Conflict model

If an external sync system changes a file while ARCP is also preparing a write, the adapter must surface the conflict/revision mismatch rather than silently using last-write-wins as truth.

Where filesystem APIs cannot provide provider-grade CAS, ARCP should use pre-write observation checks plus post-write verification and record enough evidence to classify ambiguous races.

## 7. GoogleDriveApiAdapter design

The previous Drive direction remains supported but is reframed as one implementation of `ResidenceStorageAdapter`.

It may provide additional capabilities beyond the minimum common contract, including:

- Drive Changes API cursor-based discovery;
- stable Drive file IDs;
- Shared Drive support;
- revision metadata;
- permissions/ownership metadata;
- Google-native document export/import handling;
- provider-side checksums where available.

Provider-specific capabilities are discoverable through `capabilities()` and must not leak into the base protocol contract.

### 7.1 Authentication

Authentication is an activation gate for this backend only.

A deployment using only `SyncedFilesystemAdapter` must not need Google OAuth configuration.

A deployment enabling `GoogleDriveApiAdapter` must explicitly select and configure its authentication mode before the first live call.

### 7.2 Changes API

The existing conceptual `diffAgainst` behavior can be retained internally, but the public Phase 2 contract should no longer be named or typed around Google Drive files.

Drive change tokens/cursors are backend-private optimization/state and are translated into provider-neutral diff records.

## 8. Migration of the existing FakeDriveAdapter

The current package contains `FakeDriveAdapter`, `FakeDriveFile`, and `DriveDiff` with comments stating that the real Phase 2 implementation will use the Drive Changes API.

That assumption should be removed.

Recommended migration:

1. introduce provider-neutral test fixtures such as `InMemoryResidenceStorageAdapter` or equivalent;
2. migrate generic contract tests from `FakeDriveAdapter` to the provider-neutral fake;
3. keep Drive-specific fixture types only inside Google Drive adapter tests;
4. retain the old behavior through git history and, if useful, a short migration note rather than maintaining a second long-lived Phase 2 branch;
5. implement the Google Drive API adapter later against the same common contract.

This preserves the old route without forcing the entire project to remain Google-shaped.

## 9. Relationship with Phase 1 Cloudflare runtime

Phase 1 now has a live Cloudflare control plane with D1/R2/Worker/Durable Object infrastructure.

Phase 2 storage backends must not assume the Cloudflare Worker can directly access a user's desktop filesystem.

For local synced residence mode, the architecture therefore requires a local bridge/process:

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

The local bridge is responsible for filesystem access. Cloudflare remains the control/coordination plane.

For Google Drive API mode, an authorized server-side component may call the provider API directly without a desktop bridge, subject to policy and secret handling.

## 10. Canonicality and authority invariants

The following invariants are non-negotiable.

### 10.1 Backend state is not canonical by itself

```text
Observed backend object != canonical ARCP object
```

An observed file becomes part of canonical residence state only through ARCP reconciliation/commit rules.

### 10.2 External deletion is evidence, not immediate erasure

A file disappearing from a synced folder or Drive listing creates a removal observation.

It must not silently cascade into irreversible canonical deletion.

### 10.3 External synchronization is not ARCP replication

Google Drive Desktop, OneDrive, Dropbox, Syncthing, etc. may replicate bytes, but that is not automatically equivalent to an ARCP replica with verified lineage and recovery semantics.

### 10.4 Storage success is not policy success

The model/agent must not gain permission merely because the backend can technically write or delete a file.

Policy evaluation remains outside the storage adapter.

### 10.5 Backend change must not rewrite identity

A residence may migrate from synced filesystem to Google Drive API, or vice versa, without changing the canonical Agent identity merely because the storage transport changed.

## 11. Backend selection and configuration

Suggested residence configuration shape:

```json
{
  "residence_storage": {
    "backend": "synced-filesystem",
    "root": "<local configured path>",
    "reconciliation_interval_ms": 30000
  }
}
```

or:

```json
{
  "residence_storage": {
    "backend": "google-drive-api",
    "drive_root_ref": "<provider-specific root reference>",
    "credential_ref": "<secret-store reference>"
  }
}
```

Sensitive credentials and machine-specific absolute paths should not be committed to the public repository.

Configuration templates may contain placeholders and documented environment-variable references.

## 12. Error model

Backend errors should be normalized into a small provider-neutral taxonomy while preserving original diagnostic context for audit logs.

Minimum classes:

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

The generic filesystem backend normally will not emit `rate_limited` or `authentication_required`, while Google Drive API may.

Callers must not need Google-specific error codes to decide ordinary ARCP control flow.

## 13. Testing strategy

### 13.1 Shared contract suite

Create one reusable backend conformance suite and run it against:

- in-memory reference backend;
- `SyncedFilesystemAdapter` using a temporary directory;
- Google Drive API fake/fixture backend;
- later live adapters behind explicit integration gates.

Shared assertions should cover:

- deterministic snapshot normalization;
- add/change/remove detection;
- read/write/remove receipts;
- path/ref isolation;
- conflict behavior;
- hash verification;
- idempotent retry semantics where applicable;
- no silent canonicality assumptions.

### 13.2 Filesystem-specific tests

Include:

- traversal rejection;
- symlink/junction escape handling;
- atomic-replace/rename patterns;
- dropped/coalesced watcher simulation followed by reconciliation recovery;
- concurrent external modification detection;
- restart and baseline reconstruction;
- large-file staged hashing behavior.

### 13.3 Drive-specific tests

Include:

- pagination/change cursor progression;
- expired/invalid cursor recovery;
- OAuth/auth-required behavior;
- rate limiting/retry signaling;
- Shared Drive identity/reference translation;
- Drive-native object capability differences;
- no provider-specific metadata leakage into generic callers.

## 14. Delivery sequence

### Phase 2A — provider-neutral contract

- create common storage types and interface;
- create in-memory reference adapter;
- create shared conformance tests;
- migrate generic tests away from Google-shaped fake types.

### Phase 2B — synced filesystem backend

- implement root-scoped filesystem adapter;
- implement snapshot + diff + read/write/remove;
- implement watcher hints plus reconciliation;
- implement integrity/hash verification;
- add local bridge integration boundary.

### Phase 2C — Google Drive API optional backend

- preserve/reuse Drive-specific conceptual work;
- implement provider API translation behind the common contract;
- only then activate OAuth/live integration gate;
- add live tests separately from default local test suite.

This order allows ARCP to become useful immediately on machines with existing synchronized folders without removing the future headless/cloud-only option.

## 15. Non-goals for the first implementation

The first Phase 2 implementation does not need to:

- prove that Google Drive Desktop has finished uploading a local write;
- support every synchronization provider's proprietary status API;
- expose Google Docs editing semantics through the generic filesystem backend;
- merge ARCP D1/R2 storage and residence storage into one abstraction;
- make Cloudflare Workers read local filesystem paths directly;
- implement automatic cross-backend migration in the same PR;
- treat arbitrary synchronized folders as trusted canonical state without reconciliation.

## 16. Success criteria

Phase 2 is considered structurally successful when:

1. ARCP core has no Google Drive-specific type dependency for residence storage.
2. A residence can choose `synced-filesystem` or `google-drive-api` without changing core control logic.
3. The synced filesystem route requires no Google OAuth.
4. The Google Drive API route remains supported as an optional first-class backend rather than abandoned legacy code.
5. Shared contract tests prove both backends conform to the same provider-neutral semantics.
6. Filesystem watcher loss can be healed by reconciliation.
7. External storage changes cannot silently bypass ARCP policy/canonical commit semantics.
8. Backend selection does not redefine Agent identity or lineage.
9. Cloudflare remains a control plane; local filesystem access is isolated to the local bridge/runtime.
10. Future backends such as OneDrive API, S3/WebDAV, NAS, or another sync provider can be added without redesigning ARCP core.

## 17. Final design statement

Phase 2 should no longer mean "Google Drive integration".

It should mean:

> **ARCP Pluggable Residence Storage: one residence protocol, multiple storage/synchronization backends.**

The local synchronized filesystem is the recommended local-first path. Google Drive API remains a full optional cloud-native path. Neither backend owns ARCP canonical truth; both provide observations and storage capabilities to the same residence continuity system.
