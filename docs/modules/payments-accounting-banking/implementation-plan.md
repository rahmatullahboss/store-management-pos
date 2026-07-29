# MOD-E Payments, Accounting and Banking Implementation Plan

## Activation

- Approved Foundation SHA: `57f21e8c14e27ce3ad96a862cf6de82c2c6cd27c`
- Git branch: `module/payments-accounting-banking-v1`
- Worktree: `.worktrees/payments-accounting-banking`
- Neon branch: `dev/module-payments-accounting-banking` (`br-rapid-fog-ax8tutgm`)
- Owner: `rahmatullahboss`
- Dependency mode: frozen contracts plus local MOD-B/MOD-C simulators; no unmerged module imports.

## Non-negotiable invariants

1. Amounts use integer minor units plus ISO currency and explicit scale.
2. Posted journal entries and lines are append-only.
3. Every posted journal balances by transaction and base currency.
4. Corrections create reversal or adjustment journals; they never mutate a posted journal.
5. Provider commands and callbacks are idempotent and payload-hash checked.
6. Provider timeout/ambiguous results enter `unknown`; blind retries are blocked until status recovery.
7. Refunds cannot exceed captured less already-refunded amounts.
8. Settlement gross less fees and adjustments equals net.
9. AR/AP subledgers reconcile to their control accounts.
10. Closed periods reject ordinary postings; reopen and exception posting require approval evidence.
11. General logs, audit metadata and events exclude PAN, CVV, secrets and raw provider payloads.
12. Reports expose currency, business date, freshness and source drill-through.

## Checkpoints

### E0 — Activation and frozen boundary

- Activate the programme board and record ownership/evidence.
- Add this plan and rolling handoff.
- Define approved MOD-B/MOD-C simulator fixtures and boundary tests.
- Verify baseline and push the activation checkpoint.

### E1 — Exact finance domain and contracts

- Test-first Money guards, payment state machine, refund capacity, settlement arithmetic, balanced journal builder, reversal builder and period guards.
- Add payment/accounting/banking public module contracts without changing the frozen shared contract pack.
- Add observability redaction and safe diagnostic metadata.

### E2 — Canonical PostgreSQL model

- Add PAY, ACC and BNK versioned migrations and manifests.
- Enforce tenant/legal-entity scope, forced RLS, immutable ledgers, balanced posting, idempotency, period locks and runtime privileges in PostgreSQL.
- Apply to the isolated Neon branch and verify migration, RLS, constraints and replay safety.

### E3 — Payment lifecycle and recovery

- Implement provider-neutral intents, attempts, authorization/capture/void, allocations, refunds, webhook normalization, signed callback verification, unknown-state recovery and deterministic sandbox provider.
- Persist audit/outbox evidence atomically with command effects.
- Add provider outage, duplicate callback, payload mismatch and timeout-recovery tests.

### E4 — Accounting and subledgers

- Implement chart of accounts, posting rules, posting groups, journal posting/reversal/adjustment, AR/AP open items and allocations, fiscal periods and close/reopen workflow.
- Add trial balance, general ledger, P&L, balance sheet, AR/AP aging and control-account reconciliation queries.
- Add accountant-readable golden fixtures and property-style invariant tests.

### E5 — Banking and reconciliation

- Implement bank accounts, statement import/deduplication, settlement matching, bank reconciliation, manual match/unmatch through compensating records, exceptions and close evidence.
- Add sale-to-settlement-to-bank and payable-to-payment golden scenarios.

### E6 — API, jobs and finance UI

- Add task-oriented `/v1/payments`, `/v1/refunds`, `/v1/journals`, `/v1/periods`, `/v1/bank-statements` and `/v1/reconciliations` routes with permission/approval/idempotency enforcement.
- Add recovery/reconciliation jobs and metrics.
- Build the admin finance operating surface with keyboard, RTL, localisation, resilient states, freshness labels and drill-through.

### E7 — Production evidence and handoff

- Run format, lint, boundaries, typecheck, unit/architecture/integration, secret/licence/SBOM and design verification.
- Exercise isolated Neon migration rebuild, rollback, recovery and reconciliation evidence.
- Update board evidence, runbooks, known limitations and final handoff.
- Commit/push every coherent checkpoint and open the final draft PR.
