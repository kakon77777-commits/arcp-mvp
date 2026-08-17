# ARCP-MVP

Internal single-owner implementation of **ARCP × CTCL v0.1** — the Agent Residence
Continuity Protocol, scoped to the MVP defined in
[`arcp_ctcl_internal_web_mvp_implementation_spec_v0.1.md`](../arcp/arcp_ctcl_internal_web_mvp_implementation_spec_v0.1.md).

See [`arcp_series_dependency_map_and_build_roadmap_v0.1.md`](../arcp/arcp_series_dependency_map_and_build_roadmap_v0.1.md)
for the full document dependency map and phase-by-phase build plan this repo follows,
and [`docs/superpowers/plans/2026-08-17-phase1-control-plane-foundation.md`](docs/superpowers/plans/2026-08-17-phase1-control-plane-foundation.md)
for the detailed Phase 1 task/gate log.

## Status: Phase 1 — live on Cloudflare

- Phase 0 (schema, policy engine, in-memory coordinator, fake adapters): done.
- Phase 1 Tasks 1-5B (control-plane HTTP core, coordinator transport, D1/R2
  storage adapters, per-Agent Durable Object, Worker entrypoint): done.
- **Gate A (first real deploy): done** — live at
  `https://arcp-mvp-control-plane.neokpolaris.workers.dev`, backed by a real
  D1 database and R2 bucket, verified end to end including a direct query of
  the remote D1 database confirming a wake event actually persisted.
- Gate B (Google Drive OAuth) and Gate C (live model provider) not started —
  both are explicit, credential-gated steps in the Phase 1 plan.

## Packages

```
packages/
  arcp-schema/          stable IDs, canonical JSON + SHA-256 hashing, core types
  policy-engine/         R0-R4 risk matrix, deterministic Permit() evaluation
  coordinator/            per-agent state machine, lease/fencing, in-memory store
  control-plane-core/     platform-neutral HTTP core, coordinator transport, storage ports
  adapters/
    ctcl/                  fake CTCL time adapter (deterministic instants)
    drive/                 fake Google Drive adapter (fixture-backed)
    model/                  fake model adapter (scripted decisions)
    cloudflare/             D1/R2 storage adapters, Durable Object, Worker entrypoint
migrations/d1/           D1 schema migrations
```

## Commands

```
pnpm install
pnpm test
pnpm typecheck
```

## Deploying (Cloudflare)

`packages/adapters/cloudflare/wrangler.jsonc` is a **template only** — every
database ID, bucket name, and the `compatibility_date` are `REPLACE_ME_*`
placeholders, and it stays that way in git (this is a public repo).

Real deploys use a gitignored `wrangler.local.jsonc` in the same directory,
built from the template with actual resource IDs filled in:

```
cd packages/adapters/cloudflare
npx wrangler d1 create arcp-mvp-metadata          # once, if not already provisioned
npx wrangler r2 bucket create arcp-mvp-objects    # once, if not already provisioned
# copy wrangler.jsonc -> wrangler.local.jsonc, fill in the real IDs it printed
npx wrangler d1 migrations apply arcp-mvp-metadata --config wrangler.local.jsonc --remote
npx wrangler deploy --config wrangler.local.jsonc
```

Never fill real IDs into the tracked `wrangler.jsonc` — regenerate
`wrangler.local.jsonc` instead.
