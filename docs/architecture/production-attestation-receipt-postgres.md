# Production attestation receipt Postgres boundary

## Status

This checkpoint implements the durable PostgreSQL adapter and schema for the signed production-control attestation receipt journal. It is a production control boundary, but it does not approve or perform a production launch.

## Storage contract

`FND-0019` creates two isolated Foundation relations:

- a singleton control row containing the journal version, genesis digest, protected head digest, latest issuer sequence-checkpoint digest and entry count;
- an append-only entry table containing digest-only batch evidence and no receipt payloads, signatures, raw identities, provider resources, credentials or database locations.

Every entry is unique by journal version, entry digest, batch digest, batch nonce digest, evidence digest and next sequence-checkpoint digest. Update and delete operations on journal entries are rejected by the shared append-only trigger.

## Atomic append

The security-definer append function:

1. validates the exact schema version, bounded recording clock and all digest formats;
2. requires exactly thirteen distinct receipt digests;
3. sorts the receipt digests and independently recomputes the canonical batch digest;
4. independently recomputes the canonical entry digest;
5. obtains a transaction advisory lock;
6. returns an exact existing batch as idempotent or rejects conflicting nonce reuse;
7. locks the singleton state row;
8. compares the expected version, previous journal head and previous sequence checkpoint;
9. inserts the append-only entry and advances state in the same transaction;
10. rejects the operation unless exactly one state row advances.

A different batch racing from the same state fails compare-and-swap. An exact retry resolves to the original entry. Any exception rolls back both the entry and state advancement.

## Application adapter

`internal-token-production-attestation-receipt-postgres.mjs` converts the previously verified journal command into one typed stored-function call. It computes the proposed entry digest locally, validates the returned row against every command coordinate and creates the existing aggregate acknowledgment digest. Database errors are masked at the adapter boundary.

The recovery read returns only protected coordinates: schema version, journal version, genesis digest, head digest, latest sequence-checkpoint digest and entry count. It does not expose receipt digests or provider data.

## Privileges

`PUBLIC`, `store_app_runtime` and `store_app_reporting` receive no direct table access. Only `store_key_governance_runtime` can execute the append and protected state-read functions. The application adapter never issues direct insert, update or delete statements.

## E2E evidence

Persistent staging applies the complete migration registry to the dedicated Neon project and then runs a real transactional evidence journey:

- first append is recorded;
- exact replay is idempotent;
- stale compare-and-swap is rejected;
- conflicting nonce reuse is rejected;
- a tampered entry digest is rejected by PostgreSQL;
- application/reporting DML and public function execution remain denied;
- the entire synthetic journey is rolled back;
- state and row counts after rollback exactly match their pre-journey values.

The uploaded evidence is aggregate-only and contains no digests, identifiers, database URL, receipt data or secrets.

## Remaining production blockers

This checkpoint does not provision production database infrastructure, production credentials, immutable external backup or audit storage, real issuer services, named security/platform/release owners, non-exportable KMS/HSM signing, production workload identity, monitoring and paging, regional recovery, or a valid external ten-control and three-owner admission bundle. Production remains blocked until those external controls are commissioned and admitted.
