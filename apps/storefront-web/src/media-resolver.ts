import {
  StorefrontClientError,
  type StorefrontTransport,
} from "../../../packages/storefront-client/src/index.js";
import {
  requestStorefrontPublicMedia,
  type StorefrontPublicMediaClientConfiguration,
} from "../../../packages/storefront-client/src/public-media.js";
import type { StorefrontPublicMediaManifestV1 } from "../../../packages/storefront-contracts/src/public-media.js";

export interface StorefrontMediaResolver {
  resolveProductMedia(
    requestHostname: string,
    publicSlug: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<StorefrontPublicMediaManifestV1 | null>;
}

export function createStorefrontMediaResolver(
  configuration: StorefrontPublicMediaClientConfiguration,
): StorefrontMediaResolver {
  return Object.freeze({
    async resolveProductMedia(
      requestHostname: string,
      publicSlug: string,
      options: { readonly signal?: AbortSignal } = {},
    ): Promise<StorefrontPublicMediaManifestV1 | null> {
      try {
        return await requestStorefrontPublicMedia(
          configuration,
          requestHostname,
          publicSlug,
          options.signal,
        );
      } catch (error: unknown) {
        if (error instanceof StorefrontClientError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
  });
}

export function createStorefrontMediaTransportResolver(options: {
  readonly baseUrl: string;
  readonly transport: StorefrontTransport;
  readonly timeoutMs?: number;
}): StorefrontMediaResolver {
  return createStorefrontMediaResolver({
    baseUrl: options.baseUrl,
    transport: options.transport,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}
