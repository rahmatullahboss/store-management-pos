import { JsonLogger, NoopMetricSink, type MetricSink, type NeonDatabase, type RequestContext } from "../../../packages/foundation/src/index.js";
import { calculateTax } from "./calculator.js";
import type { TaxCalculation, TaxCode, TaxContext, TaxExemption, TaxRateComponent } from "./model.js";
import { persistTaxSnapshot, type PersistedTaxSnapshot } from "./repository.js";

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

export interface TaxCalculationResult {
  readonly calculation: TaxCalculation;
  readonly calculationHash: string;
  readonly persisted?: PersistedTaxSnapshot;
}

export class TaxApi {
  private readonly metrics: MetricSink;

  constructor(private readonly options: { readonly database?: NeonDatabase; readonly metrics?: MetricSink }) {
    this.metrics = options.metrics ?? new NoopMetricSink();
  }

  async calculate(input: {
    readonly code: TaxCode;
    readonly rates: readonly TaxRateComponent[];
    readonly exemptions?: readonly TaxExemption[];
    readonly context: TaxContext;
    readonly persistence?: {
      readonly context: RequestContext;
      readonly idempotencyKey: string;
      readonly requestHash: string;
      readonly snapshotId: string;
    };
  }): Promise<TaxCalculationResult> {
    const startedAt = performance.now();
    try {
      const calculation = calculateTax({
        code: input.code,
        rates: input.rates,
        ...(input.exemptions === undefined ? {} : { exemptions: input.exemptions }),
        context: input.context,
      });
      const calculationHash = await sha256(calculation);
      let persisted: PersistedTaxSnapshot | undefined;
      if (input.persistence !== undefined) {
        if (!this.options.database) throw new Error("Tax persistence requires a database");
        const persistence = input.persistence;
        persisted = await this.options.database.withClientTransaction(persistence.context, async (client) => await persistTaxSnapshot(client, persistence.context, {
          idempotencyKey: persistence.idempotencyKey,
          requestHash: persistence.requestHash,
          snapshotId: persistence.snapshotId,
          calculationHash,
          calculation,
        }));
        new JsonLogger({
          requestId: persistence.context.requestId,
          traceId: persistence.context.traceId,
          tenantId: persistence.context.tenantId,
          actorId: persistence.context.actorId,
          module: "tax",
        }).info("tax calculation resolved", {
          snapshotId: persisted.snapshotId,
          sourceLineId: calculation.sourceLineId,
          treatment: calculation.treatment,
          calculationHash,
          replayed: persisted.replayed,
        });
      }
      this.metrics.increment("tax.calculation.success", 1, {
        treatment: calculation.treatment,
        priceMode: calculation.priceMode,
        persisted: String(persisted !== undefined),
      });
      this.metrics.observe("tax.calculation.duration_ms", performance.now() - startedAt, {
        treatment: calculation.treatment,
        persisted: String(persisted !== undefined),
      });
      return Object.freeze({ calculation, calculationHash, ...(persisted === undefined ? {} : { persisted }) });
    } catch (error) {
      this.metrics.increment("tax.calculation.failure", 1, {
        error: error instanceof Error ? error.name : "UnknownError",
      });
      throw error;
    }
  }
}
