# Localization, Country Packs and Compliance Operations

## Scope

MOD-F owns effective locale/currency/time metadata, versioned country-pack activation, legal numbering, immutable legal documents, fiscal/e-invoice provider state and retention-aware privacy operations. PostgreSQL remains canonical. Pack manifests and provider capabilities are data/configuration; no country pack may introduce a country-specific core column.

## Support-level rule

- `experimental`: engineering validation only.
- `limited`: selected flows are implemented, but production activation requires local legal, tax and accounting review.
- `validated`: may be assigned only after reviewed evidence is attached to the pack version and support matrix.

The bundled Bangladesh fixture is `limited`. It is not a production compliance claim. Fiscal submission, electronic invoicing and offline legal issuance remain disabled in that fixture.

## Activation runbook

1. Verify manifest hash, signature/key identifier, support matrix and effective dates.
2. Confirm the legal entity/store scope and approval evidence.
3. Call the activation API with an idempotency key and explicit effective date.
4. Read the effective configuration for the target business date and verify locale, currency and business-day metadata.
5. Keep the previous activation as superseded evidence; never rewrite historical documents to the new pack version.

Concurrent activation for the same scope is serialized through an advisory lock. Replaying the same idempotency key with different content is an error.

## Legal-number operations

- Allocate through the command API/function only; direct sequence-table writes are prohibited.
- Every allocation is unique by tenant/scope/operation and tenant/legal number.
- The business date is an explicit input; process time must not select a numbering period.
- Offline allocation is permitted only when the scope explicitly enables it and a device-specific allocation exists.
- Range exhaustion blocks issuance. Operators must create and approve a new scope; they must not alter or reuse issued numbers.

## Legal-document evidence

A legal document records the exact pack, template, tax-rule and currency-metadata versions used at issue time, plus semantic/rendered hashes and an archive reference. It is append-only. Corrections create a new document referencing the corrected document.

Hash mismatch or a changed replay payload is an idempotency conflict and requires investigation; do not replace the stored snapshot.

## Fiscal provider recovery

Provider calls may finish in `accepted`, `rejected` or `unknown` state. Connection loss after provider effect is recorded as `unknown`.

- Do not blindly submit a new request when state is unknown.
- Replayed `pending` or `unknown` jobs are placed in the review queue.
- Query/reconcile through the provider's supported recovery mechanism before recording `accepted` or `rejected`.
- Preserve provider reference, pack version, payload hash, event history, request ID and trace ID.
- Unsupported country-pack/provider combinations are rejected before provider submission.

## Privacy operations

Privacy actions are retention-policy scoped. Immutable statutory evidence is preserved; erasure may become anonymization only where policy allows it. Terminal completion requires the preserved-evidence and affected-resource references plus completion time.

Operators must never delete legal documents, accounting journals, cash/stock ledgers or immutable audit evidence to satisfy a privacy request.

## Monitoring and alerts

Track these metrics and queues:

- `mod_f.compliance.job` by type/status;
- `mod_f.compliance.job.duration_ms`;
- fiscal submissions in `unknown` or long-running `pending` state;
- rejected/partially completed privacy operations;
- number scopes approaching exhaustion;
- active pack versions near effective end;
- signature/manifest verification failures;
- direct-write or PUBLIC-execute privilege regressions.

Alert immediately on duplicate legal numbers, changed legal-document replay payloads, tenant-isolation failure, unsupported offline legal issuance or a provider result that cannot be reconciled.

## Recovery and rollback

Migrations are deterministic and replay-checked on the assigned Neon branch. Country-pack activation is forward-only: rollback is a new approved activation of a prior compatible version, never mutation of historical activation/document rows.

Before a provider or pack rollout, rehearse on a non-production Neon branch with synthetic data. Verify forced RLS, command-only runtime writes, deterministic replay, document hashes and fiscal unknown-state handling.

## Security boundaries

- Production secrets and provider reusable credentials are never stored in pack manifests, legal documents or client projections.
- Runtime roles have SELECT plus reviewed command-function execution only.
- Every MOD-F table uses forced tenant RLS.
- `PUBLIC` execution on MOD-F security-definer functions is prohibited.
- Logs and metrics contain identifiers/status only; document payloads, personal data and provider secrets are excluded.
