# MOD-A Tax Checkpoint

**Date:** 2026-07-28  
**Migration:** `TAX-0001`  
**SHA-256:** `67995519209b2698efa9787d78041a0c7a54139cfd1b9e2920798be3c5128ae2`

## Delivered

- Tenant-scoped tax jurisdictions with hierarchy, priority and status.
- Versioned tax codes and effective-dated rate components.
- Inclusive and exclusive tax calculation with exact minor-unit reconciliation.
- Ordered compound tax components calculated on prior reporting tax.
- Standard, zero-rated, exempt, reverse-charge and out-of-scope treatments.
- Customer/customer-group exemption certificates with jurisdiction and tax-code scope.
- Recoverable and reporting tax amounts separated from charged tax.
- Deterministic return allocation that reconciles net, tax and gross to the original snapshot.
- Immutable code/rate versions, exemption actions, calculation snapshots/components and return allocations.
- Idempotent snapshot persistence with audit and outbox events.
- Permissions for calculation read, configuration management/publishing and exemption management.
- API boundary with structured metrics/logging and optional Neon persistence.

## Verification

`npm run test:unit` passed 26/26 tests. Tax coverage includes:

- exclusive 20% VAT: net `10000`, tax `2000`, gross `12000`;
- inclusive 20% VAT: gross `12000` reconciles to net `10000` and tax `2000`;
- compound 10% plus 5%: second base `11000`, total tax `1550`;
- exemption and zero-rated treatments charge zero;
- reverse charge charges zero while preserving reporting/recoverable tax;
- return allocation reconciles exactly to the original calculation.

Live Neon verification on `dev/module-catalog-pricing-tax`:

- initial snapshot: `replayed=false`, net `10000`, tax `2000`, gross `12000` GBP;
- same idempotency key/hash: `replayed=true`, same immutable snapshot;
- one component, one audit event and one outbox event committed;
- `store_app_runtime` Alpha context saw one snapshot/component;
- `store_app_runtime` Beta context saw zero snapshots/components.
