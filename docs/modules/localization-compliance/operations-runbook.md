# MOD-F operations runbook

## Readiness checks

Before enabling a country pack for a legal entity or store:

1. Confirm the pack manifest hash, signature and signing-key identifier against the reviewed release evidence.
2. Confirm support level, capabilities, limitations and effective dates. `experimental` packs are never production-ready; `limited` packs require explicit local legal, tax and accounting acceptance.
3. Verify locale fallback, currency precision/cash rounding and business-day boundaries for the target location.
4. Verify legal-document templates, numbering scope/range and correction rules.
5. Verify provider capability mapping. An empty or unsupported fiscal-provider registry must fail closed.
6. Verify the current deployment has forced RLS, zero runtime direct-write grants and zero `PUBLIC` execute grants.

## Activation

Use `POST /v1/localization/activations` with a stable idempotency key, request hash, legal entity/store scope and explicit effective date. Read `/v1/localization/effective-configuration` after activation and compare the returned pack, locale, currency and business-day versions with the reviewed plan.

Activation is forward-only. A rollback is a new approved activation of a previously reviewed compatible version. Never mutate historical activation or document rows.

## POS behavior

The POS adapter applies locale, direction, ISO currency and accounting scale from the effective pack. Checkout fails closed when:

- legal receipts are unsupported;
- offline legal issuance is unsupported;
- the pack allows offline cash only and a non-cash tender is present;
- an existing checkout rule already blocks completion.

Operators must not bypass these blocks by changing browser locale, currency formatting or connectivity state. Restore connectivity or use a documented contingency workflow.

## Legal numbers and documents

Allocate legal numbers only through the controlled command/API. Range exhaustion blocks issuance. Create and approve a new effective scope instead of changing `next_value`, reusing a number or shortening evidence.

Issued legal documents are immutable snapshots. A correction creates a new credit/debit/correction document referencing the original. Preserve the pack, template, tax, currency, semantic hash, rendered hash and archive reference.

## Fiscal submission

- `pending`: wait for or query the configured provider.
- `accepted`: retain provider reference and immutable event history.
- `rejected`: correct the source condition through an approved workflow; do not edit the submitted snapshot.
- `unknown`: block blind resubmission. Reconcile through provider status lookup or documented support escalation, then record an explicit transition.

Worker jobs return `review` for unknown or replayed-pending outcomes and must remain visible in the compliance evidence queue.

## Privacy operations

Validate identity, authority, retention policy and legal basis before approval. Erasure may become anonymization only where the effective policy allows it. Completion or partial completion must list preserved legal evidence and affected resources. Never delete legal documents, journals, stock/cash ledgers or immutable audit records.

## Monitoring

Alert on:

- duplicate or exhausted legal-number scopes;
- unknown fiscal state beyond the provider recovery objective;
- rejected fiscal or privacy transitions;
- active pack nearing effective end without a reviewed successor;
- signature/manifest mismatch;
- unsupported offline checkout attempts;
- RLS, direct-write or function-privilege regression;
- cross-tenant reads in any MOD-F projection.

Use request ID, trace ID, tenant ID, pack version and resource ID for correlation. Do not log document payloads, personal data or reusable provider secrets.

## Incident recovery

1. Stop new activation, numbering or provider-dispatch commands for the affected scope.
2. Preserve current audit/outbox, fiscal events, document hashes and provider references.
3. Determine whether the failure is configuration, provider state, permissions, data integrity or deployment infrastructure.
4. Rehearse the corrective migration/configuration on a non-production Neon branch.
5. Use additive migration, reversal, correction document or new activation; never rewrite immutable evidence.
6. Rerun repository verification, MOD-F full-chain Neon rehearsal, Neon recovery and Cloudflare preview/runtime/cleanup gates.
7. Record the incident outcome and any support-level limitation change.
