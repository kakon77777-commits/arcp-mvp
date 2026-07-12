# ARCP-MVP

Internal single-owner implementation of **ARCP × CTCL v0.1** — the Agent Residence
Continuity Protocol, scoped to the MVP defined in
[`arcp_ctcl_internal_web_mvp_implementation_spec_v0.1.md`](../arcp/arcp_ctcl_internal_web_mvp_implementation_spec_v0.1.md).

See [`arcp_series_dependency_map_and_build_roadmap_v0.1.md`](../arcp/arcp_series_dependency_map_and_build_roadmap_v0.1.md)
for the full document dependency map and phase-by-phase build plan this repo follows.

## Status: Phase 0 — Schema & local simulator

Per the MVP spec's Phase 0 acceptance criteria:

- Replaying the same event sequence produces the same commit root hash.
- Illegal state transitions and duplicate actions are rejected.

No cloud dependency. Everything in this phase runs in-memory with fake adapters.

## Packages

```
packages/
  arcp-schema/       stable IDs, canonical JSON + SHA-256 hashing, core types
  policy-engine/      R0-R4 risk matrix, deterministic Permit() evaluation
  coordinator/        per-agent state machine, lease/fencing, in-memory store
  adapters/
    ctcl/              fake CTCL time adapter (deterministic instants)
    drive/             fake Google Drive adapter (fixture-backed)
    model/              fake model adapter (scripted decisions)
```

## Commands

```
pnpm install
pnpm test
pnpm typecheck
```
