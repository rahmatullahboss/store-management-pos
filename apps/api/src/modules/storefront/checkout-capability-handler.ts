import {
  StorefrontContractError,
  normalizeStorefrontHostname,
} from "../../../../../packages/storefront-contracts/src/index.js";
import { parseStorefrontCheckoutCapabilityRequestV1 } from "../../../../../packages/storefront-contracts/src/checkout-capabilities.js";
import type { StorefrontPublicRepository } from "../../../../../modules/storefront/src/public.js";
import {
  resolveStorefrontCheckoutCapabilities,
  type StorefrontCheckoutCapabilityAuthorityPort,
} from "../../../../../modules/storefront/src/checkout-capabilities.js";

const MAX_BODY_BYTES = 64 * 1024;

function jsonHeaders(): Headers {
  return new Headers({
    "Cache-Control": "private, no-cache, no-store, must-revalidate",
    "Content-Type": "application/json; charset=utf-8",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders(),
  });
}

async function boundedJson(request: Request): Promise<unknown> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new StorefrontContractError(
      "Storefront checkout capability request requires application/json.",
    );
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_BODY_BYTES) {
      throw new StorefrontContractError(
        "Storefront checkout capability request body is too large.",
      );
    }
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new StorefrontContractError(
      "Storefront checkout capability request body is too large.",
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new StorefrontContractError(
      "Storefront checkout capability request body is invalid JSON.",
    );
  }
}

export async function handleStorefrontCheckoutCapabilityRequest(
  repository: Pick<StorefrontPublicRepository, "resolveBootstrap">,
  authority: StorefrontCheckoutCapabilityAuthorityPort,
  request: Request,
  url: URL,
): Promise<Response> {
  if (request.method !== "POST") {
    const headers = jsonHeaders();
    headers.set("Allow", "POST");
    return new Response(
      JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED" } }),
      { status: 405, headers },
    );
  }

  try {
    const hostname = normalizeStorefrontHostname(
      url.searchParams.get("hostname") ?? "",
    );
    const payload = parseStorefrontCheckoutCapabilityRequestV1(
      await boundedJson(request),
    );
    const envelope = await resolveStorefrontCheckoutCapabilities(
      repository,
      authority,
      hostname,
      payload,
    );
    if (!envelope) {
      return jsonResponse({ error: { code: "STOREFRONT_NOT_FOUND" } }, 404);
    }
    return jsonResponse(envelope);
  } catch (error: unknown) {
    if (error instanceof StorefrontContractError) {
      return jsonResponse(
        {
          error: {
            code: "INVALID_CHECKOUT_CAPABILITY_REQUEST",
            message: error.message,
          },
        },
        400,
      );
    }
    throw error;
  }
}
