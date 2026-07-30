import {
  createStorefrontClient,
  StorefrontClientError,
  type StorefrontClient,
  type StorefrontTransport,
} from "../../../packages/storefront-client/src/index.js";
import type { StorefrontPublicContentBundleV1 } from "../../../packages/storefront-contracts/src/public-content.js";

export interface StorefrontContentResolveOptions {
  readonly signal?: AbortSignal;
  readonly slug?: string;
}

export interface StorefrontContentResolver {
  resolve(
    requestHostname: string,
    options?: StorefrontContentResolveOptions,
  ): Promise<StorefrontPublicContentBundleV1 | null>;
}

export function createStorefrontContentResolver(
  client: StorefrontClient,
): StorefrontContentResolver {
  return Object.freeze({
    async resolve(
      requestHostname: string,
      options: StorefrontContentResolveOptions = {},
    ): Promise<StorefrontPublicContentBundleV1 | null> {
      try {
        const requestOptions = {
          ...(options.signal ? { signal: options.signal } : {}),
          ...(options.slug ? { slug: options.slug } : {}),
        };
        return await client.getContent(requestHostname, requestOptions);
      } catch (error: unknown) {
        if (error instanceof StorefrontClientError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
  });
}

export function createStorefrontContentTransportResolver(options: {
  readonly baseUrl: string;
  readonly transport: StorefrontTransport;
  readonly timeoutMs?: number;
}): StorefrontContentResolver {
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
  return createStorefrontContentResolver(createStorefrontClient(clientOptions));
}
