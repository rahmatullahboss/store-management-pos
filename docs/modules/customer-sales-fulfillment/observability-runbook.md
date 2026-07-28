# MOD-C Observability and Operations Runbook

## Structured events

Every module HTTP invocation records `http.request.started` and either `http.request.completed` or `http.request.failed`. Records are JSON-compatible objects containing module, request ID, trace ID, tenant ID, method, normalized path, status, replay flag, duration and error code. Customer PII, addresses, payment credentials and proof objects are not logged.

Core counters:

- `mod_c_http_requests_total|method|path|status`
- `mod_c_events_processed_total|event_type`
- `mod_c_events_duplicate_total|event_type`

Domain services additionally persist append-only audit and outbox evidence for customer merge/credit, quote/order/invoice, fulfillment and return transitions.

## Suggested alerts

| Signal | Alert |
| --- | --- |
| HTTP 5xx ratio | >1% for 10 minutes |
| Idempotency conflict ratio | >0.5% for 15 minutes |
| Inventory reservation conflict | sustained increase above normal store baseline |
| Fulfillment plans in `allocated` | oldest age exceeds store pick SLA |
| Shipments in exception | any high-value order or >5 per store |
| Returns in `received` | unresolved longer than refund SLA |
| Event duplicates | sudden increase indicating producer or queue replay issue |
| Projection lag | queue age exceeds 5 minutes |

## Diagnosis

1. Search by `traceId`, then correlate the domain outbox event and audit record.
2. Confirm tenant/legal-entity/store/warehouse/business-date scope.
3. Check whether the command was a safe idempotent replay or a conflicting payload.
4. For order issues, inspect independent order/payment/fulfillment/invoice/return states rather than inferring one from another.
5. For refund issues, verify the named original payment allocation and cumulative resolved amount.
6. For stock issues, compare reservation ID, fulfillment allocation and immutable stock operation ID.
7. Never mutate posted invoices, credit notes, completed returns, delivery proof or append-only event evidence; issue a correcting workflow instead.

## Cloudflare integration

When the shared Worker integration is activated, enable Workers observability in the deployment configuration and emit the structured telemetry records as JSON log objects. Preserve request completion by awaiting writes or passing non-critical export work to the Worker execution context. Keep sampling high enough for errors, approval paths and financial/stock transitions.
