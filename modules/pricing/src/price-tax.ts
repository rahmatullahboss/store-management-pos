import { JsonLogger, NoopMetricSink, type MetricSink, type NeonDatabase, type RequestContext } from "../../../packages/foundation/src/index.js";
import { calculateTax } from "../../tax/src/calculator.js";
import type { TaxCode, TaxContext, TaxExemption, TaxRateComponent, TaxTreatment } from "../../tax/src/model.js";
import { divideRounded, type RoundingMode } from "./exact.js";
import { resolvePrice, type PriceContext, type PriceList, type PriceRule } from "./model.js";
import { evaluatePromotions, type Promotion, type PromotionContext } from "./promotions.js";
import { persistPriceTaxSnapshot, type PersistedPriceTaxSnapshot } from "./price-tax-repository.js";

export interface PriceTaxPromotionSnapshot {
  readonly promotionId: string;
  readonly promotionCode: string;
  readonly version: bigint;
  readonly discountMinor: bigint;
}

export interface PriceTaxComponentSnapshot {
  readonly rateId: string;
  readonly code: string;
  readonly rateBasisPoints: bigint;
  readonly compound: boolean;
  readonly taxableBaseMinor: bigint;
  readonly taxMinor: bigint;
  readonly recoverableTaxMinor: bigint;
  readonly reportingTaxMinor: bigint;
}

export interface PriceTaxSnapshot {
  readonly schemaVersion: "1.0";
  readonly snapshotId: string;
  readonly sourceLineId: string;
  readonly productId?: string;
  readonly variantId: string;
  readonly unitCode: string;
  readonly quantityMinor: bigint;
  readonly quantityScale: number;
  readonly currency: string;
  readonly moneyScale: number;
  readonly priceListId: string;
  readonly priceRuleId: string;
  readonly priceListVersion: bigint;
  readonly priceRuleVersion: bigint;
  readonly unitPriceMinor: bigint;
  readonly subtotalMinor: bigint;
  readonly discountMinor: bigint;
  readonly promotedAmountMinor: bigint;
  readonly promotions: readonly PriceTaxPromotionSnapshot[];
  readonly taxCodeId: string;
  readonly jurisdictionId: string;
  readonly taxTreatment: TaxTreatment;
  readonly taxPriceMode: "exclusive" | "inclusive";
  readonly exemptionId?: string;
  readonly netMinor: bigint;
  readonly taxMinor: bigint;
  readonly grossMinor: bigint;
  readonly taxCalculationVersion: string;
  readonly taxComponents: readonly PriceTaxComponentSnapshot[];
  readonly roundingMode: RoundingMode;
  readonly calculatedAt: string;
  readonly calculationHash: string;
}

export interface CalculatePriceAndTaxInput {
  readonly snapshotId: string;
  readonly sourceLineId: string;
  readonly productId?: string;
  readonly categoryIds?: readonly string[];
  readonly tags?: readonly string[];
  readonly priceContext: PriceContext;
  readonly priceLists: readonly PriceList[];
  readonly priceRules: readonly PriceRule[];
  readonly promotions: readonly Promotion[];
  readonly promotionContext: Omit<PromotionContext, "lines">;
  readonly taxCode: TaxCode;
  readonly taxRates: readonly TaxRateComponent[];
  readonly taxExemptions?: readonly TaxExemption[];
  readonly taxContext: Omit<TaxContext, "amountMinor" | "currency" | "scale" | "sourceLineId" | "at"> & { readonly at?: string };
  readonly rounding?: RoundingMode;
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

export async function calculatePriceAndTax(input: CalculatePriceAndTaxInput): Promise<PriceTaxSnapshot> {
  const rounding = input.rounding ?? "half_up";
  const resolvedPrice = resolvePrice(input.priceLists, input.priceRules, input.priceContext, rounding);
  const subtotalMinor = divideRounded(
    resolvedPrice.unitPrice.amountMinor * input.priceContext.quantityMinor,
    10n ** BigInt(input.priceContext.quantityScale),
    rounding,
  );
  const promotionResult = evaluatePromotions(input.promotions, {
    ...input.promotionContext,
    lines: [{
      lineId: input.sourceLineId,
      variantId: input.priceContext.variantId,
      ...(input.productId === undefined ? {} : { productId: input.productId }),
      categoryIds: input.categoryIds ?? [],
      tags: input.tags ?? [],
      quantityMinor: input.priceContext.quantityMinor,
      quantityScale: input.priceContext.quantityScale,
      unitPrice: resolvedPrice.unitPrice,
    }],
  }, rounding);
  if (promotionResult.subtotal.amountMinor !== subtotalMinor) throw new Error("Pricing subtotal and promotion subtotal diverged");

  const taxAt = input.taxContext.at ?? input.priceContext.at;
  const taxCalculation = calculateTax({
    code: input.taxCode,
    rates: input.taxRates,
    ...(input.taxExemptions === undefined ? {} : { exemptions: input.taxExemptions }),
    context: {
      ...input.taxContext,
      amountMinor: promotionResult.total.amountMinor,
      currency: promotionResult.total.currency,
      scale: promotionResult.total.scale,
      sourceLineId: input.sourceLineId,
      at: taxAt,
    },
  });
  const draft = {
    schemaVersion: "1.0" as const,
    snapshotId: input.snapshotId,
    sourceLineId: input.sourceLineId,
    ...(input.productId === undefined ? {} : { productId: input.productId }),
    variantId: input.priceContext.variantId,
    unitCode: input.priceContext.unitCode.trim().toUpperCase(),
    quantityMinor: input.priceContext.quantityMinor,
    quantityScale: input.priceContext.quantityScale,
    currency: resolvedPrice.unitPrice.currency,
    moneyScale: resolvedPrice.unitPrice.scale,
    priceListId: resolvedPrice.priceListId,
    priceRuleId: resolvedPrice.priceRuleId,
    priceListVersion: resolvedPrice.priceListVersion,
    priceRuleVersion: resolvedPrice.priceRuleVersion,
    unitPriceMinor: resolvedPrice.unitPrice.amountMinor,
    subtotalMinor,
    discountMinor: promotionResult.discountTotal.amountMinor,
    promotedAmountMinor: promotionResult.total.amountMinor,
    promotions: Object.freeze(promotionResult.applied.map((promotion) => Object.freeze({
      promotionId: promotion.promotionId,
      promotionCode: promotion.promotionCode,
      version: promotion.version,
      discountMinor: promotion.discount.amountMinor,
    }))),
    taxCodeId: taxCalculation.taxCodeId,
    jurisdictionId: taxCalculation.jurisdictionId,
    taxTreatment: taxCalculation.treatment,
    taxPriceMode: taxCalculation.priceMode,
    ...(taxCalculation.exemptionId === undefined ? {} : { exemptionId: taxCalculation.exemptionId }),
    netMinor: taxCalculation.net.amountMinor,
    taxMinor: taxCalculation.tax.amountMinor,
    grossMinor: taxCalculation.gross.amountMinor,
    taxCalculationVersion: taxCalculation.calculationVersion,
    taxComponents: Object.freeze(taxCalculation.components.map((component) => Object.freeze({
      rateId: component.rateId,
      code: component.code,
      rateBasisPoints: component.rateBasisPoints,
      compound: component.compound,
      taxableBaseMinor: component.taxableBase.amountMinor,
      taxMinor: component.tax.amountMinor,
      recoverableTaxMinor: component.recoverableTax.amountMinor,
      reportingTaxMinor: component.reportingTax.amountMinor,
    }))),
    roundingMode: rounding,
    calculatedAt: taxCalculation.calculatedAt,
  };
  const calculationHash = await sha256(draft);
  return Object.freeze({ ...draft, calculationHash });
}

export interface CalculatePriceAndTaxResult {
  readonly snapshot: PriceTaxSnapshot;
  readonly persisted?: PersistedPriceTaxSnapshot;
}

export class PriceTaxApi {
  private readonly metrics: MetricSink;

  constructor(private readonly options: { readonly database?: NeonDatabase; readonly metrics?: MetricSink }) {
    this.metrics = options.metrics ?? new NoopMetricSink();
  }

  async calculate(input: CalculatePriceAndTaxInput & {
    readonly persistence?: {
      readonly context: RequestContext;
      readonly idempotencyKey: string;
      readonly requestHash: string;
    };
  }): Promise<CalculatePriceAndTaxResult> {
    const startedAt = performance.now();
    try {
      const snapshot = await calculatePriceAndTax(input);
      let persisted: PersistedPriceTaxSnapshot | undefined;
      if (input.persistence !== undefined) {
        if (!this.options.database) throw new Error("Price and tax persistence requires a database");
        const persistence = input.persistence;
        persisted = await this.options.database.withClientTransaction(persistence.context, async (client) => await persistPriceTaxSnapshot(
          client,
          persistence.context,
          { idempotencyKey: persistence.idempotencyKey, requestHash: persistence.requestHash, snapshot },
        ));
        new JsonLogger({
          requestId: persistence.context.requestId,
          traceId: persistence.context.traceId,
          tenantId: persistence.context.tenantId,
          actorId: persistence.context.actorId,
          module: "pricing-tax",
        }).info("price and tax snapshot calculated", {
          snapshotId: snapshot.snapshotId,
          sourceLineId: snapshot.sourceLineId,
          priceListId: snapshot.priceListId,
          taxCodeId: snapshot.taxCodeId,
          calculationHash: snapshot.calculationHash,
          replayed: persisted.replayed,
        });
      }
      this.metrics.increment("pricing_tax.calculation.success", 1, {
        treatment: snapshot.taxTreatment,
        promotionCount: String(snapshot.promotions.length),
        persisted: String(persisted !== undefined),
      });
      this.metrics.observe("pricing_tax.calculation.duration_ms", performance.now() - startedAt, {
        persisted: String(persisted !== undefined),
      });
      return Object.freeze({ snapshot, ...(persisted === undefined ? {} : { persisted }) });
    } catch (error) {
      this.metrics.increment("pricing_tax.calculation.failure", 1, {
        error: error instanceof Error ? error.name : "UnknownError",
      });
      throw error;
    }
  }
}
