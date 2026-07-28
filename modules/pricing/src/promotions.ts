import { addMoney, compareMoney, money, subtractMoney, type Money } from "../../../packages/foundation/src/index.js";
import { allocateMoneyExact, divideRounded, percentageOf, type RoundingMode } from "./exact.js";
import type { SalesChannel } from "./model.js";

export interface PromotionLine {
  readonly lineId: string;
  readonly variantId: string;
  readonly productId?: string;
  readonly categoryIds: readonly string[];
  readonly tags: readonly string[];
  readonly quantityMinor: bigint;
  readonly quantityScale: number;
  readonly unitPrice: Money;
}

export interface PromotionContext {
  readonly lines: readonly PromotionLine[];
  readonly channel: SalesChannel;
  readonly storeId?: string;
  readonly customerId?: string;
  readonly customerGroupId?: string;
  readonly couponCodes?: readonly string[];
  readonly at: string;
  readonly redemptionCounts?: Readonly<Record<string, bigint>>;
}

export type PromotionCondition =
  | { readonly type: "variant"; readonly variantIds: readonly string[] }
  | { readonly type: "product"; readonly productIds: readonly string[] }
  | { readonly type: "category"; readonly categoryIds: readonly string[] }
  | { readonly type: "tag"; readonly tags: readonly string[] }
  | { readonly type: "minimum_subtotal"; readonly amount: Money }
  | { readonly type: "minimum_quantity"; readonly quantityMinor: bigint; readonly quantityScale: number }
  | { readonly type: "channel"; readonly channels: readonly SalesChannel[] }
  | { readonly type: "store"; readonly storeIds: readonly string[] }
  | { readonly type: "customer_group"; readonly customerGroupIds: readonly string[] }
  | { readonly type: "coupon"; readonly codes: readonly string[] };

export type PromotionAction =
  | { readonly type: "percentage"; readonly basisPoints: bigint; readonly maximumDiscount?: Money }
  | { readonly type: "fixed"; readonly amount: Money }
  | { readonly type: "buy_x_get_y"; readonly buyQuantityMinor: bigint; readonly getQuantityMinor: bigint; readonly quantityScale: number; readonly discountBasisPoints: bigint };

export interface Promotion {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: "draft" | "scheduled" | "active" | "paused" | "expired" | "retired";
  readonly priority: number;
  readonly exclusive: boolean;
  readonly stackingGroup?: string;
  readonly conditions: readonly PromotionCondition[];
  readonly action: PromotionAction;
  readonly effectiveFrom: string;
  readonly effectiveUntil?: string;
  readonly globalRedemptionLimit?: bigint;
  readonly customerRedemptionLimit?: bigint;
  readonly version: bigint;
}

export interface AppliedPromotion {
  readonly promotionId: string;
  readonly promotionCode: string;
  readonly discount: Money;
  readonly lineAllocations: Readonly<Record<string, Money>>;
  readonly version: bigint;
}

export interface PromotionResult {
  readonly subtotal: Money;
  readonly discountTotal: Money;
  readonly total: Money;
  readonly applied: readonly AppliedPromotion[];
  readonly rejected: readonly { readonly promotionId: string; readonly reason: string }[];
}

function compatible(left: Money, right: Money): boolean {
  return left.currency === right.currency && left.scale === right.scale;
}

function lineSubtotal(line: PromotionLine, rounding: RoundingMode): Money {
  if (line.quantityMinor <= 0n) throw new RangeError("Promotion line quantity must be positive");
  if (!Number.isInteger(line.quantityScale) || line.quantityScale < 0 || line.quantityScale > 18) throw new RangeError("Promotion line quantity scale is invalid");
  return money(divideRounded(line.unitPrice.amountMinor * line.quantityMinor, 10n ** BigInt(line.quantityScale), rounding), line.unitPrice.currency, line.unitPrice.scale);
}

function cartSubtotal(lines: readonly PromotionLine[], rounding: RoundingMode): Money {
  if (lines.length === 0) throw new TypeError("Promotion evaluation requires at least one line");
  const values = lines.map((line) => lineSubtotal(line, rounding));
  return values.slice(1).reduce(addMoney, values[0]!);
}

function conditionMatches(condition: PromotionCondition, context: PromotionContext, eligibleLines: readonly PromotionLine[], subtotal: Money): boolean {
  switch (condition.type) {
    case "variant": return eligibleLines.some((line) => condition.variantIds.includes(line.variantId));
    case "product": return eligibleLines.some((line) => line.productId !== undefined && condition.productIds.includes(line.productId));
    case "category": return eligibleLines.some((line) => line.categoryIds.some((id) => condition.categoryIds.includes(id)));
    case "tag": return eligibleLines.some((line) => line.tags.some((tag) => condition.tags.includes(tag)));
    case "minimum_subtotal": return compatible(subtotal, condition.amount) && compareMoney(subtotal, condition.amount) >= 0;
    case "minimum_quantity": {
      const total = eligibleLines.reduce((sum, line) => sum + line.quantityMinor * 10n ** BigInt(condition.quantityScale), 0n);
      const threshold = condition.quantityMinor * 10n ** BigInt(eligibleLines[0]?.quantityScale ?? condition.quantityScale);
      return total >= threshold;
    }
    case "channel": return condition.channels.includes(context.channel);
    case "store": return context.storeId !== undefined && condition.storeIds.includes(context.storeId);
    case "customer_group": return context.customerGroupId !== undefined && condition.customerGroupIds.includes(context.customerGroupId);
    case "coupon": {
      const supplied = new Set((context.couponCodes ?? []).map((code) => code.trim().toUpperCase()));
      return condition.codes.some((code) => supplied.has(code.trim().toUpperCase()));
    }
  }
}

function targetLines(promotion: Promotion, lines: readonly PromotionLine[]): readonly PromotionLine[] {
  const targeting = promotion.conditions.filter((condition) => ["variant", "product", "category", "tag"].includes(condition.type));
  if (targeting.length === 0) return lines;
  return lines.filter((line) => targeting.every((condition) => {
    switch (condition.type) {
      case "variant": return condition.variantIds.includes(line.variantId);
      case "product": return line.productId !== undefined && condition.productIds.includes(line.productId);
      case "category": return line.categoryIds.some((id) => condition.categoryIds.includes(id));
      case "tag": return line.tags.some((tag) => condition.tags.includes(tag));
      default: return true;
    }
  }));
}

function effective(promotion: Promotion, at: Date): boolean {
  return new Date(promotion.effectiveFrom) <= at && (promotion.effectiveUntil === undefined || new Date(promotion.effectiveUntil) > at);
}

function actionDiscount(action: PromotionAction, lines: readonly PromotionLine[], rounding: RoundingMode): Money {
  const subtotal = cartSubtotal(lines, rounding);
  switch (action.type) {
    case "percentage": {
      let value = percentageOf(subtotal, action.basisPoints, rounding);
      if (action.maximumDiscount !== undefined) {
        if (!compatible(value, action.maximumDiscount)) throw new TypeError("Promotion maximum discount currency is incompatible");
        if (value.amountMinor > action.maximumDiscount.amountMinor) value = action.maximumDiscount;
      }
      return value;
    }
    case "fixed": {
      if (!compatible(subtotal, action.amount)) throw new TypeError("Fixed promotion currency is incompatible");
      return action.amount.amountMinor > subtotal.amountMinor ? subtotal : action.amount;
    }
    case "buy_x_get_y": {
      if (action.buyQuantityMinor <= 0n || action.getQuantityMinor <= 0n) throw new RangeError("Buy-X-get-Y quantities must be positive");
      const totalQuantity = lines.reduce((sum, line) => {
        const scaled = line.quantityMinor * 10n ** BigInt(action.quantityScale);
        return sum + scaled / 10n ** BigInt(line.quantityScale);
      }, 0n);
      const group = action.buyQuantityMinor + action.getQuantityMinor;
      const freeQuantity = (totalQuantity / group) * action.getQuantityMinor;
      if (freeQuantity === 0n) return money(0n, subtotal.currency, subtotal.scale);
      const effectiveBasisPoints = divideRounded(action.discountBasisPoints * freeQuantity, totalQuantity, rounding);
      return percentageOf(subtotal, effectiveBasisPoints, rounding);
    }
  }
}

function allocationMap(discount: Money, lines: readonly PromotionLine[], rounding: RoundingMode): Readonly<Record<string, Money>> {
  const subtotals = lines.map((line) => lineSubtotal(line, rounding));
  const allocations = allocateMoneyExact(discount, subtotals.map((value) => value.amountMinor));
  return Object.freeze(Object.fromEntries(lines.map((line, index) => [line.lineId, allocations[index]!])));
}

export function evaluatePromotions(
  promotions: readonly Promotion[],
  context: PromotionContext,
  rounding: RoundingMode = "half_up",
): PromotionResult {
  const at = new Date(context.at);
  if (Number.isNaN(at.valueOf())) throw new TypeError("Promotion evaluation instant is invalid");
  const subtotal = cartSubtotal(context.lines, rounding);
  let remaining = subtotal;
  const applied: AppliedPromotion[] = [];
  const rejected: { promotionId: string; reason: string }[] = [];
  const usedGroups = new Set<string>();

  const candidates = [...promotions].sort((left, right) => right.priority - left.priority || left.code.localeCompare(right.code));
  for (const promotion of candidates) {
    if (promotion.status !== "active" || !effective(promotion, at)) {
      rejected.push({ promotionId: promotion.id, reason: "inactive_or_outside_effective_window" });
      continue;
    }
    if (promotion.version <= 0n) throw new RangeError("Promotion version must be positive");
    if (promotion.globalRedemptionLimit !== undefined && (context.redemptionCounts?.[promotion.id] ?? 0n) >= promotion.globalRedemptionLimit) {
      rejected.push({ promotionId: promotion.id, reason: "global_redemption_limit_reached" });
      continue;
    }
    if (promotion.stackingGroup !== undefined && usedGroups.has(promotion.stackingGroup)) {
      rejected.push({ promotionId: promotion.id, reason: "stacking_group_already_applied" });
      continue;
    }
    const lines = targetLines(promotion, context.lines);
    if (lines.length === 0 || !promotion.conditions.every((condition) => conditionMatches(condition, context, lines, subtotal))) {
      rejected.push({ promotionId: promotion.id, reason: "conditions_not_met" });
      continue;
    }
    let discount = actionDiscount(promotion.action, lines, rounding);
    if (discount.amountMinor <= 0n) {
      rejected.push({ promotionId: promotion.id, reason: "zero_discount" });
      continue;
    }
    if (!compatible(discount, remaining)) throw new TypeError("Promotion currency is incompatible with cart currency");
    if (discount.amountMinor > remaining.amountMinor) discount = remaining;
    const allocation = allocationMap(discount, lines, rounding);
    applied.push(Object.freeze({ promotionId: promotion.id, promotionCode: promotion.code, discount, lineAllocations: allocation, version: promotion.version }));
    remaining = subtractMoney(remaining, discount);
    if (promotion.stackingGroup !== undefined) usedGroups.add(promotion.stackingGroup);
    if (promotion.exclusive || remaining.amountMinor === 0n) break;
  }

  const discountTotal = subtractMoney(subtotal, remaining);
  return Object.freeze({ subtotal, discountTotal, total: remaining, applied: Object.freeze(applied), rejected: Object.freeze(rejected) });
}

export interface ManualDiscountDecision {
  readonly allowed: boolean;
  readonly approvalRequired: boolean;
  readonly requestedDiscount: Money;
  readonly resultingPrice: Money;
  readonly reason?: string;
}

export function evaluateManualDiscount(input: {
  readonly currentPrice: Money;
  readonly discount: Money;
  readonly minimumAllowedPrice?: Money;
  readonly automaticApprovalLimitBasisPoints: bigint;
  readonly approved: boolean;
  readonly reason?: string;
}, rounding: RoundingMode = "half_up"): ManualDiscountDecision {
  if (!compatible(input.currentPrice, input.discount)) throw new TypeError("Manual discount currency is incompatible");
  if (input.discount.amountMinor < 0n || input.discount.amountMinor > input.currentPrice.amountMinor) throw new RangeError("Manual discount is outside the allowed range");
  const automaticLimit = percentageOf(input.currentPrice, input.automaticApprovalLimitBasisPoints, rounding);
  const resultingPrice = subtractMoney(input.currentPrice, input.discount);
  const belowMargin = input.minimumAllowedPrice !== undefined && compareMoney(resultingPrice, input.minimumAllowedPrice) < 0;
  const approvalRequired = input.discount.amountMinor > automaticLimit.amountMinor || belowMargin;
  const reasonValid = input.reason !== undefined && input.reason.trim().length >= 4 && input.reason.length <= 500;
  const allowed = (!approvalRequired || input.approved) && (!approvalRequired || reasonValid);
  return Object.freeze({
    allowed,
    approvalRequired,
    requestedDiscount: input.discount,
    resultingPrice,
    ...(!allowed ? { reason: approvalRequired && !input.approved ? "approval_required" : "reason_required" } : {}),
  });
}
