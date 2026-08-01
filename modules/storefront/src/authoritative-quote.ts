import type { RequestContext } from "../../../packages/foundation/src/context.js";
import type { MoneyV1, QuantityV1 } from "../../../packages/contracts/src/v1/common.js";
import type {
  CatalogItemReferenceV1,
  CustomerReferenceV1,
  PriceTaxSnapshotV1,
} from "../../../packages/contracts/src/v1/contracts.js";
import type {
  SalesDocumentLine,
  SalesLineInput,
  SalesQuote,
} from "../../sales/src/index.js";
import {
  StorefrontContractError,
  type StorefrontHostContextV1,
  type StorefrontMoneyV1,
} from "../../../packages/storefront-contracts/src/index.js";
import type {
  StorefrontCartDraftLineV1,
  StorefrontCartQuoteEnvelopeV1,
  StorefrontCartQuoteInventoryEvidenceV1,
  StorefrontCartQuoteRequestV1,
} from "../../../packages/storefront-contracts/src/cart-checkout.js";
import type { StorefrontCartQuoteAuthorityPort } from "./cart-checkout.js";

export interface StorefrontQuotePrincipalV1 {
  readonly requestContext: RequestContext;
  readonly customer: CustomerReferenceV1;
}

export interface StorefrontQuotePrincipalResolverPort {
  resolve(input: {
    readonly context: StorefrontHostContextV1;
    readonly requestedCustomerId: string | null;
  }): Promise<StorefrontQuotePrincipalV1 | null>;
}

export interface StorefrontPublishedCartItemPort {
  resolve(input: {
    readonly context: StorefrontHostContextV1;
    readonly productId: string;
    readonly variantId: string;
  }): Promise<CatalogItemReferenceV1 | null>;
}

export interface StorefrontCommercialSeedV1 {
  readonly unitPriceMinor: bigint;
  readonly taxRateBasisPoints: number;
  readonly priceListRevision: string;
}

export interface StorefrontCommercialSeedPort {
  resolve(input: {
    readonly context: StorefrontHostContextV1;
    readonly principal: StorefrontQuotePrincipalV1;
    readonly item: CatalogItemReferenceV1;
    readonly quantity: QuantityV1;
    readonly couponCodes: readonly string[];
    readonly destinationCountryCode: string | null;
  }): Promise<StorefrontCommercialSeedV1>;
}

export interface StorefrontInventoryQuoteEvidenceV1 {
  readonly variantId: string;
  readonly version: string;
  readonly sufficient: boolean;
}

export interface StorefrontInventoryQuotePort {
  resolve(input: {
    readonly context: StorefrontHostContextV1;
    readonly principal: StorefrontQuotePrincipalV1;
    readonly item: CatalogItemReferenceV1;
    readonly quantity: QuantityV1;
  }): Promise<StorefrontInventoryQuoteEvidenceV1>;
}

export interface StorefrontSalesQuotePort {
  createQuote(input: {
    readonly requestContext: RequestContext;
    readonly idempotencyKey: string;
    readonly customer: CustomerReferenceV1;
    readonly currency: string;
    readonly expiresAt: string;
    readonly lines: readonly SalesLineInput[];
  }): Promise<SalesQuote>;
}

export interface StorefrontShippingAmountPort {
  quote(input: {
    readonly context: StorefrontHostContextV1;
    readonly principal: StorefrontQuotePrincipalV1;
    readonly shippingOptionId: string | null;
    readonly lines: readonly {
      readonly item: CatalogItemReferenceV1;
      readonly quantity: QuantityV1;
    }[];
  }): Promise<MoneyV1>;
}

export interface StorefrontAuthoritativeQuoteDependencies {
  readonly principals: StorefrontQuotePrincipalResolverPort;
  readonly publishedItems: StorefrontPublishedCartItemPort;
  readonly commercial: StorefrontCommercialSeedPort;
  readonly inventory: StorefrontInventoryQuotePort;
  readonly sales: StorefrontSalesQuotePort;
  readonly shipping: StorefrontShippingAmountPort;
}

export interface StorefrontAuthoritativeQuoteOptions {
  readonly now?: () => string;
  readonly quoteTtlSeconds?: number;
}

interface ResolvedLine {
  readonly draft: StorefrontCartDraftLineV1;
  readonly item: CatalogItemReferenceV1;
  readonly quantity: QuantityV1;
  readonly commercial: StorefrontCommercialSeedV1;
  readonly inventory: StorefrontInventoryQuoteEvidenceV1;
}

function requireTrustedPrincipal(
  principal: StorefrontQuotePrincipalV1 | null,
  context: StorefrontHostContextV1,
  requestedCustomerId: string | null,
): StorefrontQuotePrincipalV1 {
  if (!principal) {
    throw new StorefrontContractError(
      "Storefront checkout is not available for the resolved buyer principal.",
    );
  }
  const requestContext = principal.requestContext;
  if (
    requestContext.tenantId !== context.tenantId ||
    requestContext.locale !== context.locale ||
    !requestContext.legalEntityId ||
    !requestContext.storeId ||
    !requestContext.permissions.has("sales.quote.create")
  ) {
    throw new StorefrontContractError(
      "Storefront checkout principal is not authorised for canonical quote creation.",
    );
  }
  if (
    requestedCustomerId !== null &&
    principal.customer.customerId !== requestedCustomerId
  ) {
    throw new StorefrontContractError(
      "Storefront checkout principal does not match the requested customer.",
    );
  }
  if (!principal.customer.customerId.trim()) {
    throw new StorefrontContractError(
      "Storefront checkout principal must resolve a canonical customer reference.",
    );
  }
  return principal;
}

function quantity(line: StorefrontCartDraftLineV1): QuantityV1 {
  return Object.freeze({
    amount: line.quantity.amount,
    unit: line.quantity.unit,
    scale: line.quantity.scale,
  });
}

function requirePublishedItem(
  item: CatalogItemReferenceV1 | null,
  line: StorefrontCartDraftLineV1,
): CatalogItemReferenceV1 {
  if (!item) {
    throw new StorefrontContractError(
      "Storefront cart contains an unpublished or unavailable product variant.",
    );
  }
  if (item.itemId !== line.productId || item.variantId !== line.variantId) {
    throw new StorefrontContractError(
      "Published storefront item identity does not match cart intent.",
    );
  }
  return item;
}

function requireCommercialSeed(
  seed: StorefrontCommercialSeedV1,
  context: StorefrontHostContextV1,
): StorefrontCommercialSeedV1 {
  if (seed.unitPriceMinor < 0n) {
    throw new StorefrontContractError(
      "Canonical commercial seed returned a negative unit price.",
    );
  }
  if (
    !Number.isSafeInteger(seed.taxRateBasisPoints) ||
    seed.taxRateBasisPoints < 0 ||
    seed.taxRateBasisPoints > 100_000
  ) {
    throw new StorefrontContractError(
      "Canonical commercial seed returned an invalid tax-rate seed.",
    );
  }
  if (seed.priceListRevision !== context.priceListRevision) {
    throw new StorefrontContractError(
      "Canonical commercial seed price-list revision is stale.",
    );
  }
  return seed;
}

function requireInventoryEvidence(
  evidence: StorefrontInventoryQuoteEvidenceV1,
  line: StorefrontCartDraftLineV1,
): StorefrontInventoryQuoteEvidenceV1 {
  if (
    evidence.variantId !== line.variantId ||
    !/^(?:0|[1-9][0-9]*)$/u.test(evidence.version)
  ) {
    throw new StorefrontContractError(
      "Canonical inventory evidence is malformed or scope-mismatched.",
    );
  }
  return evidence;
}

function requireMoney(
  value: MoneyV1,
  context: StorefrontHostContextV1,
  label: string,
): StorefrontMoneyV1 {
  if (
    value.currency.toUpperCase() !== context.currency ||
    !/^-?(?:0|[1-9][0-9]*)$/u.test(value.amountMinor) ||
    BigInt(value.amountMinor) < 0n ||
    !Number.isInteger(value.scale) ||
    value.scale < 0 ||
    value.scale > 6
  ) {
    throw new StorefrontContractError(`${label} is invalid for storefront context.`);
  }
  return Object.freeze({
    currency: context.currency,
    minor: value.amountMinor,
    scale: value.scale,
  });
}

function addMoney(
  left: MoneyV1,
  right: MoneyV1,
  context: StorefrontHostContextV1,
  label: string,
): StorefrontMoneyV1 {
  const leftMoney = requireMoney(left, context, `${label}.left`);
  const rightMoney = requireMoney(right, context, `${label}.right`);
  if (leftMoney.scale !== rightMoney.scale) {
    throw new StorefrontContractError(`${label} money scale mismatch.`);
  }
  return Object.freeze({
    currency: context.currency,
    minor: (BigInt(leftMoney.minor) + BigInt(rightMoney.minor)).toString(),
    scale: leftMoney.scale,
  });
}

function taxTotal(
  snapshot: PriceTaxSnapshotV1,
  context: StorefrontHostContextV1,
): StorefrontMoneyV1 {
  const scale = snapshot.grossTotal.scale;
  let total = 0n;
  for (const component of snapshot.taxes) {
    const money = requireMoney(component.amount, context, "quoteLine.taxComponent");
    if (money.scale !== scale) {
      throw new StorefrontContractError("Quote tax-component money scale mismatch.");
    }
    total += BigInt(money.minor);
  }
  return Object.freeze({
    currency: context.currency,
    minor: total.toString(),
    scale,
  });
}

function projectLine(
  line: SalesDocumentLine,
  context: StorefrontHostContextV1,
): StorefrontCartQuoteEnvelopeV1["quote"]["lines"][number] {
  const snapshot = line.priceTaxSnapshot;
  if (
    snapshot.item.itemId !== line.item.itemId ||
    snapshot.item.variantId !== line.item.variantId ||
    snapshot.quantity.amount !== line.quantity.amount ||
    snapshot.quantity.unit !== line.quantity.unit ||
    snapshot.quantity.scale !== line.quantity.scale
  ) {
    throw new StorefrontContractError(
      "Canonical sales quote contains a mismatched price-tax snapshot.",
    );
  }
  return Object.freeze({
    lineId: line.id,
    productId: line.item.itemId,
    variantId: line.item.variantId,
    quantity: line.quantity.amount,
    unitPrice: requireMoney(
      snapshot.originalUnitPrice,
      context,
      "quoteLine.unitPrice",
    ),
    subtotal: addMoney(
      snapshot.taxableBase,
      snapshot.discountTotal,
      context,
      "quoteLine.subtotal",
    ),
    discount: requireMoney(snapshot.discountTotal, context, "quoteLine.discount"),
    tax: taxTotal(snapshot, context),
    total: requireMoney(snapshot.grossTotal, context, "quoteLine.total"),
  });
}

function validateSalesQuote(
  quote: SalesQuote,
  context: StorefrontHostContextV1,
  principal: StorefrontQuotePrincipalV1,
  resolved: readonly ResolvedLine[],
): void {
  if (
    quote.tenantId !== context.tenantId ||
    quote.currency !== context.currency ||
    quote.customer.customerId !== principal.customer.customerId ||
    quote.lines.length !== resolved.length ||
    quote.version < 1n ||
    !quote.expiresAt
  ) {
    throw new StorefrontContractError(
      "Canonical sales quote is missing required storefront scope or revision evidence.",
    );
  }
  const expected = new Map(
    resolved.map((line) => [
      `${line.item.itemId}:${line.item.variantId}`,
      line.quantity,
    ]),
  );
  for (const line of quote.lines) {
    const expectedQuantity = expected.get(`${line.item.itemId}:${line.item.variantId}`);
    if (
      !expectedQuantity ||
      expectedQuantity.amount !== line.quantity.amount ||
      expectedQuantity.unit !== line.quantity.unit ||
      expectedQuantity.scale !== line.quantity.scale
    ) {
      throw new StorefrontContractError(
        "Canonical sales quote changed cart identity or quantity.",
      );
    }
  }
}

function quoteExpiry(now: string, ttlSeconds: number): string {
  const parsed = Date.parse(now);
  if (!Number.isFinite(parsed)) {
    throw new StorefrontContractError(
      "Storefront quote clock returned an invalid timestamp.",
    );
  }
  return new Date(parsed + ttlSeconds * 1_000).toISOString();
}

function documentMoney(
  minor: bigint,
  currency: string,
  scale: number,
): MoneyV1 {
  return Object.freeze({ amountMinor: minor.toString(), currency, scale });
}

export function createStorefrontAuthoritativeQuotePort(
  dependencies: StorefrontAuthoritativeQuoteDependencies,
  options: StorefrontAuthoritativeQuoteOptions = {},
): StorefrontCartQuoteAuthorityPort {
  const now = options.now ?? (() => new Date().toISOString());
  const ttlSeconds = options.quoteTtlSeconds ?? 900;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3_600) {
    throw new StorefrontContractError(
      "Storefront canonical quote TTL must be between 60 and 3600 seconds.",
    );
  }

  return Object.freeze({
    async quote(
      { context, request }: {
        readonly context: StorefrontHostContextV1;
        readonly request: StorefrontCartQuoteRequestV1;
      },
    ): Promise<StorefrontCartQuoteEnvelopeV1> {
      const principal = requireTrustedPrincipal(
        await dependencies.principals.resolve({
          context,
          requestedCustomerId: request.customerId,
        }),
        context,
        request.customerId,
      );

      const resolved: ResolvedLine[] = [];
      for (const draft of request.lines) {
        const item = requirePublishedItem(
          await dependencies.publishedItems.resolve({
            context,
            productId: draft.productId,
            variantId: draft.variantId,
          }),
          draft,
        );
        const requestedQuantity = quantity(draft);
        const [commercial, inventory] = await Promise.all([
          dependencies.commercial.resolve({
            context,
            principal,
            item,
            quantity: requestedQuantity,
            couponCodes: request.couponCodes,
            destinationCountryCode: request.destinationCountryCode,
          }),
          dependencies.inventory.resolve({
            context,
            principal,
            item,
            quantity: requestedQuantity,
          }),
        ]);
        resolved.push(
          Object.freeze({
            draft,
            item,
            quantity: requestedQuantity,
            commercial: requireCommercialSeed(commercial, context),
            inventory: requireInventoryEvidence(inventory, draft),
          }),
        );
      }

      const expiresAt = quoteExpiry(now(), ttlSeconds);
      const salesQuote = await dependencies.sales.createQuote({
        requestContext: principal.requestContext,
        idempotencyKey: request.idempotencyKey,
        customer: principal.customer,
        currency: context.currency,
        expiresAt,
        lines: Object.freeze(
          resolved.map((line) =>
            Object.freeze({
              item: line.item,
              quantity: line.quantity,
              unitPriceMinor: line.commercial.unitPriceMinor,
              taxRateBasisPoints: line.commercial.taxRateBasisPoints,
            }),
          ),
        ),
      });
      validateSalesQuote(salesQuote, context, principal, resolved);

      const shipping = requireMoney(
        await dependencies.shipping.quote({
          context,
          principal,
          shippingOptionId: request.shippingOptionId,
          lines: Object.freeze(
            resolved.map((line) =>
              Object.freeze({ item: line.item, quantity: line.quantity }),
            ),
          ),
        }),
        context,
        "quote.shipping",
      );
      if (shipping.scale !== salesQuote.total.scale) {
        throw new StorefrontContractError(
          "Canonical shipping amount scale does not match sales quote.",
        );
      }

      const quoteLines = Object.freeze(
        salesQuote.lines.map((line) => projectLine(line, context)),
      );
      const inventoryVersions: readonly StorefrontCartQuoteInventoryEvidenceV1[] =
        Object.freeze(
          resolved.map((line) =>
            Object.freeze({
              variantId: line.inventory.variantId,
              version: line.inventory.version,
            }),
          ),
        );
      const unavailable = new Set(
        resolved
          .filter((line) => !line.inventory.sufficient)
          .map((line) => `${line.item.itemId}:${line.item.variantId}`),
      );
      const unavailableLineIds = Object.freeze(
        salesQuote.lines
          .filter((line) =>
            unavailable.has(`${line.item.itemId}:${line.item.variantId}`),
          )
          .map((line) => line.id),
      );
      const discount = documentMoney(
        salesQuote.total.discountMinor,
        salesQuote.total.currency,
        salesQuote.total.scale,
      );
      const net = documentMoney(
        salesQuote.total.netMinor,
        salesQuote.total.currency,
        salesQuote.total.scale,
      );
      const gross = documentMoney(
        salesQuote.total.grossMinor,
        salesQuote.total.currency,
        salesQuote.total.scale,
      );
      const subtotal = addMoney(net, discount, context, "quote.subtotal");
      const total: StorefrontMoneyV1 = Object.freeze({
        currency: context.currency,
        minor: (BigInt(gross.amountMinor) + BigInt(shipping.minor)).toString(),
        scale: salesQuote.total.scale,
      });

      return Object.freeze({
        contractVersion: "storefront-cart-quote-envelope.v1",
        context,
        cartRevision: request.cartRevision,
        state: unavailableLineIds.length > 0 ? "unavailable" : "ready",
        quote: Object.freeze({
          contractVersion: "storefront-cart-quote.v1",
          quoteId: salesQuote.id,
          quoteRevision: salesQuote.version.toString(),
          expiresAt: salesQuote.expiresAt as string,
          lines: quoteLines,
          subtotal,
          discount: requireMoney(discount, context, "quote.discount"),
          shipping,
          tax: requireMoney(
            documentMoney(
              salesQuote.total.taxMinor,
              salesQuote.total.currency,
              salesQuote.total.scale,
            ),
            context,
            "quote.tax",
          ),
          total,
        }),
        authority: Object.freeze({
          priceListRevision: context.priceListRevision,
          publicationGeneration: context.publicationGeneration,
          calculationIds: Object.freeze(
            salesQuote.lines.map((line) => line.priceTaxSnapshot.calculationId),
          ),
          inventoryVersions,
        }),
        changedLineIds: Object.freeze([]),
        unavailableLineIds,
      });
    },
  });
}
