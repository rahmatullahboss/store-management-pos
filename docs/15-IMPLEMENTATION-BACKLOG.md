# Implementation Backlog

## 1. Backlog rules

- Implement in dependency order, not by screen popularity.
- Complete vertical slices that include permissions, persistence, posting, API, UI, audit, tests and observability.
- P0 work must be production-grade; do not build throwaway financial logic.
- Every epic has an owner, acceptance examples, risks and measurable exit criteria.
- Country-specific behavior remains in packs/adapters.
- New scope that changes architecture or ledgers requires an ADR.
- Delegation uses whole-module workpacks, not one agent per backlog item.
- One agent completes every internal epic/task assigned to its workpack.

## 2. Agent workpack mapping

The detailed epics below remain the implementation checklist, but agent ownership is grouped as follows:

- Foundation agent: E00-E04 plus shared platform/contract portions of E18, E22 and E23.
- MOD-A Catalog/Pricing/Tax: E05-E06 and tax-engine portions of E18.
- MOD-B Inventory/Procurement: E07-E09.
- MOD-C Customer/Sales/Fulfillment: E10 and fulfillment portions of E21.
- MOD-D POS/Cash/Offline: E11-E12 and E14.
- MOD-E Payments/Accounting/Banking: E13, E15 and E16.
- MOD-F Localization/Compliance: E18-E19 and privacy/country portions of E22.
- MOD-G Reporting/Integrations/SaaS: E17, E20-E21 and platform-operations portions of E22-E23.

Each owner completes its full grouped workpack in one branch. See `docs/17-PARALLEL-AGENT-EXECUTION.md` and `docs/agent-workpacks/`.

## 3. Epic sequence

### E00 — Architecture and product spikes

**Priority:** P0, first

Tasks:

- Select first target segment and country.
- Benchmark Workers + Neon direct serverless driver using HTTP and WebSocket transaction modes.
- Prove transaction, RLS tenant context, pooling and failure semantics.
- Implement a disposable checkout spike with price, tax, FIFO, journal and outbox.
- Implement offline operation-log/replay spike.
- Test printer/local-agent and payment-terminal approaches.
- Test large import/document rendering in Workers/Workflow constraints.
- Test backup/restore/outbox replay.
- Record stack decisions in ADRs.

Exit: approved benchmark report and no unresolved architecture blocker.

### E01 — Repository, CI/CD and environments

- Establish monorepo/package layout.
- Type/lint/test/build tooling.
- Module dependency rules.
- Environment/config/secrets model.
- Cloudflare infrastructure as code.
- PostgreSQL migration pipeline.
- Preview/dev/staging/performance/production environments.
- SBOM, dependency/license/secret scans.
- Signed release provenance and canary deployment.

Exit: reproducible, observable deployment and rollback/forward-fix path.

### E02 — Tenancy and regional routing

- Tenant lifecycle and region assignment.
- Global control-plane routing record.
- Legal entity/group structure.
- Store/warehouse/register hierarchy.
- Tenant settings and entitlements.
- Custom domain resolution.
- Tenant export/suspension/deletion states.
- Cross-tenant isolation test harness.

Exit: two test tenants prove isolated writes, reads, cache, files and events.

### E03 — Identity, RBAC and audit

- User/invitation/membership.
- Authentication and MFA.
- Roles/permissions/location scopes.
- Approval policy engine.
- Device/register enrollment.
- Security/audit event model.
- Support impersonation control.
- Session/device/API-key revocation.

Exit: authorization matrix and privileged-action audit tests pass.

### E04 — Platform primitives

- UUID/time/business-date utilities.
- Exact Money/Quantity types.
- Idempotency store.
- Transactional outbox/inbox.
- R2 file abstraction.
- Job/workflow records.
- Feature flags and entitlement checks.
- Localization/translation framework.
- Notification abstraction.
- Structured errors/tracing.

Exit: reusable platform contracts are stable and have failure tests.

### E05 — Catalog

- Product/variant/category/brand/tag.
- Barcodes and normalization.
- Units/conversions.
- Product media/localizations.
- Supplier item references.
- Archive/lifecycle behavior.
- Search projection.
- CSV import dry run/execution/export.
- POS catalog snapshot/incremental feed.

Exit: representative 250,000-variant catalog imports, searches and syncs within budget.

### E06 — Pricing and tax foundation

- Currency/precision/rounding metadata.
- Price lists and assignments.
- Inclusive/exclusive tax rules.
- Effective-dated tax/rate versions.
- Manual discount and approval.
- Price/tax calculation snapshot.
- Return allocation rules.
- Golden calculation tests.

Exit: exact totals reproduce across API, POS, receipt and return.

### E07 — Inventory ledger

- Warehouse/bin/status model.
- Stock ledger/posting service.
- Balance projection and reconciliation.
- Opening balance posting.
- Adjustment/reason/approval.
- Transfer dispatch/in-transit/receipt.
- Negative-stock policy.
- FIFO cost layers/consumption.
- Inventory movement/valuation drill-through.

Exit: all balances/values rebuild from ledgers and concurrency tests pass.

### E08 — Inventory counts and advanced tracking

- Count plan/snapshot.
- Blind count/recount/approval.
- Variance posting.
- Serial/batch/expiry model.
- Damaged/quarantine status.
- Cycle-count scheduling.
- Stock aging/slow/dead projection.

P0 subset: physical count and variance. Remaining P1.

### E09 — Procurement

- Supplier/contact/terms.
- Purchase order and approval.
- Goods receipt and discrepancy.
- Supplier return.
- Supplier bill/AP posting.
- Purchase/receipt/bill matching baseline.
- Landed cost.
- Supplier/open-order reports.

Exit: purchase-to-stock-to-pay golden scenario reconciles.

### E10 — Customer and sales documents

- Customer/group/address/tax/consent.
- Quote and sales order.
- Invoice/receipt and credit note.
- Fulfillment basics.
- Partial payment/fulfillment model.
- Return authorization/exchange.
- Customer credit/AR baseline.
- Document numbering/snapshots.

Exit: sale and correction state machines are auditable and immutable after posting.

### E11 — POS online checkout

- Register/session/cart UX.
- Barcode/touch/search.
- Customer quick create/select.
- Discounts/price override/approval.
- Cash/external card/split tender.
- Checkout application command.
- Receipt rendering/print/email.
- Suspend/resume.
- Return/refund/exchange.
- Keyboard/accessibility performance.

Exit: cashier golden journeys meet speed/error targets.

### E12 — Cash and shift management

- Shift open/close.
- Opening float.
- Cash sale/refund events.
- Paid in/out/safe drop.
- Blind cash count.
- Variance explanation/approval.
- Shift/tender reports.
- Deposit tracking.

Exit: expected cash reconstructs solely from event ledger.

### E13 — Payment platform

- Payment intent/attempt/transaction model.
- Provider capability interface.
- One sandbox/global provider adapter.
- Authorization/capture/void/refund.
- Signed webhook/idempotency/recovery.
- Settlement import/fee accounting.
- Unknown-state reconciliation.
- Terminal mapping.
- PCI data-flow review.

Exit: timeout/duplicate/webhook replay cannot double-charge or double-post.

### E14 — Offline POS

- Install/service worker/local DB.
- Local catalog/price/policy projection.
- Durable operation log.
- Upload/download cursor protocol.
- Signed offline authorization.
- Cash sale/shift offline.
- Conflict/review console.
- Receipt-number strategy.
- Local schema/app updates.
- Device health and remote revoke.

Exit: full outage/restart/replay suite passes.

### E15 — Accounting core

- Chart of accounts/journals.
- Journal posting/reversal service.
- Posting-rule versions.
- Sales/tax/payment/COGS entries.
- Purchase/AP/inventory entries.
- AR/AP subledgers.
- Fiscal periods/locks.
- Trial balance/GL/P&L/balance sheet.
- Stock-to-GL reconciliation.

Exit: accountant-approved golden suite and period close pass.

### E16 — Banking and reconciliation

- Bank accounts/statements.
- Payment allocation.
- Settlement and fee matching.
- Cash deposit chain.
- Auto/manual reconciliation.
- Reconciliation exceptions and reports.

Exit: sale-to-bank and purchase-to-payment chains reconcile.

### E17 — Reporting platform

- Metric catalog.
- Operational projections.
- Owner/store/finance/inventory dashboards.
- Drill-through APIs/UI.
- Freshness/version/currency/time labels.
- Scheduled export jobs.
- Projection/control reconciliation.
- Analytics export contract.

Exit: every P0 KPI has definition, control total and drill-through.

### E18 — Country-pack framework

- Pack manifest/validation/signing.
- Language packs/RTL.
- Tax/account/document configuration.
- Numbering/offline fiscal capability.
- Accounting template/mappings.
- Legal document renderer.
- Pack activation/version/migration.
- Country support-level UI.

Exit: second synthetic country pack installs without core schema country fields.

### E19 — First production country pack

- Official requirement matrix.
- Local tax/document/numbering/accounting rules.
- Bengali/English or target languages.
- Payment/fiscal/e-invoice provider adapters as required.
- Golden examples and contingency/offline behavior.
- Local accounting/legal review.
- Pilot certification evidence and limitations.

Exit: advertised country support level is evidenced and approved.

### E20 — Public API and webhooks

- OpenAPI and auth/scopes.
- Partner app/API-key lifecycle.
- Cursor pagination/filter conventions.
- Signed outbound webhooks.
- Delivery/retry/replay console.
- Sandbox/simulators.
- Changelog/deprecation policy.

Exit: sample partner integration passes security/idempotency/contracts.

### E21 — Ecommerce connector

- Connection/mapping/cursor model.
- Catalog/price/inventory publish.
- Order/customer import.
- Fulfillment/tracking/return sync.
- Loop/conflict prevention.
- Reconciliation dashboard.

Build first connector based on launch-customer demand.

### E22 — Privacy and compliance operations

- Data inventory/classification.
- Customer access/export/anonymization.
- Retention/legal hold.
- Tenant offboarding export/delete.
- Production access and support audit.
- Incident/security runbooks.
- PCI/SOC/ISO control mapping as selected.

Exit: tested workflows and evidence repository.

### E23 — Production operations

- SLO/SLI dashboards.
- Alerting and on-call.
- Runbooks.
- Backup/PITR/restore.
- DR/regional routing exercise.
- Capacity/noisy-neighbor controls.
- Support/tenant health tools.
- Release canary/rollback.

Exit: production readiness review passes.

### E24 — Pilot and migration

- Migration assessment/templates.
- Opening stock/AR/AP/GL import.
- Reconciliation and sign-off.
- Device/hardware rollout.
- Training/help content.
- Controlled pilot and parallel checks.
- Daily issue/ledger reconciliation.
- GA decision.

## 4. P0 launch cut

Required for first sellable general-retail release:

- E00–E07;
- P0 portion of E08;
- E09–E17;
- E18 plus one validated E19;
- essential E22–E24.

E20/E21 may be pulled into P0 when a launch customer requires integration. Advanced loyalty, warehouse, serial/batch, multi-entity and vertical modules remain P1/P2 unless contractually necessary.

## 5. Cross-cutting task checklist

Apply to every epic:

- tenant/legal entity/store scope;
- authorization/approval/audit;
- exact money/quantity;
- timezone/business date;
- localization/RTL/accessibility;
- offline behavior or explicit online-only rule;
- idempotency/concurrency;
- posting/ledger impact;
- API/event versioning;
- imports/migrations;
- observability/runbook;
- security/privacy/data classification;
- performance/capacity;
- documentation/support;
- feature flag/rollback.

## 6. Initial implementation order

After Phase 0 approval, the first engineering slices should be:

1. repository/platform skeleton and one regional tenant;
2. identity/tenant/store/register and audit;
3. Money/business date/idempotency/outbox primitives;
4. minimal catalog/price/tax;
5. stock opening/receipt/issue ledger with FIFO;
6. journal posting interface and balanced entries;
7. atomic cash checkout API and receipt snapshot;
8. basic POS UI;
9. offline operation log/replay;
10. purchase receipt and return/refund vertical slices;
11. reporting controls and country-pack framework.

This order proves the hardest invariants before broad CRUD development.

## 7. Backlog anti-patterns

Do not:

- build all admin CRUD screens before posting flows;
- postpone accounting until after POS launch;
- use mutable `stock_quantity` as the only inventory source;
- add country columns to core tables for each market;
- start microservices per module;
- expose raw provider states everywhere;
- add AI forecasting before clean reconciled data;
- copy open-source code without provenance;
- claim offline support after only caching the app shell;
- define dashboards without metric ownership and drill-through.

## 8. Program completion evidence

Maintain in the repository:

- ADRs and benchmark reports;
- domain/state diagrams;
- OpenAPI/event schemas;
- database migrations and ERD;
- golden posting fixtures;
- country-pack validation evidence;
- threat model/security reviews;
- SBOM/third-party notices;
- performance/offline/DR results;
- operational runbooks;
- migration/pilot reconciliation sign-offs.
