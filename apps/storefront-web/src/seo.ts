import type { StorefrontPublicProductDetailV1 } from "../../../packages/storefront-contracts/src/public-catalog.js";
import type { StorefrontPublicSeoBundleV1 } from "../../../packages/storefront-contracts/src/public-seo.js";
import { StorefrontContractError } from "../../../packages/storefront-contracts/src/index.js";

const RESERVED_DISCOVERY_PREFIXES = [
  "/api",
  "/checkout",
  "/account",
  "/admin",
  "/__",
  "/_astro",
] as const;

export function normalizeStorefrontCanonicalPath(value: string): string {
  const path = value.trim();
  if (
    path.length === 0 ||
    path.length > 2_048 ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    /[\u0000-\u001f\u007f]/u.test(path) ||
    /%(?:2e|2f|5c)/iu.test(path)
  ) {
    throw new StorefrontContractError("Storefront canonical path is invalid.");
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new StorefrontContractError("Storefront canonical path is invalid.");
  }
  const normalized = path.replace(/\/{2,}/gu, "/");
  return normalized.length > 1 ? normalized.replace(/\/+$/u, "") : "/";
}

export function isStorefrontDiscoveryPath(path: string): boolean {
  const normalized = normalizeStorefrontCanonicalPath(path);
  return !RESERVED_DISCOVERY_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

function absoluteUrl(hostname: string, path: string): string {
  return `https://${hostname}${normalizeStorefrontCanonicalPath(path)}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function sitemapDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function renderStorefrontRobotsTxt(
  bundle: StorefrontPublicSeoBundleV1,
): string {
  const lines = ["User-agent: *"];
  if (!bundle.indexable) {
    lines.push("Disallow: /");
  } else {
    lines.push("Allow: /");
    for (const path of [...bundle.disallow].sort()) {
      lines.push(`Disallow: ${normalizeStorefrontCanonicalPath(path)}`);
    }
  }
  lines.push(
    `Sitemap: ${absoluteUrl(bundle.context.canonicalHostname, bundle.sitemapPath)}`,
  );
  return `${lines.join("\n")}\n`;
}

export function renderStorefrontSitemapXml(
  bundle: StorefrontPublicSeoBundleV1,
): string {
  const entries: StorefrontPublicSeoBundleV1["entries"][number][] = bundle.indexable
    ? [...bundle.entries]
        .filter(({ path }) => isStorefrontDiscoveryPath(path))
        .sort((left, right) => left.path.localeCompare(right.path))
    : [];
  const urls = entries
    .map((entry) => {
      const fields = [
        `<loc>${escapeXml(absoluteUrl(bundle.context.canonicalHostname, entry.path))}</loc>`,
        entry.lastModified
          ? `<lastmod>${sitemapDate(entry.lastModified)}</lastmod>`
          : null,
        `<changefreq>${entry.changeFrequency}</changefreq>`,
      ].filter((field): field is string => field !== null);
      return `  <url>${fields.join("")}</url>`;
    })
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
}

function exactDecimal(minor: string, scale: number): string {
  const value = BigInt(minor);
  const sign = value < 0n ? "-" : "";
  const digits = (value < 0n ? -value : value).toString();
  if (scale === 0) return `${sign}${digits}`;
  const padded = digits.padStart(scale + 1, "0");
  return `${sign}${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

function schemaAvailability(
  availability: StorefrontPublicProductDetailV1["product"]["summary"]["availability"],
): string | undefined {
  switch (availability) {
    case "available":
      return "https://schema.org/InStock";
    case "limited":
      return "https://schema.org/LimitedAvailability";
    case "preorder":
      return "https://schema.org/PreOrder";
    case "unavailable":
      return "https://schema.org/OutOfStock";
    case "unknown":
      return undefined;
  }
}

function structuredImage(
  hostname: string,
  source: string | undefined,
): string | undefined {
  if (!source) return undefined;
  if (source.startsWith("/")) return absoluteUrl(hostname, source);
  const url = new URL(source);
  if (url.protocol !== "https:") return undefined;
  return url.toString();
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function serializeStorefrontProductStructuredData(
  detail: StorefrontPublicProductDetailV1,
): string {
  const { context, product } = detail;
  const { summary } = product;
  const image = structuredImage(context.canonicalHostname, summary.media?.src);
  const availability = schemaAvailability(summary.availability);
  const payload = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: summary.name,
    url: absoluteUrl(context.canonicalHostname, `/products/${summary.slug}`),
    sku: product.variants[0]?.sku ?? product.code,
    ...(product.description ? { description: product.description } : {}),
    ...(image ? { image: [image] } : {}),
    offers: {
      "@type": "Offer",
      url: absoluteUrl(context.canonicalHostname, `/products/${summary.slug}`),
      priceCurrency: summary.price.currency,
      price: exactDecimal(summary.price.minor, summary.price.scale),
      ...(availability ? { availability } : {}),
      itemCondition: "https://schema.org/NewCondition",
    },
  };
  return safeJson(payload);
}

export function renderStorefrontProductStructuredData(
  detail: StorefrontPublicProductDetailV1,
): string {
  return `<script type="application/ld+json">${serializeStorefrontProductStructuredData(detail)}</script>`;
}
