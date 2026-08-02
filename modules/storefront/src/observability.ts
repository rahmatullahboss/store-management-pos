import { StorefrontContractError } from "../../../packages/storefront-contracts/src/index.js";
import type { StorefrontAbusePolicyClassV1 } from "./abuse-control.js";
import type { StorefrontDomainLifecyclePhaseV1 } from "./domain-lifecycle.js";

export type StorefrontOperationalEventNameV1 =
  | "storefront.cache.decision"
  | "storefront.public_host.resolve"
  | "storefront.private_access.decision"
  | "storefront.abuse_control.decision"
  | "storefront.domain.lifecycle"
  | "storefront.checkout.guard";

export type StorefrontOperationalSeverityV1 = "info" | "warn" | "error";
export type StorefrontOperationalOutcomeV1 =
  | "success"
  | "bypass"
  | "denied"
  | "unavailable"
  | "stale"
  | "conflict"
  | "failed";

export type StorefrontOperationalCacheFamilyV1 =
  | "bootstrap"
  | "content"
  | "catalog"
  | "product"
  | "category"
  | "collection"
  | "search"
  | "sitemap"
  | "media";

export interface StorefrontOperationalEventV1 {
  readonly eventVersion: "storefront-operational-event.v1";
  readonly eventName: StorefrontOperationalEventNameV1;
  readonly occurredAt: string;
  readonly severity: StorefrontOperationalSeverityV1;
  readonly outcome: StorefrontOperationalOutcomeV1;
  readonly reason: string;
  readonly requestId: string;
  readonly traceId: string;
  readonly tenantId: string | null;
  readonly storefrontId: string | null;
  readonly salesChannelId: string | null;
  readonly cacheFamily: StorefrontOperationalCacheFamilyV1 | null;
  readonly abusePolicyClass: StorefrontAbusePolicyClassV1 | null;
  readonly domainPhase: StorefrontDomainLifecyclePhaseV1 | null;
}

const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const SAFE_REASON = /^[a-z0-9][a-z0-9._-]{0,79}$/u;
const EVENT_NAMES: readonly StorefrontOperationalEventNameV1[] = [
  "storefront.cache.decision",
  "storefront.public_host.resolve",
  "storefront.private_access.decision",
  "storefront.abuse_control.decision",
  "storefront.domain.lifecycle",
  "storefront.checkout.guard",
];
const SEVERITIES: readonly StorefrontOperationalSeverityV1[] = ["info", "warn", "error"];
const OUTCOMES: readonly StorefrontOperationalOutcomeV1[] = [
  "success",
  "bypass",
  "denied",
  "unavailable",
  "stale",
  "conflict",
  "failed",
];
const CACHE_FAMILIES: readonly StorefrontOperationalCacheFamilyV1[] = [
  "bootstrap",
  "content",
  "catalog",
  "product",
  "category",
  "collection",
  "search",
  "sitemap",
  "media",
];
const ABUSE_POLICIES: readonly StorefrontAbusePolicyClassV1[] = [
  "public_read",
  "public_search",
  "public_media",
  "private_read",
  "checkout_quote",
  "checkout_submit",
  "admin_mutation",
];
const DOMAIN_PHASES: readonly StorefrontDomainLifecyclePhaseV1[] = [
  "setup_pending",
  "ownership_pending",
  "certificate_pending",
  "active",
  "attention",
  "suspended",
  "removing",
  "removed",
];

const ALLOWED_KEYS = new Set([
  "eventVersion",
  "eventName",
  "occurredAt",
  "severity",
  "outcome",
  "reason",
  "requestId",
  "traceId",
  "tenantId",
  "storefrontId",
  "salesChannelId",
  "cacheFamily",
  "abusePolicyClass",
  "domainPhase",
]);

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorefrontContractError("Storefront operational event must be an object.");
  }
  return value as Record<string, unknown>;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new StorefrontContractError(`${label} is unsupported.`);
  }
  return value as T;
}

function nullableEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T | null {
  if (value === null || value === undefined) return null;
  return enumValue(value, allowed, label);
}

function safeToken(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_TOKEN.test(value)) {
    throw new StorefrontContractError(`${label} must be a bounded safe token.`);
  }
  return value;
}

function nullableToken(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return safeToken(value, label);
}

function occurredAt(value: unknown): string {
  if (typeof value !== "string" || value.length > 64) {
    throw new StorefrontContractError("Storefront operational event occurredAt is invalid.");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new StorefrontContractError("Storefront operational event occurredAt is invalid.");
  }
  return new Date(parsed).toISOString();
}

export function parseStorefrontOperationalEventV1(value: unknown): StorefrontOperationalEventV1 {
  const source = record(value);
  const unexpected = Object.keys(source).filter((key) => !ALLOWED_KEYS.has(key));
  if (unexpected.length > 0) {
    throw new StorefrontContractError(
      `Storefront operational event contains unsupported fields: ${unexpected.sort().join(", ")}.`,
    );
  }
  if (source.eventVersion !== "storefront-operational-event.v1") {
    throw new StorefrontContractError("Unsupported storefront operational event version.");
  }
  if (typeof source.reason !== "string" || !SAFE_REASON.test(source.reason)) {
    throw new StorefrontContractError("Storefront operational event reason is invalid.");
  }
  return Object.freeze({
    eventVersion: "storefront-operational-event.v1",
    eventName: enumValue(source.eventName, EVENT_NAMES, "Storefront operational event name"),
    occurredAt: occurredAt(source.occurredAt),
    severity: enumValue(source.severity, SEVERITIES, "Storefront operational event severity"),
    outcome: enumValue(source.outcome, OUTCOMES, "Storefront operational event outcome"),
    reason: source.reason,
    requestId: safeToken(source.requestId, "Storefront operational event requestId"),
    traceId: safeToken(source.traceId, "Storefront operational event traceId"),
    tenantId: nullableToken(source.tenantId, "Storefront operational event tenantId"),
    storefrontId: nullableToken(source.storefrontId, "Storefront operational event storefrontId"),
    salesChannelId: nullableToken(
      source.salesChannelId,
      "Storefront operational event salesChannelId",
    ),
    cacheFamily: nullableEnum(
      source.cacheFamily,
      CACHE_FAMILIES,
      "Storefront operational event cacheFamily",
    ),
    abusePolicyClass: nullableEnum(
      source.abusePolicyClass,
      ABUSE_POLICIES,
      "Storefront operational event abusePolicyClass",
    ),
    domainPhase: nullableEnum(
      source.domainPhase,
      DOMAIN_PHASES,
      "Storefront operational event domainPhase",
    ),
  });
}

export function serializeStorefrontOperationalEventV1(value: unknown): string {
  return JSON.stringify(parseStorefrontOperationalEventV1(value));
}
