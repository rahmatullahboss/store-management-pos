import {
  StorefrontContractError,
  parseStorefrontHostContextV1,
  type StorefrontHostContextV1,
} from "./index.js";

export interface StorefrontPublicMediaItemV1 {
  readonly mediaId: string;
  readonly variantId: string | null;
  readonly src: string;
  readonly alt: string;
  readonly sortOrder: number;
  readonly createdAt: string;
}

export interface StorefrontPublicMediaDeliveryV1 {
  readonly widths: readonly number[];
  readonly formats: readonly ["avif", "webp", "auto"];
  readonly fit: "scale-down";
  readonly quality: number;
  readonly lowBandwidthWidth: number;
  readonly fallback: "original";
}

export interface StorefrontPublicMediaManifestV1 {
  readonly contractVersion: "storefront-public-media.v1";
  readonly context: StorefrontHostContextV1;
  readonly productId: string;
  readonly slug: string;
  readonly revision: string;
  readonly items: readonly StorefrontPublicMediaItemV1[];
  readonly delivery: StorefrontPublicMediaDeliveryV1;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SLUG = /^[a-z0-9](?:[a-z0-9._~-]{0,178}[a-z0-9])?$/u;
const REVISION = /^[a-f0-9]{32,64}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorefrontContractError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") {
    throw new StorefrontContractError(`${label} must be a string.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || CONTROL.test(normalized)) {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  return normalized;
}

function uuid(value: unknown, label: string): string {
  const normalized = text(value, label, 36).toLowerCase();
  if (!UUID.test(normalized)) {
    throw new StorefrontContractError(`${label} must be a UUID.`);
  }
  return normalized;
}

function source(value: unknown): string {
  const normalized = text(value, "media.src", 2_048);
  if (normalized.startsWith("/") && !normalized.startsWith("//")) {
    if (normalized.includes("\\") || normalized.includes("#")) {
      throw new StorefrontContractError("media.src is invalid.");
    }
    return normalized;
  }
  try {
    const url = new URL(normalized);
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.hash.length > 0
    ) {
      throw new Error("unsafe");
    }
    return url.toString();
  } catch {
    throw new StorefrontContractError("media.src is invalid.");
  }
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new StorefrontContractError(`${label} is outside the supported range.`);
  }
  return value as number;
}

function instant(value: unknown): string {
  const normalized = text(value, "media.createdAt", 80);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw new StorefrontContractError("media.createdAt must be an ISO timestamp.");
  }
  return new Date(parsed).toISOString();
}

function parseItem(value: unknown): StorefrontPublicMediaItemV1 {
  const item = record(value, "media item");
  return Object.freeze({
    mediaId: uuid(item.mediaId, "media.mediaId"),
    variantId:
      item.variantId === null || item.variantId === undefined
        ? null
        : uuid(item.variantId, "media.variantId"),
    src: source(item.src),
    alt: text(item.alt, "media.alt", 300),
    sortOrder: integer(item.sortOrder, "media.sortOrder", -1_000_000, 1_000_000),
    createdAt: instant(item.createdAt),
  });
}

const DELIVERY: StorefrontPublicMediaDeliveryV1 = Object.freeze({
  widths: Object.freeze([320, 480, 640, 960, 1280]),
  formats: Object.freeze(["avif", "webp", "auto"] as const),
  fit: "scale-down",
  quality: 82,
  lowBandwidthWidth: 320,
  fallback: "original",
});

export function parseStorefrontPublicMediaManifestV1(
  value: unknown,
): StorefrontPublicMediaManifestV1 {
  const sourceDocument = record(value, "media manifest");
  if (sourceDocument.contractVersion !== "storefront-public-media.v1") {
    throw new StorefrontContractError("Unsupported storefront media contract.");
  }
  const context = parseStorefrontHostContextV1(sourceDocument.context);
  const productId = uuid(sourceDocument.productId, "media.productId");
  const slug = text(sourceDocument.slug, "media.slug", 180).toLowerCase();
  if (!SLUG.test(slug) || slug === "." || slug === "..") {
    throw new StorefrontContractError("media.slug is invalid.");
  }
  const revision = text(sourceDocument.revision, "media.revision", 64).toLowerCase();
  if (!REVISION.test(revision)) {
    throw new StorefrontContractError("media.revision is invalid.");
  }
  if (!Array.isArray(sourceDocument.items) || sourceDocument.items.length > 24) {
    throw new StorefrontContractError("media.items are invalid.");
  }
  const identities = new Set<string>();
  const items = Object.freeze(sourceDocument.items.map((entry) => {
    const item = parseItem(entry);
    if (identities.has(item.mediaId)) {
      throw new StorefrontContractError("media.items contain a duplicate media ID.");
    }
    identities.add(item.mediaId);
    return item;
  }));
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1]!;
    const current = items[index]!;
    if (
      previous.sortOrder > current.sortOrder ||
      (previous.sortOrder === current.sortOrder && previous.mediaId.localeCompare(current.mediaId) > 0)
    ) {
      throw new StorefrontContractError("media.items are not deterministically ordered.");
    }
  }
  return Object.freeze({
    contractVersion: "storefront-public-media.v1",
    context,
    productId,
    slug,
    revision,
    items,
    delivery: DELIVERY,
  });
}
