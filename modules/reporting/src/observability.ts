import type { Logger, MetricSink } from "../../../packages/foundation/src/observability.js";

const OPERATION_PATTERN = /^[a-z][a-z0-9_.-]{2,127}$/u;
const ERROR_CATEGORY_PATTERN = /^[a-z][a-z0-9_.-]{2,63}$/u;

export interface ModGObservabilityPorts {
  readonly metrics?: MetricSink;
  readonly logger?: Logger;
}

export async function observeModGOperation<T>(input: {
  readonly ports: ModGObservabilityPorts;
  readonly module: "reporting" | "integration" | "saas_admin";
  readonly operation: string;
  readonly work: () => Promise<T>;
  readonly classifyError?: (error: unknown) => string;
}): Promise<T> {
  if (!OPERATION_PATTERN.test(input.operation)) throw new TypeError("MOD-G operation name is invalid");
  const startedAt = performance.now();
  const attributes = Object.freeze({ module: input.module, operation: input.operation });
  input.ports.metrics?.increment("mod_g.operation.started", 1, attributes);
  try {
    const result = await input.work();
    const duration = Math.max(0, performance.now() - startedAt);
    input.ports.metrics?.increment("mod_g.operation.completed", 1, { ...attributes, outcome: "success" });
    input.ports.metrics?.observe("mod_g.operation.duration_ms", duration, attributes);
    input.ports.logger?.info("MOD-G operation completed", { ...attributes, durationMs: Math.round(duration) });
    return result;
  } catch (error) {
    const category = input.classifyError?.(error) ?? "unexpected_failure";
    const safeCategory = ERROR_CATEGORY_PATTERN.test(category) ? category : "unexpected_failure";
    const duration = Math.max(0, performance.now() - startedAt);
    input.ports.metrics?.increment("mod_g.operation.completed", 1, { ...attributes, outcome: "failure", category: safeCategory });
    input.ports.metrics?.observe("mod_g.operation.duration_ms", duration, attributes);
    input.ports.logger?.error("MOD-G operation failed", { ...attributes, category: safeCategory, durationMs: Math.round(duration) });
    throw error;
  }
}

export function recordModGBacklog(input: {
  readonly metrics?: MetricSink;
  readonly queue: "projection" | "export" | "webhook" | "connector" | "tenant_lifecycle";
  readonly depth: number;
  readonly oldestAgeSeconds: number;
}): void {
  if (!Number.isInteger(input.depth) || input.depth < 0) throw new RangeError("MOD-G backlog depth must be a non-negative integer");
  if (!Number.isInteger(input.oldestAgeSeconds) || input.oldestAgeSeconds < 0) throw new RangeError("MOD-G backlog age must be a non-negative integer");
  input.metrics?.observe("mod_g.backlog.depth", input.depth, { queue: input.queue });
  input.metrics?.observe("mod_g.backlog.oldest_age_seconds", input.oldestAgeSeconds, { queue: input.queue });
}

export function recordModGReconciliation(input: {
  readonly metrics?: MetricSink;
  readonly projection: string;
  readonly reconciled: boolean;
  readonly differenceMinor: string;
}): void {
  if (!OPERATION_PATTERN.test(input.projection)) throw new TypeError("MOD-G projection name is invalid");
  if (!/^-?(?:0|[1-9][0-9]*)$/u.test(input.differenceMinor)) throw new TypeError("MOD-G reconciliation difference must be an integer string");
  input.metrics?.increment("mod_g.reconciliation.checked", 1, { projection: input.projection, reconciled: String(input.reconciled) });
  input.metrics?.observe("mod_g.reconciliation.absolute_difference_minor", Number(BigInt(input.differenceMinor) < 0n ? -BigInt(input.differenceMinor) : BigInt(input.differenceMinor)), { projection: input.projection });
}
