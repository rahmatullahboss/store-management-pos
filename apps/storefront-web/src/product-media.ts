export interface StorefrontImageTransformOptions {
  readonly width?: number;
  readonly quality?: number;
  readonly format?: "auto" | "webp" | "avif";
  readonly fit?: "scale-down" | "contain" | "cover" | "pad";
}

export interface StorefrontImageDeliveryContext {
  readonly enabled?: boolean;
  readonly allowedHosts?: readonly string[];
  readonly development?: boolean;
}

export const STOREFRONT_PRODUCT_IMAGE_FALLBACK = "/evidence/placeholder-product.svg";
export const STOREFRONT_PRODUCT_IMAGE_WIDTHS = Object.freeze([320, 480, 640, 960, 1280]);

const CONTROL = /[\u0000-\u001f\u007f]/u;
const NON_RESIZABLE = /\.(?:svg|svgz|ico)$/iu;

function normalizeHost(value: string): string {
  const raw = value.trim().toLowerCase();
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function normalizeStorefrontMediaSource(value: string | null | undefined): string {
  const source = typeof value === "string" ? value.trim() : "";
  if (!source) return "";
  if (source.length > 2_048 || CONTROL.test(source)) return "";

  if (source.startsWith("/") && !source.startsWith("//")) {
    if (source.includes("\\") || source.includes("#")) return "";
    return source;
  }

  try {
    const url = new URL(source);
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.hash.length > 0
    ) {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

function normalizedOptions(options: StorefrontImageTransformOptions): Required<StorefrontImageTransformOptions> {
  const width = options.width ?? 640;
  const quality = options.quality ?? 82;
  const format = options.format ?? "auto";
  const fit = options.fit ?? "scale-down";
  if (!Number.isInteger(width) || width < 64 || width > 2_048) {
    throw new RangeError("Storefront image width must be between 64 and 2048 pixels.");
  }
  if (!Number.isInteger(quality) || quality < 40 || quality > 95) {
    throw new RangeError("Storefront image quality must be between 40 and 95.");
  }
  return { width, quality, format, fit };
}

function cloudflareParameters(options: Required<StorefrontImageTransformOptions>): string {
  return [
    "onerror=redirect",
    `width=${options.width}`,
    `quality=${options.quality}`,
    `format=${options.format}`,
    `fit=${options.fit}`,
  ].join(",");
}

function canResizeAbsolute(url: URL, context: StorefrontImageDeliveryContext): boolean {
  const allowed = new Set(
    (context.allowedHosts ?? []).map(normalizeHost).filter((host) => host.length > 0),
  );
  return allowed.size > 0 && allowed.has(url.hostname.toLowerCase());
}

export function buildStorefrontProductImageUrl(
  value: string | null | undefined,
  options: StorefrontImageTransformOptions = {},
  context: StorefrontImageDeliveryContext = {},
  fallback = STOREFRONT_PRODUCT_IMAGE_FALLBACK,
): string {
  const normalizedFallback = normalizeStorefrontMediaSource(fallback);
  const source = normalizeStorefrontMediaSource(value) || normalizedFallback;
  if (!source) return "";

  const path = (() => {
    try {
      return new URL(source).pathname;
    } catch {
      return source.split("?", 1)[0] ?? source;
    }
  })();
  if (NON_RESIZABLE.test(path) || context.enabled === false) return source;

  const transform = normalizedOptions(options);
  const parameters = cloudflareParameters(transform);
  if (source.startsWith("https://")) {
    const url = new URL(source);
    if (!canResizeAbsolute(url, context)) return source;
    return `${url.origin}/cdn-cgi/image/${parameters}${url.pathname}${url.search}`;
  }

  if (context.development) return source;
  return `/cdn-cgi/image/${parameters}${source}`;
}

export function buildStorefrontProductImageSrcSet(
  value: string | null | undefined,
  widths: readonly number[] = STOREFRONT_PRODUCT_IMAGE_WIDTHS,
  options: Omit<StorefrontImageTransformOptions, "width"> = {},
  context: StorefrontImageDeliveryContext = {},
): string {
  const source = normalizeStorefrontMediaSource(value);
  if (!source || NON_RESIZABLE.test(source.split(/[?#]/u, 1)[0] ?? source)) return "";

  const unique = [...new Set(widths)];
  if (
    unique.length === 0 ||
    unique.length > 8 ||
    unique.some((width) => !Number.isInteger(width) || width < 64 || width > 2_048)
  ) {
    throw new RangeError("Storefront image srcset widths are invalid.");
  }

  return unique
    .sort((left, right) => left - right)
    .map((width) => `${buildStorefrontProductImageUrl(source, { ...options, width }, context, "")} ${width}w`)
    .filter((entry) => !entry.startsWith(" "))
    .join(", ");
}
