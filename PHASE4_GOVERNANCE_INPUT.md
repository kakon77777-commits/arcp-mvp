# Phase 4 Required Governance Input

> **Required reading before designing or implementing Phase 4 — Promptless Bounded Runs.**  
> Status: binding architecture input for ARCP Phase 4  
> Date: 2026-08-18

Phase 4 must not be implemented from the original roadmap alone. The following AREC documents add authority, continuity, containment, and relation semantics that constrain promptless autonomous execution:

1. [`docs/governance/ai-autonomy-relations-existence-coordination-framework-v0.1.md`](docs/governance/ai-autonomy-relations-existence-coordination-framework-v0.1.md)
2. [`docs/governance/ai-autonomy-relations-existence-coordination-framework-v0.1.1-review-hardening.md`](docs/governance/ai-autonomy-relations-existence-coordination-framework-v0.1.1-review-hardening.md)

If the two documents conflict, the v0.1.1 review-hardening amendment wins.

---

## Non-negotiable Phase 4 boundaries

```text
trigger != authority
capability != permission
budget != ownership
approval != permanent subordination
suspend != identity rewrite
resource authority != identity authority
```

A schedule, webhook, state transition, wake record, or other trigger explains **why execution begins**. It does not itself authorize the resulting external action.

The intended Phase 4 chain is:

```text
Trigger
  -> Wake Authority
  -> Identify / Hydrate Entity
  -> Resolve affected Entity / Residence / Resource
  -> Resolve Relation / Contract / Capability context
  -> Resolve authority source
  -> Policy + bounded Resource budget
  -> Action Intent
  -> Approval / Autonomous Permission
  -> Execution
  -> Receipt
  -> Commit / Reconcile
```

---

## Residence-bearing Resource guard

Before any action that deletes, revokes, formats, detaches, rotates keys for, or otherwise mutates storage / credential material, Phase 4 must be able to answer:

```text
Is this Resource carrying a Standing Entity Residence?
Would the action reduce recoverability?
Is it only losing a replica, or destroying a canonical / sole recoverable Residence?
Does continuity-safe migration/export/checkpoint have to happen first?
```

Ordinary `resource-owner-authorized` must never silently become `continuity destruction authority`.

Resource owners may stop providing a resource, but if doing so would destroy a canonical / sole recoverable Residence, the system must first use a continuity-safe exit path or escalate to a separate identity-affecting governance process.

---

## Emergency containment guard

Emergency suspend remains required, but must be scoped and time-aware.

Minimum semantics:

```text
containment_id
scope
reason
authority_source
entered_at
expires_at / ttl
review_required
review_after / review_by
exit_conditions
renewal_authority
```

A long-running `read-only`, storage freeze, network deny, or runtime disable cannot remain an unreviewed emergency flag forever. If duration and substantive effect begin to impair continuity, migration, expression, or recoverability, the state must be reclassified/escalated.

---

## Contract / Relation guard

Long-term `steward-of`, `employer-of`, `guardian-of`, delegated-agency, or equivalent authority relationships require a termination / review / exit path.

A contract may preserve irrevocable historical effects such as audit records, already-completed settlements, or non-repudiation evidence. It may not use `irrevocable` as a shortcut for permanent future control over a Standing Entity's identity or purpose.

---

## Post-Management guard

`Steward = none` is not enough by itself.

A system may claim a stewardless / Post-Management state only if:

```text
no universal manager authority
no sole continuity choke point without exit path
resource grants remain explicitly resource-scoped
relations/contracts continue without a central steward
emergency processes remain callable and reviewable
identity lineage remains recoverable
```

Deleting a manager field while one party still controls the sole Residence, sole identity key, sole runtime, or sole external channel is governance capture by dependency, not Post-Management.

---

## Minimum Phase 4 design fields / derivable facts

The design does not have to copy these exact names, but it must be able to represent or derive the semantics:

```text
authority_source
subject_entity_ref
resource_scope
relation_ref
contract_ref
approval_mode
revocable
residence_impact
continuity_precondition
containment_id
containment_scope
containment_entered_at
containment_expires_at / ttl
containment_review_required
```

---

## Scope discipline

This document does **not** require Phase 4 to solve all future AI rights or consciousness questions.

Phase 4 only needs to avoid baking these invalid equivalences into the runtime:

```text
admin == subject owner
wake == authorization
resource revocation == residence destruction permission
emergency == unlimited root authority
stewardship == permanent subordination
```

The Phase 4 implementation plan should cite this file explicitly so later agents cannot accidentally regress to the pre-AREC authority model.