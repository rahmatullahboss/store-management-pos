import { requirePermission, type RequestContext, type TransactionClient } from "../../../packages/foundation/src/index.js";

export const PRICING_PERMISSIONS = Object.freeze({
  read: "pricing.price.read",
  manage: "pricing.price.manage",
  publish: "pricing.price.publish",
  promotionManage: "pricing.promotion.manage",
  discountApply: "pricing.discount.apply",
  discountApprove: "pricing.discount.approve",
} as const);

export interface PersistedPriceQuote {
  readonly snapshotId: string;
  readonly variantId: string;
  readonly priceListId: string;
  readonly priceRuleId: string;
  readonly currency: string;
  readonly scale: number;
  readonly unitPriceMinor: bigint;
  readonly quantityMinor: bigint;
  readonly quantityScale: number;
  readonly subtotalMinor: bigint;
  readonly discountMinor: bigint;
  readonly totalMinor: bigint;
  readonly promotionIds: readonly string[];
  readonly calculationHash: string;
  readonly replayed: boolean;
  readonly createdAt: string;
}

export async function persistPriceQuote(
  client: TransactionClient,
  context: RequestContext,
  input: {
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly snapshot: Omit<PersistedPriceQuote, "replayed" | "createdAt">;
  },
): Promise<PersistedPriceQuote> {
  requirePermission(context, PRICING_PERMISSIONS.read);
  if (input.idempotencyKey.length < 8) throw new TypeError("Pricing idempotency key is invalid");
  if (!/^[a-f0-9]{64}$/i.test(input.requestHash) || !/^[a-f0-9]{64}$/i.test(input.snapshot.calculationHash)) throw new TypeError("Pricing hashes must be SHA-256 hex digests");
  const result = await client.query<{
    snapshot_id: string;
    variant_id: string;
    price_list_id: string;
    price_rule_id: string;
    currency: string;
    scale: number;
    unit_price_minor: string;
    quantity_minor: string;
    quantity_scale: number;
    subtotal_minor: string;
    discount_minor: string;
    total_minor: string;
    promotion_ids: string[];
    calculation_hash: string;
    replayed: boolean;
    created_at: string;
  }>(
    "SELECT * FROM pricing.record_quote_snapshot($1,$2,$3::jsonb,$4)",
    [input.idempotencyKey, input.requestHash, JSON.stringify({
      ...input.snapshot,
      unitPriceMinor: input.snapshot.unitPriceMinor.toString(),
      quantityMinor: input.snapshot.quantityMinor.toString(),
      subtotalMinor: input.snapshot.subtotalMinor.toString(),
      discountMinor: input.snapshot.discountMinor.toString(),
      totalMinor: input.snapshot.totalMinor.toString(),
    }), context.requestId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Pricing quote snapshot returned no row");
  return Object.freeze({
    snapshotId: row.snapshot_id,
    variantId: row.variant_id,
    priceListId: row.price_list_id,
    priceRuleId: row.price_rule_id,
    currency: row.currency,
    scale: row.scale,
    unitPriceMinor: BigInt(row.unit_price_minor),
    quantityMinor: BigInt(row.quantity_minor),
    quantityScale: row.quantity_scale,
    subtotalMinor: BigInt(row.subtotal_minor),
    discountMinor: BigInt(row.discount_minor),
    totalMinor: BigInt(row.total_minor),
    promotionIds: Object.freeze(row.promotion_ids),
    calculationHash: row.calculation_hash,
    replayed: row.replayed,
    createdAt: row.created_at,
  });
}

export async function requestManualDiscountApproval(
  client: TransactionClient,
  context: RequestContext,
  input: {
    readonly approvalId: string;
    readonly targetType: string;
    readonly targetId: string;
    readonly currency: string;
    readonly scale: number;
    readonly originalAmountMinor: bigint;
    readonly requestedDiscountMinor: bigint;
    readonly minimumAllowedAmountMinor?: bigint;
    readonly reason: string;
  },
): Promise<void> {
  requirePermission(context, PRICING_PERMISSIONS.discountApply);
  if (input.reason.trim().length < 4 || input.reason.length > 500) throw new TypeError("Manual discount reason is invalid");
  await client.query("SELECT pricing.request_manual_discount_approval($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [
    input.approvalId,
    input.targetType,
    input.targetId,
    input.currency,
    input.scale,
    input.originalAmountMinor.toString(),
    input.requestedDiscountMinor.toString(),
    input.minimumAllowedAmountMinor?.toString() ?? null,
    input.reason.trim(),
    context.requestId,
  ]);
}
