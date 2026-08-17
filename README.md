# ARCP-MVP

Internal single-owner implementation of **ARCP × CTCL v0.1** — the Agent Residence
Continuity Protocol, scoped to the MVP defined in
[`arcp_ctcl_internal_web_mvp_implementation_spec_v0.1.md`](../arcp/arcp_ctcl_internal_web_mvp_implementation_spec_v0.1.md).

See [`arcp_series_dependency_map_and_build_roadmap_v0.1.md`](../arcp/arcp_series_dependency_map_and_build_roadmap_v0.1.md)
for the full document dependency map and phase-by-phase build plan,
[`docs/superpowers/plans/2026-08-17-phase1-control-plane-foundation.md`](docs/superpowers/plans/2026-08-17-phase1-control-plane-foundation.md)
for Phase 1, and
[`docs/superpowers/specs/2026-08-17-phase2-pluggable-residence-storage-design.md`](docs/superpowers/specs/2026-08-17-phase2-pluggable-residence-storage-design.md)
for the Phase 2 residence-storage design.

## Status: Phase 2 — pluggable residence storage

- Phase 0 (schema, policy engine, in-memory coordinator, fake adapters): done.
- Phase 1 control-plane foundation and Gate A: done and live on Cloudflare.
- Phase 2 provider-neutral residence storage, synced-filesystem backend, reconciliation,
  local observation bridge, and optional Google Drive API backend: implemented.
- The default/recommended local-first route is **synced filesystem** for users who
  already run Google Drive for desktop, OneDrive, Dropbox, Syncthing, NAS sync, or
  another local synchronization client.
- The **Google Drive API** route is optional for headless/cloud-only deployments or
  users who do not want to depend on a desktop sync client.
- Google OAuth is **not required** for the synced-filesystem route. A real Google
  authorization flow is an activation gate only for deployments that explicitly
  select `google-drive-api`.

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

## Packages

```text
packages/
  arcp-schema/                    stable IDs, canonical JSON + SHA-256 hashing, core types
  policy-engine/                  R0-R4 risk matrix, deterministic Permit() evaluation
  coordinator/                    per-Agent state machine, lease/fencing, in-memory store
  control-plane-core/             platform-neutral HTTP core, coordinator transport, storage ports
  residence-storage/              provider-neutral residence contract, diff/error/hash semantics
  residence-bridge/               local storage-observation publishing boundary; no canonical authority
  adapters/
    ctcl/                          fake CTCL time adapter (deterministic instants)
    model/                         fake model adapter (scripted decisions)
    cloudflare/                    D1/R2 storage adapters, Durable Object, Worker entrypoint
    synced-filesystem/             recommended local-first residence backend
    google-drive-api/              optional Drive v3 transport + residence backend
migrations/d1/                    D1 schema migrations
```

## Residence storage selection

Synced filesystem example:

```text
docs/examples/residence-storage.synced-filesystem.json
```

It reads the root from `ARCP_RESIDENCE_ROOT`; the actual local path is never committed
to Git.

Optional Google Drive API example:

```text
docs/examples/residence-storage.google-drive-api.json
```

It refers only to environment-variable names for the Drive root/shared-drive IDs and
an external access-token provider. No token, OAuth client secret, Drive ID, or user
path belongs in the tracked configuration.

## Commands

```text
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
```

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
