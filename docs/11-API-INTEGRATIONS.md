# API and Integration Strategy

## 1. Goals

Provide stable, secure and observable integration contracts without exposing internal table structure or provider-specific state throughout the product.

The integration platform must support:

- first-party web, POS and mobile clients;
- payment, fiscal, tax, shipping and messaging providers;
- ecommerce and marketplace synchronization;
- customer/supplier/accounting data exchange;
- partner applications and automation;
- bulk imports/exports;
- reliable event delivery and replay.

## 2. API styles

### Command API

Use task-oriented REST endpoints for mutations:

```text
POST /v1/pos/checkouts
POST /v1/purchase-orders/{id}/receive
POST /v1/stock-transfers/{id}/dispatch
POST /v1/returns/{id}/approve
POST /v1/pos-shifts/{id}/close
POST /v1/settlements/{id}/reconcile
```

Commands express business intent, authorization and state transition. Avoid generic `PATCH table-row` APIs for posted business documents.

### Query API

REST query resources serve operational views with filtering, sorting, cursor pagination and field selection. GraphQL may later serve complex read composition, but it must not bypass authorization, metric definitions or module boundaries.

### Bulk API

Large imports/exports are asynchronous jobs:

1. request upload/job;
2. upload source to R2;
3. validate/dry-run;
4. confirm execution;
5. process through Workflows/Queues;
6. download result/error report;
7. retain provenance and undo/compensation references.

## 3. API conventions

- JSON with documented content type and schema.
- UTC timestamps in RFC 3339 plus business-date fields where relevant.
- UUIDv7-style opaque IDs.
- ISO currency codes and exact amount representation.
- BCP 47 locale and IANA timezone identifiers.
- Cursor pagination; no large unbounded offset scans.
- Stable machine error code plus localized human message.
- Request/trace ID returned in headers/body metadata.
- `Idempotency-Key` required for retryable mutation endpoints.
- Optimistic concurrency through version/ETag where applicable.
- Explicit expansion/include parameters with limits.
- Consistent archive rather than destructive delete for used master data.

Example error:

```json
{
  "error": {
    "code": "inventory.insufficient_available",
    "message": "The requested quantity is not available.",
    "details": {
      "variant_id": "...",
      "warehouse_id": "...",
      "requested": "5",
      "available": "3"
    },
    "trace_id": "..."
  }
}
```

Do not expose stack traces, SQL or secrets.

## 4. Authentication and authorization

### First-party clients

- OIDC/OAuth-based user authentication.
- Short-lived access tokens and renewable sessions.
- Tenant and membership resolved from verified claims/session.
- Device/register credentials supplement, not replace, user authorization for POS.

### Partner applications

- OAuth authorization code flow for user-authorized apps.
- Client credentials for server-to-server integrations where appropriate.
- Scoped API keys for simpler trusted use cases.
- Secrets displayed once and stored hashed/encrypted.
- Redirect URI validation and PKCE where applicable.

Scopes should be business-oriented:

```text
catalog.read
catalog.write
inventory.read
inventory.adjust
orders.read
orders.write
payments.read
accounting.read
webhooks.manage
```

Scope alone does not override tenant role/location restrictions.

## 5. Idempotency

Every externally retryable mutation stores:

- tenant/client;
- idempotency key;
- operation type/path;
- normalized request hash;
- processing state;
- response status/body reference;
- expiry/retention.

Same key plus same request returns the original result. Same key plus different request is rejected. In-progress operations return a recoverable status rather than executing twice.

Provider adapter calls also use stable provider idempotency keys.

## 6. Versioning

- Major version in path (`/v1`).
- Backward-compatible fields/endpoints evolve within the major version.
- Never repurpose an existing field’s meaning.
- Additive enum values require clients to handle unknown values.
- Breaking changes require migration guide, sandbox and deprecation window.
- Webhook/event schemas have independent version numbers.
- Offline operation schemas have explicit support windows.
- Country/provider adapter versions are recorded separately.

Publish a compatibility policy before partner GA.

## 7. Webhooks

Outbound webhook envelope:

```json
{
  "id": "evt_...",
  "type": "sale.completed.v1",
  "occurred_at": "2026-07-27T12:00:00Z",
  "tenant_id": "...",
  "data": {},
  "attempt": 1
}
```

Security and delivery:

- HMAC or asymmetric signature over timestamp and raw body;
- replay window and unique event ID;
- HTTPS only;
- SSRF-safe destination validation;
- at-least-once delivery;
- exponential backoff and dead-letter state;
- tenant console for attempts, response codes and replay;
- event filtering by scope/type;
- payload minimization and versioning.

Consumers must deduplicate by event ID.

## 8. Domain event catalog

Initial events:

### Catalog

- `product.created.v1`
- `product.updated.v1`
- `variant.updated.v1`
- `price.changed.v1`

### Inventory

- `stock.posted.v1`
- `stock.balance.changed.v1`
- `stock.low.v1`
- `transfer.dispatched.v1`
- `transfer.received.v1`

### Procurement

- `purchase_order.approved.v1`
- `goods_receipt.posted.v1`
- `supplier_bill.posted.v1`

### Sales/POS

- `sale.completed.v1`
- `sale.returned.v1`
- `order.fulfillment.changed.v1`
- `pos_shift.closed.v1`
- `cash_variance.recorded.v1`

### Payments/finance

- `payment.status.changed.v1`
- `settlement.received.v1`
- `journal.posted.v1`
- `period.closed.v1`

Events describe facts and include stable references, not giant entity dumps.

## 9. Payment provider contract

```text
capabilities(context)
createIntent(request)
authorize(request)
capture(request)
void(request)
refund(request)
queryStatus(reference)
verifyWebhook(headers, body)
normalizeWebhook(headers, body)
importSettlement(source)
```

Normalize:

- internal state;
- provider reference;
- amount/currency;
- terminal/payment method metadata;
- failure category;
- risk/authorization evidence;
- settlement/fee information.

Provider-specific fields remain in encrypted integration records. Core business code depends only on the capability contract.

## 10. Tax and fiscal contracts

### Tax provider

```text
calculateQuote(context, lines)
commit(document)
voidOrAdjust(document)
validateCustomerTaxIdentity(identity)
```

Use a provider only when local configuration is insufficient or external determination is required. Persist normalized rule/evidence snapshot.

### Fiscal/e-invoice provider

```text
capabilities(country, documentType)
validate(document)
issue(document, idempotencyKey)
queryStatus(reference)
correct(original, correction)
verifyCallback(headers, body)
archiveEvidence(reference)
```

The adapter must expose offline/contingency capability explicitly.

## 11. Shipping contract

```text
capabilities(origin, destination)
getRates(parcel, context)
createShipment(order, service)
createLabel(shipment)
track(reference)
cancel(reference)
normalizeWebhook(headers, body)
```

Separate rate quote, shipment booking, label and tracking. Never make an external carrier’s status enum the internal fulfillment state.

## 12. Ecommerce and marketplace connectors

Connector responsibilities:

- product/variant mapping;
- price/inventory publishing;
- order/customer import;
- fulfillment/tracking export;
- cancellation/return synchronization;
- tax/payment normalization;
- channel/location mapping;
- cursor and error management.

Rules:

- one canonical mapping table per connection;
- external IDs namespaced by provider/account;
- deterministic source-of-truth rules by field;
- prevent update loops using source/event metadata;
- inventory publishing uses an explicitly defined available-to-promise projection;
- imported orders preserve original totals and provider calculation evidence;
- conflicts enter a visible reconciliation queue.

Initial likely connectors: Shopify, WooCommerce and a generic REST/CSV channel, selected by customer demand.

## 13. Accounting integrations

Support two modes:

1. **Native accounting** — platform GL is canonical.
2. **Operational export** — platform exports summarized/detailed transactions to an external accounting system.

Avoid uncontrolled dual-master accounting. Each connection defines:

- master system;
- account/tax/customer/supplier mappings;
- document granularity;
- posting timing;
- correction behavior;
- reconciliation status;
- exchange-rate source;
- closed-period handling.

Exports are idempotent and retain source-to-external entry mappings.

## 14. Import framework

Import stages:

- upload;
- malware/type/size checks;
- column mapping;
- normalization;
- validation/dry run;
- duplicate detection;
- user confirmation;
- batched execution;
- result/error report;
- reconciliation/undo reference.

Supported initial templates:

- products/variants/barcodes/prices;
- customers/suppliers;
- opening stock;
- opening receivables/payables;
- chart of accounts;
- bank statements.

Opening financial/stock imports post controlled opening entries; they do not directly edit balances.

## 15. Export framework

- CSV/XLSX/JSON/PDF depending on use case.
- Asynchronous for large sets.
- Snapshot time, filters, timezone, locale and metric version recorded.
- Short-lived signed download links.
- Formula-injection-safe tabular data.
- Export authorization and audit.
- Data-residency/retention-aware object storage.
- Privacy export separate from ordinary reports.

## 16. Integration execution model

Use PostgreSQL transactional outbox followed by Cloudflare Queues. Each consumer uses inbox/idempotency records.

Long-running stateful integrations use Workflows when they require wait/retry/callback, such as fiscal submission, settlement reconciliation or large import.

Scheduled polling uses explicit cursors and overlap protection. One tenant/provider failure must not block unrelated tenants.

## 17. Rate limits and quotas

Apply limits by:

- public IP/anonymous endpoint;
- tenant;
- user;
- OAuth client/API key;
- endpoint cost class;
- provider connection.

Return standard retry metadata. Bulk export/import uses job quotas rather than oversized synchronous calls. Enterprise limits may differ by plan but must not weaken abuse controls.

## 18. Developer experience

Partner offering should include:

- OpenAPI specification;
- generated typed clients where useful;
- sandbox tenant and provider simulators;
- webhook test/replay console;
- idempotency examples;
- pagination/filtering guide;
- event catalog;
- rate-limit and error documentation;
- changelog/deprecation notices;
- integration health dashboard.

## 19. Observability and support

For every integration operation record:

- tenant/connection/provider;
- normalized operation type;
- correlation/idempotency/event ID;
- state and attempt count;
- safe request/response metadata;
- latency;
- provider reference;
- error category;
- next retry/required action.

Redact credentials, personal data and payment details. Provide a tenant-visible activity trail plus deeper restricted support diagnostics.

## 20. Acceptance criteria

- Duplicate API commands and webhooks are safe.
- Every adapter passes capability and contract tests.
- Provider outages create recoverable, visible states.
- One integration cannot access another tenant’s data.
- Event/webhook replay does not duplicate business effects.
- Imports support dry run and row-level error reporting.
- Exports preserve filter, time, locale and metric provenance.
- Ecommerce synchronization avoids loops and has explicit field ownership.
- API documentation and sandbox match production contracts.
- Secrets and restricted payloads are absent from general logs.
