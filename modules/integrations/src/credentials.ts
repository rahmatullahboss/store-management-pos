import type { ApiClientV1 } from "./contracts.js";
import { assertApiClient } from "./public-api.js";

const CREDENTIAL_REFERENCE_PATTERN = /^(?:secret|vault|kms|provider):\/\/[A-Za-z0-9][A-Za-z0-9._-]{1,63}\/[A-Za-z0-9][A-Za-z0-9._\/-]{1,190}$/u;

function parseCredentialTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} is invalid`);
  return parsed;
}

export interface ApiClientCredentialBindingV1 {
  readonly schemaVersion: "1.0";
  readonly bindingId: string;
  readonly tenantId: string;
  readonly clientId: string;
  readonly authentication: ApiClientV1["authentication"];
  readonly credentialReference: string;
  readonly credentialVersion: number;
  readonly status: "active" | "retired" | "revoked";
  readonly validFrom: string;
  readonly validUntil?: string;
}

export function assertApiClientCredentialReference(reference: string): void {
  if (!CREDENTIAL_REFERENCE_PATTERN.test(reference)) {
    throw new TypeError("API client credential must be an external secret reference");
  }
}

export function assertApiClientCredentialBinding(binding: ApiClientCredentialBindingV1): void {
  if (binding.bindingId.trim().length === 0 || binding.tenantId.trim().length === 0 || binding.clientId.trim().length === 0) {
    throw new TypeError("API client credential binding identity is required");
  }
  assertApiClientCredentialReference(binding.credentialReference);
  if (!Number.isInteger(binding.credentialVersion) || binding.credentialVersion < 1) {
    throw new RangeError("API client credential version must be a positive integer");
  }
  const validFrom = parseCredentialTimestamp(binding.validFrom, "API client credential validFrom");
  if (binding.validUntil !== undefined) {
    const validUntil = parseCredentialTimestamp(binding.validUntil, "API client credential validUntil");
    if (validUntil <= validFrom) throw new TypeError("API client credential validity must end after it begins");
  }
  if (binding.status !== "active" && binding.validUntil === undefined) {
    throw new TypeError("Retired or revoked API client credentials require validUntil");
  }
}

export type ApiCredentialVerificationOutcome = "match" | "mismatch" | "unavailable";

export interface ApiCredentialVerificationPort {
  verify(input: {
    readonly authentication: ApiClientV1["authentication"];
    readonly credentialReference: string;
    readonly presentedCredential: string;
  }): Promise<ApiCredentialVerificationOutcome>;
}

export type ApiClientCredentialVerificationReason =
  | "verified"
  | "tenant_mismatch"
  | "client_mismatch"
  | "authentication_mismatch"
  | "client_inactive"
  | "client_expired"
  | "credential_inactive"
  | "credential_not_yet_valid"
  | "credential_expired"
  | "credential_rejected"
  | "credential_unavailable";

export interface ApiClientCredentialVerificationDecisionV1 {
  readonly verified: boolean;
  readonly reason: ApiClientCredentialVerificationReason;
  readonly clientId: string;
  readonly credentialVersion: number;
}

function credentialDecision(
  clientId: string,
  credentialVersion: number,
  verified: boolean,
  reason: ApiClientCredentialVerificationReason,
): ApiClientCredentialVerificationDecisionV1 {
  return Object.freeze({ verified, reason, clientId, credentialVersion });
}

export async function verifyApiClientCredential(input: {
  readonly client: ApiClientV1;
  readonly binding: ApiClientCredentialBindingV1;
  readonly tenantId: string;
  readonly clientId: string;
  readonly authentication: ApiClientV1["authentication"];
  readonly presentedCredential: string;
  readonly observedAt: string;
  readonly verifier: ApiCredentialVerificationPort;
}): Promise<ApiClientCredentialVerificationDecisionV1> {
  assertApiClient(input.client);
  assertApiClientCredentialBinding(input.binding);
  const observedAt = parseCredentialTimestamp(input.observedAt, "API client credential observedAt");
  const decision = (
    verified: boolean,
    reason: ApiClientCredentialVerificationReason,
  ): ApiClientCredentialVerificationDecisionV1 => credentialDecision(
    input.client.clientId,
    input.binding.credentialVersion,
    verified,
    reason,
  );

  if (input.tenantId !== input.client.tenantId || input.binding.tenantId !== input.client.tenantId) {
    return decision(false, "tenant_mismatch");
  }
  if (input.clientId !== input.client.clientId || input.binding.clientId !== input.client.clientId) {
    return decision(false, "client_mismatch");
  }
  if (input.authentication !== input.client.authentication || input.binding.authentication !== input.client.authentication) {
    return decision(false, "authentication_mismatch");
  }
  if (input.client.status !== "active") return decision(false, "client_inactive");
  if (input.client.expiresAt !== undefined
      && observedAt >= parseCredentialTimestamp(input.client.expiresAt, "API client expiresAt")) {
    return decision(false, "client_expired");
  }
  if (input.binding.status !== "active") return decision(false, "credential_inactive");
  if (observedAt < parseCredentialTimestamp(input.binding.validFrom, "API client credential validFrom")) {
    return decision(false, "credential_not_yet_valid");
  }
  if (input.binding.validUntil !== undefined
      && observedAt >= parseCredentialTimestamp(input.binding.validUntil, "API client credential validUntil")) {
    return decision(false, "credential_expired");
  }
  if (input.presentedCredential.length < 8 || input.presentedCredential.length > 4096) {
    return decision(false, "credential_rejected");
  }

  try {
    const outcome = await input.verifier.verify({
      authentication: input.authentication,
      credentialReference: input.binding.credentialReference,
      presentedCredential: input.presentedCredential,
    });
    if (outcome === "match") return decision(true, "verified");
    if (outcome === "mismatch") return decision(false, "credential_rejected");
    return decision(false, "credential_unavailable");
  } catch {
    return decision(false, "credential_unavailable");
  }
}

export interface RotateApiClientCredentialResultV1 {
  readonly previous: ApiClientCredentialBindingV1;
  readonly current: ApiClientCredentialBindingV1;
}

export function rotateApiClientCredentialBinding(input: {
  readonly current: ApiClientCredentialBindingV1;
  readonly expectedCredentialVersion: number;
  readonly nextBindingId: string;
  readonly nextCredentialReference: string;
  readonly observedAt: string;
}): RotateApiClientCredentialResultV1 {
  assertApiClientCredentialBinding(input.current);
  if (input.current.status !== "active") throw new TypeError("Only an active API client credential can rotate");
  if (input.current.credentialVersion !== input.expectedCredentialVersion) {
    throw new TypeError("API client credential version conflict");
  }
  if (input.nextBindingId.trim().length === 0) throw new TypeError("Next API client credential binding identity is required");
  assertApiClientCredentialReference(input.nextCredentialReference);
  if (input.nextCredentialReference === input.current.credentialReference) {
    throw new TypeError("API client credential rotation requires a new reference");
  }
  const observedAt = parseCredentialTimestamp(input.observedAt, "API client credential rotation observedAt");
  if (observedAt < parseCredentialTimestamp(input.current.validFrom, "API client credential validFrom")) {
    throw new TypeError("API client credential rotation precedes current validity");
  }

  const previous: ApiClientCredentialBindingV1 = Object.freeze({
    schemaVersion: "1.0",
    bindingId: input.current.bindingId,
    tenantId: input.current.tenantId,
    clientId: input.current.clientId,
    authentication: input.current.authentication,
    credentialReference: input.current.credentialReference,
    credentialVersion: input.current.credentialVersion,
    status: "retired",
    validFrom: input.current.validFrom,
    validUntil: input.observedAt,
  });
  const current: ApiClientCredentialBindingV1 = Object.freeze({
    schemaVersion: "1.0",
    bindingId: input.nextBindingId,
    tenantId: input.current.tenantId,
    clientId: input.current.clientId,
    authentication: input.current.authentication,
    credentialReference: input.nextCredentialReference,
    credentialVersion: input.current.credentialVersion + 1,
    status: "active",
    validFrom: input.observedAt,
  });
  return Object.freeze({ previous, current });
}
