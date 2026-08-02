import { StorefrontContractError } from "../../../packages/storefront-contracts/src/index.js";
import {
  parseStorefrontAbuseControlDecisionV1,
  type StorefrontAbuseControlDecisionV1,
  type StorefrontAbuseControlRequestV1,
} from "./abuse-control.js";

export interface StorefrontDistributedAbuseProviderRequestV1 {
  readonly requestVersion: "storefront-distributed-abuse-provider-request.v1";
  readonly source: "trusted-storefront-runtime";
  readonly policyClass: StorefrontAbuseControlRequestV1["policyClass"];
  readonly unavailableMode: StorefrontAbuseControlRequestV1["unavailableMode"];
  readonly tenantId: string;
  readonly storefrontId: string;
  readonly requestHostname: string;
  readonly identityClass: "anonymous" | "authenticated";
  readonly keySource: StorefrontAbuseControlRequestV1["abuseKey"]["source"];
  readonly opaqueKey: string;
}

export interface StorefrontDistributedAbuseProviderResultV1 {
  readonly resultVersion: "storefront-distributed-abuse-provider-result.v1";
  readonly source: "trusted-distributed-provider";
  readonly state: StorefrontAbuseControlDecisionV1["state"];
  readonly reason: StorefrontAbuseControlDecisionV1["reason"];
  readonly policyRevision: string;
  readonly retryAfterSeconds: number | null;
}

const RESULT_KEYS = new Set([
  "resultVersion",
  "source",
  "state",
  "reason",
  "policyRevision",
  "retryAfterSeconds",
]);

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorefrontContractError("Distributed storefront abuse provider result must be an object.");
  }
  return value as Record<string, unknown>;
}

export function createStorefrontDistributedAbuseProviderRequestV1(
  request: StorefrontAbuseControlRequestV1,
): StorefrontDistributedAbuseProviderRequestV1 {
  if (
    request.authenticated &&
    request.abuseKey.source !== "authenticated_session"
  ) {
    throw new StorefrontContractError(
      "Authenticated abuse provider requests require an authenticated-session key.",
    );
  }
  if (!request.authenticated && request.abuseKey.source !== "trusted_edge") {
    throw new StorefrontContractError(
      "Anonymous abuse provider requests require a trusted-edge key.",
    );
  }

  return Object.freeze({
    requestVersion: "storefront-distributed-abuse-provider-request.v1",
    source: "trusted-storefront-runtime",
    policyClass: request.policyClass,
    unavailableMode: request.unavailableMode,
    tenantId: request.tenantId,
    storefrontId: request.storefrontId,
    requestHostname: request.requestHostname,
    identityClass: request.authenticated ? "authenticated" : "anonymous",
    keySource: request.abuseKey.source,
    opaqueKey: request.abuseKey.opaqueKey,
  });
}

export function parseStorefrontDistributedAbuseProviderResultV1(
  value: unknown,
): StorefrontDistributedAbuseProviderResultV1 {
  const source = record(value);
  const unexpected = Object.keys(source).filter((key) => !RESULT_KEYS.has(key));
  if (unexpected.length > 0) {
    throw new StorefrontContractError(
      `Distributed storefront abuse provider result contains unsupported fields: ${unexpected.sort().join(", ")}.`,
    );
  }
  if (source.resultVersion !== "storefront-distributed-abuse-provider-result.v1") {
    throw new StorefrontContractError("Unsupported distributed storefront abuse provider result version.");
  }
  if (source.source !== "trusted-distributed-provider") {
    throw new StorefrontContractError("Distributed storefront abuse provider source is not trusted.");
  }

  const decision = parseStorefrontAbuseControlDecisionV1({
    decisionVersion: "storefront-abuse-control-decision.v1",
    state: source.state,
    reason: source.reason,
    policyRevision: source.policyRevision,
    retryAfterSeconds: source.retryAfterSeconds ?? null,
  });

  return Object.freeze({
    resultVersion: "storefront-distributed-abuse-provider-result.v1",
    source: "trusted-distributed-provider",
    state: decision.state,
    reason: decision.reason,
    policyRevision: decision.policyRevision,
    retryAfterSeconds: decision.retryAfterSeconds,
  });
}

export function mapStorefrontDistributedAbuseProviderResultV1(
  value: unknown,
): StorefrontAbuseControlDecisionV1 {
  const result = parseStorefrontDistributedAbuseProviderResultV1(value);
  return Object.freeze({
    decisionVersion: "storefront-abuse-control-decision.v1",
    state: result.state,
    reason: result.reason,
    policyRevision: result.policyRevision,
    retryAfterSeconds: result.retryAfterSeconds,
  });
}
