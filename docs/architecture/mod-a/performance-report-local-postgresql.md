# MOD-A 250,000-Variant Local PostgreSQL Report

**Generated:** 2026-07-28T18:01:42.172Z
**Status:** passed
**Evidence class:** local-postgresql-shape-validation
**PostgreSQL:** 18.3 (Homebrew)

This disposable benchmark validates the catalog projection's tenant, exact SKU, unique barcode, generated tsvector and staged search resolver shapes. It does not replace the required Neon branch rerun.

## Import

- Representative variants: 250,000
- Representative barcode rows: 250,000
- Elapsed: 8433.6 ms
- Throughput: 29643.33 variant rows/second

## Search latency

| Query | Rows returned | p50 ms | p95 ms | p99 ms | max ms |
|---|---:|---:|---:|---:|---:|
| combinedSearch | 1 | 0.024 | 0.052 | 0.188 | 0.24 |
| exactBarcode | 1 | 0.008 | 0.036 | 0.076 | 0.086 |
| exactSku | 1 | 0.005 | 0.014 | 0.527 | 0.736 |
| fullText | 1 | 1.703 | 1.77 | 1.775 | 1.776 |

## Gate checks

| Check | Result |
|---|---|
| representativeVariantCount | Pass |
| representativeBarcodeCount | Pass |
| tenantIsolation | Pass |
| importWithinBudget | Pass |
| exactSkuWithinBudget | Pass |
| exactBarcodeWithinBudget | Pass |
| fullTextWithinBudget | Pass |
| combinedSearchWithinBudget | Pass |

## Limitation

This validates PostgreSQL 18.3 query shape and budgets locally. The required Neon branch rerun remains separate and must use br-fancy-bird-axo3z9ek.

Machine-readable metrics and execution plans are in [performance-report-local-postgresql.json](performance-report-local-postgresql.json).
