import type { SalesService } from "../../sales/src/index.js";
import type { StorefrontSalesQuotePort } from "./authoritative-quote.js";

export function createStorefrontSalesServiceQuotePort(
  service: Pick<SalesService, "createQuote">,
): StorefrontSalesQuotePort {
  return Object.freeze({
    async createQuote(
      input: Parameters<StorefrontSalesQuotePort["createQuote"]>[0],
    ) {
      return service.createQuote(input.requestContext, {
        idempotencyKey: input.idempotencyKey,
        customer: input.customer,
        currency: input.currency,
        expiresAt: input.expiresAt,
        lines: input.lines,
      });
    },
  });
}
