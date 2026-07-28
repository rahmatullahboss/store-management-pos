# MOD-C Application Surfaces

## API adapter

`createModCRouter` is a Fetch-standard module router exported through `apps/api/src/modules/mod-c.ts`. Integration into the shared authenticated API shell is intentionally deferred to the integration agent; the module adapter requires a verified `RequestContext` and never parses identity headers itself.

Implemented routes:

| Method | Path | Permission / behaviour |
| --- | --- | --- |
| POST | `/api/v1/customers` | `customer.profile.create`; requires `idempotency-key` |
| GET | `/api/v1/customers/:id` | `customer.profile.read` |
| POST | `/api/v1/quotes` | `sales.quote.create`; exact line snapshots |
| POST | `/api/v1/orders` | `sales.order.create`; reservation and credit orchestration |
| GET | `/api/v1/orders/:id` | `sales.order.read` |
| POST | `/api/v1/fulfillment/plans` | `fulfillment.plan.create` |
| GET | `/api/v1/fulfillment/plans/:id` | `fulfillment.read` |
| POST | `/api/v1/returns` | `return.request`; preserves original payment allocation |

All mutation routes require an idempotency key of at least eight characters. Replays return HTTP 200 with `meta.replayed=true`; first writes return HTTP 201 and a `Location` header. BigInt minor-unit values and versions are encoded as decimal strings. Responses are `application/json; charset=utf-8`, `cache-control: no-store`, and include request/trace identifiers. Unsupported routes fail closed.

## Admin UI

Module-owned renderers are exported by the existing admin module entry points:

- Customer directory: profile, type/status, credit attention, import/create actions, loading/empty/error/denied/stale states.
- Sales control desk: quote action, independent order/payment/fulfillment/invoice statuses, approval attention and localized Bengali empty state.
- Fulfillment floor: responsive allocation queue, keyboard-operable work actions, shipment/pickup methods, Arabic RTL, conflict/stale recovery and clear no-side-effect error messages.

The surfaces inherit the existing Operations Ledger shell and design tokens. They use semantic landmarks, tables/headings, 44px controls, visible focus, logical CSS properties, reduced-motion-safe hover enhancement and explicit resilient states.

## Event job

`ModCEventProjector` is exported through `apps/worker-jobs/src/modules/mod-c.ts`. It accepts the frozen v1 event envelope, deduplicates by event ID and projects order, fulfillment and return status. Duplicate and processed counters are separate to make at-least-once delivery visible.

## Integration notes

The integration agent should mount the router after OIDC verification and request-context construction, wire repository-backed service implementations, connect outbox events to the queue consumer and add these module routes to the shared navigation only after permission filtering. No MOD-A, MOD-B or MOD-E implementation import is required.
