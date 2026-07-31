# Production provider operational gate

## Purpose

The operational gate sits in front of the recorded internal-token provider signing path. It verifies that a provider is currently permitted and healthy enough to receive a signing request before any provider or durable-journal operation runs.

This boundary does not provision a provider, create a KMS or HSM key, configure workload identity, choose a production owner, or approve production launch.

## Policy evidence

A policy is externally produced, SHA-256 digest-bound, short lived and exact-schema validated. It contains only low-cardinality controls and key-reference digests:

- environment: `production` or `staging`;
- provider class: `cloud-kms`, `managed-hsm` or `pkcs11-hsm`;
- ordered bindings for `command-token` and `read-token`;
- one distinct key-reference digest for each purpose;
- maximum concurrent requests;
- maximum error rate in basis points;
- maximum p95 latency;
- maximum single-request latency;
- provider-audit freshness limit;
- durable-journal acknowledgement freshness limit;
- generated-at and expiry timestamps;
- emergency-disable state.

The policy window cannot exceed fifteen minutes. Test doubles are not operationally eligible.

## Health evidence

A health snapshot is independently digest-bound and limited to a five-minute observation window. It must be no more than thirty seconds old when evaluated. It includes:

- provider class;
- signing purpose;
- key-reference digest;
- observation-window timestamps;
- attempt and failure counts;
- current in-flight request count;
- p95 latency;
- last provider-audit timestamp;
- last durable-journal acknowledgement timestamp;
- emergency-disable state.

The health snapshot must bind to the exact provider class, purpose and key-reference digest selected by the command.

## Gate sequence

1. Validate the exact policy schema and policy digest.
2. Reject expired, future, disabled or emergency-stopped policy evidence.
3. Verify the command purpose and key-reference digest against the two-purpose allowlist.
4. Validate the exact health schema and health digest.
5. Reject stale, future, emergency-stopped or incorrectly bound health evidence.
6. Enforce concurrency, p95 latency and error-rate limits.
7. Enforce provider-audit and durable-journal freshness.
8. Execute the existing audited provider signer.
9. Require durable journal acknowledgement before signature return.
10. Reject the result if the actual provider request latency exceeds policy.

When any preflight control fails, the provider and recorder are not called. When the actual request exceeds policy, the signature is not returned even though the validated provider receipt remains recorded for investigation.

## Aggregate output

Successful readiness evidence contains only:

- environment;
- provider class;
- purpose;
- allowed-purpose count;
- aggregate boolean gate results.

It does not include policy digests, health digests, key-reference digests, raw key references, signing inputs, signatures, provider resource names or audit identifiers.

## Relationship to production admission

Operational readiness is one input to the production launch-admission process. It does not replace the launch bundle. Production remains blocked until the launch-admission boundary receives all ten verified controls and three distinct owner approvals in a bounded external evidence file.

A green staging or CI run is evidence that the fail-closed boundary works. It is not evidence that a real production provider, production key, named owner, workload identity, immutable audit sink, monitoring backend or incident process exists.

## Remaining external responsibilities

Production owners must still provide and govern:

- a real non-exportable KMS or HSM key;
- least-privilege signing workload identity;
- protected provider and audit-sink configuration;
- monitored emergency-disable operation;
- approved error, latency and concurrency budgets;
- alerting, paging and incident ownership;
- scheduled and emergency rotation and revocation;
- production launch evidence and approvals.
