import { requirePermission, type RequestContext, type TransactionClient } from "../../../packages/foundation/src/index.js";
import { PRICING_PERMISSIONS } from "./repository.js";

export interface PublishCommandResult {
  readonly aggregateId: string;
  readonly version: bigint;
  readonly status: string;
  readonly replayed: boolean;
  readonly effectiveFrom: string;
}

export interface PriceRulePublishInput {
  readonly id: string;
  readonly variantId: string;
  readonly unitCode: string;
  readonly minimumQuantityMinor: bigint;
  readonly quantityScale: number;
  readonly unitPriceMinor: bigint;
  readonly compareAtPriceMinor?: bigint;
  readonly minimumMarginBasisPoints?: bigint;
  readonly priority?: number;
  readonly effectiveFrom?: string;
  readonly effectiveUntil?: string;
  readonly ruleVersion?: bigint;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

function validateCommand(idempotencyKey: string, requestHash: string, reason: string): void {
  if (idempotencyKey.length < 8) throw new TypeError("Publishing idempotency key is invalid");
  if (!/^[a-f0-9]{64}$/i.test(requestHash)) throw new TypeError("Publishing request hash must be a SHA-256 hex digest");
  if (reason.trim().length < 4 || reason.length > 500) throw new TypeError("Publishing reason is invalid");
}

function serializeRule(rule: PriceRulePublishInput): Record<string, unknown> {
  return {
    ...rule,
    minimumQuantityMinor: rule.minimumQuantityMinor.toString(),
    unitPriceMinor: rule.unitPriceMinor.toString(),
    ...(rule.compareAtPriceMinor === undefined ? {} : { compareAtPriceMinor: rule.compareAtPriceMinor.toString() }),
    ...(rule.minimumMarginBasisPoints === undefined ? {} : { minimumMarginBasisPoints: rule.minimumMarginBasisPoints.toString() }),
    ...(rule.ruleVersion === undefined ? {} : { ruleVersion: rule.ruleVersion.toString() }),
  };
}

export async function publishPriceListVersion(
  client: TransactionClient,
  context: RequestContext,
  input: {
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly priceList: { readonly id: string; readonly code: string; readonly name: string; readonly currency: string; readonly scale: number; readonly expectedCurrentVersion: bigint };
    readonly version: {
      readonly id: string;
      readonly status: "scheduled" | "active";
      readonly priority?: number;
      readonly legalEntityId?: string;
      readonly storeId?: string;
      readonly channel?: string;
      readonly customerGroupId?: string;
      readonly effectiveFrom: string;
      readonly effectiveUntil?: string;
      readonly reason: string;
    };
    readonly rules: readonly PriceRulePublishInput[];
  },
): Promise<PublishCommandResult> {
  requirePermission(context, PRICING_PERMISSIONS.manage);
  requirePermission(context, PRICING_PERMISSIONS.publish);
  validateCommand(input.idempotencyKey, input.requestHash, input.version.reason);
  if (input.rules.length === 0) throw new TypeError("At least one price rule is required");
  const result = await client.query<{ price_list_id: string; version: string; status: string; replayed: boolean; effective_from: string }>(
    "SELECT price_list_id::text,version::text,status,replayed,effective_from::text FROM pricing.publish_price_list_version($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6)",
    [
      input.idempotencyKey,
      input.requestHash,
      JSON.stringify({ ...input.priceList, expectedCurrentVersion: input.priceList.expectedCurrentVersion.toString() }),
      JSON.stringify(input.version),
      JSON.stringify(input.rules.map(serializeRule)),
      context.requestId,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Price list publish returned no row");
  return Object.freeze({ aggregateId: row.price_list_id, version: BigInt(row.version), status: row.status, replayed: row.replayed, effectiveFrom: row.effective_from });
}

export async function publishPromotionVersion(
  client: TransactionClient,
  context: RequestContext,
  input: {
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly promotion: { readonly id: string; readonly code: string; readonly name: string; readonly expectedCurrentVersion: bigint };
    readonly version: {
      readonly id: string;
      readonly status: "scheduled" | "active";
      readonly priority?: number;
      readonly exclusive?: boolean;
      readonly stackingGroup?: string;
      readonly conditions: readonly unknown[];
      readonly action: Readonly<Record<string, unknown>>;
      readonly effectiveFrom: string;
      readonly effectiveUntil?: string;
      readonly globalRedemptionLimit?: bigint;
      readonly customerRedemptionLimit?: bigint;
      readonly reason: string;
    };
  },
): Promise<PublishCommandResult> {
  requirePermission(context, PRICING_PERMISSIONS.promotionManage);
  validateCommand(input.idempotencyKey, input.requestHash, input.version.reason);
  const version = {
    ...input.version,
    ...(input.version.globalRedemptionLimit === undefined ? {} : { globalRedemptionLimit: input.version.globalRedemptionLimit.toString() }),
    ...(input.version.customerRedemptionLimit === undefined ? {} : { customerRedemptionLimit: input.version.customerRedemptionLimit.toString() }),
  };
  const result = await client.query<{ promotion_id: string; version: string; status: string; replayed: boolean; effective_from: string }>(
    "SELECT promotion_id::text,version::text,status,replayed,effective_from::text FROM pricing.publish_promotion_version($1,$2,$3::jsonb,$4::jsonb,$5)",
    [
      input.idempotencyKey,
      input.requestHash,
      JSON.stringify({ ...input.promotion, expectedCurrentVersion: input.promotion.expectedCurrentVersion.toString() }),
      JSON.stringify(version),
      context.requestId,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Promotion publish returned no row");
  return Object.freeze({ aggregateId: row.promotion_id, version: BigInt(row.version), status: row.status, replayed: row.replayed, effectiveFrom: row.effective_from });
}
