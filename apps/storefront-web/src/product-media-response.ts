import type { StorefrontTransport } from "../../../packages/storefront-client/src/index.js";
import { requestStorefrontPublicMedia } from "../../../packages/storefront-client/src/public-media.js";
import { normalizeStorefrontHostname } from "../../../packages/storefront-contracts/src/index.js";
import {
  buildStorefrontProductImageSrcSet,
  buildStorefrontProductImageUrl,
} from "./product-media.js";

export interface StorefrontProductMediaBindings {
  readonly STOREFRONT_API_BASE_URL: string;
  readonly STOREFRONT_API?: StorefrontTransport;
}

const PRODUCT_DETAIL = /^\/products\/([^/]+)$/u;
const PLACEHOLDER =
  /<div class="product-media product-media-large" aria-hidden="true"><span>[^<]*<\/span><\/div>/u;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function decodedSlug(pathname: string): string | null {
  const match = pathname.match(PRODUCT_DETAIL);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]).trim().toLowerCase();
  } catch {
    return null;
  }
}

function transport(value: unknown): StorefrontTransport | undefined {
  return typeof value === "object" && value !== null && "fetch" in value &&
      typeof value.fetch === "function"
    ? value as StorefrontTransport
    : undefined;
}

async function weakEtag(scope: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(scope),
  );
  const prefix = Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `W/\"${prefix}\"`;
}

function mediaHtml(input: {
  readonly src: string;
  readonly srcset: string;
  readonly alt: string;
}): string {
  const srcset = input.srcset
    ? ` srcset="${escapeHtml(input.srcset)}"`
    : "";
  return `<figure class="product-media product-media-large" style="overflow:hidden;aspect-ratio:1/1"><img src="${escapeHtml(input.src)}"${srcset} sizes="(max-width: 48rem) calc(100vw - 2rem), 50vw" alt="${escapeHtml(input.alt)}" loading="eager" decoding="async" fetchpriority="high" style="display:block;width:100%;height:100%;object-fit:contain;background:var(--storefront-surface)"></figure>`;
}

export async function enrichStorefrontProductMedia(
  request: Request,
  bindings: StorefrontProductMediaBindings,
  response: Response,
): Promise<Response> {
  if (
    response.status !== 200 ||
    (request.method !== "GET" && request.method !== "HEAD")
  ) {
    return response;
  }
  const url = new URL(request.url);
  const slug = decodedSlug(url.pathname);
  if (!slug) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (request.method === "GET" && !contentType.includes("text/html")) {
    return response;
  }

  try {
    const storefrontTransport = transport(bindings.STOREFRONT_API);
    const manifest = await requestStorefrontPublicMedia(
      {
        baseUrl: bindings.STOREFRONT_API_BASE_URL,
        ...(storefrontTransport ? { transport: storefrontTransport } : {}),
        timeoutMs: 1_500,
      },
      normalizeStorefrontHostname(url.hostname),
      slug,
      request.signal,
    );
    const primary = manifest.items[0];
    if (!primary) return response;

    const src = buildStorefrontProductImageUrl(primary.src, {
      width: 960,
      quality: manifest.delivery.quality,
      format: "auto",
      fit: manifest.delivery.fit,
    });
    const srcset = buildStorefrontProductImageSrcSet(
      primary.src,
      manifest.delivery.widths,
      {
        quality: manifest.delivery.quality,
        format: "auto",
        fit: manifest.delivery.fit,
      },
    );
    const headers = new Headers(response.headers);
    headers.set(
      "ETag",
      await weakEtag(
        `${headers.get("etag") ?? "no-etag"}:media:${manifest.productId}:${manifest.revision}`,
      ),
    );
    headers.set("X-Storefront-Media-State", "resolved");
    if (request.method === "HEAD") {
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    const html = await response.text();
    if (!PLACEHOLDER.test(html)) {
      headers.set("X-Storefront-Media-State", "placeholder-missing");
      return new Response(html, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return new Response(
      html.replace(PLACEHOLDER, mediaHtml({ src, srcset, alt: primary.alt })),
      {
        status: response.status,
        statusText: response.statusText,
        headers,
      },
    );
  } catch {
    const headers = new Headers(response.headers);
    headers.set("X-Storefront-Media-State", "fallback");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
