import {
  createStorefrontClient,
  StorefrontClientError,
  type StorefrontClient,
  type StorefrontTransport,
} from "../../../packages/storefront-client/src/index.js";
import type { StorefrontBootstrapV1 } from "../../../packages/storefront-contracts/src/index.js";

export interface StorefrontResolveOptions {
  readonly signal?: AbortSignal;
}

export interface StorefrontHostResolver {
  resolve(
    requestHostname: string,
    options?: StorefrontResolveOptions,
  ): Promise<StorefrontBootstrapV1 | null>;
}

export function createStorefrontHostResolver(
  client: StorefrontClient,
): StorefrontHostResolver {
  return Object.freeze({
    async resolve(
      requestHostname: string,
      options: StorefrontResolveOptions = {},
    ): Promise<StorefrontBootstrapV1 | null> {
      try {
        const requestOptions = options.signal
          ? { signal: options.signal }
          : undefined;
        return await client.getBootstrap(requestHostname, requestOptions);
      } catch (error: unknown) {
        if (error instanceof StorefrontClientError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
  });
}

export function createStorefrontTransportResolver(options: {
  readonly baseUrl: string;
  readonly transport: StorefrontTransport;
  readonly timeoutMs?: number;
}): StorefrontHostResolver {
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
  return createStorefrontHostResolver(createStorefrontClient(clientOptions));
}
