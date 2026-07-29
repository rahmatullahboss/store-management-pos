import type {
  ConnectorConnectionV1,
  ConnectorCursorV1,
  ConnectorFieldMappingV1,
  ConnectorSyncOutcomeV1,
  WebhookDeliveryV1,
  WebhookSubscriptionV1,
} from "./contracts.js";
import { assertConnectorMappingsLoopSafe, assertWebhookSubscription, transitionWebhookDelivery } from "./domain.js";

export interface WebhookSignerPort {
  sign(input: {
    readonly signingKeyReference: string;
    readonly signatureVersion: string;
    readonly deliveryId: string;
    readonly eventId: string;
    readonly payload: Uint8Array;
    readonly observedAt: string;
  }): Promise<string>;
}

export interface WebhookTransportPort {
  send(input: {
    readonly endpointUrl: string;
    readonly payload: Uint8Array;
    readonly headers: Readonly<Record<string, string>>;
  }): Promise<{ readonly statusCode: number }>;
}

export interface WebhookCommandPort {
  record(delivery: WebhookDeliveryV1): Promise<void>;
}

export interface WebhookWorkerResultV1 {
  readonly outcome: "delivered" | "retry" | "dead_letter";
  readonly delivery: WebhookDeliveryV1;
}

function stripNextAttempt(delivery: WebhookDeliveryV1): Omit<WebhookDeliveryV1, "nextAttemptAt"> {
  const { nextAttemptAt, ...withoutSchedule } = delivery;
  void nextAttemptAt;
  return withoutSchedule;
}

function isRetryableStatus(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
}

async function finalizeWebhookFailure(input: {
  readonly subscription: WebhookSubscriptionV1;
  readonly delivery: WebhookDeliveryV1;
  readonly commands: WebhookCommandPort;
  readonly observedAt: string;
  readonly nextAttemptAt: string;
  readonly category: string;
  readonly retryable: boolean;
  readonly responseCode?: number;
}): Promise<WebhookWorkerResultV1> {
  const exhausted = input.delivery.attemptCount >= input.subscription.maxAttempts;
  const shouldRetry = input.retryable && !exhausted;
  if (shouldRetry) {
    const observed = Date.parse(input.observedAt);
    const nextAttempt = Date.parse(input.nextAttemptAt);
    if (!Number.isFinite(observed) || !Number.isFinite(nextAttempt) || nextAttempt <= observed) {
      throw new TypeError("Webhook retry schedule must follow the observed attempt time");
    }
  }
  const transitioned = transitionWebhookDelivery(
    input.delivery,
    shouldRetry ? "retry" : "dead_letter",
    input.observedAt,
    input.responseCode,
  );
  const withoutSchedule = stripNextAttempt(transitioned);
  const delivery: WebhookDeliveryV1 = Object.freeze({
    ...withoutSchedule,
    ...(shouldRetry ? { nextAttemptAt: input.nextAttemptAt } : {}),
    lastErrorCategory: input.category,
  });
  await input.commands.record(delivery);
  return Object.freeze({ outcome: shouldRetry ? "retry" : "dead_letter", delivery });
}

export async function runWebhookWorker(input: {
  readonly subscription: WebhookSubscriptionV1;
  readonly delivery: WebhookDeliveryV1;
  readonly payload: Uint8Array;
  readonly signer: WebhookSignerPort;
  readonly transport: WebhookTransportPort;
  readonly commands: WebhookCommandPort;
  readonly observedAt: string;
  readonly nextAttemptAt: string;
}): Promise<WebhookWorkerResultV1> {
  assertWebhookSubscription(input.subscription);
  if (input.subscription.status !== "active") throw new TypeError("Webhook subscription is not active");
  if (input.subscription.tenantId !== input.delivery.tenantId) throw new TypeError("Webhook subscription and delivery tenants do not match");
  if (!input.subscription.eventTypes.includes(input.delivery.eventType)) throw new TypeError("Webhook delivery event type is not subscribed");

  const delivering = Object.freeze(stripNextAttempt(transitionWebhookDelivery(input.delivery, "start", input.observedAt)));
  await input.commands.record(delivering);

  let signature: string;
  try {
    signature = await input.signer.sign({
      signingKeyReference: input.subscription.signingKeyReference,
      signatureVersion: input.delivery.signatureVersion,
      deliveryId: input.delivery.deliveryId,
      eventId: input.delivery.eventId,
      payload: input.payload,
      observedAt: input.observedAt,
    });
  } catch {
    return finalizeWebhookFailure({
      subscription: input.subscription,
      delivery: delivering,
      commands: input.commands,
      observedAt: input.observedAt,
      nextAttemptAt: input.nextAttemptAt,
      category: "signing_failed",
      retryable: true,
    });
  }
  if (signature.trim().length === 0) {
    return finalizeWebhookFailure({
      subscription: input.subscription,
      delivery: delivering,
      commands: input.commands,
      observedAt: input.observedAt,
      nextAttemptAt: input.nextAttemptAt,
      category: "signature_invalid",
      retryable: false,
    });
  }

  let response: { readonly statusCode: number };
  try {
    response = await input.transport.send({
      endpointUrl: input.subscription.endpointUrl,
      payload: input.payload,
      headers: Object.freeze({
        "content-type": "application/json",
        "x-ozzyl-delivery-id": input.delivery.deliveryId,
        "x-ozzyl-event-id": input.delivery.eventId,
        "x-ozzyl-signature": signature,
        "x-ozzyl-signature-version": input.delivery.signatureVersion,
      }),
    });
  } catch {
    return finalizeWebhookFailure({
      subscription: input.subscription,
      delivery: delivering,
      commands: input.commands,
      observedAt: input.observedAt,
      nextAttemptAt: input.nextAttemptAt,
      category: "transport_failed",
      retryable: true,
    });
  }
  if (!Number.isInteger(response.statusCode) || response.statusCode < 100 || response.statusCode > 599) {
    return finalizeWebhookFailure({
      subscription: input.subscription,
      delivery: delivering,
      commands: input.commands,
      observedAt: input.observedAt,
      nextAttemptAt: input.nextAttemptAt,
      category: "response_invalid",
      retryable: false,
    });
  }
  if (response.statusCode >= 200 && response.statusCode < 300) {
    const delivered = Object.freeze(stripNextAttempt(transitionWebhookDelivery(delivering, "deliver", input.observedAt, response.statusCode)));
    await input.commands.record(delivered);
    return Object.freeze({ outcome: "delivered", delivery: delivered });
  }
  return finalizeWebhookFailure({
    subscription: input.subscription,
    delivery: delivering,
    commands: input.commands,
    observedAt: input.observedAt,
    nextAttemptAt: input.nextAttemptAt,
    category: isRetryableStatus(response.statusCode) ? "provider_retryable" : "provider_rejected",
    retryable: isRetryableStatus(response.statusCode),
    responseCode: response.statusCode,
  });
}

export interface ConnectorRecordV1<TPayload = Readonly<Record<string, unknown>>> {
  readonly syncId: string;
  readonly externalId: string;
  readonly payload: TPayload;
}

export interface ConnectorPageV1<TPayload = Readonly<Record<string, unknown>>> {
  readonly records: readonly ConnectorRecordV1<TPayload>[];
  readonly nextCursor?: string;
  readonly exhausted: boolean;
}

export interface ConnectorAdapterPort<TPayload = Readonly<Record<string, unknown>>> {
  read(input: {
    readonly connection: ConnectorConnectionV1;
    readonly resourceType: string;
    readonly direction: ConnectorCursorV1["direction"];
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<ConnectorPageV1<TPayload>>;
}

export interface ConnectorApplyPort<TPayload = Readonly<Record<string, unknown>>> {
  apply(input: {
    readonly connection: ConnectorConnectionV1;
    readonly mappings: readonly ConnectorFieldMappingV1[];
    readonly resourceType: string;
    readonly direction: ConnectorCursorV1["direction"];
    readonly record: ConnectorRecordV1<TPayload>;
  }): Promise<{
    readonly status: ConnectorSyncOutcomeV1["status"];
    readonly platformReference?: string;
    readonly reasonCode?: string;
  }>;
}

export interface ConnectorCommandPort {
  recordOutcome(outcome: ConnectorSyncOutcomeV1): Promise<void>;
  advanceCursor(cursor: ConnectorCursorV1): Promise<void>;
}

export interface ConnectorWorkerResultV1 {
  readonly outcomes: readonly ConnectorSyncOutcomeV1[];
  readonly cursor?: ConnectorCursorV1;
  readonly exhausted: boolean;
}

export async function runConnectorPage<TPayload>(input: {
  readonly connection: ConnectorConnectionV1;
  readonly mappings: readonly ConnectorFieldMappingV1[];
  readonly cursor?: ConnectorCursorV1;
  readonly resourceType: string;
  readonly direction: ConnectorCursorV1["direction"];
  readonly adapter: ConnectorAdapterPort<TPayload>;
  readonly apply: ConnectorApplyPort<TPayload>;
  readonly commands: ConnectorCommandPort;
  readonly observedAt: string;
  readonly maxRecords?: number;
}): Promise<ConnectorWorkerResultV1> {
  if (input.connection.status !== "active" && input.connection.status !== "degraded") {
    throw new TypeError("Connector connection is not runnable");
  }
  if (input.resourceType.trim().length === 0) throw new TypeError("Connector resource type is required");
  assertConnectorMappingsLoopSafe(input.mappings);
  const relevantMappings = input.mappings.filter((mapping) =>
    mapping.connectionId === input.connection.connectionId
    && mapping.resourceType === input.resourceType
    && mapping.direction === input.direction);
  if (relevantMappings.length === 0) throw new TypeError("Connector worker requires at least one relevant field mapping");
  if (input.cursor !== undefined) {
    if (input.cursor.tenantId !== input.connection.tenantId
      || input.cursor.connectionId !== input.connection.connectionId
      || input.cursor.resourceType !== input.resourceType
      || input.cursor.direction !== input.direction) {
      throw new TypeError("Connector cursor scope does not match the worker request");
    }
  }
  const maxRecords = input.maxRecords ?? 100;
  if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 1_000) {
    throw new RangeError("Connector page size must be between 1 and 1000");
  }

  const page = await input.adapter.read({
    connection: input.connection,
    resourceType: input.resourceType,
    direction: input.direction,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor.cursor }),
    limit: maxRecords,
  });
  if (page.records.length > maxRecords) throw new TypeError("Connector adapter exceeded the requested page size");
  if (!page.exhausted && (page.nextCursor === undefined || page.nextCursor.trim().length === 0)) {
    throw new TypeError("Non-terminal connector page requires a next cursor");
  }
  if (page.nextCursor !== undefined && input.cursor?.cursor === page.nextCursor && page.records.length > 0) {
    throw new TypeError("Connector adapter returned a non-advancing cursor");
  }

  const outcomes: ConnectorSyncOutcomeV1[] = [];
  for (const record of page.records) {
    if (record.syncId.trim().length === 0 || record.externalId.trim().length === 0) {
      throw new TypeError("Connector record identity is required");
    }
    let decision: Awaited<ReturnType<ConnectorApplyPort<TPayload>["apply"]>>;
    try {
      decision = await input.apply.apply({
        connection: input.connection,
        mappings: relevantMappings,
        resourceType: input.resourceType,
        direction: input.direction,
        record,
      });
    } catch {
      decision = { status: "deferred", reasonCode: "apply_failed" };
    }
    const outcome: ConnectorSyncOutcomeV1 = Object.freeze({
      schemaVersion: "1.0",
      syncId: record.syncId,
      tenantId: input.connection.tenantId,
      connectionId: input.connection.connectionId,
      resourceType: input.resourceType,
      status: decision.status,
      ...(decision.platformReference === undefined ? {} : { platformReference: decision.platformReference }),
      externalReference: record.externalId,
      ...(decision.reasonCode === undefined ? {} : { reasonCode: decision.reasonCode }),
      observedAt: input.observedAt,
    });
    await input.commands.recordOutcome(outcome);
    outcomes.push(outcome);
  }

  let cursor: ConnectorCursorV1 | undefined;
  if (page.nextCursor !== undefined) {
    const lastRecord = page.records.at(-1);
    cursor = Object.freeze({
      schemaVersion: "1.0",
      tenantId: input.connection.tenantId,
      connectionId: input.connection.connectionId,
      resourceType: input.resourceType,
      direction: input.direction,
      cursor: page.nextCursor,
      ...(lastRecord === undefined ? {} : { lastExternalId: lastRecord.externalId }),
      updatedAt: input.observedAt,
    });
    await input.commands.advanceCursor(cursor);
  }

  return Object.freeze({
    outcomes: Object.freeze(outcomes),
    ...(cursor === undefined ? {} : { cursor }),
    exhausted: page.exhausted,
  });
}
