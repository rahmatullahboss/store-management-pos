# Production attestation issuer identity and signed receipts

## Purpose

Control-attestation assembly validates structure, provider classes, freshness and independent evidence sources. This boundary adds cryptographic issuer authenticity and replay protection before those attestations can become production launch evidence.

Every external attestation must arrive inside an Ed25519-signed receipt. The receipt is bound to a protected public trust-registry digest, a protected issuer sequence-checkpoint digest and the exact release digest. This boundary does not create production issuer credentials or operate a trust-registry service.

## Public trust registry

The production registry is an exact-schema, five-minute snapshot containing one principal for every signed receipt. Each principal includes only:

- issuer class and digest;
- trust-domain digest;
- public Ed25519 JWK;
- key digest and positive key epoch;
- active, suspended or revoked status;
- validity interval;
- schema version.

Only public `OKP / Ed25519 / EdDSA / sig` JWK fields are accepted. Private JWK parameters, PEM certificates, account names, email addresses and provider resource identifiers are rejected by exact-field validation.

The registry body is digest-bound. Production callers must provide the expected registry digest through a separately protected configuration path. A self-resealed registry with a different digest is rejected.

## Signed receipt

Each receipt binds:

- the complete digest-bound control attestation;
- registry digest;
- issuer key digest;
- sequence-checkpoint digest;
- positive receipt sequence;
- unique nonce digest;
- issued-at timestamp;
- schema version;
- detached Ed25519 signature.

The verifier reconstructs a canonical signing payload and verifies the signature against the active registry principal. Algorithm confusion, malformed signatures, inactive keys, expired keys, unknown issuers and key-digest mismatches fail closed.

Receipts must be issued after the underlying observation, no later than assembly generation and no more than five minutes before assembly.

## Protected replay checkpoint

A separately protected five-minute sequence snapshot contains the exact next sequence for every issuer. Its digest must match an expected checkpoint digest supplied outside the receipt batch.

A receipt is accepted only when its sequence equals the protected next sequence. Nonces must also be globally unique in the batch. After successful verification, the boundary produces a new protected checkpoint candidate with each consumed issuer sequence advanced by one.

The raw checkpoint contains issuer digests and must not be published as aggregate evidence. Durable external checkpoint storage and compare-and-swap persistence remain production infrastructure responsibilities.

## Trust-domain independence

The three critical dual-source controls remain:

- database backup and recovery;
- non-exportable KMS/HSM signing;
- production monitoring and paging.

For each critical control, the provider-side receipt and independent-verifier receipt must resolve to two distinct trust-domain digests. Two keys or principals under the same trust domain do not count as independent evidence.

## Verification and assembly flow

1. Validate protected expected release, registry and sequence-checkpoint digests.
2. Validate fresh registry and sequence snapshots.
3. Validate exact principal coverage for every receipt.
4. Validate every attestation digest and protected receipt binding.
5. Validate active key status, epoch, validity and Ed25519 public key.
6. Validate receipt timestamp, sequence and unique nonce.
7. Verify every detached signature.
8. Validate critical trust-domain independence.
9. Pass verified attestations into the existing deterministic control assembler.
10. Return admission-compatible ten-control evidence and an advanced checkpoint candidate.

The resulting evidence must still receive three independent launch-owner approvals and pass the revocation/suspension checkpoint.

## Aggregate evidence

The public summary contains only counts, expiry, status and boolean assertions. It explicitly excludes:

- issuer and trust-domain identifiers;
- registry and sequence-checkpoint digests;
- issuer-key digests;
- receipt nonce digests;
- signatures;
- release and evidence digests;
- launch approvals.

## End-to-end coverage

Runtime-generated Ed25519 keys are used by tests; no private key material is committed to the repository. E2E tests cover:

- thirteen valid signed receipts assembling ten controls;
- deterministic results under input reordering;
- complete signed receipt → control evidence → three-owner admission → clear revocation flow;
- signature tampering and unknown issuers;
- revoked keys and wrong key binding;
- private JWK and algorithm-confusion rejection;
- critical trust-domain collision;
- duplicate nonce and wrong sequence;
- replay against an advanced checkpoint;
- protected registry/checkpoint mismatch;
- stale registry and sequence snapshots;
- cross-release reuse;
- raw identity, certificate and provider-resource rejection;
- aggregate-only summaries and workflow path locks.

## Remaining external production work

This repository boundary does not provision or prove:

- real issuer key generation and custody;
- workload identity for issuer services;
- protected registry publication and authorization;
- durable compare-and-swap sequence checkpoint storage;
- key rotation, compromise response and registry distribution;
- immutable signed-receipt retention;
- live provider and independent-verifier implementations;
- production deployment credentials or infrastructure.

Production remains blocked until those controls exist and current signed receipts, launch approvals and a clear revocation checkpoint are available.
