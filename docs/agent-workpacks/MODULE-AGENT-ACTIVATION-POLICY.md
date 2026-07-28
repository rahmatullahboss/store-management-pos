# Module Agent Activation Policy

**Decision date:** 2026-07-28
**Status:** Active program-control policy

## Current decision

FOUNDATION has passed the original technical platform gate and the actual-worktree instruction review, and remains `handoff_ready`, but module agents are not yet allowed. The only remaining Foundation Gate blocker is completion of the Impeccable visual-foundation gate for the real admin/POS shell.

The real Foundation worktree loaded the tracked root `AGENTS.md` and exposed no `.ai-bridge` context files, resolving the prior external blocker. Impeccable tooling is installed and its detector smoke passes, but the current route shells are not a finished visual implementation. MOD-A through MOD-G remain blocked until the visual gate is completed and the board records the transition.

Small-task agents are prohibited. No separate agent is created for an endpoint, table, migration, UI screen, test suite, bug, documentation fragment or other internal checklist item.

After the Foundation Gate passes, separate agents may be assigned only at the complete workpack level:

- MOD-A — Catalog, Pricing and Tax;
- MOD-B — Inventory and Procurement;
- MOD-C — Customer, Sales and Fulfillment;
- MOD-D — POS, Cash, Offline and Hardware;
- MOD-E — Payments, Accounting and Banking;
- MOD-F — Localization, Country Packs and Compliance;
- MOD-G — Reporting, Integrations and SaaS Administration.

Each module agent owns its workpack from branch creation through handoff. It completes the domain model, migrations, backend, APIs, UI, permissions, approvals, audit/events, tests, performance evidence, observability, runbook, ADRs and final handoff itself.

## Activation conditions

A module agent may start only when all of the following are true:

1. The real `.worktrees/foundation-v1` worktree is mounted or its `.ai-bridge` contents are supplied.
2. Ignored instructions are reviewed and reconciled without resetting or discarding existing work.
3. The Foundation Agent implements and finishes the real admin/POS visual foundation through `docs/18-IMPECCABLE-DESIGN-WORKFLOW.md`.
4. Impeccable detector, browser, accessibility, responsive, localisation/RTL and finish-review evidence passes, and `DESIGN.md`/`.impeccable/design.json` record the implemented system.
5. `FOUNDATION` is marked `complete` in `program-board.yaml`.
6. Its own workpack is marked `ready`.
7. Contract pack v1 and required dependency fixtures are frozen.
8. Its Git branch, worktree and Neon branch are created from the approved Foundation baseline.
9. Its owned paths and PostgreSQL schemas are machine-enforced.
10. The program integrator records the owner and activation checkpoint.

## Controlled launch waves

The preferred launch sequence limits rework while still using module-level parallelism:

1. **Wave 1:** MOD-A, MOD-B, MOD-C and MOD-E develop against frozen contracts and approved simulators.
2. **Wave 2:** MOD-D and MOD-F start after the first-wave contract checkpoints are available.
3. **Wave 3:** MOD-G starts after cross-module reporting and integration contracts are stable.

The integrator may activate all seven workpacks concurrently only when every dependency simulator and contract fixture is independently usable. Parallel development never means parallel merging.

## Integration order

Module integration remains serial:

1. MOD-A
2. MOD-B
3. MOD-C
4. MOD-E
5. MOD-D
6. MOD-F
7. MOD-G

Each module reaches `integration_review` independently. Cross-module conflicts return to the owning module branch or are recorded as explicit integrator patches.

## Completed Foundation evidence

- exact install, format, lint, boundaries, typecheck, 14 tests, secret/licence/SBOM and dependency audit;
- fresh `FND-0001`–`FND-0005` migration lifecycle and cleanup;
- direct Neon HTTP/batch/WebSocket p50/p95/p99, concurrency, rollback and genuine cold-wake evidence;
- disposable Neon PITR restore and reconciliation;
- Cloudflare deploy, preview, bundle, health, latency, CPU, wall-time, memory and cleanup evidence;
- stale disposable branch cleanup and confirmation that only `main` and `dev/foundation-v1` remain.

## Prohibited delegation patterns

- one agent per small TODO;
- backend, frontend and database agents inside one module;
- multiple agents editing one module simultaneously;
- module agents modifying another module's paths or schema;
- module agents changing shared contracts without an approved change request;
- agents using the root checkout or a shared mutable Neon development branch;
- status changes without verification evidence and updated documentation.

## Tracking requirements

`docs/agent-workpacks/program-board.yaml` is the machine-readable source of truth. It must be updated:

- when a workpack becomes ready or active;
- at every coherent checkpoint commit;
- when a blocker is added or removed;
- before ownership changes;
- before handoff or integration review;
- after CI, migration, benchmark or recovery evidence changes.

Human-readable handoffs and architecture reports must match the board before any status transition is accepted. The actual-worktree instruction review has passed. When the Impeccable visual-foundation gate passes, mark FOUNDATION `complete`, set MOD-A/MOD-B/MOD-C/MOD-E to `ready`, then activate one whole-module agent per workpack.
