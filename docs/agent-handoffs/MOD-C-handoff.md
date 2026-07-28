# MOD-C Customer, Sales and Fulfillment Handoff

Status: active
Last updated: 2026-07-28

## Execution identity

- Foundation SHA: `57f21e8c14e27ce3ad96a862cf6de82c2c6cd27c`
- Git branch: `module/customer-sales-fulfillment-v1`
- Worktree: `.worktrees/customer-sales-fulfillment`
- Neon project: `twilight-boat-26805962`
- Neon branch: `dev/module-customer-sales-fulfillment` (`br-muddy-star-axo1uogc`)
- Neon parent: `dev/foundation-v1` (`br-autumn-pine-axuo502u`)

## Checkpoint log

### 0 — Activation and architecture

- Exact approved Foundation commit verified locally and through GitHub.
- Remote module branch created at the exact Foundation commit.
- Dedicated ignored worktree created with no pre-existing dirty state overwritten.
- Isolated Neon branch created from the approved Foundation Neon parent and verified through the Neon API.
- Required repository, product, design, execution, activation, program-board, architecture, security, testing and workpack documents read.
- Baseline `npm run verify` passed with 15 tests before implementation.
- Implementation plan and test/evidence matrix recorded.

### 1 — Customer domain

- Added tenant-isolated person/company profiles with normalized contacts, typed addresses, tags/groups, tax registrations and immutable consent history.
- Added deterministic duplicate detection and audit-preserving merge that retains all historical customer identifiers.
- Added exact minor-unit credit profiles, availability decisions and privileged credit override authorization.
- Added bounded idempotent customer import and deterministic export contracts.
- Added `CUS-0001` migration with customer-owned tables, indexes, forced RLS, append-only consent/credit-approval/merge history, permissions and grants.
- Verified red/green coverage for customer behavior and migration structure; 20 unit tests pass at this checkpoint.

### 2 — Sales domain

- Added quotation creation, revision snapshots, send/accept transitions and idempotent quote-to-order conversion with optimistic version enforcement.
- Added immutable MOD-A-compatible price/tax snapshot consumption and MOD-C-owned deterministic simulators for pricing/tax, inventory reservation, customer credit, payment/refund, accounting and receipt/fiscal contracts.
- Added authoritative sales orders with independent order, payment, fulfillment, invoice, return and backorder states; partial payment/fulfillment and prepaid/deposit/layaway/on-account metadata are represented independently.
- Added inventory reservation and customer-credit checks before confirmation, duplicate-command replay protection and outbox/audit events.
- Added operational invoice posting, accounting/receipt instructions, immutable posted documents and proportional credit-note allocation preserving original price/tax snapshots.
- Added approval-gated cancellation after payment, fulfillment or invoicing effects and concurrency-safe document numbering.
- Added `SAL-0001` migration with quote/order/invoice/credit-note documents, immutable revisions/observations, independent status columns, document metadata, indexes, forced RLS, permissions and row-locked numbering.
- Verified red/green coverage; 28 unit tests pass at this checkpoint.

### 3 — Fulfillment, returns and refund orchestration

- Added reservation-backed split fulfillment plans with explicit allocations by method and warehouse, idempotent creation and over-allocation prevention.
- Added enforced picking, packing, ship-from-store, local delivery and pickup transitions with exact quantity checks, stock issue postings, shipment metadata and immutable delivery/collection proof.
- Added return authorization, privileged approval, receipt condition/disposition, customer-return stock posting and cumulative over-return protection with explicit policy override permission.
- Preserved original order quantity and price/tax snapshots on every return line and original payment allocation provenance on every authorization.
- Added original-payment-targeted refund orchestration and exchange replacement requests through deterministic frozen-contract simulators; completed returns become immutable.
- Added `FUL-0001` migration with fulfillment queues, allocations, packages, shipments, proofs, workflow events, return approvals/receipts/refunds/exchanges, forced RLS, append-only evidence, completed-return immutability and permissions.
- Verified red/green coverage; 36 unit tests pass at this checkpoint.

## Dependency policy

MOD-C consumes only the frozen v1 public contracts and deterministic MOD-C-owned simulators for catalog/pricing/tax, inventory, payment/refund, accounting and receipt/fiscal dependencies. No unmerged MOD-A, MOD-B or MOD-E implementation code is imported.

## Open work

Application APIs/UI, observability/jobs, live migrations/evidence and final integration handoff remain in progress.
