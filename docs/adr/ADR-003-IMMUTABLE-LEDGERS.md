# ADR-003: Immutable Stock, Financial and Cash/Payment Ledgers

- **Status:** Accepted
- **Date:** 2026-07-27
- **Decision owners:** Product/Finance/Architecture

## Context

Store systems often become unreliable when balances are stored as editable totals or posted transactions are modified in place. Sales, returns, purchases, inventory valuation, cash drawers and accounting must remain explainable after corrections, retries, imports and integrations.

The product requires accurate historical reporting, auditability, period close, reconciliation and deterministic recovery.

## Decision

Use append-only authoritative ledgers:

1. **Stock ledger** for quantity and inventory value movements.
2. **Financial journal** for double-entry accounting.
3. **Cash/payment ledgers** for tender, provider transaction, settlement and drawer events.
4. **Liability ledgers** for gift card, store credit and loyalty balances where applicable.

Current balances and dashboard aggregates are projections. Posted entries are never silently edited or deleted. Corrections create reversal, return, credit/debit, adjustment or revaluation entries that reference the original.

A `posting_group` links one business event to its sales/purchase documents, stock entries, payment events, journal entries, audit events and outbox events.

## Invariants

- Posted journal debit equals credit according to currency/rounding policy.
- Stock balance equals stock-ledger sum for the same dimensions.
- Expected cash equals cash-event sum.
- Gift card/store-credit/loyalty balance equals liability-ledger sum.
- Posted entries retain source document, rule version, actor, business date and reversal reference.
- A closed period blocks ordinary posting/modification.
- Duplicate idempotent commands create no duplicate entries.
- Reports can drill from aggregate to source document and ledger.

## Rationale

Immutable ledgers provide:

- complete audit history;
- reliable reconciliation;
- safe retry/idempotency behavior;
- reproducible historical reports;
- clear correction semantics;
- projection rebuild and disaster recovery;
- fraud/error investigation;
- consistent integration exports.

## Consequences

### Positive

- balances are explainable;
- corrections preserve history;
- accounting and inventory reconcile;
- projections can be rebuilt;
- duplicate/replay detection is simpler;
- period close and audit are credible.

### Negative

- more rows and storage growth;
- correction workflows are more complex than editing totals;
- historical queries need indexes/partitioning/projections;
- operational teams need exception/reconciliation tools;
- imports must create opening entries rather than direct balances.

## Posting behavior

### Example cash sale

One controlled transaction creates:

- sales/invoice document and lines;
- cash payment and drawer event;
- stock issue and cost-layer consumption;
- journal entry for cash/revenue/tax;
- journal entry or lines for COGS/inventory;
- receipt snapshot;
- audit and outbox events.

### Example return

Creates new return/credit/refund/stock/journal records referencing original allocations. It does not mutate the original sale.

### External payment

Provider authorization is a state machine. The final business posting happens only at the configured payment state. Lost responses are recovered through idempotency, status query and signed webhook; blind new charges are prohibited.

## Projection policy

Projections such as `stock_balances`, customer balance, daily sales and dashboard aggregates:

- have explicit source cursor/version;
- are never used to erase/replace source ledgers;
- have reconciliation checks;
- can be rebuilt;
- expose freshness;
- use controlled transactional updates when immediate consistency is required.

## Data lifecycle

- Ledger records are retained according to legal/business policy.
- Privacy deletion may pseudonymize customer identity where legally allowed but does not destroy required financial history.
- Partition/archive strategy is based on measured volume.
- Legal documents and posting snapshots are immutable/versioned.
- Database migrations never rewrite historical financial meaning.

## Guardrails

- No direct `UPDATE stock_quantity` as a business operation.
- No direct account/customer/gift-card balance update without a ledger entry.
- No delete endpoint for posted entries.
- Manual journal/adjustment requires permission, reason, attachments/approval as configured.
- Posting rules are effective-dated; future changes do not alter old entries.
- Every posting service has golden and property-based tests.

## Validation

- projection-to-ledger reconciliation;
- journal balance property tests;
- FIFO/weighted-average golden tests;
- return/reversal net-effect tests;
- duplicate/offline replay tests;
- period close/reopen tests;
- opening import and restore/rebuild tests;
- stock-to-GL and subledger-to-control-account reconciliation.

## Related documents

- `docs/04-DOMAIN-AND-DATA-MODEL.md`
- `docs/14-REPORTING-ANALYTICS.md`
- `docs/13-TESTING-OBSERVABILITY-SRE.md`
