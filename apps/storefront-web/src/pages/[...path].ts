import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { enrichStorefrontProductMedia } from "../product-media-response.js";
import { enrichStorefrontProductStructuredData } from "../product-structured-response.js";
import { bindStorefrontPublicCacheGeneration } from "../public-cache-response.js";
import { handleStorefrontSeoRoute } from "../seo-route.js";
import storefrontWorker, {
  type StorefrontWorkerBindings,
} from "../worker.js";

export const prerender = false;

export const ALL: APIRoute = async ({ request }) => {
  const bindings = env as StorefrontWorkerBindings;
  const seoResponse = await handleStorefrontSeoRoute(request, bindings);
  if (seoResponse) {
    return await bindStorefrontPublicCacheGeneration(
      request,
      bindings,
      seoResponse,
    );
  }
  const shellResponse = await storefrontWorker.fetch(request, bindings);
  const mediaResponse = await enrichStorefrontProductMedia(
    request,
    bindings,
    shellResponse,
  );
  const structuredResponse = await enrichStorefrontProductStructuredData(
    request,
    bindings,
    mediaResponse,
  );
  return await bindStorefrontPublicCacheGeneration(
    request,
    bindings,
    structuredResponse,
  );
};
