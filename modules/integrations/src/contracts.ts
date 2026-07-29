import type { AuditMetadataV1, IdempotencyMetadataV1, PaginationRequestV1, ScopeContextV1 } from "../../../packages/contracts/src/v1/common.js";

export interface ApiClientV1 {
  readonly schemaVersion: "1.0";
  readonly clientId: string;
  readonly tenantId: string;
  readonly displayName: string;
  readonly authentication: "api_key" | "oauth2_client_credentials";
  readonly scopes: readonly string[];
  readonly status: "active" | "suspended" | "revoked";
  readonly rateLimitPerMinute: number;
  readonly createdAt: string;
  readonly expiresAt?: string;
}

export interface PublicApiRequestV1<TBody = unknown> {
  readonly schemaVersion: "1.0";
  readonly scope: ScopeContextV1;
  readonly clientId: string;
  readonly operationId: string;
  readonly idempotency?: IdempotencyMetadataV1;
  readonly pagination?: PaginationRequestV1;
  readonly body: TBody;
  readonly requestedAt: string;
}

export interface WebhookSubscriptionV1 {
  readonly schemaVersion: "1.0";
  readonly subscriptionId: string;
  readonly tenantId: string;
  readonly endpointUrl: string;
  readonly eventTypes: readonly string[];
  readonly signingKeyReference: string;
  readonly status: "active" | "paused" | "revoked";
  readonly maxAttempts: number;
  readonly createdAt: string;
}

export interface WebhookDeliveryV1 {
  readonly schemaVersion: "1.0";
  readonly deliveryId: string;
  readonly tenantId: string;
  readonly subscriptionId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly payloadHash: string;
  readonly signatureVersion: string;
  readonly status: "queued" | "delivering" | "delivered" | "retry_wait" | "dead_letter" | "cancelled";
  readonly attemptCount: number;
  readonly nextAttemptAt?: string;
  readonly deliveredAt?: string;
  readonly lastResponseCode?: number;
  readonly lastErrorCategory?: string;
  readonly createdAt: string;
}

export interface WebhookReplayRequestV1 {
  readonly schemaVersion: "1.0";
  readonly replayId: string;
  readonly tenantId: string;
  readonly deliveryId: string;
  readonly reason: string;
  readonly requestedAt: string;
  readonly metadata: AuditMetadataV1;
}

export type ConnectorFieldOwnership = "platform" | "external" | "manual";

export interface ConnectorConnectionV1 {
  readonly schemaVersion: "1.0";
  readonly connectionId: string;
  readonly tenantId: string;
  readonly connectorType: string;
  readonly providerKey: string;
  readonly credentialReference: string;
  readonly status: "draft" | "active" | "degraded" | "paused" | "revoked";
  readonly createdAt: string;
  readonly lastHealthyAt?: string;
}

export interface ConnectorFieldMappingV1 {
  readonly schemaVersion: "1.0";
  readonly mappingId: string;
  readonly connectionId: string;
  readonly resourceType: string;
  readonly platformField: string;
  readonly externalField: string;
  readonly ownership: ConnectorFieldOwnership;
  readonly direction: "inbound" | "outbound";
  readonly transformVersion: string;
}

export interface ConnectorCursorV1 {
  readonly schemaVersion: "1.0";
  readonly tenantId: string;
  readonly connectionId: string;
  readonly resourceType: string;
  readonly direction: "inbound" | "outbound";
  readonly cursor: string;
  readonly lastExternalId?: string;
  readonly lastEventId?: string;
  readonly updatedAt: string;
}

export interface ConnectorSyncOutcomeV1 {
  readonly schemaVersion: "1.0";
  readonly syncId: string;
  readonly tenantId: string;
  readonly connectionId: string;
  readonly resourceType: string;
  readonly status: "applied" | "duplicate" | "conflict" | "rejected" | "deferred";
  readonly platformReference?: string;
  readonly externalReference?: string;
  readonly reasonCode?: string;
  readonly observedAt: string;
}
