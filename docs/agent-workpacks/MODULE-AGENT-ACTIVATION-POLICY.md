# Module Agent Activation Policy

**Decision date:** 2026-07-28
**Status:** Foundation complete; Wave 1 ready

## Current decision

FOUNDATION has passed the platform, actual-worktree instruction and Impeccable visual gates. Whole-module agents are now allowed for the ready Wave 1 workpacks:

- MOD-A — Catalog, Pricing and Tax;
- MOD-B — Inventory and Procurement;
- MOD-C — Customer, Sales and Fulfillment;
- MOD-E — Payments, Accounting and Banking.

Small-task agents remain prohibited. No separate agent is created for an endpoint, table, migration, UI screen, test suite, bug or documentation fragment inside a module.

## Ownership unit

Each module agent owns one complete workpack from activation through handoff. It completes:

- domain model and module-owned PostgreSQL schema;
- migrations and fixtures;
- backend/domain services and APIs;
- admin/POS UI owned by the module;
- permissions, approvals, audit and event effects;
- imports/exports and module integrations;
- unit, property, integration, contract, browser and performance tests;
- observability, runbook, ADRs and final handoff.

The module owner may use Impeccable’s review helpers for quality, but may not delegate implementation slices to separate agents.

## Activation conditions

A ready module agent may start only when:

1. It starts from the exact approved Foundation SHA after Foundation PR integration.
2. Its workpack is marked `ready` or `active` in `program-board.yaml`.
3. Its Git branch, worktree and Neon branch are isolated and verified.
4. Its owned paths and PostgreSQL schemas are machine-enforced.
5. It has read `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, the programme execution plan and its complete workpack.
6. Contract pack v1 and approved dependency fixtures remain frozen.
7. The programme integrator records the owner and activation checkpoint.
8. Existing dirty changes are preserved; no reset, discard or force push is used.

## Controlled launch waves

### Wave 1 — ready now

- MOD-A — Catalog, Pricing and Tax
- MOD-B — Inventory and Procurement
- MOD-C — Customer, Sales and Fulfillment
- MOD-E — Payments, Accounting and Banking

These agents may develop concurrently against frozen contracts and simulators.

### Wave 2 — dependency-gated

- MOD-D — POS, Cash, Offline and Hardware
- MOD-F — Localization, Country Packs and Compliance

Start after the Wave 1 contract checkpoints required by their workpacks are stable.

### Wave 3 — dependency-gated

- MOD-G — Reporting, Integrations and SaaS Administration

Start after cross-module reporting, event and integration contracts are stable enough to avoid speculative adapters.

## Integration order

Development may be parallel. Merge and integration remain serial:

1. MOD-A
2. MOD-B
3. MOD-C
4. MOD-E
5. MOD-D
6. MOD-F
7. MOD-G

Each module reaches `integration_review` independently. Cross-module conflicts return to the owning branch or are recorded as explicit programme-integrator patches.

## Shared contract and design rules

- Module agents may not edit another module's paths or schema.
- Shared contract changes require an approved contract-change request.
- Module agents inherit the Operations Ledger visual system in `DESIGN.md`.
- A module must not introduce a parallel component library, palette or visual language.
- Durable shared UI primitives require a reviewed shared-design change.
- Every UI-bearing workpack runs the Impeccable context, detector, browser/accessibility, responsive/RTL and finish-review gates.

## Prohibited patterns

- one agent per small TODO;
- separate database, backend and frontend agents inside one module;
- multiple agents editing the same module simultaneously;
- agents developing in the root checkout;
- agents sharing one mutable Neon development branch;
- parallel merges;
- status transitions without test and handoff evidence;
- production credentials or customer data in agent branches.

## Tracking requirements

`docs/agent-workpacks/program-board.yaml` is the machine-readable source of truth. Update it:

- when a workpack becomes active;
- at coherent checkpoint commits;
- when a blocker is added or removed;
- before ownership changes;
- before handoff or integration review;
- after CI, migration, benchmark, recovery or design evidence changes.

Human-readable handoffs and architecture reports must match the board before a status transition is accepted.
