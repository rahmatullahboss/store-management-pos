# Production attestation receipt Postgres boundary

## Status

This checkpoint implements the durable PostgreSQL adapter and schema for the signed production-control attestation receipt journal. It is a production control boundary, but it does not approve or perform a production launch.

## Storage contract

`FND-0019` creates two isolated Foundation relations:

- a singleton control row containing the journal version, genesis digest, protected head digest, latest issuer sequence-checkpoint digest and entry count;
- an append-only entry table containing digest-only batch evidence and no receipt payloads, signatures, raw identities, provider resources, credentials or database locations.

Every entry is unique by journal version, entry digest, batch digest, batch nonce digest, evidence digest and next sequence-checkpoint digest. Update and delete operations on journal entries are rejected by the shared append-only trigger.

`FND-0020` disables governance execution of the original positional append function and exposes one exact JSONB command instead. This additive migration preserves migration history while ensuring the operational boundary cannot depend on ambiguous positional or output-column names.

## Atomic append

The FND-0020 security-definer command:

1. requires exactly thirteen top-level command fields;
2. validates the exact schema version, bounded recording clock and all digest formats;
3. requires exactly thirteen distinct receipt digests;
4. sorts the receipt digests and independently recomputes the canonical batch digest;
5. independently recomputes the canonical entry digest;
6. obtains a transaction advisory lock;
7. returns an exact existing batch as idempotent or rejects conflicting nonce reuse;
8. locks the singleton state row;
9. compares the expected version, previous journal head and previous sequence checkpoint;
10. inserts the append-only entry and advances state in the same transaction;
11. rejects the operation unless exactly one state row advances;
12. returns one aggregate JSON acknowledgment.

A different batch racing from the same state is serialized by the transaction advisory lock and then evaluated against the authoritative state. An exact retry resolves to the original entry. Any exception rolls back both the entry and state advancement.

## Application adapter

`internal-token-production-attestation-receipt-postgres.mjs` converts the previously verified journal command into one JSONB stored-function call. It computes the proposed entry digest locally, sends one exact thirteen-field command, requires one result field named `acknowledgment`, validates every returned coordinate and creates the existing aggregate acknowledgment digest. Database errors are masked at the adapter boundary.

The recovery read returns only protected coordinates: schema version, journal version, genesis digest, head digest, latest sequence-checkpoint digest and entry count. It does not expose receipt digests or provider data.

## Privileges

`PUBLIC`, `store_app_runtime` and `store_app_reporting` receive no direct table access. Only `store_key_governance_runtime` can execute the FND-0020 JSONB append and protected state-read functions. The governance role no longer has execute permission on the original positional append. The application adapter never issues direct insert, update or delete statements.

## E2E evidence

Persistent staging applies the complete migration registry to the dedicated Neon project and then runs real PostgreSQL transaction journeys:

- first append is recorded;
- exact replay is idempotent;
- stale compare-and-swap is rejected inside an isolated savepoint;
- conflicting nonce reuse is rejected inside an isolated savepoint;
- a tampered entry digest is rejected by PostgreSQL inside an isolated savepoint;
- application/reporting DML and append execution remain denied;
- governance execution of the positional function remains revoked;
- two concurrent database connections contend on the exact advisory lock;
- an observer connection confirms the second append is waiting;
- rollback of the first transaction releases the lock and the second append records serially;
- both concurrent synthetic transactions are rolled back;
- state and row counts after all journeys exactly match their pre-journey values.

The uploaded evidence is aggregate-only and contains no digests, identifiers, database URL, receipt data or secrets.

## Remaining production blockers

This checkpoint does not provision production database infrastructure, production credentials, immutable external backup or audit storage, real issuer services, named security/platform/release owners, non-exportable KMS/HSM signing, production workload identity, monitoring and paging, regional recovery, or a valid external ten-control and three-owner admission bundle. Production remains blocked until those external controls are commissioned and admitted.
