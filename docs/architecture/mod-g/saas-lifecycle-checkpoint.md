# MOD-G SaaS Lifecycle and Support Controls Checkpoint

**Date:** 2026-07-30  
**Branch:** `module/reporting-integrations-saas-v1`  
**Review PR:** `#45`

## Persistence

`INT-0005` adds immutable global plan versions and tenant-scoped subscription, exact usage, lifecycle, rollout, incident and support-access evidence.

- global versioned plans and immutable entitlement definitions;
- one current subscription per tenant with optimistic versioning;
- append-only exact `numeric(78,0)` usage events and period counters;
- data-preserving provision, suspend, resume, export and offboarding jobs;
- independently approved, time-boxed support impersonation grants;
- deterministic feature rollout state and append-only change evidence;
- tenant-scoped support incidents and state transitions;
- forced tenant RLS on all tenant-specific SaaS tables;
- runtime roles retain select and approved command execution only.

## Command layer

`INT-0006` provides:

- idempotent plan publication and entitlement validation;
- plan assignment and exact subscription transitions;
- terminal cancellation and optimistic subscription-version checks;
- exact idempotent usage aggregation;
- lifecycle request/transition commands;
- transactional audit and outbox evidence;
- tenant status changes only after completed lifecycle jobs;
- no tenant or business-document deletion.

`INT-0007` provides:

- independent support impersonation approval;
- maximum eight-hour access windows;
- visible issued, used and revoked evidence;
- deterministic rollout control;
- incident opening, investigation, monitoring, resolution, reopening and closing;
- optimistic versioning and replay protection;
- transactional audit and event publication.

## Runtime policy

The SaaS control plane combines subscription status, period, plan version and entitlement enforcement before allowing a feature. Suspended or cancelled subscriptions fail closed. Past-due subscriptions can retain explicitly configured access while surfacing billing attention. Soft and observe entitlements never silently become hard blocks.

Lifecycle workers move through queued, running and terminal evidence. Export and offboarding completion require a bounded evidence reference. Unknown failures are normalized and recorded without exposing provider payloads.

## Invariants

- suspension and offboarding never delete tenant business data;
- cancelled subscriptions are terminal;
- usage events are exact, append-only and replay-safe;
- support access is separately approved, scoped, visible and time-boxed;
- rollout decisions are stable for a tenant and feature;
- incidents retain complete transition history;
- all tenant-specific reads and writes remain RLS-bound.

## Verification scope

- deterministic migration order and checksums;
- complete live Neon chain and replay;
- forced RLS and command-only writes;
- append-only evidence triggers;
- exact usage and replay behavior;
- subscription, rollout, incident and lifecycle state machines;
- support approval and expiry boundaries;
- data-preservation architecture guards.
