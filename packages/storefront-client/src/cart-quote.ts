import {
  parseStorefrontCartDraftV1,
  type StorefrontCartDraftV1,
} from "../../storefront-contracts/src/cart-draft.js";
import {
  parseStorefrontCartQuoteRequestV1,
  type StorefrontCartQuoteRequestV1,
} from "../../storefront-contracts/src/cart-checkout.js";

export function createStorefrontCartQuoteRequest(
  draftValue: StorefrontCartDraftV1 | unknown,
  input: {
    readonly idempotencyKey: string;
    readonly customerId?: string | null;
    readonly shippingOptionId?: string | null;
  },
): StorefrontCartQuoteRequestV1 {
  const draft = parseStorefrontCartDraftV1(draftValue);
  return parseStorefrontCartQuoteRequestV1({
    contractVersion: "storefront-cart-quote-request.v1",
    cartRevision: draft.revision,
    idempotencyKey: input.idempotencyKey,
    lines: draft.lines.map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      quantity: line.quantity,
    })),
    couponCodes: draft.couponCodes,
    destinationCountryCode: draft.destinationCountryCode,
    customerId: input.customerId ?? null,
    shippingOptionId: input.shippingOptionId ?? null,
  });
}
