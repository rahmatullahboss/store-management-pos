import {
  StorefrontContractError,
  parseStorefrontHostContextV1,
  type StorefrontHostContextV1,
} from "./index.js";

export type StorefrontNavigationPlacementV1 = "header" | "footer" | "utility";

export interface StorefrontNavigationItemV1 {
  readonly label: string;
  readonly href: string;
  readonly children: readonly StorefrontNavigationItemV1[];
}

export interface StorefrontNavigationDocumentV1 {
  readonly items: readonly StorefrontNavigationItemV1[];
}

export interface StorefrontPublicPageV1 {
  readonly slug: string;
  readonly title: string;
  readonly revision: string;
  readonly content: Readonly<Record<string, unknown>>;
  readonly seo: Readonly<Record<string, unknown>>;
}

export interface StorefrontPublicContentBundleV1 {
  readonly contractVersion: "storefront-public-content.v1";
  readonly context: StorefrontHostContextV1;
  readonly themeRevision: string;
  readonly layoutRevision: string;
  readonly theme: Readonly<Record<string, unknown>>;
  readonly navigation: Readonly<
    Partial<Record<StorefrontNavigationPlacementV1, StorefrontNavigationDocumentV1>>
  >;
  readonly homepage: Readonly<Record<string, unknown>>;
  readonly homepageSeo: Readonly<Record<string, unknown>>;
  readonly page: StorefrontPublicPageV1 | null;
}

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const SLUG = /^[a-z0-9](?:[a-z0-9._~-]{0,178}[a-z0-9])?$/u;
const PLACEMENTS: readonly StorefrontNavigationPlacementV1[] = [
  "header",
  "footer",
  "utility",
];

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorefrontContractError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") {
    throw new StorefrontContractError(`${label} must be a string.`);
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  return normalized;
}

function token(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 200);
  if (!TOKEN.test(normalized)) {
    throw new StorefrontContractError(`${label} is not a valid token.`);
  }
  return normalized;
}

function slug(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 180).toLowerCase();
  if (!SLUG.test(normalized) || normalized === "." || normalized === "..") {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  return normalized;
}

function safeHref(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 2_048);
  if (normalized.startsWith("/") && !normalized.startsWith("//")) {
    if (normalized.includes("\\")) {
      throw new StorefrontContractError(`${label} is invalid.`);
    }
    return normalized;
  }
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  return parsed.toString();
}

function safeJson(value: unknown, label: string, depth = 0): unknown {
  if (depth > 6) {
    throw new StorefrontContractError(`${label} exceeds the supported depth.`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new StorefrontContractError(`${label} contains an invalid number.`);
    }
    return value;
  }
  if (typeof value === "string") {
    if (value.length > 8_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
      throw new StorefrontContractError(`${label} contains invalid text.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) {
      throw new StorefrontContractError(`${label} contains too many items.`);
    }
    return Object.freeze(
      value.map((entry, index) => safeJson(entry, `${label}[${index}]`, depth + 1)),
    );
  }
  const source = record(value, label);
  const entries = Object.entries(source);
  if (entries.length > 100) {
    throw new StorefrontContractError(`${label} contains too many fields.`);
  }
  return Object.freeze(
    Object.fromEntries(
      entries.map(([key, entry]) => {
        if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u.test(key)) {
          throw new StorefrontContractError(`${label} contains an invalid field name.`);
        }
        return [key, safeJson(entry, `${label}.${key}`, depth + 1)];
      }),
    ),
  );
}

function document(value: unknown, label: string): Readonly<Record<string, unknown>> {
  return safeJson(record(value, label), label) as Readonly<Record<string, unknown>>;
}

function navigationItems(
  value: unknown,
  label: string,
  depth = 0,
): readonly StorefrontNavigationItemV1[] {
  if (!Array.isArray(value) || value.length > 50 || depth > 3) {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  return Object.freeze(
    value.map((entry, index) => {
      const source = record(entry, `${label}[${index}]`);
      const children = source.children === undefined
        ? Object.freeze([] as StorefrontNavigationItemV1[])
        : navigationItems(source.children, `${label}[${index}].children`, depth + 1);
      return Object.freeze({
        label: boundedText(source.label, `${label}[${index}].label`, 120),
        href: safeHref(source.href, `${label}[${index}].href`),
        children,
      });
    }),
  );
}

function navigationDocument(
  value: unknown,
  label: string,
): StorefrontNavigationDocumentV1 {
  const source = record(value, label);
  return Object.freeze({ items: navigationItems(source.items ?? [], `${label}.items`) });
}

function navigation(
  value: unknown,
): StorefrontPublicContentBundleV1["navigation"] {
  const source = record(value, "publicContent.navigation");
  const result: Partial<
    Record<StorefrontNavigationPlacementV1, StorefrontNavigationDocumentV1>
  > = {};
  for (const placement of PLACEMENTS) {
    if (source[placement] !== undefined) {
      result[placement] = navigationDocument(
        source[placement],
        `publicContent.navigation.${placement}`,
      );
    }
  }
  return Object.freeze(result);
}

function page(value: unknown): StorefrontPublicPageV1 | null {
  if (value === null || value === undefined) return null;
  const source = record(value, "publicContent.page");
  return Object.freeze({
    slug: slug(source.slug, "publicContent.page.slug"),
    title: boundedText(source.title, "publicContent.page.title", 240),
    revision: token(source.revision, "publicContent.page.revision"),
    content: document(source.content, "publicContent.page.content"),
    seo: document(source.seo ?? {}, "publicContent.page.seo"),
  });
}

export function parseStorefrontPublicContentBundleV1(
  value: unknown,
): StorefrontPublicContentBundleV1 {
  const source = record(value, "publicContent");
  if (source.contractVersion !== "storefront-public-content.v1") {
    throw new StorefrontContractError("Unsupported storefront public-content contract.");
  }
  return Object.freeze({
    contractVersion: "storefront-public-content.v1",
    context: parseStorefrontHostContextV1(source.context),
    themeRevision: token(source.themeRevision, "publicContent.themeRevision"),
    layoutRevision: token(source.layoutRevision, "publicContent.layoutRevision"),
    theme: document(source.theme ?? {}, "publicContent.theme"),
    navigation: navigation(source.navigation ?? {}),
    homepage: document(source.homepage ?? {}, "publicContent.homepage"),
    homepageSeo: document(source.homepageSeo ?? {}, "publicContent.homepageSeo"),
    page: page(source.page),
  });
}
