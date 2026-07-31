# Production control attestation assembly boundary

## Purpose

Production launch admission requires ten verified controls. This boundary defines how external control observations are normalized into the existing digest-only production launch evidence format.

The assembler does not provision providers, discover resources, nominate owners or approve a launch. It only validates bounded attestations and assembles evidence that must still pass three-owner admission and the independent revocation checkpoint.

## Required controls

The assembler covers exactly:

1. database backup and recovery;
2. evidence archive and legal hold;
3. incident-response ownership;
4. non-exportable KMS/HSM signing;
5. production monitoring and paging;
6. protected JWKS publication;
7. immutable provider audit sink;
8. recovery email delivery;
9. retention and disposition ownership;
10. signing workload identity.

Provider classes match the production admission allowlist exactly.

## Critical dual-source controls

The following controls require two independent issuer classes:

| Control | Provider-side issuer | Independent verifier |
| --- | --- | --- |
| database backup and recovery | `database-provider-control-plane` | `independent-recovery-verifier` |
| non-exportable KMS/HSM signing | `kms-provider-control-plane` | `independent-key-policy-verifier` |
| production monitoring and paging | `monitoring-provider-control-plane` | `independent-alert-delivery-verifier` |

Every attestation has a unique issuer digest and source digest. Reusing an issuer or evidence source across controls is rejected. Both attestations for a control must bind to the same allowed provider class.

## Single-source controls

The other seven controls require one exact issuer class:

- archive provider control plane;
- governance registry for incident ownership;
- edge runtime verifier for JWKS publication;
- audit-sink verifier;
- email-provider verifier;
- governance registry for retention ownership;
- identity-provider verifier for signing workload identity.

The two governance-registry attestations still require distinct issuer and source digests.

## Attestation contract

Each attestation is exact-schema and contains only:

- schema version;
- production environment;
- control ID;
- allowed provider class;
- allowed issuer class;
- release digest;
- issuer digest;
- source digest;
- observation and expiry timestamps;
- verified status;
- attestation digest.

Raw resource names, account identifiers, human identities, email addresses, provider URLs, incident links, credentials and secret values are prohibited by exact-field validation.

Attestations must:

- bind to the exact release digest;
- be observed no more than fifteen minutes before assembly;
- not be future-dated;
- remain valid through the assembled evidence expiry;
- have a maximum validity window of four hours;
- have a digest matching the canonical body.

## Assembly behavior

A valid assembly contains thirteen attestations: six for the three dual-source controls and seven for the remaining controls.

The assembler:

1. validates every attestation;
2. sorts attestations deterministically;
3. verifies global issuer, source and attestation-digest uniqueness;
4. verifies exact issuer coverage for every control;
5. verifies provider binding consistency within each control;
6. creates one digest-only control evidence record per control;
7. creates the existing production launch evidence digest.

The assembled evidence can be consumed directly by the production launch admission evaluator. It does not contain launch approvals and does not bypass revocation evaluation.

## Aggregate output

The public summary contains only:

- attestation count;
- control count;
- critical and dual-source control counts;
- environment;
- expiry;
- assembled status;
- explicit false flags for identifiers, evidence digests, release digest and launch approval.

The summary does not expose issuer, source, release, attestation, control-evidence or final evidence digests.

## End-to-end coverage

Repository tests cover:

- deterministic assembly from thirteen attestations;
- exact ten-control output;
- full attestation → evidence → three-owner admission → clear revocation chain;
- missing critical independent verifier;
- duplicate issuer and source evidence;
- unsupported and inconsistent provider classes;
- stale, future, short-lived and cross-release evidence;
- tampered attestation digests;
- missing and duplicated controls;
- raw human identity, resource name and URL rejection;
- aggregate-only output and workflow path locks.

## Remaining external production work

This boundary does not prove authenticity by itself. Production still requires:

- protected issuer workload identities;
- authenticated provider APIs;
- signed or otherwise integrity-protected source receipts;
- immutable storage for issued attestations;
- independent verifier deployments and ownership;
- protected release-digest distribution;
- operational monitoring and paging for attestation failures;
- current real evidence for every control;
- valid launch approvals and a clear revocation checkpoint.
