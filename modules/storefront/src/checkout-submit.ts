import {
  StorefrontContractError,
} from "../../../packages/storefront-contracts/src/index.js";
import {
  parseStorefrontCheckoutCapabilityEnvelopeV1,
  type StorefrontCheckoutCapabilityEnvelopeV1,
  type StorefrontPaymentCapabilityV1,
  type StorefrontShippingOptionV1,
} from "../../../packages/storefront-contracts/src/checkout-capabilities.js";
import {
  parseStorefrontCheckoutSubmissionIntentV1,
  type StorefrontCheckoutSubmissionIntentV1,
} from "../../../packages/storefront-contracts/src/checkout-submit.js";

export interface StorefrontCheckoutSubmissionPreflightV1 {
  readonly intent: StorefrontCheckoutSubmissionIntentV1;
  readonly capabilities: StorefrontCheckoutCapabilityEnvelopeV1;
  readonly shippingOption: StorefrontShippingOptionV1;
  readonly paymentCapability: StorefrontPaymentCapabilityV1;
}

function assertRevision(
  actual: string,
  expected: string,
  label: string,
): void {
  if (actual !== expected) {
    throw new StorefrontContractError(
      `${label} changed and checkout must be revalidated.`,
    );
  }
}

function requireShippingOption(
  capabilities: StorefrontCheckoutCapabilityEnvelopeV1,
  intent: StorefrontCheckoutSubmissionIntentV1,
): StorefrontShippingOptionV1 {
  const option = capabilities.shippingOptions.find(
    (candidate) => candidate.optionId === intent.shippingOptionId,
  );
  if (!option) {
    throw new StorefrontContractError(
      "Selected shipping option is no longer eligible.",
    );
  }
  assertRevision(
    option.version,
    intent.shippingOptionVersion,
    "Selected shipping option version",
  );
  return option;
}

function requirePaymentCapability(
  capabilities: StorefrontCheckoutCapabilityEnvelopeV1,
  intent: StorefrontCheckoutSubmissionIntentV1,
): StorefrontPaymentCapabilityV1 {
  const capability = capabilities.paymentCapabilities.find(
    (candidate) => candidate.capabilityId === intent.paymentCapabilityId,
  );
  if (!capability) {
    throw new StorefrontContractError(
      "Selected payment capability is no longer eligible.",
    );
  }
  assertRevision(
    capability.version,
    intent.paymentCapabilityVersion,
    "Selected payment capability version",
  );
  return capability;
}

export function preflightStorefrontCheckoutSubmission(
  rawIntent: unknown,
  rawCapabilities: unknown,
  options: { readonly now?: () => string } = {},
): StorefrontCheckoutSubmissionPreflightV1 {
  const intent = parseStorefrontCheckoutSubmissionIntentV1(rawIntent);
  const capabilities = parseStorefrontCheckoutCapabilityEnvelopeV1(
    rawCapabilities,
  );

  if (capabilities.state !== "ready") {
    throw new StorefrontContractError(
      "Checkout capabilities require revalidation before submission.",
    );
  }
  if (capabilities.quoteId !== intent.quoteId) {
    throw new StorefrontContractError(
      "Checkout submission quote identity does not match current capabilities.",
    );
  }
  if (capabilities.quoteRevision !== intent.quoteRevision) {
    throw new StorefrontContractError(
      "Checkout submission quote revision is stale.",
    );
  }
  assertRevision(
    capabilities.authority.quoteAuthorityToken,
    intent.quoteAuthorityToken,
    "Quote authority token",
  );
  assertRevision(
    capabilities.authority.countryPolicyRevision,
    intent.countryPolicyRevision,
    "Country policy revision",
  );
  assertRevision(
    capabilities.authority.shippingRevision,
    intent.shippingRevision,
    "Shipping authority revision",
  );
  assertRevision(
    capabilities.authority.paymentRevision,
    intent.paymentRevision,
    "Payment authority revision",
  );

  const shippingOption = requireShippingOption(capabilities, intent);
  const paymentCapability = requirePaymentCapability(capabilities, intent);
  const now = Date.parse((options.now ?? (() => new Date().toISOString()))());
  if (!Number.isFinite(now)) {
    throw new StorefrontContractError(
      "Checkout submission validation clock is invalid.",
    );
  }
  if (Date.parse(capabilities.quoteExpiresAt) <= now) {
    throw new StorefrontContractError(
      "Checkout quote expired before submission.",
    );
  }
  if (Date.parse(shippingOption.expiresAt) <= now) {
    throw new StorefrontContractError(
      "Selected shipping option expired before submission.",
    );
  }
  if (
    paymentCapability.expiresAt !== null &&
    Date.parse(paymentCapability.expiresAt) <= now
  ) {
    throw new StorefrontContractError(
      "Selected payment capability expired before submission.",
    );
  }

  return Object.freeze({
    intent,
    capabilities,
    shippingOption,
    paymentCapability,
  });
}
