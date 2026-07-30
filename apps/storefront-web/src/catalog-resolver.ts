import {
  createStorefrontClient,
  StorefrontClientError,
  type StorefrontCatalogRequestOptions,
  type StorefrontClient,
  type StorefrontTransport,
} from "../../../packages/storefront-client/src/index.js";
import type {
  StorefrontPublicCatalogPageV1,
  StorefrontPublicProductDetailV1,
} from "../../../packages/storefront-contracts/src/public-catalog.js";

export interface StorefrontCatalogResolver {
  resolveCatalog(
    requestHostname: string,
    options?: StorefrontCatalogRequestOptions,
  ): Promise<StorefrontPublicCatalogPageV1 | null>;
  resolveProduct(
    requestHostname: string,
    publicSlug: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<StorefrontPublicProductDetailV1 | null>;
}

export function createStorefrontCatalogResolver(
  client: StorefrontClient,
): StorefrontCatalogResolver {
  return Object.freeze({
    async resolveCatalog(
      requestHostname: string,
      options: StorefrontCatalogRequestOptions = {},
    ): Promise<StorefrontPublicCatalogPageV1 | null> {
      try {
        return await client.getCatalog(requestHostname, options);
      } catch (error: unknown) {
        if (error instanceof StorefrontClientError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },

    async resolveProduct(
      requestHostname: string,
      publicSlug: string,
      options: { readonly signal?: AbortSignal } = {},
    ): Promise<StorefrontPublicProductDetailV1 | null> {
      try {
        return await client.getProduct(requestHostname, publicSlug, options);
      } catch (error: unknown) {
        if (error instanceof StorefrontClientError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
  });
}

export function createStorefrontCatalogTransportResolver(options: {
  readonly baseUrl: string;
  readonly transport: StorefrontTransport;
  readonly timeoutMs?: number;
}): StorefrontCatalogResolver {
  const clientOptions = options.timeoutMs
    ? {
        baseUrl: options.baseUrl,
        transport: options.transport,
        timeoutMs: options.timeoutMs,
      }
    : {
        baseUrl: options.baseUrl,
        transport: options.transport,
      };
  return createStorefrontCatalogResolver(createStorefrontClient(clientOptions));
}
