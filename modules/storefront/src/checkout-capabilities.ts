import {
  StorefrontContractError,
  normalizeStorefrontHostname,
  type StorefrontHostContextV1,
} from "../../../packages/storefront-contracts/src/index.js";
import {
  parseStorefrontCheckoutCapabilityEnvelopeV1,
  parseStorefrontCheckoutCapabilityRequestV1,
  type StorefrontCheckoutCapabilityEnvelopeV1,
  type StorefrontCheckoutCapabilityRequestV1,
} from "../../../packages/storefront-contracts/src/checkout-capabilities.js";
import type { StorefrontPublicRepository } from "./public.js";

export interface StorefrontCheckoutCapabilityAuthorityPort {
  resolve(input: {
    readonly context: StorefrontHostContextV1;
    readonly request: StorefrontCheckoutCapabilityRequestV1;
  }): Promise<unknown>;
}

export interface StorefrontCheckoutCapabilityBoundaryOptions {
  readonly now?: () => string;
}

const CONTEXT_KEYS = [
  "tenantId",
  "storefrontId",
  "salesChannelId",
  "requestHostname",
  "canonicalHostname",
  "locale",
  "currency",
  "priceListRevision",
  "publicationGeneration",
] as const;

function assertContextMatches(
  actual: StorefrontHostContextV1,
  expected: StorefrontHostContextV1,
): void {
  for (const key of CONTEXT_KEYS) {
    if (actual[key] !== expected[key]) {
      throw new StorefrontContractError(
        `Checkout capability authority returned mismatched storefront context: ${key}.`,
      );
    }
  }
}

function assertQuoteMatchesRequest(
  request: StorefrontCheckoutCapabilityRequestV1,
  envelope: StorefrontCheckoutCapabilityEnvelopeV1,
): void {
  if (envelope.quoteId !== request.quoteId) {
    throw new StorefrontContractError(
      "Checkout capability authority returned a different quote identity.",
    );
  }
  if (envelope.quoteRevision !== request.quoteRevision) {
    throw new StorefrontContractError(
      "Checkout capability authority returned a stale quote revision.",
    );
  }
}

function assertReadySelectionsRemainEligible(
  request: StorefrontCheckoutCapabilityRequestV1,
  envelope: StorefrontCheckoutCapabilityEnvelopeV1,
): void {
  if (envelope.state !== "ready") return;
  if (
    request.shippingOptionId !== null &&
    !envelope.shippingOptions.some(
      (option) => option.optionId === request.shippingOptionId,
    )
  ) {
    throw new StorefrontContractError(
      "Ready checkout capability response omitted the selected shipping option.",
    );
  }
  if (
    request.paymentCapabilityId !== null &&
    !envelope.paymentCapabilities.some(
      (capability) => capability.capabilityId === request.paymentCapabilityId,
    )
  ) {
    throw new StorefrontContractError(
      "Ready checkout capability response omitted the selected payment capability.",
    );
  }
}

export async function resolveStorefrontCheckoutCapabilities(
  repository: Pick<StorefrontPublicRepository, "resolveBootstrap">,
  authority: StorefrontCheckoutCapabilityAuthorityPort,
  hostname: string,
  payload: unknown,
  options: StorefrontCheckoutCapabilityBoundaryOptions = {},
): Promise<StorefrontCheckoutCapabilityEnvelopeV1 | null> {
  const normalizedHostname = normalizeStorefrontHostname(hostname);
  const request = parseStorefrontCheckoutCapabilityRequestV1(payload);
  const bootstrap = await repository.resolveBootstrap(normalizedHostname);
  if (!bootstrap) return null;
  if (bootstrap.context.requestHostname !== normalizedHostname) {
    throw new StorefrontContractError(
      "Storefront bootstrap returned a mismatched request hostname.",
    );
  }

  const envelope = parseStorefrontCheckoutCapabilityEnvelopeV1(
    await authority.resolve({ context: bootstrap.context, request }),
  );
  assertContextMatches(envelope.context, bootstrap.context);
  assertQuoteMatchesRequest(request, envelope);
  assertReadySelectionsRemainEligible(request, envelope);

  const now = Date.parse((options.now ?? (() => new Date().toISOString()))());
  const quoteExpiresAt = Date.parse(envelope.quoteExpiresAt);
  if (!Number.isFinite(now) || quoteExpiresAt <= now) {
    throw new StorefrontContractError(
      "Checkout capability authority returned an expired quote.",
    );
  }
  for (const option of envelope.shippingOptions) {
    if (Date.parse(option.expiresAt) <= now && envelope.state === "ready") {
      throw new StorefrontContractError(
        "Ready checkout capability response contains an expired shipping option.",
      );
    }
  }
  for (const capability of envelope.paymentCapabilities) {
    if (
      capability.expiresAt !== null &&
      Date.parse(capability.expiresAt) <= now &&
      envelope.state === "ready"
    ) {
      throw new StorefrontContractError(
        "Ready checkout capability response contains an expired payment capability.",
      );
    }
  }

  return envelope;
}
