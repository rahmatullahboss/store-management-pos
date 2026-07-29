# Module Agent Activation Policy

**Original decision date:** 2026-07-28  
**Mobile extension decision:** 2026-07-29  
**Status:** Foundation complete; MOD-A/B/C/D/E integrated; MOD-F active; MOB-01 active in parallel; integration remains serial

## Current decision

FOUNDATION has passed the platform, actual-worktree instruction and Impeccable visual gates. Whole-module development is allowed in isolated branches/worktrees/Neon branches. Small-task agents remain prohibited.

Current parallel owners:

- MOD-F — Localization, Country Packs and Compliance;
- MOB-01 — Store Companion Mobile documentation and Flutter foundation.

MOB-01 is an additive client workpack. It may consume reviewed integrated contracts and deterministic fixtures, but it may not bypass MOD-F/MOD-G dependency gates, edit module-private paths or create a second authoritative database.

No separate agent is created for an endpoint, table, migration, UI screen, mobile package, platform target, test suite, bug or documentation fragment inside a workpack.

## Ownership unit

Each agent owns one complete workpack from activation through handoff. Depending on the workpack, this includes:

- domain model and module-owned PostgreSQL schema, when the workpack owns server data;
- migrations and fixtures;
- backend/domain services and APIs;
- admin/POS/mobile UI owned by the workpack;
- permissions, approvals, audit and event effects;
- imports/exports and module integrations;
- unit, property, integration, contract, browser/device and performance tests;
- observability, runbook, ADRs and final handoff.

MOB-01 owns no canonical PostgreSQL business schema. Its Neon branch is for isolated synthetic contract/E2E evidence only. It owns the complete Flutter application, mobile local database, synchronisation, Android/iOS targets, mobile tests and documentation.

The workpack owner may use Impeccable review helpers for quality, but may not delegate implementation slices to separate agents.

## Activation conditions

A ready workpack may start only when:

1. It starts from the exact approved Foundation or reviewed integration SHA recorded for that workpack.
2. Its workpack is marked `ready` or `active` in `program-board.yaml`.
3. Its Git branch, worktree and required Neon branch are isolated and verified.
4. Its owned paths and any owned PostgreSQL schemas are machine-enforced.
5. It has read `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, the programme execution plan and its complete workpack.
6. Reviewed contracts and approved dependency fixtures remain frozen.
7. The programme integrator records the owner and activation checkpoint.
8. Existing dirty changes are preserved; no reset, discard, destructive rebase, force checkout or force push is used.
9. Shared contract needs are recorded through a contract-change request.
10. Production credentials, production data, production database mutation and production deployment remain separately authorised.

## Controlled launch waves

### Wave 1 — integrated

- MOD-A — Catalog, Pricing and Tax
- MOD-B — Inventory and Procurement
- MOD-C — Customer, Sales and Fulfillment
- MOD-E — Payments, Accounting and Banking

### Wave 2 — MOD-D integrated; MOD-F active

- MOD-D — POS, Cash, Offline and Hardware
- MOD-F — Localization, Country Packs and Compliance

MOD-F continues against the integrated MOD-D baseline.

### Wave 3 — dependency-gated

- MOD-G — Reporting, Integrations and SaaS Administration

MOD-G starts after MOD-F and the cross-module reporting/event/integration contracts are stable enough to avoid speculative adapters.

### Wave 4 integration / parallel mobile development

- MOB-01 — Store Companion Mobile

MOB-01 may develop now because Foundation and MOD-A/B/C/D/E are integrated and its documentation/contract gate is explicit. It uses frozen fixtures for unfinished MOD-F/MOD-G dependencies.

MOB-01 final integration is after MOD-G by default. The programme integrator may accept an earlier additive mobile-foundation checkpoint only when it contains no speculative domain contract, does not block MOD-F/MOD-G and passes full repository verification.

## Integration order

Development may be parallel. Merge and integration remain controlled and serial:

1. MOD-A
2. MOD-B
3. MOD-C
4. MOD-E
5. MOD-D
6. MOD-F
7. MOD-G
8. MOB-01

Each workpack reaches `integration_review` independently. Cross-module conflicts return to the owning branch or are recorded as explicit programme-integrator patches/contract decisions.

A workpack may non-destructively merge the latest reviewed integration checkpoint into its own branch to remain current. It must not overwrite reviewed work, force-update another branch or merge its incomplete work into the programme branch out of order.

## MOB-01 dependency rules

MOB-01 may immediately consume:

- Foundation identity, tenant, permissions, session/device revocation, errors, audit, idempotency and localisation primitives;
- integrated MOD-A catalog/pricing/tax contracts;
- integrated MOD-B inventory/procurement contracts;
- integrated MOD-C customer/sales/fulfilment contracts;
- integrated MOD-D compatible device/offline/idempotency principles without native POS authority;
- integrated MOD-E finance operational contracts;
- Operations Ledger design authority.

MOB-01 must wait for reviewed contracts before finalising:

- MOD-F effective locale/currency/timezone/business date, country capability, privacy/retention and legal/fiscal presentation;
- MOD-G governed metrics, reporting, notifications, entitlements and canonical OpenAPI/public integration schemas.

MOB-01 never connects directly to Neon, owns no business tables and does not introduce Firebase/Firestore/Supabase as a second business source of truth.

## Shared contract and design rules

- Workpack agents may not edit another workpack's paths or schema.
- Shared contract changes require an approved contract-change request.
- MOB-01 uses CCR-0003 for mobile bootstrap, workspace, device, change-feed, operation-batch, approval-reference and notification-reference contracts.
- All UI work inherits the Operations Ledger visual system in `DESIGN.md`.
- A workpack must not introduce a parallel component library, palette or visual language.
- Durable shared UI primitives require a reviewed shared-design change.
- Every UI-bearing workpack runs the Impeccable context, shaping, detector, accessibility, responsive/RTL and finish-review gates.
- Mobile UI additionally records phone/tablet, TalkBack/VoiceOver, text-scaling, offline/conflict and device evidence.

## Prohibited patterns

- one agent per small TODO;
- separate database, backend, frontend, Android or iOS implementation agents inside one workpack;
- multiple agents editing the same workpack simultaneously;
- agents developing in the root checkout;
- agents sharing one mutable Neon development branch;
- parallel programme merges;
- status transitions without test and handoff evidence;
- production credentials or customer data in agent branches;
- mobile direct database access or client-authoritative business calculations;
- native POS/cash/hardware scope inside MOB-01;
- claiming Flutter/build/device/Neon evidence that was not executed.

## Tracking requirements

`docs/agent-workpacks/program-board.yaml` is the machine-readable source of truth. Update it:

- when a workpack becomes active;
- at coherent checkpoint commits;
- when a blocker is added or removed;
- before ownership changes;
- before handoff or integration review;
- after CI, migration, benchmark, recovery or design evidence changes;
- when a workpack syncs a newer reviewed integration checkpoint;
- when mobile compatibility/dependency gates change.

Human-readable handoffs and architecture reports must match the board before a status transition is accepted.
