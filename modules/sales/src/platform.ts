import type { RequestContext } from "../../../packages/foundation/src/context.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import type { DomainEventEnvelopeV1 } from "../../../packages/contracts/src/v1/contracts.js";
import type { CustomerService, CreateCustomerInput } from "../../customer/src/index.js";
import type { FulfillmentService, FulfillmentPlan, ReturnAuthorization } from "../../fulfillment/src/index.js";
import type { SalesLineInput, SalesOrder, SalesQuote, SalesService } from "./index.js";

export interface TelemetryLog {
  readonly timestamp: string;
  readonly level: "info" | "warn" | "error";
  readonly module: "MOD-C";
  readonly event: string;
  readonly requestId: string;
  readonly traceId: string;
  readonly tenantId: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

export class StructuredTelemetry {
  readonly logs: TelemetryLog[] = [];
  readonly counters = new Map<string, number>();

  increment(name: string, ...labels: readonly string[]): void {
    const key = [name, ...labels].join("|");
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  record(context: RequestContext, event: string, attributes: Readonly<Record<string, unknown>>, level: TelemetryLog["level"] = "info"): void {
    const entry: TelemetryLog = {
      timestamp: new Date().toISOString(),
      level,
      module: "MOD-C",
      event,
      requestId: context.requestId,
      traceId: context.traceId,
      tenantId: context.tenantId,
      attributes,
    };
    this.logs.push(entry);
  }
}

export interface ModCApplicationServices {
  readonly customer: CustomerService;
  readonly sales: SalesService;
  readonly fulfillment: FulfillmentService;
  readonly telemetry: StructuredTelemetry;
}

interface CachedHttpResponse {
  readonly hash: string;
  readonly data: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

function stringifyExact(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => typeof nested === "bigint" ? nested.toString() : nested);
}

function stable(value: unknown): string {
  if (typeof value === "bigint") return `bigint:${value.toString()}`;
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function jsonResponse(value: unknown, status: number, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(stringifyExact(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

async function parseJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new PlatformError("VALIDATION_FAILED", "content-type application/json is required", 415);
  }
  try {
    const value = await request.json() as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON object required");
    return value as Record<string, unknown>;
  } catch {
    throw new PlatformError("VALIDATION_FAILED", "Request body must contain valid JSON", 400);
  }
}

function idempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8) throw new PlatformError("VALIDATION_FAILED", "idempotency-key header with at least 8 characters is required", 400);
  return key;
}

function asString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new PlatformError("VALIDATION_FAILED", `${name} is required`, 400);
  return value.trim();
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlatformError("VALIDATION_FAILED", `${name} must be an object`, 400);
  return value as Record<string, unknown>;
}

function asArray(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new PlatformError("VALIDATION_FAILED", `${name} must be an array`, 400);
  return value;
}

function parseSalesLines(value: unknown): readonly SalesLineInput[] {
  return asArray(value, "lines").map((raw, index) => {
    const line = asObject(raw, `lines[${index}]`);
    const item = asObject(line.item, `lines[${index}].item`);
    const quantity = asObject(line.quantity, `lines[${index}].quantity`);
    const taxRateBasisPoints = line.taxRateBasisPoints;
    if (!Number.isInteger(taxRateBasisPoints)) throw new PlatformError("VALIDATION_FAILED", `lines[${index}].taxRateBasisPoints must be an integer`, 400);
    return {
      item: {
        itemId: asString(item.itemId, `lines[${index}].item.itemId`),
        variantId: asString(item.variantId, `lines[${index}].item.variantId`),
        ...(typeof item.sku === "string" ? { sku: item.sku } : {}),
        ...(typeof item.barcode === "string" ? { barcode: item.barcode } : {}),
        ...(typeof item.displayNameSnapshot === "string" ? { displayNameSnapshot: item.displayNameSnapshot } : {}),
      },
      quantity: {
        amount: asString(quantity.amount, `lines[${index}].quantity.amount`),
        unit: asString(quantity.unit, `lines[${index}].quantity.unit`),
        scale: Number(quantity.scale),
      },
      unitPriceMinor: BigInt(asString(line.unitPriceMinor, `lines[${index}].unitPriceMinor`)),
      taxRateBasisPoints: taxRateBasisPoints as number,
    };
  });
}

function platformErrorResponse(error: unknown, context: RequestContext): Response {
  if (error instanceof PlatformError) {
    return jsonResponse({ error: { code: error.code, message: error.message, details: error.details }, meta: { requestId: context.requestId, traceId: context.traceId } }, error.status);
  }
  return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "The operation could not be completed" }, meta: { requestId: context.requestId, traceId: context.traceId } }, 500);
}

export function createModCRouter(services: ModCApplicationServices): (request: Request, context: RequestContext) => Promise<Response> {
  const cache = new Map<string, CachedHttpResponse>();

  return async (request, context) => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/u, "") || "/";
    const startedAt = performance.now();
    services.telemetry.record(context, "http.request.started", { method: request.method, path });

    try {
      let status = 200;
      let data: unknown;
      let headers: Readonly<Record<string, string>> = {};
      let replayed = false;

      if (request.method === "POST") {
        const key = idempotencyKey(request);
        const body = await parseJson(request);
        const cacheKey = `${context.tenantId}:${request.method}:${path}:${key}`;
        const hash = stable(body);
        const cached = cache.get(cacheKey);
        if (cached) {
          if (cached.hash !== hash) throw new PlatformError("IDEMPOTENCY_CONFLICT", "Idempotency key was reused with a different HTTP payload", 409);
          data = cached.data;
          headers = cached.headers;
          replayed = true;
        } else {
          if (path === "/api/v1/customers") {
            data = await services.customer.create(context, { ...body, idempotencyKey: key } as unknown as CreateCustomerInput);
            headers = { location: `/api/v1/customers/${(data as { id: string }).id}` };
          } else if (path === "/api/v1/quotes") {
            const customer = asObject(body.customer, "customer");
            data = await services.sales.createQuote(context, {
              idempotencyKey: key,
              customer: {
                customerId: asString(customer.customerId, "customer.customerId"),
                ...(typeof customer.displayNameSnapshot === "string" ? { displayNameSnapshot: customer.displayNameSnapshot } : {}),
                ...(typeof customer.taxRegistrationSnapshot === "string" ? { taxRegistrationSnapshot: customer.taxRegistrationSnapshot } : {}),
              },
              currency: asString(body.currency, "currency"),
              lines: parseSalesLines(body.lines),
              ...(typeof body.expiresAt === "string" ? { expiresAt: body.expiresAt } : {}),
              ...(typeof body.salespersonId === "string" ? { salespersonId: body.salespersonId } : {}),
            });
            headers = { location: `/api/v1/quotes/${(data as SalesQuote).id}` };
          } else if (path === "/api/v1/orders") {
            const customer = asObject(body.customer, "customer");
            data = await services.sales.createOrder(context, {
              idempotencyKey: key,
              customer: {
                customerId: asString(customer.customerId, "customer.customerId"),
                ...(typeof customer.displayNameSnapshot === "string" ? { displayNameSnapshot: customer.displayNameSnapshot } : {}),
              },
              currency: asString(body.currency, "currency"),
              lines: parseSalesLines(body.lines),
              fulfillmentMethod: asString(body.fulfillmentMethod, "fulfillmentMethod") as "pickup" | "local_delivery" | "ship_from_store" | "split",
              warehouseId: asString(body.warehouseId, "warehouseId"),
              paymentTerms: asString(body.paymentTerms, "paymentTerms") as "prepaid" | "deposit" | "layaway" | "on_account",
              ...(typeof body.salespersonId === "string" ? { salespersonId: body.salespersonId } : {}),
            });
            headers = { location: `/api/v1/orders/${(data as SalesOrder).id}` };
          } else if (path === "/api/v1/fulfillment/plans") {
            data = await services.fulfillment.createPlan(context, {
              idempotencyKey: key,
              order: body.order as unknown as SalesOrder,
              allocations: asArray(body.allocations, "allocations") as unknown as Parameters<FulfillmentService["createPlan"]>[1]["allocations"],
            });
            headers = { location: `/api/v1/fulfillment/plans/${(data as FulfillmentPlan).id}` };
          } else if (path === "/api/v1/returns") {
            data = await services.fulfillment.requestReturn(context, {
              idempotencyKey: key,
              order: body.order as unknown as SalesOrder,
              reason: asString(body.reason, "reason"),
              lines: asArray(body.lines, "lines") as unknown as Parameters<FulfillmentService["requestReturn"]>[1]["lines"],
              originalPaymentAllocations: (asArray(body.originalPaymentAllocations, "originalPaymentAllocations") as readonly Record<string, unknown>[]).map((allocation) => ({
                paymentIntentId: asString(allocation.paymentIntentId, "paymentIntentId"),
                amountMinor: BigInt(asString(allocation.amountMinor, "amountMinor")),
                currency: asString(allocation.currency, "currency"),
              })),
            });
            headers = { location: `/api/v1/returns/${(data as ReturnAuthorization).id}` };
          } else {
            throw new PlatformError("NOT_FOUND", "API route not found", 404);
          }
          cache.set(cacheKey, { hash, data, headers });
          status = 201;
        }
      } else if (request.method === "GET") {
        const customerMatch = /^\/api\/v1\/customers\/([^/]+)$/u.exec(path);
        const orderMatch = /^\/api\/v1\/orders\/([^/]+)$/u.exec(path);
        const planMatch = /^\/api\/v1\/fulfillment\/plans\/([^/]+)$/u.exec(path);
        if (customerMatch) data = await services.customer.get(context, decodeURIComponent(customerMatch[1]!));
        else if (orderMatch) data = await services.sales.getOrder(context, decodeURIComponent(orderMatch[1]!));
        else if (planMatch) data = await services.fulfillment.getPlan(context, decodeURIComponent(planMatch[1]!));
        else throw new PlatformError("NOT_FOUND", "API route not found", 404);
      } else {
        throw new PlatformError("VALIDATION_FAILED", "HTTP method is not supported for this route", 405);
      }

      const responseStatus = replayed ? 200 : status;
      services.telemetry.increment("mod_c_http_requests_total", request.method, path, String(responseStatus));
      services.telemetry.record(context, "http.request.completed", {
        method: request.method,
        path,
        status: responseStatus,
        replayed,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      });
      return jsonResponse({ data, meta: { requestId: context.requestId, traceId: context.traceId, replayed } }, responseStatus, headers);
    } catch (error) {
      const response = platformErrorResponse(error, context);
      services.telemetry.increment("mod_c_http_requests_total", request.method, path, String(response.status));
      services.telemetry.record(context, "http.request.failed", {
        method: request.method,
        path,
        status: response.status,
        errorCode: error instanceof PlatformError ? error.code : "INTERNAL_ERROR",
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      }, response.status >= 500 ? "error" : "warn");
      return response;
    }
  };
}

export class ModCEventProjector {
  private readonly processedEventIds = new Set<string>();
  readonly orderProjection = new Map<string, { readonly status: string; readonly documentNumber?: string; readonly lastEventId: string }>();
  readonly fulfillmentProjection = new Map<string, { readonly status: string; readonly orderId?: string; readonly lastEventId: string }>();
  readonly returnProjection = new Map<string, { readonly status: string; readonly orderId?: string; readonly lastEventId: string }>();

  constructor(private readonly telemetry: StructuredTelemetry) {}

  async consume(event: DomainEventEnvelopeV1): Promise<{ readonly processed: boolean; readonly duplicate: boolean }> {
    if (this.processedEventIds.has(event.eventId)) {
      this.telemetry.increment("mod_c_events_duplicate_total", event.eventType);
      return { processed: false, duplicate: true };
    }

    const payload = event.payload as Readonly<Record<string, unknown>>;
    if (event.eventType === "sales.order.confirmed.v1") {
      this.orderProjection.set(event.aggregateId, {
        status: "confirmed",
        ...(typeof payload.documentNumber === "string" ? { documentNumber: payload.documentNumber } : {}),
        lastEventId: event.eventId,
      });
    } else if (event.eventType.startsWith("fulfillment.")) {
      this.fulfillmentProjection.set(event.aggregateId, {
        status: typeof payload.status === "string" ? payload.status : event.eventType,
        ...(typeof payload.orderId === "string" ? { orderId: payload.orderId } : {}),
        lastEventId: event.eventId,
      });
    } else if (event.eventType.startsWith("sales.return.")) {
      this.returnProjection.set(event.aggregateId, {
        status: event.eventType.split(".").at(-2) ?? "unknown",
        ...(typeof payload.orderId === "string" ? { orderId: payload.orderId } : {}),
        lastEventId: event.eventId,
      });
    }

    this.processedEventIds.add(event.eventId);
    this.telemetry.increment("mod_c_events_processed_total", event.eventType);
    return { processed: true, duplicate: false };
  }
}
