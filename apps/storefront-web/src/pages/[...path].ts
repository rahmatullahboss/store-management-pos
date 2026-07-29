import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import storefrontWorker, {
  type StorefrontWorkerBindings,
} from "../worker.js";

export const prerender = false;

export const ALL: APIRoute = async ({ request }) =>
  storefrontWorker.fetch(request, env as StorefrontWorkerBindings);
