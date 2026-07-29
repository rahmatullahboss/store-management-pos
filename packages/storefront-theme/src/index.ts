/**
 * Selected sanitisation patterns adapted for MOD-H from
 * scaliuslabs/scalius-commerce-lite/packages/shared/src/storefront-theme.ts
 * at commit 4cb83aecb6d27483951618dcf8398592e662f241.
 *
 * Product identity, defaults, field names and public contracts are Ozzyl-owned.
 * See docs/architecture/storefront/upstream-file-manifest.yaml.
 */

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
const COLOR_KEY_SET = new Set<string>(COLOR_KEYS);
const CSS_VARIABLES = new Map<StorefrontThemeColorKeyV1, string>(
  COLOR_KEYS.map((key) => [
    key,
    `--storefront-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
  ]),
);

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FUNCTION =
  /^(?:rgb|rgba|hsl|hsla|oklch|oklab|lch|lab)\(\s*[-+0-9.%\s,/]+\)$/i;
const UNSAFE_TOKEN =
  /(?:\/\*|\*\/|@import|expression\s*\(|url\s*\(|javascript\s*:)/i;
const STYLE_BREAKOUT = new Set([";", "{", "}", "<", ">", "\\"]);
const NAMED_COLORS = new Set([
  "transparent",
  "currentcolor",
  "black",
  "white",
]);

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

function hasControlOrBreakoutCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127 || STYLE_BREAKOUT.has(character)) return true;
  }
  return false;
}

function isSafeThemeVariable(value: string): boolean {
  const match = /^var\((--[a-z0-9-]+)\)$/i.exec(value);
  if (!match?.[1]) return false;
  return [...CSS_VARIABLES.values()].includes(match[1].toLowerCase());
}

export function isStorefrontThemeColorKeyV1(
  value: string,
): value is StorefrontThemeColorKeyV1 {
  return COLOR_KEY_SET.has(value);
}

export function isSafeStorefrontThemeColorValueV1(value: string): boolean {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 128 ||
    hasControlOrBreakoutCharacter(normalized) ||
    UNSAFE_TOKEN.test(normalized)
  ) {
    return false;
  }
  return (
    HEX_COLOR.test(normalized) ||
    COLOR_FUNCTION.test(normalized) ||
    NAMED_COLORS.has(normalized.toLowerCase()) ||
    isSafeThemeVariable(normalized)
  );
}

export function sanitizeStorefrontThemeColorsV1(
  value: unknown,
): Readonly<Record<StorefrontThemeColorKeyV1, string>> {
  const colors: Record<StorefrontThemeColorKeyV1, string> = {
    ...DEFAULT_STOREFRONT_THEME_V1.colors,
  };
  if (!isRecord(value)) return Object.freeze(colors);

  for (const [key, candidate] of Object.entries(value)) {
    if (
      !isStorefrontThemeColorKeyV1(key) ||
      typeof candidate !== "string" ||
      !isSafeStorefrontThemeColorValueV1(candidate)
    ) {
      continue;
    }
    colors[key] = candidate.trim();
  }
  return Object.freeze(colors);
}

export function listInvalidStorefrontThemeColorEntriesV1(
  value: unknown,
): readonly string[] {
  if (!isRecord(value)) return Object.freeze([]);
  const invalid: string[] = [];
  for (const [key, candidate] of Object.entries(value)) {
    if (
      !isStorefrontThemeColorKeyV1(key) ||
      typeof candidate !== "string" ||
      !isSafeStorefrontThemeColorValueV1(candidate)
    ) {
      invalid.push(key);
    }
  }
  return Object.freeze([...new Set(invalid)]);
}

export function sanitizeStorefrontThemeV1(value: unknown): StorefrontThemeV1 {
  if (!isRecord(value)) return DEFAULT_STOREFRONT_THEME_V1;
  return Object.freeze({
    version: "storefront-theme.v1",
    colors: sanitizeStorefrontThemeColorsV1(value.colors),
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

export function buildStorefrontThemeTokensV1(
  value: unknown,
): Readonly<Record<string, string>> {
  const theme = sanitizeStorefrontThemeV1(value);
  const tokens: Record<string, string> = {};
  for (const key of COLOR_KEYS) {
    const variable = CSS_VARIABLES.get(key);
    if (variable) tokens[variable] = theme.colors[key];
  }
  tokens["--storefront-density"] =
    theme.density === "compact" ? "0.9" : theme.density === "airy" ? "1.1" : "1";
  tokens["--storefront-radius"] =
    theme.corner === "square" ? "0" : theme.corner === "rounded" ? "0.8rem" : "0.45rem";
  tokens["--storefront-container"] =
    theme.container === "focused" ? "64rem" : theme.container === "standard" ? "72rem" : "80rem";
  return Object.freeze(tokens);
}
