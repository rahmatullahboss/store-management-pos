# MOD-A 250,000-Variant Neon Performance Report

**Observed:** 2026-07-29 03:33:27 UTC  
**Status:** Passed  
**Evidence class:** isolated Neon branch staged resolver  
**Neon project:** `twilight-boat-26805962`  
**Neon branch:** `dev/module-catalog-pricing-tax` (`br-fancy-bird-axo3z9ek`)  
**PostgreSQL:** 17.10

## Scope and safety

The integration rerun used disposable unlogged tables on the isolated, non-default MOD-A Neon branch. It loaded 250,000 representative variants and 250,000 unique barcode rows, measured 30 post-warmup samples per query, and dropped the complete `mod_a_benchmark` schema afterward. The Neon default/main branch and production data were not touched.

Measurements were captured server-side with `clock_timestamp` through the Neon connector. They validate PostgreSQL execution latency independently of client/network round-trip latency.

## Import

- Variant rows: 250,000
- Barcode rows: 250,000
- Elapsed: 11,139.593 ms
- Throughput: 22,442.47 variant rows/second
- Budget: 120,000 ms
- Other-tenant rows visible: 0

## Accepted resolver latency

| Query | Rows | p50 ms | p95 ms | p99 ms | max ms | Budget p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| Exact SKU | 1 | 0.007 | 0.079 | 0.171 | 0.171 | 100 |
| Exact barcode | 1 | 0.013 | 0.031 | 0.180 | 0.180 | 100 |
| Full text | 1 | 0.069 | 0.103 | 0.291 | 0.291 | 250 |
| CAT-0002 staged search | 1 | 0.033 | 0.274 | 0.353 | 0.353 | 300 |

The staged resolver first checks normalized barcode, SKU and product code using targeted indexes. It returns immediately when an exact match exists, then proceeds to full-text and guarded fallback search only when necessary. An analyzed staged lookup returned one row in 0.553 ms execution time with 19 shared-buffer hits and no shared-buffer reads.

## Defect reproduction

The deprecated single-query resolver that combines exact SKU, barcode, full-text and trigram predicates with one `OR` expression was also reproduced against the same dataset. Its p95 was 1,764.250 ms. This confirms the defect documented by CAT-0002 and is not an accepted runtime path or gate metric.

During integration review, `tooling/scripts/mod-a-250k-benchmark.mjs` was corrected to exercise the CAT-0002 staged resolver rather than the deprecated OR shape. Architecture tests now prevent that regression.

## Gate result

All integration performance checks passed:

- representative variant and barcode counts;
- tenant isolation;
- import budget;
- exact SKU, exact barcode and full-text budgets;
- staged combined-search budget;
- disposable fixture cleanup.

Machine-readable evidence is retained in [performance-report.json](performance-report.json).
