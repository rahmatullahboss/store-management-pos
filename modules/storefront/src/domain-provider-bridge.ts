import { StorefrontContractError } from "../../../packages/storefront-contracts/src/index.js";
import type {
  RecordDomainVerificationInput,
  StorefrontCertificateStatus,
  StorefrontDomainStatus,
  TransitionDomainInput,
} from "./index.js";

export type StorefrontTrustedDomainProviderSourceV1 = "trusted-control-plane";

export interface StorefrontTrustedDomainVerificationObservationV1 {
  readonly observationVersion: "storefront-trusted-domain-verification-observation.v1";
  readonly source: StorefrontTrustedDomainProviderSourceV1;
  readonly observationId: string;
  readonly domainId: string;
  readonly attempt: number;
  readonly challengeType: "dns_txt" | "dns_cname" | "http";
  readonly challengeName: string;
  readonly challengeValueHash: string;
  readonly verificationStatus: "pending" | "verified" | "failed" | "expired";
  readonly providerReference: string | null;
  readonly observedAt: string;
  readonly expiresAt: string;
}

export interface StorefrontTrustedDomainLifecycleObservationV1 {
  readonly observationVersion: "storefront-trusted-domain-lifecycle-observation.v1";
  readonly source: StorefrontTrustedDomainProviderSourceV1;
  readonly observationId: string;
  readonly domainId: string;
  readonly status: StorefrontDomainStatus;
  readonly certificateStatus: StorefrontCertificateStatus;
  readonly providerHostnameId: string | null;
  readonly failureCode: string | null;
  readonly observedAt: string;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH = /^[a-f0-9]{64}$/u;
const OPAQUE = /^[A-Za-z0-9._:=-]{1,160}$/u;
const PROVIDER_ID = /^[A-Za-z0-9._:=-]{1,240}$/u;
const FAILURE_CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorefrontContractError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function strictKeys(
  source: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unexpected = Object.keys(source).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new StorefrontContractError(
      `${label} contains unsupported fields: ${unexpected.sort().join(", ")}.`,
    );
  }
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new StorefrontContractError(`${label} must be a UUID.`);
  }
  const normalized = value.trim().toLowerCase();
  if (!UUID.test(normalized)) {
    throw new StorefrontContractError(`${label} must be a UUID.`);
  }
  return normalized;
}

function bounded(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") {
    throw new StorefrontContractError(`${label} must be a string.`);
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  return normalized;
}

function dateTime(value: unknown, label: string): string {
  const normalized = bounded(value, label, 64);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw new StorefrontContractError(`${label} must be an ISO date-time.`);
  }
  return new Date(parsed).toISOString();
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new StorefrontContractError(`${label} is unsupported.`);
  }
  return value as T;
}

function opaque(value: unknown, label: string): string {
  const normalized = bounded(value, label, 160);
  if (!OPAQUE.test(normalized)) {
    throw new StorefrontContractError(`${label} must be a bounded opaque token.`);
  }
  return normalized;
}

function providerId(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const normalized = bounded(value, label, 240);
  if (!PROVIDER_ID.test(normalized)) {
    throw new StorefrontContractError(`${label} must be a bounded provider identifier.`);
  }
  return normalized;
}

function failureCode(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const normalized = bounded(value, "Trusted domain provider failureCode", 120);
  if (!FAILURE_CODE.test(normalized)) {
    throw new StorefrontContractError(
      "Trusted domain provider failureCode must be a bounded low-cardinality token.",
    );
  }
  return normalized;
}

export function parseStorefrontTrustedDomainVerificationObservationV1(
  value: unknown,
): StorefrontTrustedDomainVerificationObservationV1 {
  const label = "Trusted domain verification observation";
  const source = record(value, label);
  strictKeys(
    source,
    new Set([
      "observationVersion",
      "source",
      "observationId",
      "domainId",
      "attempt",
      "challengeType",
      "challengeName",
      "challengeValueHash",
      "verificationStatus",
      "providerReference",
      "observedAt",
      "expiresAt",
    ]),
    label,
  );
  if (
    source.observationVersion !==
    "storefront-trusted-domain-verification-observation.v1"
  ) {
    throw new StorefrontContractError(
      "Unsupported trusted domain verification observation version.",
    );
  }
  if (source.source !== "trusted-control-plane") {
    throw new StorefrontContractError(
      "Trusted domain verification observation source is unsupported.",
    );
  }
  if (
    !Number.isInteger(source.attempt) ||
    (source.attempt as number) < 1 ||
    (source.attempt as number) > 1_000
  ) {
    throw new StorefrontContractError(
      "Trusted domain verification observation attempt must be between 1 and 1000.",
    );
  }
  const challengeValueHash = bounded(
    source.challengeValueHash,
    "Trusted domain provider challengeValueHash",
    64,
  ).toLowerCase();
  if (!HASH.test(challengeValueHash)) {
    throw new StorefrontContractError(
      "Trusted domain provider challengeValueHash must be a SHA-256 hex digest.",
    );
  }
  const observedAt = dateTime(
    source.observedAt,
    "Trusted domain provider observedAt",
  );
  const expiresAt = dateTime(
    source.expiresAt,
    "Trusted domain provider expiresAt",
  );
  if (Date.parse(expiresAt) <= Date.parse(observedAt)) {
    throw new StorefrontContractError(
      "Trusted domain provider verification expiry must be after observation.",
    );
  }
  return Object.freeze({
    observationVersion:
      "storefront-trusted-domain-verification-observation.v1",
    source: "trusted-control-plane",
    observationId: opaque(
      source.observationId,
      "Trusted domain provider observationId",
    ),
    domainId: uuid(source.domainId, "Trusted domain provider domainId"),
    attempt: source.attempt as number,
    challengeType: enumValue(
      source.challengeType,
      ["dns_txt", "dns_cname", "http"] as const,
      "Trusted domain provider challengeType",
    ),
    challengeName: bounded(
      source.challengeName,
      "Trusted domain provider challengeName",
      320,
    ),
    challengeValueHash,
    verificationStatus: enumValue(
      source.verificationStatus,
      ["pending", "verified", "failed", "expired"] as const,
      "Trusted domain provider verificationStatus",
    ),
    providerReference: providerId(
      source.providerReference,
      "Trusted domain provider providerReference",
    ),
    observedAt,
    expiresAt,
  });
}

export function parseStorefrontTrustedDomainLifecycleObservationV1(
  value: unknown,
): StorefrontTrustedDomainLifecycleObservationV1 {
  const label = "Trusted domain lifecycle observation";
  const source = record(value, label);
  strictKeys(
    source,
    new Set([
      "observationVersion",
      "source",
      "observationId",
      "domainId",
      "status",
      "certificateStatus",
      "providerHostnameId",
      "failureCode",
      "observedAt",
    ]),
    label,
  );
  if (
    source.observationVersion !==
    "storefront-trusted-domain-lifecycle-observation.v1"
  ) {
    throw new StorefrontContractError(
      "Unsupported trusted domain lifecycle observation version.",
    );
  }
  if (source.source !== "trusted-control-plane") {
    throw new StorefrontContractError(
      "Trusted domain lifecycle observation source is unsupported.",
    );
  }
  const status = enumValue(
    source.status,
    [
      "pending",
      "verification_pending",
      "certificate_pending",
      "active",
      "suspended",
      "failed",
      "deleting",
      "deleted",
    ] as const,
    "Trusted domain provider status",
  );
  const certificateStatus = enumValue(
    source.certificateStatus,
    ["none", "pending", "active", "expiring", "failed", "revoked"] as const,
    "Trusted domain provider certificateStatus",
  );
  const providerHostnameId = providerId(
    source.providerHostnameId,
    "Trusted domain provider providerHostnameId",
  );
  const normalizedFailureCode = failureCode(source.failureCode);
  if (
    status === "active" &&
    (certificateStatus !== "active" || providerHostnameId === null)
  ) {
    throw new StorefrontContractError(
      "Trusted active domain observation requires active certificate and provider hostname ID.",
    );
  }
  if (status === "failed" && normalizedFailureCode === null) {
    throw new StorefrontContractError(
      "Trusted failed domain observation requires a failureCode.",
    );
  }
  return Object.freeze({
    observationVersion: "storefront-trusted-domain-lifecycle-observation.v1",
    source: "trusted-control-plane",
    observationId: opaque(
      source.observationId,
      "Trusted domain provider observationId",
    ),
    domainId: uuid(source.domainId, "Trusted domain provider domainId"),
    status,
    certificateStatus,
    providerHostnameId,
    failureCode: normalizedFailureCode,
    observedAt: dateTime(
      source.observedAt,
      "Trusted domain provider observedAt",
    ),
  });
}

function verificationIdempotencyKey(observationId: string): string {
  return `domain-provider-verification:${observationId}`;
}

function lifecycleIdempotencyKey(observationId: string): string {
  return `domain-provider-lifecycle:${observationId}`;
}

export function mapStorefrontTrustedDomainVerificationObservationV1(
  value: unknown,
): RecordDomainVerificationInput {
  const observation = parseStorefrontTrustedDomainVerificationObservationV1(value);
  return Object.freeze({
    domainId: observation.domainId,
    attempt: observation.attempt,
    challengeType: observation.challengeType,
    challengeName: observation.challengeName,
    challengeValueHash: observation.challengeValueHash,
    resultStatus: observation.verificationStatus,
    ...(observation.providerReference === null
      ? {}
      : { providerReference: observation.providerReference }),
    observedDetail: Object.freeze({
      source: observation.source,
      observationId: observation.observationId,
    }),
    observedAt: observation.observedAt,
    expiresAt: observation.expiresAt,
    idempotencyKey: verificationIdempotencyKey(observation.observationId),
  });
}

export function mapStorefrontTrustedDomainLifecycleObservationV1(
  value: unknown,
  local: { readonly canonical: boolean },
): TransitionDomainInput {
  const observation = parseStorefrontTrustedDomainLifecycleObservationV1(value);
  if (typeof local.canonical !== "boolean") {
    throw new StorefrontContractError(
      "Trusted domain bridge local canonical state must be boolean.",
    );
  }
  if (local.canonical && observation.status !== "active") {
    throw new StorefrontContractError(
      "Only an active trusted provider observation may preserve local canonical state.",
    );
  }
  return Object.freeze({
    domainId: observation.domainId,
    status: observation.status,
    certificateStatus: observation.certificateStatus,
    ...(observation.providerHostnameId === null
      ? {}
      : { providerHostnameId: observation.providerHostnameId }),
    ...(observation.failureCode === null
      ? {}
      : { failureCode: observation.failureCode }),
    canonical: local.canonical,
    idempotencyKey: lifecycleIdempotencyKey(observation.observationId),
  });
}
