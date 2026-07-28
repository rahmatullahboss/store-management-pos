# Contract Pack v1

Contract pack version `1.0.0` is the frozen Foundation baseline for MOD-A through MOD-G.

## Compatibility policy

- Existing required fields and meanings are not changed within v1.
- Additive optional fields require fixtures and compatibility tests.
- New enum values must be handled as unknown by consumers unless a closed set is explicitly documented.
- Breaking changes require a contract-change request and a new major contract version.
- Events include `schemaVersion`, tenant, business date, correlation and immutable identifiers.
- Consumers are at-least-once and must use inbox deduplication.

## Published contracts

The TypeScript contracts under `packages/contracts/src/v1` cover catalog references, price/tax requests and snapshots, stock availability/reservation/posting, customer and sales references, payment/refund state, accounting instructions/results, receipts/fiscal documents, event envelopes, file jobs, module health and reconciliation results.

`schemas/v1/domain-event-envelope.schema.json` is the canonical JSON Schema for the shared event envelope.
