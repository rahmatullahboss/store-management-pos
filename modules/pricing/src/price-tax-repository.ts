import { requirePermission, type RequestContext, type TransactionClient } from "../../../packages/foundation/src/index.js";
import type { PriceTaxSnapshot } from "./price-tax.js";
import { PRICING_PERMISSIONS } from "./repository.js";

export interface PersistedPriceTaxSnapshot {
  readonly snapshotId: string;
  readonly sourceLineId: string;
  readonly variantId: string;
  readonly currency: string;
  readonly scale: number;
  readonly subtotalMinor: bigint;
  readonly discountMinor: bigint;
  readonly netMinor: bigint;
  readonly taxMinor: bigint;
  readonly grossMinor: bigint;
  readonly calculationHash: string;
  readonly replayed: boolean;
  readonly createdAt: string;
}

function serializeSnapshot(snapshot: PriceTaxSnapshot): string {
  return JSON.stringify({
    ...snapshot,
    quantityMinor: snapshot.quantityMinor.toString(),
    priceListVersion: snapshot.priceListVersion.toString(),
    priceRuleVersion: snapshot.priceRuleVersion.toString(),
    unitPriceMinor: snapshot.unitPriceMinor.toString(),
    subtotalMinor: snapshot.subtotalMinor.toString(),
    discountMinor: snapshot.discountMinor.toString(),
    promotedAmountMinor: snapshot.promotedAmountMinor.toString(),
    netMinor: snapshot.netMinor.toString(),
    taxMinor: snapshot.taxMinor.toString(),
    grossMinor: snapshot.grossMinor.toString(),
    promotions: snapshot.promotions.map((promotion) => ({
      ...promotion,
      version: promotion.version.toString(),
      discountMinor: promotion.discountMinor.toString(),
    })),
    taxComponents: snapshot.taxComponents.map((component) => ({
      ...component,
      rateBasisPoints: component.rateBasisPoints.toString(),
      taxableBaseMinor: component.taxableBaseMinor.toString(),
      taxMinor: component.taxMinor.toString(),
      recoverableTaxMinor: component.recoverableTaxMinor.toString(),
      reportingTaxMinor: component.reportingTaxMinor.toString(),
    })),
  });
}

export async function persistPriceTaxSnapshot(
  client: TransactionClient,
  context: RequestContext,
  input: {
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly snapshot: PriceTaxSnapshot;
  },
): Promise<PersistedPriceTaxSnapshot> {
  requirePermission(context, PRICING_PERMISSIONS.read);
  requirePermission(context, "tax.calculation.read");
  if (input.idempotencyKey.length < 8) throw new TypeError("Price-tax idempotency key is invalid");
  if (!/^[a-f0-9]{64}$/i.test(input.requestHash) || !/^[a-f0-9]{64}$/.test(input.snapshot.calculationHash)) {
    throw new TypeError("Price-tax hashes must be SHA-256 hex digests");
  }
  const result = await client.query<{
    snapshot_id: string;
    source_line_id: string;
    variant_id: string;
    currency: string;
    scale: number;
    subtotal_minor: string;
    discount_minor: string;
    net_minor: string;
    tax_minor: string;
    gross_minor: string;
    calculation_hash: string;
    replayed: boolean;
    created_at: string;
  }>("SELECT * FROM pricing.record_price_tax_snapshot($1,$2,$3::jsonb,$4)", [
    input.idempotencyKey,
    input.requestHash,
    serializeSnapshot(input.snapshot),
    context.requestId,
  ]);
  const row = result.rows[0];
  if (!row) throw new Error("Price-tax snapshot returned no row");
  return Object.freeze({
    snapshotId: row.snapshot_id,
    sourceLineId: row.source_line_id,
    variantId: row.variant_id,
    currency: row.currency,
    scale: row.scale,
    subtotalMinor: BigInt(row.subtotal_minor),
    discountMinor: BigInt(row.discount_minor),
    netMinor: BigInt(row.net_minor),
    taxMinor: BigInt(row.tax_minor),
    grossMinor: BigInt(row.gross_minor),
    calculationHash: row.calculation_hash,
    replayed: row.replayed,
    createdAt: row.created_at,
  });
}
