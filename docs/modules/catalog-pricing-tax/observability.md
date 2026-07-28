# MOD-A Observability and SLOs

The values below are engineering objectives and alert thresholds, not production-performance claims. Current evidence is synthetic and is identified as local PostgreSQL, browser or isolated Neon evidence.

## Metrics

### Catalog

| Metric | Meaning |
|---|---|
| `catalog.product.save.success` | Successful product writes, labelled by replay/status |
| `catalog.product.save.failure` | Product write failures |
| `catalog.product.save.duration_ms` | Product transaction latency |
| `catalog.product.status_change` | Lifecycle transitions |
| `catalog.product.status_change.duration_ms` | Lifecycle transaction latency |
| `catalog.search.request` | Interactive search requests/result count |
| `catalog.search.duration_ms` | Interactive search latency |
| `catalog.feed.request` | POS feed requests and continuation state |
| `catalog.feed.duration_ms` | Feed page latency and size |
| `catalog.feed.page_size` | Returned projection rows |
| `catalog.feed.failure` | Feed request failures |

### Pricing and promotions

| Metric | Meaning |
|---|---|
| `pricing.quote.success` | Price/promotion quote success |
| `pricing.quote.duration_ms` | Quote calculation/persistence latency |
| `pricing_tax.calculation.success` | Combined calculation success |
| `pricing_tax.calculation.failure` | Combined calculation failure |
| `pricing_tax.calculation.duration_ms` | Combined calculation latency |
| `pricing.price_list.publish.success` | Price-list publishing success/replay |
| `pricing.price_list.publish.failure` | Price-list publishing failures |
| `pricing.price_list.publish.duration_ms` | Price-list publish transaction latency |
| `pricing.promotion.publish.success` | Promotion publishing success/replay |
| `pricing.promotion.publish.failure` | Promotion publishing failures |
| `pricing.promotion.publish.duration_ms` | Promotion publish transaction latency |

### Tax

| Metric | Meaning |
|---|---|
| `tax.calculation.success` | Tax calculation success by treatment/mode |
| `tax.calculation.failure` | Tax calculation failures |
| `tax.calculation.duration_ms` | Tax calculation latency |
| `tax.configuration.publish.success` | Tax publishing success/replay |
| `tax.configuration.publish.failure` | Tax publishing failures |
| `tax.configuration.publish.duration_ms` | Tax publish transaction latency |

## Structured log fields

Module APIs log only operational metadata:

- request and trace ID;
- tenant and actor ID;
- module and operation;
- aggregate/snapshot ID;
- immutable version;
- status and replay result;
- calculation hash when applicable.

Do not log full import rows, certificate documents, customer details, promotion coupon lists or arbitrary metadata payloads.

## Engineering SLOs

| Operation | Target |
|---|---|
| Exact SKU/barcode lookup | p95 ≤ 100 ms on the isolated Neon branch |
| Natural-language catalog search | p95 ≤ 300 ms on the isolated Neon branch |
| POS feed page up to 500 entries | p95 ≤ 500 ms |
| In-memory combined price-tax calculation | p95 ≤ 50 ms |
| Persisted combined snapshot | p95 ≤ 300 ms excluding caller network |
| Price/promotion/tax publish transaction | p95 ≤ 500 ms |
| Validated 250,000-variant synthetic import | ≤ 120 seconds |
| Snapshot and publish availability | ≥ 99.9% over a rolling 30-day window |

## Alerts

Recommended alerts:

- calculation or feed failure ratio above 1% for 5 minutes;
- publish failure ratio above 0.5% for 10 minutes;
- exact search p95 above 100 ms for 15 minutes;
- natural-language search p95 above 300 ms for 15 minutes;
- feed p95 above 500 ms or page-size saturation at 500 for 15 minutes;
- idempotency mismatch, append-only rejection or version conflict rates exceeding their normal operational baseline;
- audit/outbox count mismatch for a committed publish or snapshot;
- expired/scheduled pricing or tax windows with no successor version;
- catalog projection lag exceeding the consumer freshness objective.

## Evidence classes

- Unit/architecture: deterministic exact arithmetic, contracts, permissions and metric emission.
- Browser: responsive/RTL/accessibility evidence under `docs/architecture/mod-a/design-evidence/`.
- Local PostgreSQL: fresh migration chain, runtime RLS/idempotency and 250,000-row query-shape evidence.
- Isolated Neon: CAT/PRC/TAX core live validation is complete; the final 250,000-variant rerun remains required on `br-fancy-bird-axo3z9ek`.
