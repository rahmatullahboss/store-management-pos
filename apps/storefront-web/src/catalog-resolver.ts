import {
  createStorefrontClient,
  StorefrontClientError,
  type StorefrontCatalogRequestOptions,
  type StorefrontClient,
  type StorefrontTransport,
} from "../../../packages/storefront-client/src/index.js";
import {
  requestStorefrontPublicSearch,
  type StorefrontPublicSearchClientConfiguration,
  type StorefrontPublicSearchClientOptions,
} from "../../../packages/storefront-client/src/public-search.js";
import type {
  StorefrontPublicCatalogPageV1,
  StorefrontPublicProductDetailV1,
} from "../../../packages/storefront-contracts/src/public-catalog.js";
import type {
  StorefrontPublicCategoryPageV1,
  StorefrontPublicCollectionPageV1,
  StorefrontPublicSearchPageV1,
} from "../../../packages/storefront-contracts/src/public-discovery.js";

export interface StorefrontSearchRequestOptions
  extends StorefrontCatalogRequestOptions,
    Pick<
      StorefrontPublicSearchClientOptions,
      "category" | "availability"
    > {}

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
  resolveCategory(
    requestHostname: string,
    publicSlug: string,
    options?: StorefrontCatalogRequestOptions,
  ): Promise<StorefrontPublicCategoryPageV1 | null>;
  resolveCollection(
    requestHostname: string,
    publicSlug: string,
    options?: StorefrontCatalogRequestOptions,
  ): Promise<StorefrontPublicCollectionPageV1 | null>;
  resolveSearch(
    requestHostname: string,
    query: string,
    options?: StorefrontSearchRequestOptions,
  ): Promise<StorefrontPublicSearchPageV1 | null>;
}

async function publicRead<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (error instanceof StorefrontClientError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export function createStorefrontCatalogResolver(
  client: StorefrontClient,
  searchConfiguration?: StorefrontPublicSearchClientConfiguration,
): StorefrontCatalogResolver {
  return Object.freeze({
    async resolveCatalog(
      requestHostname: string,
      options: StorefrontCatalogRequestOptions = {},
    ): Promise<StorefrontPublicCatalogPageV1 | null> {
      return await publicRead(() => client.getCatalog(requestHostname, options));
    },

    async resolveProduct(
      requestHostname: string,
      publicSlug: string,
      options: { readonly signal?: AbortSignal } = {},
    ): Promise<StorefrontPublicProductDetailV1 | null> {
      return await publicRead(() =>
        client.getProduct(requestHostname, publicSlug, options)
      );
    },

    async resolveCategory(
      requestHostname: string,
      publicSlug: string,
      options: StorefrontCatalogRequestOptions = {},
    ): Promise<StorefrontPublicCategoryPageV1 | null> {
      return await publicRead(() =>
        client.getCategory(requestHostname, publicSlug, options)
      );
    },

    async resolveCollection(
      requestHostname: string,
      publicSlug: string,
      options: StorefrontCatalogRequestOptions = {},
    ): Promise<StorefrontPublicCollectionPageV1 | null> {
      return await publicRead(() =>
        client.getCollection(requestHostname, publicSlug, options)
      );
    },

    async resolveSearch(
      requestHostname: string,
      query: string,
      options: StorefrontSearchRequestOptions = {},
    ): Promise<StorefrontPublicSearchPageV1 | null> {
      if (searchConfiguration) {
        return await publicRead(() =>
          requestStorefrontPublicSearch(
            searchConfiguration,
            requestHostname,
            query,
            options,
          )
        );
      }
      return await publicRead(() => client.search(requestHostname, query, options));
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
  return createStorefrontCatalogResolver(
    createStorefrontClient(clientOptions),
    clientOptions,
  );
}
