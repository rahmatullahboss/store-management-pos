import {
  StorefrontContractError,
  parseStorefrontHostContextV1,
  type StorefrontHostContextV1,
} from "./index.js";

export type StorefrontPublicSitemapKindV1 =
  | "home"
  | "product"
  | "category"
  | "collection"
  | "content";

export type StorefrontPublicChangeFrequencyV1 =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

export interface StorefrontPublicSitemapEntryV1 {
  readonly kind: StorefrontPublicSitemapKindV1;
  readonly path: string;
  readonly lastModified: string | null;
  readonly changeFrequency: StorefrontPublicChangeFrequencyV1;
}

export interface StorefrontPublicSeoBundleV1 {
  readonly contractVersion: "storefront-public-seo.v1";
  readonly context: StorefrontHostContextV1;
  readonly indexable: boolean;
  readonly sitemapPath: "/sitemap.xml";
  readonly disallow: readonly string[];
  readonly entries: readonly StorefrontPublicSitemapEntryV1[];
}

const KINDS: readonly StorefrontPublicSitemapKindV1[] = [
  "home",
  "product",
  "category",
  "collection",
  "content",
];
const FREQUENCIES: readonly StorefrontPublicChangeFrequencyV1[] = [
  "always",
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "never",
];
const CONTROL = /[\u0000-\u001f\u007f]/u;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorefrontContractError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new StorefrontContractError(`${label} is unsupported.`);
  }
  return value as T;
}

function publicPath(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new StorefrontContractError(`${label} must be a string.`);
  }
  const path = value.trim();
  if (
    path.length === 0 ||
    path.length > 2_048 ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    CONTROL.test(path) ||
    /%(?:2e|2f|5c)/iu.test(path)
  ) {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  return path;
}

function lastModified(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 40) {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  return parsed.toISOString();
}

function parseEntry(
  value: unknown,
  index: number,
): StorefrontPublicSitemapEntryV1 {
  const source = asRecord(value, `seo.entries[${index}]`);
  return Object.freeze({
    kind: enumValue(source.kind, KINDS, `seo.entries[${index}].kind`),
    path: publicPath(source.path, `seo.entries[${index}].path`),
    lastModified: lastModified(
      source.lastModified,
      `seo.entries[${index}].lastModified`,
    ),
    changeFrequency: enumValue(
      source.changeFrequency,
      FREQUENCIES,
      `seo.entries[${index}].changeFrequency`,
    ),
  });
}

export function parseStorefrontPublicSeoBundleV1(
  value: unknown,
): StorefrontPublicSeoBundleV1 {
  const source = asRecord(value, "seo");
  if (source.contractVersion !== "storefront-public-seo.v1") {
    throw new StorefrontContractError("Unsupported storefront public SEO contract.");
  }
  if (typeof source.indexable !== "boolean") {
    throw new StorefrontContractError("seo.indexable must be a boolean.");
  }
  if (source.sitemapPath !== "/sitemap.xml") {
    throw new StorefrontContractError("seo.sitemapPath is unsupported.");
  }
  if (!Array.isArray(source.disallow) || source.disallow.length > 50) {
    throw new StorefrontContractError("seo.disallow is invalid.");
  }
  if (!Array.isArray(source.entries) || source.entries.length > 5_000) {
    throw new StorefrontContractError("seo.entries is invalid.");
  }

  const disallow = source.disallow.map((item, index) =>
    publicPath(item, `seo.disallow[${index}]`)
  );
  if (new Set(disallow).size !== disallow.length) {
    throw new StorefrontContractError("seo.disallow contains duplicate paths.");
  }

  const entries = source.entries.map(parseEntry);
  const paths = entries.map(({ path }) => path);
  if (new Set(paths).size !== paths.length) {
    throw new StorefrontContractError("seo.entries contains duplicate paths.");
  }
  if (entries.filter(({ kind }) => kind === "home").length !== 1) {
    throw new StorefrontContractError("seo.entries must contain exactly one home entry.");
  }
  if (entries.find(({ kind }) => kind === "home")?.path !== "/") {
    throw new StorefrontContractError("seo home entry must use the root path.");
  }

  return Object.freeze({
    contractVersion: "storefront-public-seo.v1",
    context: parseStorefrontHostContextV1(source.context),
    indexable: source.indexable,
    sitemapPath: "/sitemap.xml",
    disallow: Object.freeze(disallow),
    entries: Object.freeze(entries),
  });
}
