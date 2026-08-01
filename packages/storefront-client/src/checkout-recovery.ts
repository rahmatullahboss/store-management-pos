import type { StorefrontCartQuoteEnvelopeV1 } from "../../storefront-contracts/src/cart-checkout.js";
import type {
  StorefrontCheckoutCapabilityEnvelopeV1,
  StorefrontCheckoutChangeReasonV1,
} from "../../storefront-contracts/src/checkout-capabilities.js";

export type StorefrontCheckoutRecoveryReasonV1 =
  | "cart_recovered"
  | "quote_expired"
  | "quote_changed"
  | "quote_unavailable"
  | "price_tax_changed"
  | "inventory_changed"
  | "country_policy_changed"
  | "shipping_changed"
  | "payment_changed"
  | "checkout_unavailable";

export type StorefrontCheckoutRecoveryActionV1 =
  | "review_cart"
  | "refresh_quote"
  | "review_destination"
  | "select_shipping"
  | "select_payment";

export interface StorefrontCheckoutRecoveryItemV1 {
  readonly reason: StorefrontCheckoutRecoveryReasonV1;
  readonly action: StorefrontCheckoutRecoveryActionV1;
  readonly blocking: true;
}

export interface StorefrontCheckoutRecoveryModelV1 {
  readonly contractVersion: "storefront-checkout-recovery.v1";
  readonly items: readonly StorefrontCheckoutRecoveryItemV1[];
  readonly canSubmit: boolean;
}

function isExpired(value: string, now: number): boolean {
  const parsed = Date.parse(value);
  return !Number.isFinite(parsed) || parsed <= now;
}

function quoteRecovery(
  quote: StorefrontCartQuoteEnvelopeV1 | null | undefined,
  now: number,
): StorefrontCheckoutRecoveryItemV1 | null {
  if (!quote) return null;
  if (isExpired(quote.quote.expiresAt, now)) {
    return Object.freeze({
      reason: "quote_expired",
      action: "refresh_quote",
      blocking: true,
    });
  }
  if (quote.state === "changed") {
    return Object.freeze({
      reason: "quote_changed",
      action: "review_cart",
      blocking: true,
    });
  }
  if (quote.state === "unavailable") {
    return Object.freeze({
      reason: "quote_unavailable",
      action: "review_cart",
      blocking: true,
    });
  }
  return null;
}

function capabilityRecovery(
  reason: StorefrontCheckoutChangeReasonV1,
): StorefrontCheckoutRecoveryItemV1 {
  if (reason === "country_policy") {
    return Object.freeze({
      reason: "country_policy_changed",
      action: "review_destination",
      blocking: true,
    });
  }
  if (reason === "shipping") {
    return Object.freeze({
      reason: "shipping_changed",
      action: "select_shipping",
      blocking: true,
    });
  }
  if (reason === "payment") {
    return Object.freeze({
      reason: "payment_changed",
      action: "select_payment",
      blocking: true,
    });
  }
  if (reason === "price_tax") {
    return Object.freeze({
      reason: "price_tax_changed",
      action: "refresh_quote",
      blocking: true,
    });
  }
  if (reason === "inventory") {
    return Object.freeze({
      reason: "inventory_changed",
      action: "review_cart",
      blocking: true,
    });
  }
  return Object.freeze({
    reason: "quote_changed",
    action: "refresh_quote",
    blocking: true,
  });
}

function dedupe(
  items: readonly StorefrontCheckoutRecoveryItemV1[],
): readonly StorefrontCheckoutRecoveryItemV1[] {
  const byReason = new Map<
    StorefrontCheckoutRecoveryReasonV1,
    StorefrontCheckoutRecoveryItemV1
  >();
  for (const item of items) {
    if (!byReason.has(item.reason)) byReason.set(item.reason, item);
  }
  return Object.freeze([...byReason.values()]);
}

export function deriveStorefrontCheckoutRecoveryV1(input: {
  readonly cartRecovered?: boolean;
  readonly quote?: StorefrontCartQuoteEnvelopeV1 | null;
  readonly capabilities?: StorefrontCheckoutCapabilityEnvelopeV1 | null;
  readonly now?: () => string;
}): StorefrontCheckoutRecoveryModelV1 {
  const nowValue = input.now?.() ?? new Date().toISOString();
  const now = Date.parse(nowValue);
  if (!Number.isFinite(now)) {
    throw new TypeError("Storefront checkout recovery clock is invalid.");
  }

  const items: StorefrontCheckoutRecoveryItemV1[] = [];
  if (input.cartRecovered === true) {
    items.push(
      Object.freeze({
        reason: "cart_recovered",
        action: "review_cart",
        blocking: true,
      }),
    );
  }

  const quoteItem = quoteRecovery(input.quote, now);
  if (quoteItem) items.push(quoteItem);

  const capabilities = input.capabilities;
  if (capabilities) {
    if (isExpired(capabilities.quoteExpiresAt, now)) {
      items.push(
        Object.freeze({
          reason: "quote_expired",
          action: "refresh_quote",
          blocking: true,
        }),
      );
    }
    if (capabilities.state === "unavailable") {
      items.push(
        Object.freeze({
          reason: "checkout_unavailable",
          action: "review_cart",
          blocking: true,
        }),
      );
    }
    for (const reason of capabilities.changedReasons) {
      items.push(capabilityRecovery(reason));
    }
  }

  const unique = dedupe(items);
  return Object.freeze({
    contractVersion: "storefront-checkout-recovery.v1",
    items: unique,
    canSubmit:
      unique.length === 0 &&
      input.quote?.state === "ready" &&
      input.capabilities?.state === "ready",
  });
}
