# Production attestation receipt journal boundary

## Purpose

Cryptographic receipt verification and control assembly must not return launch evidence unless the complete signed-receipt batch and its replay-checkpoint advancement are durably acknowledged as one operation. This boundary defines the append-only journal command, compare-and-swap rules, idempotency behavior and recovery reconciliation required around that durable transaction.

The repository provides the command boundary, acknowledgment validator, deterministic in-memory reference implementation and exhaustive E2E tests. It does not provision the production database or external durable journal service.

## Atomic batch

A journal batch contains exactly thirteen verified receipt digests and binds:

- an externally generated idempotency nonce digest;
- the assembled evidence digest;
- the protected trust-registry digest;
- the release digest;
- the previous protected sequence-checkpoint digest;
- the next protected sequence-checkpoint digest;
- schema version.

Receipt digests are deterministically sorted before the batch digest is computed. Reordering the same verified receipt set does not change the batch identity.

No receipt, signature, issuer identity, resource name or credential is stored in the public summary. The journal stores hash-only bindings.

## Append command

The append command requires:

- exact batch and matching batch digest;
- expected journal version;
- expected previous journal-head digest;
- recorded-at timestamp;
- schema version.

The recorder is invoked only after all thirteen Ed25519 receipts, trust registry, issuer keys, nonces, sequences, trust domains and control attestations have passed verification and assembly.

A valid append must atomically verify:

1. current journal version equals the expected version;
2. current journal head equals the expected previous head;
3. current protected sequence checkpoint equals the batch's previous checkpoint;
4. the idempotency nonce has not been used for a different batch;
5. the next entry links to both the current journal head and current sequence checkpoint.

Only after those checks may the recorder append the entry and advance the durable sequence checkpoint.

## Idempotency and conflict behavior

An exact retry with the same nonce, batch, expected version, previous head and recorded-at timestamp returns an `idempotent` acknowledgment without creating a second entry.

The same nonce with a different batch is rejected. A retry that changes its original expected version, previous head or timestamp is also rejected. Stale version, stale head and stale sequence checkpoint fail closed.

## Journal entry and acknowledgment

Each entry binds:

- journal version;
- previous journal digest;
- batch and nonce digests;
- evidence, registry and release digests;
- previous and next sequence-checkpoint digests;
- fixed receipt count of thirteen;
- recorded-at timestamp;
- schema version.

The entry digest commits to all fields. The recorder returns a digest-bound acknowledgment with status `recorded` or `idempotent`. The command boundary validates every acknowledgment field before returning evidence to the caller.

A malformed, unbound or forged acknowledgment fails closed.

## Recovery snapshot

A recovery snapshot contains the append-only digest entries, genesis digest, current head, latest sequence checkpoint and exact version. Reconciliation verifies:

- entry versions start at one and are contiguous;
- every previous-journal link matches;
- every previous-to-next sequence checkpoint link matches;
- every entry digest matches its canonical body;
- snapshot version equals entry count;
- head and latest sequence checkpoint match the final entry;
- snapshot digest matches;
- version, head and sequence checkpoint match separately protected expected values.

A self-resealed snapshot with valid tail entries removed is rejected by the protected checkpoint comparison.

## End-to-end flow

1. Validate all thirteen signed receipts.
2. Assemble ten production control records.
3. Produce the next issuer sequence-checkpoint candidate.
4. Build the deterministic receipt batch.
5. Execute the append command through an append-capable recorder.
6. Validate the durable acknowledgment.
7. Return admission-compatible evidence and aggregate journal status.
8. Continue through three-owner launch admission and the revocation/suspension boundary.

If verification or assembly fails, the recorder is never called. If the recorder transaction fails or rolls back, the boundary returns no launch evidence.

## Aggregate output

The public summary contains only counts, expiry, journal version, status and boolean assertions. It explicitly excludes:

- journal entry, acknowledgment, batch and nonce digests;
- receipt and signature digests;
- issuer, registry, release, evidence and checkpoint digests;
- provider resources, database URLs and operator identities;
- launch approvals.

## E2E coverage

Tests cover:

- successful thirteen-receipt atomic append;
- complete append → evidence → launch admission → clear revocation flow;
- exact idempotent retry without version advancement;
- conflicting nonce reuse;
- two valid batches with contiguous journal and checkpoint chains;
- stale journal version and head;
- stale protected sequence checkpoint;
- partial batch and signature failure before recorder invocation;
- recorder rollback without returned evidence;
- exact recovery reconciliation;
- entry tampering and validly resealed tail truncation;
- raw operator, database and provider-resource field rejection;
- aggregate-only output and workflow path locks.

## Remaining external production work

This boundary does not provide:

- an actual transactional Postgres or immutable-log adapter;
- durable compare-and-swap persistence;
- database uniqueness constraints for idempotency and receipt reuse;
- external journal backup, retention or legal hold;
- journal service workload identity and network policy;
- production monitoring, paging and reconciliation scheduling;
- real signed receipts, launch approvals or deployment infrastructure.

A production adapter must implement the exact append contract atomically and return the validated acknowledgment. Production remains blocked until that adapter and the other external launch controls are provisioned and evidenced.
