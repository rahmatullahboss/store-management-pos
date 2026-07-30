import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { handleStorefrontSeoRoute } from "../seo-route.js";
import storefrontWorker, {
  type StorefrontWorkerBindings,
} from "../worker.js";

export const prerender = false;

export const ALL: APIRoute = async ({ request }) => {
  const bindings = env as StorefrontWorkerBindings;
  const seoResponse = await handleStorefrontSeoRoute(request, bindings);
  return seoResponse ?? storefrontWorker.fetch(request, bindings);
};
