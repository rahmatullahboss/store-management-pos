export type StorefrontThemeDensityV1 = "compact" | "comfortable" | "airy";
export type StorefrontThemeCornerV1 = "square" | "subtle" | "rounded";
export type StorefrontThemeContainerV1 = "focused" | "standard" | "wide";

export interface StorefrontThemeV1 {
  readonly version: "storefront-theme.v1";
  readonly colors: Readonly<Record<StorefrontThemeColorKeyV1, string>>;
  readonly density: StorefrontThemeDensityV1;
  readonly corner: StorefrontThemeCornerV1;
  readonly container: StorefrontThemeContainerV1;
}

export type StorefrontThemeColorKeyV1 =
  | "background"
  | "foreground"
  | "surface"
  | "surfaceMuted"
  | "primary"
  | "primaryForeground"
  | "border"
  | "danger"
  | "focus";

const COLOR_KEYS: readonly StorefrontThemeColorKeyV1[] = [
  "background",
  "foreground",
  "surface",
  "surfaceMuted",
  "primary",
  "primaryForeground",
  "border",
  "danger",
  "focus",
];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const DENSITIES: readonly StorefrontThemeDensityV1[] = [
  "compact",
  "comfortable",
  "airy",
];
const CORNERS: readonly StorefrontThemeCornerV1[] = [
  "square",
  "subtle",
  "rounded",
];
const CONTAINERS: readonly StorefrontThemeContainerV1[] = [
  "focused",
  "standard",
  "wide",
];

export const DEFAULT_STOREFRONT_THEME_V1: StorefrontThemeV1 = Object.freeze({
  version: "storefront-theme.v1",
  colors: Object.freeze({
    background: "#f7f5ee",
    foreground: "#17231e",
    surface: "#fffefa",
    surfaceMuted: "#edf2ee",
    primary: "#1f6a51",
    primaryForeground: "#ffffff",
    border: "#d7ddd8",
    danger: "#9b2c2c",
    focus: "#e09a13",
  }),
  density: "comfortable",
  corner: "subtle",
  container: "wide",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

export function sanitizeStorefrontThemeV1(value: unknown): StorefrontThemeV1 {
  if (!isRecord(value)) return DEFAULT_STOREFRONT_THEME_V1;
  const sourceColors = isRecord(value.colors) ? value.colors : {};
  const colors = { ...DEFAULT_STOREFRONT_THEME_V1.colors };

  for (const key of COLOR_KEYS) {
    const candidate = sourceColors[key];
    if (typeof candidate === "string" && HEX_COLOR.test(candidate.trim())) {
      colors[key] = candidate.trim().toLowerCase();
    }
  }

  return Object.freeze({
    version: "storefront-theme.v1",
    colors: Object.freeze(colors),
    density: enumValue(
      value.density,
      DENSITIES,
      DEFAULT_STOREFRONT_THEME_V1.density,
    ),
    corner: enumValue(
      value.corner,
      CORNERS,
      DEFAULT_STOREFRONT_THEME_V1.corner,
    ),
    container: enumValue(
      value.container,
      CONTAINERS,
      DEFAULT_STOREFRONT_THEME_V1.container,
    ),
  });
}
