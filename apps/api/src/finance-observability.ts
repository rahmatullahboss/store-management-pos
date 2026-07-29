import type { RequestContext } from "../../../packages/foundation/src/context.js";
import { JsonLogger, NoopMetricSink, type MetricSink } from "../../../packages/foundation/src/observability.js";

export interface FinanceOperationObserver {
  readonly metrics?: MetricSink;
}

export async function observeFinanceOperation(
  context: RequestContext,
  observer: FinanceOperationObserver,
  module: "payment" | "accounting" | "banking" | "finance",
  operation: string,
  work: () => Promise<Response>,
): Promise<Response> {
  const metrics = observer.metrics ?? new NoopMetricSink();
  const logger = new JsonLogger({
    requestId: context.requestId,
    traceId: context.traceId,
    tenantId: context.tenantId,
    actorId: context.actorId,
    module: `mod-e.${module}`,
  });
  const startedAt = Date.now();
  try {
    const response = await work();
    const durationMs = Date.now() - startedAt;
    const outcome = response.status >= 500 ? "server_error" : response.status >= 400 ? "client_error" : "success";
    metrics.increment("mod_e.finance.operation", 1, { module, operation, outcome });
    metrics.observe("mod_e.finance.operation.duration_ms", durationMs, { module, operation, outcome });
    logger.info("finance operation completed", { operation, outcome, status: response.status, durationMs });
    return response;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    metrics.increment("mod_e.finance.operation", 1, { module, operation, outcome: "exception" });
    metrics.observe("mod_e.finance.operation.duration_ms", durationMs, { module, operation, outcome: "exception" });
    logger.error("finance operation failed", {
      operation,
      outcome: "exception",
      durationMs,
      errorType: error instanceof Error ? error.name : "unknown",
    });
    throw error;
  }
}
