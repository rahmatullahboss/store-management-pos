# MOD-E Finance Operations Runbook

## Purpose

This runbook covers payment recovery, accounting integrity, bank reconciliation, event delivery and release readiness for the MOD-E financial kernel. It applies to non-production and production environments after the corresponding migrations and runtime bindings are approved.

## Release gate

Call `GET /v1/finance/readiness` with a principal holding `platform.audit.read`.

- `ready`: all blocking and warning controls are clear.
- `degraded`: release requires an explicit risk acceptance and named owner for every warning.
- `blocked`: do not deploy or close a period until every failed control is resolved.

The endpoint evaluates:

1. PAY-0002, ACC-0002 and BNK-0002 migration presence.
2. Payment intents left in `unknown` state for more than 15 minutes.
3. Finance idempotency records left in `processing` for more than 10 minutes.
4. Unbalanced transaction or base-currency journal totals.
5. Unreconciled bank statement differences older than 24 hours.
6. Open banking reconciliation exceptions.
7. Finance outbox events unpublished for more than 5 minutes.
8. Pending finance dead-letter records.

## Payment unknown-state recovery

1. Do not blindly repeat authorize, capture, void or refund commands.
2. Run the `payment_status_recovery` job with the original payment intent ID and a new job idempotency key.
3. Confirm the provider status query result and the internal payment timeline.
4. Retry only when the provider result proves that the requested effect did not occur.
5. Escalate when the provider remains ambiguous after the configured retry budget.

Evidence to retain:

- payment intent ID;
- provider account and provider reference;
- original command idempotency key;
- recovery request and trace IDs;
- normalized provider outcome;
- resulting audit and outbox event IDs.

Never record PAN, CVV, magnetic-stripe data, PIN data or unrestricted provider payloads in logs, audit metadata or incident notes.

## Journal integrity incident

Any unbalanced posted journal is a release blocker.

1. Stop period-close and ordinary finance deployment activity.
2. Capture the journal ID, posting group, source document and rule version.
3. Confirm whether the problem is a reporting/read-model defect or persisted journal corruption.
4. Do not update or delete a posted journal.
5. Correct a valid business error through an exact linked reversal and a new corrected journal.
6. Treat persisted debit/credit inequality as a severity-one data-integrity incident.

## Bank reconciliation exception

1. Review the statement line, signed unmatched amount, candidate type and candidate ID.
2. Confirm currency, scale, legal entity and bank-account identity.
3. For an incorrect match, create an append-only reconciliation reversal with a reason.
4. Re-match only after the reversal restores the expected unmatched balance.
5. Resolve or waive reconciliation exceptions with owner and evidence before period close.

Run the `bank_reconciliation_control` job for the required bank account and period. A `completed_with_exceptions` result is not automatically retried; it requires operational review.

## Stuck idempotency record

1. Confirm the command's audit, resource and provider evidence before changing any state.
2. If the effect completed, restore the idempotency record to a completed response matching the existing resource.
3. If the effect did not occur and no external ambiguity exists, mark the failed attempt according to the approved recovery procedure and replay with a new request context.
4. Never delete an idempotency record to force a retry.

## Outbox and dead-letter recovery

For stale outbox events:

1. Restore the publisher dependency.
2. Re-run the publisher using the existing event identity.
3. Confirm consumer deduplication and `published_at` evidence.

For dead letters:

1. Inspect only redacted payload metadata.
2. Correct the consumer or contract incompatibility.
3. Replay with the original message identity.
4. Mark `discarded` only with an approved reason when replay is intentionally prohibited.

## Metrics

Finance API operations emit:

- `mod_e.finance.operation` with `module`, `operation` and `outcome` attributes;
- `mod_e.finance.operation.duration_ms` with the same low-cardinality attributes.

Finance workers emit:

- `mod_e.finance.job` with `type` and `status`;
- `mod_e.finance.job.duration_ms` with the same attributes.

Do not add tenant IDs, payment IDs, journal IDs, provider references or customer data as metric attributes.

## Deployment sequence

1. Confirm the branch descends from the approved Foundation SHA.
2. Apply Foundation migrations followed by PAY-0001/0002, ACC-0001/0002 and BNK-0001/0002.
3. Run `npm run test:database:mod-e` against the target preview database.
4. Run the repository verification suite.
5. Confirm `/v1/finance/readiness` is `ready`, or document approved degraded-state acceptance.
6. Deploy API, worker and admin surfaces.
7. Validate one non-financial read, one finance report read and one deterministic non-production recovery exercise.

## Rollback and correction

Schema rollback is not performed by destructive reverse migration. Restore service compatibility by rolling the application back while retaining append-only financial evidence. Correct financial effects through reversal commands. If a migration introduces an operational defect, ship a forward corrective migration and preserve the original migration record.

## Escalation data

Provide only:

- environment and region;
- request and trace IDs;
- internal resource IDs;
- normalized status and error code;
- migration IDs and checksums;
- control totals and timestamps;
- redacted provider or bank evidence.

Exclude secrets, credentials, cardholder data, unrestricted webhooks and raw bank-statement files.
