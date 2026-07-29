# MOD-E Payment Lifecycle and API

## Command boundary

Payment provider calls never run inside a database transaction. Every provider command uses two short transactions:

1. **Claim** — validate the current payment state, claim the idempotency key and append an immutable `payment_attempts` record.
2. **Complete** — after the external provider responds, append one `payment_attempt_results` record, update the intent projection, and atomically write state-event, audit and outbox evidence.

A timeout after provider effect is recorded as `unknown`. A second capture, void or refund is rejected until an explicit provider status query resolves the state. This prevents blind double charges.

## Exact state and amount rules

- Intended, captured and refunded amounts are integer minor units with ISO currency and explicit scale.
- Captured cannot exceed intended.
- Refunded cannot exceed captured.
- Recovery of an ambiguous capture updates the captured projection only when the provider status resolves to `captured`.
- Refund completion creates new refund, attempt-result, state-event, audit and outbox facts; it does not rewrite provider history.
- Settlement net must equal gross less fees and adjustments in the same currency and scale.

## Runtime database commands

`PAY-0002` adds task-oriented security-definer commands:

- `payment.create_intent_v1`
- `payment.begin_attempt_v1`
- `payment.complete_attempt_v1`
- `payment.begin_refund_v1`
- `payment.complete_refund_v1`
- `payment.import_settlement_v1`

The runtime role can execute these commands and read tenant-scoped projections, but still has no direct INSERT, UPDATE or DELETE privilege on payment tables. Provider attempts and results are append-only.

## HTTP API

All mutation endpoints require authentication, tenant context, narrow permission and an `Idempotency-Key` header.

| Method | Route | Permission | Purpose |
|---|---|---|---|
| POST | `/v1/payments/intents` | `payments.intent.create` | Create a provider-neutral intent |
| POST | `/v1/payments/intents/{id}/authorize` | `payments.authorize` | Authorize through the configured provider |
| POST | `/v1/payments/intents/{id}/capture` | `payments.capture` | Capture an authorization |
| POST | `/v1/payments/intents/{id}/void` | `payments.capture` | Void an authorization |
| POST | `/v1/payments/intents/{id}/recover` | `payments.recover` | Query and resolve ambiguous provider state |
| POST | `/v1/refunds` | `payments.refund.request` and, when supplied, `payments.refund.approve` | Create and execute a controlled refund |
| POST | `/v1/settlements/import` | `payments.settlement.import` | Import an exact gross-to-net settlement |

Money JSON uses the canonical shape:

```json
{
  "amountMinor": "12500",
  "currency": "GBP",
  "scale": 2
}
```

Payment-method references are accepted only as provider/vault references and are never returned in API responses, audit metadata, events or general diagnostics.

## Provider configuration

The deterministic simulator is enabled only in local, development, preview and test environments. Production fails closed until an explicitly configured live provider adapter is installed. No PAN, CVV or raw provider payload is stored.

## Verification evidence

- Service tests prove duplicate replay, timeout-after-effect recovery, refund permission and settlement arithmetic.
- A fresh PostgreSQL rebuild applies FND-0001 through FND-0005, PAY-0001/PAY-0002, ACC-0001 and BNK-0001.
- The rollback-only lifecycle drill proves intent replay, completed-attempt replay, ambiguous capture, blind-retry rejection, recovery to captured, exact full refund, settlement replay, audit/outbox evidence and direct-DML denial.
- `npm run verify` passes 32 tests plus format, lint, boundaries, typecheck, secret scan, licence scan and SBOM generation.

## Deployment note

`PAY-0002` is validated on a fresh local PostgreSQL database and is included in module-aware preview/recovery manifests. The connected Neon execution tool was unavailable during this checkpoint, so applying `PAY-0002` to `br-rapid-fog-ax8tutgm` remains a recorded deployment-evidence action; no credential was copied into the workspace or command history.
