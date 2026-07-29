import type { APIRoute } from "astro";
import storefrontWorker, {
  type StorefrontWorkerBindings,
} from "../worker.js";

export const prerender = false;

interface CloudflareAstroLocals {
  readonly runtime?: {
    readonly env?: StorefrontWorkerBindings;
  };
}

export const ALL: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as CloudflareAstroLocals).runtime;
  const bindings = runtime?.env ?? ({} as StorefrontWorkerBindings);
  return storefrontWorker.fetch(request, bindings);
};
