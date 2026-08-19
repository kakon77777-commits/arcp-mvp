# ARCP Theory & Roadmap Corpus

Ten documents Neo wrote (originally 2026-07-12, roadmap updated through 2026-08-19).
Mirrored into this repo 2026-08-19 after a real cross-AI-collaboration gap: these
lived only in a local folder outside git, and a collaborator reading via GitHub
had no way to see them or verify their content. **This copy is the canonical,
git-tracked version for ARCP-MVP work.** The originals continue to live at
`D:\Ai\work together\arcp\` on Neo's machine as a cross-project workspace (several
of these documents, especially the residence-building guide, are referenced by
projects outside ARCP-MVP too); if the source theory itself is revised there,
re-copy the changed file here rather than editing two divergent copies.

## Two tracks, one parallel implementation track

### Theory/normative track (5 documents, single dependency chain)

```text
digital_residence_intelligent_continuity_ontology_v1.0.md
  (most upstream — defines the H_t nine-tuple, five kinds of continuity, five memory-source categories)
        |
promptless_event_driven_network_native_agent_v1.0.md
  (event-driven wake replacing prompts, the Omega wake operator, an L0-L5 autonomy model)
        |
digital_residence_rights_migration_refusal_governance_v1.0.md
  (evidence-graded governance over residence operations, refusal-governance spectrum, R0-R5 maturity)
        |
cloud_sync_subjectivity_infrastructure_hybrid_agent_continuity_v1.0.md
  (six consistency tiers for local-cloud sync needing causal/identity consistency, S0-S5 maturity)
        |
autonomous_agi_spatiotemporal_residence_action_scaffold_v1.0.md
  (unifies the above four into one maturity ladder, W0-W6, bridges into the engineering track)
```

These five are AREC's own upstream lineage — see `../governance/README.md`.

### Engineering/spec track (3 documents, increasingly concrete)

```text
arcp_agent_residence_continuity_protocol_whitepaper_v0.1.md
  (the ARCP protocol itself — 15 core objects, a 9-stage sync protocol, 10 invariants, an error-code table)
        |
agent_residence_cloud_technical_whitepaper_v0.1.md
  (ARC — productizes ARCP into a cloud service vision: Phase 0-7, multi-tenancy, billing, federated migration)
        |
arcp_ctcl_internal_web_mvp_implementation_spec_v0.1.md
  (ARCP x CTCL MVP — the one spec with a real system to attach to: commoninstant.org, single-owner internal build, this repo's actual origin)
```

### Parallel track: the local residence build guide (operational, not ARCP-specific)

```text
ai_dedicated_residence_space_building_guide_v1.0.md
  (practical disk-layout guide for a personal/small-team "AI residence" — predates and is independent of ARCP)
```

### Roadmap

```text
arcp_series_dependency_map_and_build_roadmap_v0.1.md
  (the phase-by-phase build plan this repo has followed since Phase 0; superseded/extended for
   Phase 5 specifically by ../../PHASE5_ENTRY_GATE.md, which is the canonical source for that decision)
```

## Reading order for someone new to this repo

Start with `arcp_ctcl_internal_web_mvp_implementation_spec_v0.1.md` (most concrete, closest to what's
actually built), then the roadmap doc for how phases were sequenced, then the AREC governance docs in
`../governance/`, then the deeper theory chain above only as needed for a specific design question.
