import { JsonLogger, NoopMetricSink, type MetricSink, type NeonDatabase, type RequestContext } from "../../../packages/foundation/src/index.js";
import { createCatalogProduct, type ProductInput } from "./model.js";
import { changeCatalogProductStatus, queryCatalogVariantFeed, saveCatalogProduct, type CatalogVariantFeedRow, type CatalogWriteResult } from "./repository.js";

export interface CatalogApiOptions {
  readonly database: NeonDatabase;
  readonly metrics?: MetricSink;
}

export class CatalogApi {
  private readonly metrics: MetricSink;

  constructor(private readonly options: CatalogApiOptions) {
    this.metrics = options.metrics ?? new NoopMetricSink();
  }

  async saveProduct(
    context: RequestContext,
    input: { readonly idempotencyKey: string; readonly requestHash: string; readonly expectedVersion?: bigint; readonly product: ProductInput },
  ): Promise<CatalogWriteResult> {
    const startedAt = performance.now();
    const logger = new JsonLogger({ requestId: context.requestId, traceId: context.traceId, tenantId: context.tenantId, actorId: context.actorId, module: "catalog" });
    try {
      const product = createCatalogProduct(input.product);
      const result = await this.options.database.withClientTransaction(context, async (client) => await saveCatalogProduct(client, context, {
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        product,
        ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
      }));
      this.metrics.increment("catalog.product.save.success", 1, { replayed: String(result.replayed), status: result.status });
      this.metrics.observe("catalog.product.save.duration_ms", performance.now() - startedAt, { status: result.status });
      logger.info("catalog product saved", { productId: result.productId, version: result.version.toString(), replayed: result.replayed });
      return result;
    } catch (error) {
      this.metrics.increment("catalog.product.save.failure");
      logger.error("catalog product save failed", { error: error instanceof Error ? error.message : "UnknownError" });
      throw error;
    }
  }

  async changeStatus(
    context: RequestContext,
    input: { readonly productId: string; readonly status: "draft" | "active" | "inactive" | "archived"; readonly expectedVersion: bigint; readonly reason: string },
  ): Promise<CatalogWriteResult> {
    const startedAt = performance.now();
    const result = await this.options.database.withClientTransaction(context, async (client) => await changeCatalogProductStatus(client, context, input));
    this.metrics.increment("catalog.product.status_change", 1, { status: result.status });
    this.metrics.observe("catalog.product.status_change.duration_ms", performance.now() - startedAt, { status: result.status });
    return result;
  }

  async search(
    context: RequestContext,
    input: { readonly locale: string; readonly query?: string; readonly limit?: number; readonly cursor?: string },
  ): Promise<readonly CatalogVariantFeedRow[]> {
    const startedAt = performance.now();
    const result = await this.options.database.withClientTransaction(context, async (client) => await queryCatalogVariantFeed(client, context, input));
    this.metrics.observe("catalog.search.duration_ms", performance.now() - startedAt, { resultCount: String(result.length) });
    this.metrics.increment("catalog.search.request", 1, { resultCount: String(result.length) });
    return result;
  }
}
