import { StorefrontContractError } from "../../../packages/storefront-contracts/src/index.js";

export type StorefrontDomainKindV1 = "platform_subdomain" | "custom";
export type StorefrontDomainStatusV1 =
  | "pending"
  | "verification_pending"
  | "certificate_pending"
  | "active"
  | "suspended"
  | "failed"
  | "deleting"
  | "deleted";
export type StorefrontDomainCertificateStatusV1 =
  | "none"
  | "pending"
  | "active"
  | "expiring"
  | "failed"
  | "revoked";
export type StorefrontDomainVerificationStatusV1 =
  | "none"
  | "pending"
  | "verified"
  | "failed"
  | "expired";
export type StorefrontDomainLifecyclePhaseV1 =
  | "setup_pending"
  | "ownership_pending"
  | "certificate_pending"
  | "active"
  | "attention"
  | "suspended"
  | "removing"
  | "removed";
export type StorefrontDomainLifecycleActionV1 =
  | "wait_for_provider"
  | "review_configuration"
  | "contact_support"
  | "none";

export interface StorefrontDomainLifecycleSnapshotV1 {
  readonly snapshotVersion: "storefront-domain-lifecycle-snapshot.v1";
  readonly domainId: string;
  readonly storefrontId: string;
  readonly hostname: string;
  readonly kind: StorefrontDomainKindV1;
  readonly status: StorefrontDomainStatusV1;
  readonly certificateStatus: StorefrontDomainCertificateStatusV1;
  readonly verificationStatus: StorefrontDomainVerificationStatusV1;
  readonly canonical: boolean;
  readonly updatedAt: string;
}

export interface StorefrontDomainLifecycleViewV1 {
  readonly viewVersion: "storefront-domain-lifecycle-view.v1";
  readonly domainId: string;
  readonly storefrontId: string;
  readonly hostname: string;
  readonly kind: StorefrontDomainKindV1;
  readonly phase: StorefrontDomainLifecyclePhaseV1;
  readonly status: StorefrontDomainStatusV1;
  readonly certificateStatus: StorefrontDomainCertificateStatusV1;
  readonly verificationStatus: StorefrontDomainVerificationStatusV1;
  readonly canonical: boolean;
  readonly providerControlAvailable: boolean;
  readonly recommendedAction: StorefrontDomainLifecycleActionV1;
  readonly updatedAt: string;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HOSTNAME =
  /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?!-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;

const allowedSnapshotKeys = new Set([
  "snapshotVersion",
  "domainId",
  "storefrontId",
  "hostname",
  "kind",
  "status",
  "certificateStatus",
  "verificationStatus",
  "canonical",
  "updatedAt",
]);

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorefrontContractError("Storefront domain lifecycle snapshot must be an object.");
  }
  return value as Record<string, unknown>;
}

function strictKeys(source: Record<string, unknown>): void {
  const unexpected = Object.keys(source).filter((key) => !allowedSnapshotKeys.has(key));
  if (unexpected.length > 0) {
    throw new StorefrontContractError(
      `Storefront domain lifecycle snapshot contains unsupported fields: ${unexpected.sort().join(", ")}.`,
    );
  }
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string") throw new StorefrontContractError(`${label} must be a UUID.`);
  const normalized = value.trim().toLowerCase();
  if (!UUID.test(normalized)) throw new StorefrontContractError(`${label} must be a UUID.`);
  return normalized;
}

function hostname(value: unknown): string {
  if (typeof value !== "string") {
    throw new StorefrontContractError("Storefront domain hostname must be a string.");
  }
  const normalized = value.trim().toLowerCase().replace(/\.$/u, "");
  if (!HOSTNAME.test(normalized)) {
    throw new StorefrontContractError("Storefront domain hostname is invalid.");
  }
  return normalized;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new StorefrontContractError(`${label} must be a boolean.`);
  return value;
}

function dateTime(value: unknown): string {
  if (typeof value !== "string" || value.length > 64) {
    throw new StorefrontContractError("Storefront domain updatedAt is invalid.");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new StorefrontContractError("Storefront domain updatedAt is invalid.");
  }
  return new Date(parsed).toISOString();
}

function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new StorefrontContractError(`${label} is unsupported.`);
  }
  return value as T;
}

export function parseStorefrontDomainLifecycleSnapshotV1(
  value: unknown,
): StorefrontDomainLifecycleSnapshotV1 {
  const source = record(value);
  strictKeys(source);
  if (source.snapshotVersion !== "storefront-domain-lifecycle-snapshot.v1") {
    throw new StorefrontContractError("Unsupported storefront domain lifecycle snapshot version.");
  }
  return Object.freeze({
    snapshotVersion: "storefront-domain-lifecycle-snapshot.v1",
    domainId: uuid(source.domainId, "Storefront domainId"),
    storefrontId: uuid(source.storefrontId, "Storefront storefrontId"),
    hostname: hostname(source.hostname),
    kind: enumValue(source.kind, ["platform_subdomain", "custom"] as const, "Storefront domain kind"),
    status: enumValue(
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
      "Storefront domain status",
    ),
    certificateStatus: enumValue(
      source.certificateStatus,
      ["none", "pending", "active", "expiring", "failed", "revoked"] as const,
      "Storefront domain certificateStatus",
    ),
    verificationStatus: enumValue(
      source.verificationStatus,
      ["none", "pending", "verified", "failed", "expired"] as const,
      "Storefront domain verificationStatus",
    ),
    canonical: booleanValue(source.canonical, "Storefront domain canonical"),
    updatedAt: dateTime(source.updatedAt),
  });
}

function derivePhase(snapshot: StorefrontDomainLifecycleSnapshotV1): StorefrontDomainLifecyclePhaseV1 {
  if (snapshot.status === "deleted") return "removed";
  if (snapshot.status === "deleting") return "removing";
  if (snapshot.status === "suspended") return "suspended";
  if (
    snapshot.status === "failed" ||
    snapshot.verificationStatus === "failed" ||
    snapshot.verificationStatus === "expired" ||
    snapshot.certificateStatus === "failed" ||
    snapshot.certificateStatus === "revoked" ||
    snapshot.certificateStatus === "expiring"
  ) {
    return "attention";
  }
  if (
    snapshot.status === "active" &&
    snapshot.verificationStatus === "verified" &&
    snapshot.certificateStatus === "active"
  ) {
    return "active";
  }
  if (
    snapshot.status === "certificate_pending" ||
    (snapshot.verificationStatus === "verified" && snapshot.certificateStatus === "pending")
  ) {
    return "certificate_pending";
  }
  if (
    snapshot.status === "verification_pending" ||
    snapshot.verificationStatus === "pending"
  ) {
    return "ownership_pending";
  }
  return "setup_pending";
}

function recommendedAction(
  phase: StorefrontDomainLifecyclePhaseV1,
  providerControlAvailable: boolean,
): StorefrontDomainLifecycleActionV1 {
  if (phase === "active" || phase === "removed" || phase === "removing") return "none";
  if (phase === "attention" || phase === "suspended") return "contact_support";
  if (!providerControlAvailable) return "review_configuration";
  return "wait_for_provider";
}

export function deriveStorefrontDomainLifecycleViewV1(
  value: unknown,
  options: { readonly providerControlAvailable: boolean },
): StorefrontDomainLifecycleViewV1 {
  const snapshot = parseStorefrontDomainLifecycleSnapshotV1(value);
  if (typeof options.providerControlAvailable !== "boolean") {
    throw new StorefrontContractError("Storefront domain provider control availability must be boolean.");
  }
  const phase = derivePhase(snapshot);
  return Object.freeze({
    viewVersion: "storefront-domain-lifecycle-view.v1",
    domainId: snapshot.domainId,
    storefrontId: snapshot.storefrontId,
    hostname: snapshot.hostname,
    kind: snapshot.kind,
    phase,
    status: snapshot.status,
    certificateStatus: snapshot.certificateStatus,
    verificationStatus: snapshot.verificationStatus,
    canonical: snapshot.canonical,
    providerControlAvailable: options.providerControlAvailable,
    recommendedAction: recommendedAction(phase, options.providerControlAvailable),
    updatedAt: snapshot.updatedAt,
  });
}
