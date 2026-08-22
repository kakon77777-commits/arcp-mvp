# Phase 5.0A Model Call Boundary Amendment

**Status:** Proposed cross-review amendment to the approved 5.0A design  
**Date:** 2026-08-19  
**Applies to:** `docs/superpowers/specs/2026-08-19-phase5-0a-runtime-clock-hard-budget-design.md`  
**Reason:** Implementation-plan conversion exposed an interface-level contradiction between local preflight and the durable `reserved -> calling` boundary.

## 1. Problem discovered during implementation planning

The approved 5.0A design requires this ordering:

```text
reserve model-call envelope
-> create ModelInvocationRecord(status=reserved)
-> adapter performs local preflight only
-> durable transition reserved -> calling
-> provider I/O may begin
```

It also proposed this single-stage interface:

```ts
interface ModelPort {
  deliberate(
    input: ModelTurnInput,
    limits: ModelCallLimits,
  ): Promise<ModelTurnProposal>;
}
```

Those two requirements cannot both be implemented faithfully. Once the orchestrator enters one opaque `deliberate()` call, it has no host-controlled point between adapter-local preflight and provider I/O at which it can durably persist `calling`.

Marking `calling` before invoking `deliberate()` is rejected: a crash or failure during purely local preflight would then be misclassified as "provider I/O may have begun", causing conservative maximum-budget consumption for an operation that definitely never crossed the provider boundary.

Allowing the adapter to update `RunStateStorePort` directly is also rejected: it would violate the 5.0A boundary that adapters translate host limits but do not read or mutate governance state.

## 2. Selected fix: two-stage prepared model call

Replace the single opaque call with a local-only prepare stage and a separately invoked prepared call:

```ts
export interface PreparedModelCall {
  execute(): Promise<ModelTurnProposal>;
}

export interface ModelPort {
  prepareCall(
    input: ModelTurnInput,
    limits: ModelCallLimits,
  ): Promise<PreparedModelCall>;
}
```

Normative ordering becomes:

```text
1. reserve model-call BudgetEnvelope
2. create ModelInvocationRecord(status=reserved)
3. ModelPort.prepareCall(input, limits)
   - local/configured computation only
   - validates every supplied hard limit
   - constructs the provider request
   - MUST perform zero provider/network I/O
4. if prepareCall fails:
   - invocation -> failed
   - provider I/O definitely did not begin
   - release model-call envelope safely
5. host durably CAS-transitions invocation reserved -> calling
6. prepared.execute()
   - provider I/O may begin only here
7. calling -> succeeded | failed | unknown
8. settle/recover the envelope from authoritative usage semantics
```

`PreparedModelCall` is intentionally process-local and non-persisted. It is only a capability to perform the already-preflighted call after the host has established the durable `calling` boundary.

## 3. Crash semantics

```text
crash before / during prepareCall
-> invocation remains reserved
-> provider I/O definitely did not begin
-> envelope may be released after validation

crash after prepareCall returns but before reserved -> calling
-> invocation remains reserved
-> prepared object is lost
-> provider I/O definitely did not begin
-> envelope may be released and the logical call retried

crash after calling is durable but before execute actually reaches provider
-> exact provider-consumption state is unknowable after process death
-> retain the approved conservative rule
-> reconcile if authoritative usage reconciliation exists; otherwise consume reserved maxima

crash during / after execute
-> calling means provider may have consumed resources
-> never release unknown usage as zero
```

The third case may over-charge a call that had not yet reached the network, but it never under-charges an ambiguous call. This preserves the approved fail-closed recovery rule.

## 4. Adapter rules

`prepareCall()` MUST NOT:

- perform provider/network I/O;
- fetch live pricing;
- mutate ARCP store state;
- enlarge any host-supplied `ModelCallLimits`;
- return a prepared call if any finite hard limit cannot be enforced.

It MAY:

- tokenize locally;
- serialize the final request locally;
- use configured/versioned pricing bounds;
- reduce input/output maxima to satisfy the host cost ceiling;
- configure timeout/cancellation parameters on the prepared request.

`execute()` MUST use the request/limits produced by `prepareCall()` and may only preserve or reduce those limits, never enlarge them.

## 5. Deterministic adapter and tests

The deterministic adapter records separate counters for preparation and provider execution.

Required tests:

```text
unsupported hard limit
-> prepareCall fails
-> invocation never becomes calling
-> execute/provider-call count = 0
-> envelope safely released

crash after prepareCall before calling
-> invocation remains reserved
-> provider-call count = 0
-> safe recovery/retry

crash after calling before/inside execute
-> invocation remains calling
-> unknown usage != zero
-> conservative reserved-maximum recovery when no reconciliation exists
```

## 6. Relationship to the approved design

All other 5.0A decisions remain unchanged:

- `ProvenanceClockPort != MonotonicClockPort`;
- Budget View is advisory, not authority;
- Budget Envelopes remain atomic and fencing-protected;
- `ModelCallLimits` remain host-derived hard ceilings;
- omitted model budgets remain zero, never unlimited;
- missing usage never settles as zero;
- wall-time overrun remains a violation, not clamped success;
- containment remains preemptive;
- budget authority remains Resource governance, not identity ownership.

This amendment only makes the already-approved durable model-call boundary executable without giving provider adapters governance-store authority.
