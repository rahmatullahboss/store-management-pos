import { JsonLogger, NoopMetricSink, money, type MetricSink, type NeonDatabase, type RequestContext } from "../../../packages/foundation/src/index.js";
import { divideRounded, type RoundingMode } from "./exact.js";
import { resolvePrice, type PriceContext, type PriceList, type PriceRule, type ResolvedPrice } from "./model.js";
import { evaluatePromotions, type Promotion, type PromotionContext, type PromotionResult } from "./promotions.js";
import { persistPriceQuote, type PersistedPriceQuote } from "./repository.js";

export interface PriceQuoteResult {
  readonly price: ResolvedPrice;
  readonly promotions: PromotionResult;
  readonly persisted?: PersistedPriceQuote;
}

function stableJson(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class PricingApi {
  private readonly metrics: MetricSink;

  constructor(private readonly options: { readonly database?: NeonDatabase; readonly metrics?: MetricSink }) {
    this.metrics = options.metrics ?? new NoopMetricSink();
  }

  async quote(input: {
    readonly context: PriceContext;
    readonly priceLists: readonly PriceList[];
    readonly priceRules: readonly PriceRule[];
    readonly promotions: readonly Promotion[];
    readonly promotionContext: Omit<PromotionContext, "lines">;
    readonly lineId: string;
    readonly productId?: string;
    readonly categoryIds?: readonly string[];
    readonly tags?: readonly string[];
    readonly rounding?: RoundingMode;
    readonly persistence?: { readonly context: RequestContext; readonly idempotencyKey: string; readonly requestHash: string; readonly snapshotId: string };
  }): Promise<PriceQuoteResult> {
    const startedAt = performance.now();
    const rounding = input.rounding ?? "half_up";
    const resolved = resolvePrice(input.priceLists, input.priceRules, input.context, rounding);
    const subtotalMinor = divideRounded(resolved.unitPrice.amountMinor * input.context.quantityMinor, 10n ** BigInt(input.context.quantityScale), rounding);
    const promotions = evaluatePromotions(input.promotions, {
      ...input.promotionContext,
      lines: [{
        lineId: input.lineId,
        variantId: input.context.variantId,
        ...(input.productId === undefined ? {} : { productId: input.productId }),
        categoryIds: input.categoryIds ?? [],
        tags: input.tags ?? [],
        quantityMinor: input.context.quantityMinor,
        quantityScale: input.context.quantityScale,
        unitPrice: resolved.unitPrice,
      }],
    }, rounding);
    const calculationHash = await sha256({ resolved, promotions });
    let persisted: PersistedPriceQuote | undefined;
    if (input.persistence !== undefined) {
      if (!this.options.database) throw new Error("Pricing persistence requires a database");
      persisted = await this.options.database.withClientTransaction(input.persistence.context, async (client) => await persistPriceQuote(client, input.persistence!.context, {
        idempotencyKey: input.persistence!.idempotencyKey,
        requestHash: input.persistence!.requestHash,
        snapshot: {
          snapshotId: input.persistence!.snapshotId,
          variantId: input.context.variantId,
          priceListId: resolved.priceListId,
          priceRuleId: resolved.priceRuleId,
          currency: resolved.unitPrice.currency,
          scale: resolved.unitPrice.scale,
          unitPriceMinor: resolved.unitPrice.amountMinor,
          quantityMinor: input.context.quantityMinor,
          quantityScale: input.context.quantityScale,
          subtotalMinor,
          discountMinor: promotions.discountTotal.amountMinor,
          totalMinor: promotions.total.amountMinor,
          promotionIds: promotions.applied.map((promotion) => promotion.promotionId),
          calculationHash,
        },
      }));
    }
    this.metrics.increment("pricing.quote.success", 1, { promotionCount: String(promotions.applied.length), persisted: String(persisted !== undefined) });
    this.metrics.observe("pricing.quote.duration_ms", performance.now() - startedAt, { persisted: String(persisted !== undefined) });
    if (input.persistence !== undefined) {
      new JsonLogger({
        requestId: input.persistence.context.requestId,
        traceId: input.persistence.context.traceId,
        tenantId: input.persistence.context.tenantId,
        actorId: input.persistence.context.actorId,
        module: "pricing",
      }).info("pricing quote resolved", { priceListId: resolved.priceListId, priceRuleId: resolved.priceRuleId, calculationHash });
    }
    return Object.freeze({ price: resolved, promotions, ...(persisted === undefined ? {} : { persisted }) });
  }
}

export function quoteMoney(amountMinor: bigint, currency: string, scale: number) {
  return money(amountMinor, currency, scale);
}
