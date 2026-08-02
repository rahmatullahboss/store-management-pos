import type { RequestContext } from "../../../packages/foundation/src/context.js";
import type { CustomerService } from "../../customer/src/index.js";
import {
  StorefrontContractError,
  type StorefrontHostContextV1,
} from "../../../packages/storefront-contracts/src/index.js";
import type {
  StorefrontQuotePrincipalResolverPort,
  StorefrontQuotePrincipalV1,
} from "./authoritative-quote.js";

export interface StorefrontAuthenticatedPrincipalOptions {
  readonly requestContext: RequestContext;
}

function assertContextScope(
  requestContext: RequestContext,
  storefront: StorefrontHostContextV1,
): void {
  if (
    requestContext.tenantId !== storefront.tenantId ||
    requestContext.locale !== storefront.locale ||
    !requestContext.legalEntityId ||
    !requestContext.storeId
  ) {
    throw new StorefrontContractError(
      "Authenticated storefront buyer context does not match checkout scope.",
    );
  }
  if (
    !requestContext.permissions.has("sales.quote.create") ||
    !requestContext.permissions.has("customer.profile.read")
  ) {
    throw new StorefrontContractError(
      "Authenticated storefront buyer lacks canonical checkout permissions.",
    );
  }
}

export function createStorefrontAuthenticatedCustomerPrincipalResolver(
  customerService: Pick<CustomerService, "get">,
  options: StorefrontAuthenticatedPrincipalOptions,
): StorefrontQuotePrincipalResolverPort {
  return Object.freeze({
    async resolve(
      input: Parameters<StorefrontQuotePrincipalResolverPort["resolve"]>[0],
    ): Promise<StorefrontQuotePrincipalV1 | null> {
      if (!input.requestedCustomerId) return null;
      assertContextScope(options.requestContext, input.context);
      const customer = await customerService.get(
        options.requestContext,
        input.requestedCustomerId,
      );
      if (
        customer.id !== input.requestedCustomerId ||
        customer.tenantId !== input.context.tenantId ||
        customer.status !== "active" ||
        customer.mergedIntoId
      ) {
        throw new StorefrontContractError(
          "Authenticated storefront buyer resolved an invalid canonical customer.",
        );
      }
      if (
        customer.legalEntityId &&
        customer.legalEntityId !== options.requestContext.legalEntityId
      ) {
        throw new StorefrontContractError(
          "Authenticated storefront customer legal-entity scope mismatch.",
        );
      }
      return Object.freeze({
        requestContext: options.requestContext,
        customer: Object.freeze({
          customerId: customer.id,
          displayNameSnapshot: customer.displayName,
        }),
      });
    },
  });
}
