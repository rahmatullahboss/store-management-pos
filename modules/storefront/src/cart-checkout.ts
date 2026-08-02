import {
  StorefrontContractError,
  normalizeStorefrontHostname,
  type StorefrontHostContextV1,
} from "../../../packages/storefront-contracts/src/index.js";
import {
  parseStorefrontCartQuoteEnvelopeV1,
  parseStorefrontCartQuoteRequestV1,
  type StorefrontCartQuoteEnvelopeV1,
  type StorefrontCartQuoteRequestV1,
} from "../../../packages/storefront-contracts/src/cart-checkout.js";
import type { StorefrontPublicRepository } from "./public.js";

export interface StorefrontCartQuoteAuthorityPort {
  quote(input: {
    readonly context: StorefrontHostContextV1;
    readonly request: StorefrontCartQuoteRequestV1;
  }): Promise<unknown>;
}

export interface StorefrontCartQuoteBoundaryOptions {
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
        `Cart quote authority returned mismatched storefront context: ${key}.`,
      );
    }
  }
}

function logicalLine(productId: string, variantId: string): string {
  return `${productId}:${variantId}`;
}

function assertQuoteMatchesIntent(
  request: StorefrontCartQuoteRequestV1,
  envelope: StorefrontCartQuoteEnvelopeV1,
): void {
  if (envelope.cartRevision !== request.cartRevision) {
    throw new StorefrontContractError(
      "Cart quote authority returned a stale cart revision.",
    );
  }
  if (BigInt(envelope.quote.quoteRevision) < 1n) {
    throw new StorefrontContractError(
      "Cart quote authority returned an invalid quote revision.",
    );
  }
  if (envelope.quote.lines.length !== request.lines.length) {
    throw new StorefrontContractError(
      "Cart quote authority returned a different line count.",
    );
  }

  const requestLines = new Map(
    request.lines.map((line) => [
      logicalLine(line.productId, line.variantId),
      line.quantity.amount,
    ]),
  );
  const quotedLines = new Map<string, string>();
  for (const line of envelope.quote.lines) {
    const key = logicalLine(line.productId, line.variantId);
    if (quotedLines.has(key)) {
      throw new StorefrontContractError(
        "Cart quote authority returned a duplicate product variant.",
      );
    }
    quotedLines.set(key, line.quantity);
  }

  if (requestLines.size !== quotedLines.size) {
    throw new StorefrontContractError(
      "Cart quote authority returned mismatched cart lines.",
    );
  }
  for (const [key, quantity] of requestLines) {
    if (quotedLines.get(key) !== quantity) {
      throw new StorefrontContractError(
        "Cart quote authority returned mismatched cart identity or quantity.",
      );
    }
  }
}

export async function resolveStorefrontCartQuote(
  repository: Pick<StorefrontPublicRepository, "resolveBootstrap">,
  authority: StorefrontCartQuoteAuthorityPort,
  hostname: string,
  payload: unknown,
  options: StorefrontCartQuoteBoundaryOptions = {},
): Promise<StorefrontCartQuoteEnvelopeV1 | null> {
  const normalizedHostname = normalizeStorefrontHostname(hostname);
  const request = parseStorefrontCartQuoteRequestV1(payload);
  const bootstrap = await repository.resolveBootstrap(normalizedHostname);
  if (!bootstrap) return null;
  if (bootstrap.context.requestHostname !== normalizedHostname) {
    throw new StorefrontContractError(
      "Storefront bootstrap returned a mismatched request hostname.",
    );
  }

  const envelope = parseStorefrontCartQuoteEnvelopeV1(
    await authority.quote({ context: bootstrap.context, request }),
  );
  assertContextMatches(envelope.context, bootstrap.context);
  assertQuoteMatchesIntent(request, envelope);

  const now = Date.parse((options.now ?? (() => new Date().toISOString()))());
  const expiresAt = Date.parse(envelope.quote.expiresAt);
  if (!Number.isFinite(now) || expiresAt <= now) {
    throw new StorefrontContractError(
      "Cart quote authority returned an expired quote.",
    );
  }

  return envelope;
}
