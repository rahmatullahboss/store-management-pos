import type {
  ConnectorFieldMappingV1,
  WebhookDeliveryV1,
  WebhookSubscriptionV1,
} from "./contracts.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const BLOCKED_DIAGNOSTIC_KEY = /(?:secret|token|password|credential|authorization|api[_-]?key|signature)/iu;
const MAX_DIAGNOSTIC_DEPTH = 8;
const MAX_DIAGNOSTIC_ENTRIES = 100;
const MAX_DIAGNOSTIC_STRING = 4_096;

export function assertWebhookSubscription(subscription: WebhookSubscriptionV1): void {
  let endpoint: URL;
  try {
    endpoint = new URL(subscription.endpointUrl);
  } catch {
    throw new TypeError("Webhook endpoint URL is invalid");
  }
  if (endpoint.protocol !== "https:") throw new TypeError("Webhook endpoint must use HTTPS");
  if (subscription.eventTypes.length === 0 || new Set(subscription.eventTypes).size !== subscription.eventTypes.length) {
    throw new TypeError("Webhook event types must be non-empty and unique");
  }
  if (subscription.signingKeyReference.trim().length === 0) throw new TypeError("Webhook signing key reference is required");
  if (!Number.isInteger(subscription.maxAttempts) || subscription.maxAttempts < 1 || subscription.maxAttempts > 100) {
    throw new RangeError("Webhook max attempts must be between 1 and 100");
  }
}

export function webhookDeliveryIdentity(input: Pick<WebhookDeliveryV1, "tenantId" | "subscriptionId" | "eventId">): string {
  if (input.tenantId.trim().length === 0) throw new TypeError("tenantId is required");
  if (input.subscriptionId.trim().length === 0) throw new TypeError("subscriptionId is required");
  if (input.eventId.trim().length === 0) throw new TypeError("eventId is required");
  return `${input.tenantId}:${input.subscriptionId}:${input.eventId}`;
}

export type WebhookDeliveryCommand = "start" | "deliver" | "retry" | "dead_letter" | "cancel";

export function transitionWebhookDelivery(
  delivery: WebhookDeliveryV1,
  command: WebhookDeliveryCommand,
  observedAt: string,
  responseCode?: number,
): WebhookDeliveryV1 {
  if (!SHA256_PATTERN.test(delivery.payloadHash)) throw new TypeError("Webhook payload hash must be SHA-256 hex");
  const terminal = delivery.status === "delivered" || delivery.status === "dead_letter" || delivery.status === "cancelled";
  if (terminal) throw new TypeError(`Webhook delivery ${delivery.deliveryId} is terminal`);
  if (command === "start" && delivery.status !== "queued" && delivery.status !== "retry_wait") throw new TypeError("Only queued or retrying webhook deliveries can start");
  if (command === "deliver" && delivery.status !== "delivering") throw new TypeError("Webhook must be delivering before success");
  if ((command === "retry" || command === "dead_letter") && delivery.status !== "delivering") throw new TypeError("Webhook failure outcome requires an active delivery attempt");
  const status = command === "start" ? "delivering" : command === "deliver" ? "delivered" : command === "retry" ? "retry_wait" : command === "dead_letter" ? "dead_letter" : "cancelled";
  return Object.freeze({
    ...delivery,
    status,
    attemptCount: command === "start" ? delivery.attemptCount + 1 : delivery.attemptCount,
    ...(command === "deliver" ? { deliveredAt: observedAt } : {}),
    ...(responseCode === undefined ? {} : { lastResponseCode: responseCode }),
  });
}

export function assertConnectorMappingsLoopSafe(mappings: readonly ConnectorFieldMappingV1[]): void {
  const identities = new Set<string>();
  const ownedPlatformFields = new Map<string, ConnectorFieldMappingV1>();
  const ownedExternalFields = new Map<string, ConnectorFieldMappingV1>();
  for (const mapping of mappings) {
    const identity = `${mapping.connectionId}:${mapping.resourceType}:${mapping.direction}:${mapping.platformField}:${mapping.externalField}`;
    if (identities.has(identity)) throw new TypeError("Duplicate connector field mapping");
    identities.add(identity);
    if (mapping.platformField.trim().length === 0 || mapping.externalField.trim().length === 0) throw new TypeError("Connector mapping fields are required");
    const scope = `${mapping.connectionId}:${mapping.resourceType}`;
    const platformKey = `${scope}:${mapping.platformField}`;
    const externalKey = `${scope}:${mapping.externalField}`;
    if (mapping.ownership === "platform") {
      const existing = ownedPlatformFields.get(platformKey);
      if (existing && existing.direction !== mapping.direction) throw new TypeError("Platform-owned field cannot be synchronized in both directions");
      ownedPlatformFields.set(platformKey, mapping);
    }
    if (mapping.ownership === "external") {
      const existing = ownedExternalFields.get(externalKey);
      if (existing && existing.direction !== mapping.direction) throw new TypeError("External-owned field cannot be synchronized in both directions");
      ownedExternalFields.set(externalKey, mapping);
    }
    if (mapping.ownership === "platform" && mapping.direction !== "outbound") throw new TypeError("Platform-owned fields must synchronize outbound");
    if (mapping.ownership === "external" && mapping.direction !== "inbound") throw new TypeError("External-owned fields must synchronize inbound");
  }
}

function redactDiagnosticValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return value.length <= MAX_DIAGNOSTIC_STRING ? value : `${value.slice(0, MAX_DIAGNOSTIC_STRING)}…`;
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DIAGNOSTIC_DEPTH) return "[MaxDepth]";
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    const sanitized = value.slice(0, MAX_DIAGNOSTIC_ENTRIES).map((item) => redactDiagnosticValue(item, depth + 1, seen));
    if (value.length > MAX_DIAGNOSTIC_ENTRIES) sanitized.push(`[${value.length - MAX_DIAGNOSTIC_ENTRIES} more items]`);
    return Object.freeze(sanitized);
  }
  const output: Record<string, unknown> = {};
  const entries = Object.entries(value as Readonly<Record<string, unknown>>).slice(0, MAX_DIAGNOSTIC_ENTRIES);
  for (const [key, nested] of entries) {
    if (!BLOCKED_DIAGNOSTIC_KEY.test(key)) output[key] = redactDiagnosticValue(nested, depth + 1, seen);
  }
  if (Object.keys(value).length > MAX_DIAGNOSTIC_ENTRIES) output.truncatedEntries = Object.keys(value).length - MAX_DIAGNOSTIC_ENTRIES;
  return Object.freeze(output);
}

export function redactIntegrationDiagnostic(input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return redactDiagnosticValue(input, 0, new WeakSet<object>()) as Readonly<Record<string, unknown>>;
}

export function protectSpreadsheetCell(value: string): string {
  return /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
}
