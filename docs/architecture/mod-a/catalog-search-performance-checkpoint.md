# MOD-A Catalog Search Performance Checkpoint

**Date:** 2026-07-28  
**Migration:** `CAT-0002`  
**SHA-256:** `8007c0a15335c740e529646b7fd9fc9d26b97edf281310acf233325d79b68fa0`

## Defect found

The original single-query resolver combined exact SKU, barcode-array, full-text and trigram predicates with `OR`. At 250,000 representative variants PostgreSQL produced an expensive bitmap-or plan. The trigram branch returned all 250,000 candidates for an identifier-shaped query and forced 12,500 heap-block rechecks.

Observed before correction on disposable PostgreSQL 18.3:

- exact SKU p95: `0.021 ms`;
- barcode-array p95: `32.871 ms`;
- full-text p95: `1.392 ms`;
- combined OR search p95: `715.319 ms`.

## Correction

`CAT-0002-search-performance.sql` replaces the resolver with staged execution:

1. exact barcode through the tenant-global unique barcode table;
2. exact SKU and product code through tenant-prefixed B-tree indexes;
3. full-text search through the generated tsvector GIN index;
4. natural-language substring and word-similarity fallback only after exact/full-text misses;
5. identifier-shaped queries never enter the expensive fuzzy branch.

The migration is additive and preserves the public function signature, cursor behavior, permission grants and tenant context requirement.

## 250,000-variant local PostgreSQL evidence

The reproducible harness is `tooling/scripts/mod-a-250k-local-postgres-benchmark.mjs`. It creates and removes disposable unlogged tables matching the catalog projection and unique barcode shapes.

Corrected result:

- 250,000 variants and 250,000 barcode rows imported in `8,433.60 ms`;
- throughput: `29,643.33` variant rows/second;
- exact SKU p95: `0.014 ms`;
- exact barcode p95: `0.036 ms`;
- full-text p95: `1.770 ms`;
- staged combined search p95: `0.052 ms`;
- representative row counts and cross-tenant zero-result check passed;
- all local performance budgets passed.

Machine-readable execution plans and percentiles are in:

- `docs/architecture/mod-a/performance-report-local-postgresql.json`
- `docs/architecture/mod-a/performance-report-local-postgresql.md`

## Fresh migration-chain validation

A disposable PostgreSQL 18.3 database successfully applied:

- Foundation `FND-0001` through `FND-0005`;
- Foundation synthetic seed;
- `CAT-0001` and `CAT-0002`;
- `PRC-0001`;
- `TAX-0001`.

Under `store_app_runtime`, an idempotent product save then returned one hit each for:

- exact SKU `PERF-BLUE-M`;
- exact barcode `5555555555550`;
- natural-language query `Representative blue performance`.

## Remaining external evidence

The mandatory Neon rerun must use isolated branch `br-fancy-bird-axo3z9ek`. The harness `tooling/scripts/mod-a-250k-benchmark.mjs` refuses to run unless that branch ID is explicitly supplied. During this checkpoint the session exposed neither the Neon SQL connector nor a local `DATABASE_URL`; no credential was invented or persisted. The Neon-specific performance gate therefore remains open while local PostgreSQL query-shape evidence is complete.
