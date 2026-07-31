# Production launch admission

Status: fail-closed policy and CI evidence implemented; production infrastructure and approval evidence not provisioned
Date: 2026-07-31

## Purpose

The production launch admission boundary prevents a deployment target from being treated as production-ready merely because synthetic staging, repository tests or migration recovery are green. Staging operability and production admission are separate decisions.

`tooling/scripts/check-production-launch-admission.mjs` is included in repository verification. For unset, CI, development or staging targets it writes an aggregate `not_requested` report with a blocked launch gate and exits successfully. This allows non-production verification to continue without representing it as production approval.

When `STORE_DEPLOYMENT_TARGET=production`, the check fails unless `PRODUCTION_LAUNCH_EVIDENCE_PATH` points to a valid external evidence bundle. Inline JSON evidence is prohibited because environment values are commonly exposed through process inspection, debug output and CI configuration.

## Required controls

A production bundle must contain each control exactly once:

1. non-exportable KMS/HSM signing;
2. signing workload identity;
3. immutable provider audit sink;
4. protected JWKS publication;
5. production monitoring and paging;
6. incident-response ownership;
7. production recovery-email delivery;
8. immutable evidence archive and legal-hold support;
9. retention and disposition ownership;
10. database backup and recovery.

Each control has an exact schema, a bounded provider class, a verified timestamp and a purpose-specific SHA-256 digest. Raw key resources, service-account identifiers, audit identifiers, URLs, email addresses, human names, credentials, signatures and provider responses are not accepted.

## Independent approval

Admission requires three distinct actors in these policy roles:

- `security_owner`;
- `platform_owner`;
- `operations_owner`.

Every approval binds the release digest, complete evidence digest, role, actor digest and approval time. Approvals must occur inside the evidence window. A single actor cannot satisfy more than one role.

The final bundle digest binds the release, evidence, expiry and all approval digests. The evidence lifetime is limited to four hours, and evidence older than 24 hours is rejected.

## Output and privacy

A successful evaluator returns only:

- schema version;
- environment;
- status and launch gate;
- control and approval counts;
- expiry;
- explicit flags confirming identifiers and evidence digests are omitted.

The aggregate report is written to `artifacts/foundation/production-launch-admission.json`. CI uploads only the non-production `not_requested` report. Production evidence files and their digests must not be uploaded as ordinary CI artifacts or written to application logs.

## CI contract

`.github/workflows/production-launch-admission.yml` runs with target `ci`, invokes the admission check and independently asserts that the result is `not_requested` with a blocked launch gate. It uses no production secrets and cannot report production admission.

Persistent staging invokes repository verification and therefore executes the same gate in non-production mode. Its synthetic staging result remains evidence of application behavior only.

## What this does not provide

This repository policy does not provision a KMS/HSM, workload identity, audit sink, protected production JWKS route, paging service, recovery-email provider, backup system, evidence archive or named human owners. It does not create a production deployment workflow and does not authorize launch.

A real production release still requires independently generated evidence from the deployed providers, approved named owners, a protected mechanism for mounting the evidence file, a production workflow that invokes this gate before any irreversible deployment action, and organizational approval that the evidence is sufficient.
