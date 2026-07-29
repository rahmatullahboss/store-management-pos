import { currencyCode, money, type CurrencyCode, type Money } from "../../../packages/foundation/src/index.js";
import type { RoundingMode } from "./exact.js";

export type PriceListStatus = "draft" | "scheduled" | "active" | "retired";
export type SalesChannel = "admin" | "pos" | "web" | "mobile" | "marketplace" | "wholesale";

export interface PriceScope {
  readonly legalEntityId?: string;
  readonly storeId?: string;
  readonly channel?: SalesChannel;
  readonly customerGroupId?: string;
}

export interface PriceList {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly currency: CurrencyCode;
  readonly scale: number;
  readonly status: PriceListStatus;
  readonly priority: number;
  readonly scope: PriceScope;
  readonly effectiveFrom: string;
  readonly effectiveUntil?: string;
  readonly version: bigint;
}

export interface PriceRule {
  readonly id: string;
  readonly priceListId: string;
  readonly variantId: string;
  readonly unitCode: string;
  readonly minimumQuantityMinor: bigint;
  readonly quantityScale: number;
  readonly unitPrice: Money;
  readonly compareAtPrice?: Money;
  readonly minimumMarginBasisPoints?: bigint;
  readonly effectiveFrom?: string;
  readonly effectiveUntil?: string;
  readonly priority: number;
  readonly version: bigint;
}

export interface PriceContext {
  readonly variantId: string;
  readonly unitCode: string;
  readonly quantityMinor: bigint;
  readonly quantityScale: number;
  readonly currency: string;
  readonly scale: number;
  readonly legalEntityId?: string;
  readonly storeId?: string;
  readonly channel: SalesChannel;
  readonly customerGroupId?: string;
  readonly at: string;
  readonly cost?: Money;
}

export interface ResolvedPrice {
  readonly priceListId: string;
  readonly priceRuleId: string;
  readonly priceListVersion: bigint;
  readonly priceRuleVersion: bigint;
  readonly unitPrice: Money;
  readonly compareAtPrice?: Money;
  readonly minimumAllowedPrice?: Money;
  readonly scopeSpecificity: number;
  readonly resolvedAt: string;
}

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{0,63}$/;

function instant(value: string, field: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError(`${field} is invalid`);
  return date.toISOString();
}

function validateEffectiveRange(effectiveFrom: string, effectiveUntil?: string): void {
  const start = new Date(effectiveFrom);
  if (Number.isNaN(start.valueOf())) throw new TypeError("effectiveFrom is invalid");
  if (effectiveUntil !== undefined) {
    const end = new Date(effectiveUntil);
    if (Number.isNaN(end.valueOf()) || end <= start) throw new TypeError("effectiveUntil must be later than effectiveFrom");
  }
}

export function definePriceList(input: Omit<PriceList, "currency" | "effectiveFrom" | "effectiveUntil"> & {
  readonly currency: string;
  readonly effectiveFrom: string;
  readonly effectiveUntil?: string;
}): PriceList {
  const code = input.code.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) throw new TypeError("Price list code is invalid");
  if (input.name.trim().length === 0 || input.name.length > 160) throw new TypeError("Price list name is invalid");
  if (!Number.isInteger(input.scale) || input.scale < 0 || input.scale > 12) throw new RangeError("Price list scale is invalid");
  if (!Number.isInteger(input.priority) || input.priority < -1_000_000 || input.priority > 1_000_000) throw new RangeError("Price list priority is invalid");
  if (input.version <= 0n) throw new RangeError("Price list version must be positive");
  validateEffectiveRange(input.effectiveFrom, input.effectiveUntil);
  return Object.freeze({
    ...input,
    code,
    name: input.name.trim(),
    currency: currencyCode(input.currency),
    effectiveFrom: instant(input.effectiveFrom, "effectiveFrom"),
    ...(input.effectiveUntil === undefined ? {} : { effectiveUntil: instant(input.effectiveUntil, "effectiveUntil") }),
  });
}

export function definePriceRule(input: Omit<PriceRule, "unitPrice" | "compareAtPrice" | "effectiveFrom" | "effectiveUntil"> & {
  readonly unitPriceMinor: bigint;
  readonly currency: string;
  readonly moneyScale: number;
  readonly compareAtPriceMinor?: bigint;
  readonly effectiveFrom?: string;
  readonly effectiveUntil?: string;
}): PriceRule {
  if (input.minimumQuantityMinor <= 0n) throw new RangeError("Minimum quantity must be positive");
  if (!Number.isInteger(input.quantityScale) || input.quantityScale < 0 || input.quantityScale > 18) throw new RangeError("Quantity scale is invalid");
  if (input.unitPriceMinor < 0n) throw new RangeError("Unit price cannot be negative");
  if (input.compareAtPriceMinor !== undefined && input.compareAtPriceMinor < input.unitPriceMinor) throw new RangeError("Compare-at price cannot be below unit price");
  if (input.minimumMarginBasisPoints !== undefined && (input.minimumMarginBasisPoints < 0n || input.minimumMarginBasisPoints >= 10_000n)) {
    throw new RangeError("Minimum margin must be between 0 and 9,999 basis points");
  }
  if (input.version <= 0n) throw new RangeError("Price rule version must be positive");
  if (input.effectiveFrom !== undefined) validateEffectiveRange(input.effectiveFrom, input.effectiveUntil);
  const unitPrice = money(input.unitPriceMinor, input.currency, input.moneyScale);
  return Object.freeze({
    id: input.id,
    priceListId: input.priceListId,
    variantId: input.variantId,
    unitCode: input.unitCode.trim().toUpperCase(),
    minimumQuantityMinor: input.minimumQuantityMinor,
    quantityScale: input.quantityScale,
    unitPrice,
    ...(input.compareAtPriceMinor === undefined ? {} : { compareAtPrice: money(input.compareAtPriceMinor, input.currency, input.moneyScale) }),
    ...(input.minimumMarginBasisPoints === undefined ? {} : { minimumMarginBasisPoints: input.minimumMarginBasisPoints }),
    ...(input.effectiveFrom === undefined ? {} : { effectiveFrom: instant(input.effectiveFrom, "effectiveFrom") }),
    ...(input.effectiveUntil === undefined ? {} : { effectiveUntil: instant(input.effectiveUntil, "effectiveUntil") }),
    priority: input.priority,
    version: input.version,
  });
}

function scopeSpecificity(scope: PriceScope): number {
  return Number(scope.legalEntityId !== undefined)
    + Number(scope.storeId !== undefined) * 2
    + Number(scope.channel !== undefined) * 4
    + Number(scope.customerGroupId !== undefined) * 8;
}

function scopeMatches(scope: PriceScope, context: PriceContext): boolean {
  return (scope.legalEntityId === undefined || scope.legalEntityId === context.legalEntityId)
    && (scope.storeId === undefined || scope.storeId === context.storeId)
    && (scope.channel === undefined || scope.channel === context.channel)
    && (scope.customerGroupId === undefined || scope.customerGroupId === context.customerGroupId);
}

function effectiveAt(from: string, until: string | undefined, at: Date): boolean {
  return new Date(from) <= at && (until === undefined || new Date(until) > at);
}

function quantityMeetsThreshold(context: PriceContext, rule: PriceRule): boolean {
  const contextAmount = context.quantityMinor * 10n ** BigInt(rule.quantityScale);
  const ruleAmount = rule.minimumQuantityMinor * 10n ** BigInt(context.quantityScale);
  return contextAmount >= ruleAmount;
}

function minimumPriceForMargin(cost: Money, marginBasisPoints: bigint, rounding: RoundingMode): Money {
  if (marginBasisPoints < 0n || marginBasisPoints >= 10_000n) throw new RangeError("Margin basis points are invalid");
  const denominator = 10_000n - marginBasisPoints;
  const numerator = cost.amountMinor * 10_000n;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const amount = rounding === "floor" || rounding === "toward_zero" || remainder === 0n ? quotient : quotient + 1n;
  return money(amount, cost.currency, cost.scale);
}

export function resolvePrice(
  priceLists: readonly PriceList[],
  rules: readonly PriceRule[],
  context: PriceContext,
  rounding: RoundingMode = "half_up",
): ResolvedPrice {
  const at = new Date(context.at);
  if (Number.isNaN(at.valueOf())) throw new TypeError("Price context instant is invalid");
  if (context.quantityMinor <= 0n) throw new RangeError("Price quantity must be positive");
  if (!Number.isInteger(context.quantityScale) || context.quantityScale < 0 || context.quantityScale > 18) throw new RangeError("Price quantity scale is invalid");
  const currency = currencyCode(context.currency);
  const activeLists = priceLists
    .filter((list) => list.status === "active" || list.status === "scheduled")
    .filter((list) => list.currency === currency && list.scale === context.scale)
    .filter((list) => effectiveAt(list.effectiveFrom, list.effectiveUntil, at))
    .filter((list) => scopeMatches(list.scope, context));
  const listById = new Map(activeLists.map((list) => [list.id, list]));
  const candidates = rules
    .filter((rule) => rule.variantId === context.variantId && rule.unitCode === context.unitCode.trim().toUpperCase())
    .filter((rule) => listById.has(rule.priceListId))
    .filter((rule) => quantityMeetsThreshold(context, rule))
    .filter((rule) => rule.effectiveFrom === undefined || effectiveAt(rule.effectiveFrom, rule.effectiveUntil, at))
    .map((rule) => ({ rule, list: listById.get(rule.priceListId)! }))
    .sort((left, right) => {
      const specificity = scopeSpecificity(right.list.scope) - scopeSpecificity(left.list.scope);
      if (specificity !== 0) return specificity;
      if (right.list.priority !== left.list.priority) return right.list.priority - left.list.priority;
      if (right.rule.priority !== left.rule.priority) return right.rule.priority - left.rule.priority;
      if (right.rule.minimumQuantityMinor !== left.rule.minimumQuantityMinor) return right.rule.minimumQuantityMinor > left.rule.minimumQuantityMinor ? 1 : -1;
      return right.rule.version > left.rule.version ? 1 : right.rule.version < left.rule.version ? -1 : 0;
    });
  const selected = candidates[0];
  if (!selected) throw new RangeError("No effective price rule matched the request");
  let minimumAllowedPrice: Money | undefined;
  if (context.cost !== undefined && selected.rule.minimumMarginBasisPoints !== undefined) {
    if (context.cost.currency !== selected.rule.unitPrice.currency || context.cost.scale !== selected.rule.unitPrice.scale) throw new TypeError("Cost and price currencies are incompatible");
    minimumAllowedPrice = minimumPriceForMargin(context.cost, selected.rule.minimumMarginBasisPoints, rounding);
  }
  return Object.freeze({
    priceListId: selected.list.id,
    priceRuleId: selected.rule.id,
    priceListVersion: selected.list.version,
    priceRuleVersion: selected.rule.version,
    unitPrice: selected.rule.unitPrice,
    ...(selected.rule.compareAtPrice === undefined ? {} : { compareAtPrice: selected.rule.compareAtPrice }),
    ...(minimumAllowedPrice === undefined ? {} : { minimumAllowedPrice }),
    scopeSpecificity: scopeSpecificity(selected.list.scope),
    resolvedAt: at.toISOString(),
  });
}
