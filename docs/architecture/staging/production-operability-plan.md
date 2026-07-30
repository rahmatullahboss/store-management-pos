# Production operability gate plan

Status: aggregate staging policy implemented; production activation gates remain open
Date: 2026-07-31
Branch: `ops/persistent-admin-pos-staging-v1`

## Purpose

Define the evidence required before persistent synthetic staging can be promoted into a controlled production launch. This plan does not create production infrastructure, use production credentials or enable additional financial/business commands.

Inventory reservation create/release remains the only authoritative business write until every applicable gate below is approved and proven.

## Gate 1 — environment separation and release identity

Required:

- approved public product name and production domain;
- distinct Cloudflare production Worker/Pages resources;
- distinct Neon production project and protected production branch;
- separate staging and production secret scopes;
- least-privilege deployment identity with auditable rotation;
- deployment manifest binding Git SHA, migration set, Worker version and database branch;
- production launch approval recorded outside the application runtime.

Failure policy:

- staging credentials cannot deploy production;
- production credentials cannot be read by pull-request workflows;
- missing environment classification fails deployment before migration or upload.

## Gate 2 — Neon backup, restore and retention

Required policy:

- point-in-time recovery window and retention duration;
- scheduled logical export for disaster portability;
- encryption and access-control policy for export artifacts;
- documented recovery-point objective and recovery-time objective;
- restore target must be a newly created isolated branch/project, never the live production branch;
- post-restore migration checksum, tenant count, ledger reconciliation, journal balance and outbox consistency checks;
- restore evidence must not contain production row values or credentials in CI artifacts;
- retention expiry and emergency legal-hold procedures.

Required rehearsal:

1. create an isolated recovery target;
2. restore from an approved recovery point;
3. run all migrations in verification mode;
4. run tenant/RLS isolation checks;
5. reconcile immutable inventory ledgers and accounting journals;
6. verify auth/session/action-token tables without preserving active browser sessions;
7. prove application health against the recovery target;
8. destroy only the temporary recovery target after evidence is retained.

Launch blocker:

- no production launch until one full restore rehearsal passes and an owner accepts the measured RPO/RTO.

## Gate 3 — authentication and MFA recovery governance

Required:

- production policy for mandatory email verification;
- verified support ownership and escalation path;
- factor replacement requires a recently completed password-recovery flow or separately approved high-assurance support procedure;
- no support operator may read or set a user's TOTP secret;
- password reset revokes sessions, step-up grants and password-derived factors, as staging already proves;
- factor-replacement audit event includes actor, reason, request/case reference and outcome;
- recovery abuse rate limits and alerts;
- user notification for password reset, factor revocation and new factor enrolment;
- emergency account lock procedure;
- documented handling for lost email access without security-question fallback.

Prohibited:

- plaintext recovery codes in database/logs;
- reusable universal bypass codes;
- administrator password assignment;
- disabling MFA without immutable audit evidence.

## Gate 4 — transactional email delivery

Required:

- approved provider and verified sender domain;
- provider API credential stored only as a production secret;
- separate templates for password recovery, email verification, password-changed notice and MFA-factor-changed notice;
- links bound to the approved HTTPS production origin;
- token values excluded from provider metadata, application logs and analytics;
- delivery idempotency key and bounded retry policy;
- bounce, complaint and suppression handling;
- delivery-status monitoring without exposing email content;
- rate limits by account, tenant, client fingerprint and provider quota;
- provider outage behaviour returns the same non-enumerating browser response and does not issue unlimited active tokens.

Launch evidence:

- successful delivery to controlled test inboxes;
- expired/replayed links rejected;
- unknown/known account responses indistinguishable;
- provider failure and retry behaviour proven;
- sender-domain authentication independently verified.

## Gate 5 — monitoring and alerting

Minimum production signals:

### Availability

- Worker request success/error rate;
- database connectivity and transaction timeout rate;
- protected-read and controlled-command latency;
- deployment health and version drift.

### Authentication

- sign-in success/failure/blocked counts;
- credential lockouts;
- recovery request and completion counts;
- invalid/replayed recovery token counts;
- MFA enrolment, step-up failure and replay rejection counts;
- session-revocation failures.

### Business integrity

- outbox oldest-unpublished age and backlog count;
- inventory projection lag and reconciliation mismatches;
- journal imbalance must remain zero;
- payment/provider reconciliation failures when those commands are later enabled;
- command version-conflict and idempotency-replay rates.

### Security

- cross-tenant/RLS denial anomalies;
- repeated cross-warehouse denials;
- secret-scan/deployment-policy failures;
- unusual recovery or MFA activity by tenant/account/client fingerprint.

Alert requirements:

- severity, owner and response time are defined per signal;
- alerts use aggregate identifiers and never include tokens, passwords, document contents or database URLs;
- alert delivery is tested;
- every alert has a linked runbook and bounded diagnostic queries;
- silence/maintenance windows are auditable.

Implemented in synthetic staging on 2026-07-31:

- twelve fixed low-cardinality aggregate signals covering HTTP/browser evidence, identity/recovery/MFA controls, controlled reservation evidence, artifact leakage, synthetic outbox publisher delivery, inventory reconciliation, journal balance and post-publisher outbox health;
- zero-tolerance critical gates for publisher, integrity, identity, accessibility and leakage failures;
- a staging-only, lease-based synthetic outbox publisher with canonical envelope hashing, durable hash-only inbox receipts, replay-safe acknowledgement and bounded retry;
- warning-only post-publisher outbox thresholds until a production transport and approved production SLO exist;
- schema-v7 atomic report enrichment that preserves publisher and operability evidence before a critical gate fails;
- bounded GitHub Actions summaries containing fixed alert IDs, severity, owner and runbook path rather than raw metric payloads;
- `docs/architecture/staging/operability-alerts-runbook.md` with ownership, response objectives, containment and recovery verification.

Still required for production:

- approved observability backend and production resource binding;
- tested paging/notification delivery, acknowledgement and escalation;
- approved production SLOs, critical outbox thresholds, maintenance windows and audit retention.

## Gate 6 — incident and support runbooks

Required runbooks:

- authentication outage;
- suspected credential/token leakage;
- account takeover and emergency revocation;
- transactional-email outage;
- database outage or degraded Neon branch;
- failed migration/deployment rollback;
- outbox backlog;
- inventory reconciliation mismatch;
- payment or ledger incident before those writes are enabled;
- tenant isolation concern;
- production restore invocation.

Every runbook must define detection, immediate containment, evidence preservation, customer communication ownership, recovery verification and post-incident review.

## Gate 7 — launch rehearsal

A launch candidate must prove:

- exact reviewed Git SHA and migration manifest;
- clean repository, design, Cloudflare and Neon recovery checks;
- production-like synthetic smoke against release configuration;
- backup/restore rehearsal;
- authentication, recovery, MFA and controlled-reservation journeys;
- zero leaked credentials/tokens in artifacts;
- monitoring and alert delivery;
- rollback to the prior application version without reversing immutable migrations;
- explicit approver decision.

## Implementation order

1. define environment/secret ownership and production resource names;
2. implement isolated Neon restore rehearsal automation;
3. connect the completed aggregate staging policies to an approved production alert-delivery backend and approved SLOs;
4. define MFA recovery/factor-replacement workflow and audit contract;
5. select transactional-email provider and implement an adapter behind the existing delivery interface;
6. execute a full synthetic production launch rehearsal;
7. request controlled production launch approval.

## Current position

Completed in synthetic persistent staging:

- first-party password/session authentication;
- encrypted TOTP MFA and single-use step-up;
- protected inventory/procurement reads;
- controlled inventory reservation create/release;
- password-recovery and email-verification token lifecycles;
- exact-head CI, accessibility, recovery and artifact evidence;
- aggregate synthetic-staging operability queries, deterministic thresholds, atomic report evidence and linked response runbook.

Still blocked:

- production resources/secrets/domain;
- production email delivery;
- production MFA support governance;
- backup/restore acceptance;
- production monitoring backend, alert delivery, paging and approved SLOs;
- remaining incident/support readiness;
- controlled launch approval.
