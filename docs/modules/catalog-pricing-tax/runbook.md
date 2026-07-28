# MOD-A Operational Runbook

## Safety rules

1. Confirm tenant, legal entity/store scope, business date and trace ID before any write.
2. Do not update or delete published price/tax versions, calculation snapshots, redemptions or append-only actions.
3. Correct an effective configuration by publishing a successor version.
4. Reuse the original idempotency key only for an identical request body.
5. Do not recompute historical documents from current configuration.
6. Keep production/customer data out of diagnostics and benchmark fixtures.

## Error reference

| SQLSTATE / condition | Meaning | Operator response |
|---|---|---|
| `40001` | Optimistic version conflict | Reload root/current version, compare changes, submit a new command |
| `23P01` | Effective-window overlap | Correct scope/window; do not retire or edit the existing immutable row |
| `P0001` | Idempotency key payload mismatch | Stop; generate a new key for the changed payload and investigate caller reuse |
| `55P03` | Same idempotent operation still processing | Retry with bounded backoff using the same key/body |
| `55000` | Append-only or immutable identity mutation | Publish a successor or use the supported lifecycle command |
| `42501` | Missing context/permission | Verify request context and narrow permission; do not bypass RLS |
| `22023` | Invalid input/range/reason | Correct validation errors before retrying |

## Catalog search degradation

1. Compare exact SKU/barcode and natural-language latency separately.
2. Verify `CAT-0002` exists in `platform.schema_migrations`.
3. Confirm the exact path uses `catalog.variant_barcodes`, SKU or product-code indexes before full-text/fuzzy fallback.
4. Run bounded `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` using synthetic identifiers in a non-production branch.
5. Look for a trigram branch returning a large portion of the catalog for an identifier-shaped query.
6. Confirm statistics are current with `ANALYZE` on the projection/barcode tables.
7. Rebuild a product projection with `catalog.refresh_product_search_documents(product_id)` inside the correct tenant context.
8. For broad repair, iterate product IDs in bounded batches; do not truncate canonical catalog tables.

Evidence command:

```text
npm run mod-a:benchmark:neon
```

Required environment:

```text
DATABASE_URL=<isolated module branch connection>
MOD_A_NEON_BRANCH_ID=br-fancy-bird-axo3z9ek
```

The harness drops only its disposable benchmark schema.

## POS feed recovery

### Consumer lost its cursor

- If the original `snapshotAt` is retained, restart that snapshot from the beginning and de-duplicate by variant/version.
- Otherwise start a new full snapshot at a new instant.
- Never combine a cursor from one snapshot instant with another.

### Consumer sees a lifecycle gap

- Verify inactive variants are not filtered from the feed.
- Compare `(updatedAt, variantId)` ordering and the last committed cursor.
- Request one look-ahead row and persist the returned cursor only after the page is durably applied.

### Feed latency is high

- Reduce consumer limit while investigating.
- Check projection lag and index health.
- Do not switch consumers to direct canonical-table reads.

## Catalog import failure

### Dry-run rejected

- Download row issues and source hash.
- Correct SKU/barcode collisions, duplicate combinations or invalid units.
- Re-plan before execution.

### Execution failed

- The transaction should leave no partial product aggregate.
- Query the import audit by import ID and request ID.
- Retry only with the same key/body when the prior state is unknown.
- Use a new key when corrected rows change the request hash.

### Executed import was commercially wrong

- Do not delete audit records or published/downstream-referenced variants.
- Publish corrected product versions or move affected products/variants to inactive lifecycle state.
- Export the before/after catalog and retain the corrective reason.

## Price or promotion publish failure

### Version conflict

- Read root `current_version` and immutable published history.
- Compare the operator draft with the new published version.
- Rebase into a new version and publish with the new expected version.

### Effective overlap

- Identify the matching legal-entity/store/channel/customer-group scope.
- End the proposed window before the existing start, or start it at/after the existing end.
- When replacing an open-ended current version, publish a controlled successor design through the approved cutover procedure; never update the old row.

### Emergency rollback

- Publish a successor version with the previous known-good rules and an immediate effective instant.
- Record the incident and approval reason.
- Historical snapshots remain tied to their original versions.

## Tax configuration incident

### Wrong rate/treatment published

- Stop further publication for the affected jurisdiction.
- Determine the exact effective interval and impacted source lines through immutable snapshots.
- Publish a corrected successor version; do not modify the wrong version.
- Coordinate downstream financial/legal correction through reversal or adjustment contracts.

### Exemption issue

- Revoke or expire the certificate with a reason and append-only action.
- Recalculate only unposted/current operations.
- Posted historical calculations remain preserved; corrections use downstream adjustment flows.

### Net/tax/gross mismatch

- Quarantine the source line; do not persist a combined snapshot.
- Verify inclusive/exclusive mode, component order and rounding.
- Confirm the invariant `net + tax = gross` and promotion basis before retrying with a new snapshot ID.

## Combined snapshot incident

### Idempotency state unknown

- Query `platform.idempotency_records` by tenant, scope `pricing.price_tax.snapshot` and key.
- If `completed`, return the recorded snapshot.
- If `processing`, retry with bounded backoff.
- If the hash differs, treat it as caller corruption and use a new key only after investigation.

### Historical document differs from current pricing

This is expected after a later version. Use the stored snapshot ID/hash and version references. Do not recalculate the historical line with current rules.

### Snapshot audit/outbox mismatch

- A committed snapshot should have one audit and one outbox event.
- If the snapshot exists without both effects, declare an integrity incident and stop downstream posting.
- Restore or reconcile from a known-good database recovery point; do not manufacture missing events manually without an approved recovery procedure.

## Outbox and consumer replay

- Module outbox events are at-least-once.
- Consumers must use event ID or aggregate/version idempotency.
- Replaying the same event must not duplicate product projections, price activation, tax configuration or document totals.
- Contract-major mismatches fail closed and require integration review.

## Database recovery validation

After restoring a disposable or incident database:

1. verify all Foundation and MOD-A migration IDs/checksums;
2. verify forced RLS on catalog/pricing/tax tables;
3. verify append-only triggers;
4. run Alpha/Beta tenant isolation checks with `store_app_runtime`;
5. replay one idempotent product save and one price-tax snapshot;
6. verify one audit/outbox pair per first write and none added by replay;
7. run exact SKU/barcode and feed smoke tests;
8. compare snapshot counts and calculation hashes with the recovery manifest.

## Escalation evidence

Attach:

- request/trace ID and tenant ID;
- operation and aggregate/snapshot ID;
- SQLSTATE/error class, not raw sensitive payload;
- current/expected version;
- effective scope/window;
- relevant metric window;
- migration IDs/checksums;
- synthetic `EXPLAIN` plan where performance is involved;
- recovery steps already attempted.
