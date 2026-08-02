import { normalizeStorefrontHostname } from "../../../packages/storefront-contracts/src/index.js";

export type StorefrontRuntimeStage = "development" | "staging" | "production";

export interface StorefrontRuntimeEnvironment {
  readonly stage: StorefrontRuntimeStage;
  readonly apiBaseUrl: string;
  readonly platformBaseDomain: string;
  readonly buildId: string;
}

export class StorefrontEnvironmentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StorefrontEnvironmentError";
  }
}

const BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const STAGES: readonly StorefrontRuntimeStage[] = [
  "development",
  "staging",
  "production",
];

function requiredString(
  source: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new StorefrontEnvironmentError(`${key} is required.`);
  }
  return value.trim();
}

function normalizeApiBaseUrl(value: string, stage: StorefrontRuntimeStage): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StorefrontEnvironmentError("STOREFRONT_API_BASE_URL is invalid.");
  }

  const localDevelopment =
    stage === "development" &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (
    (url.protocol !== "https:" && !localDevelopment) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new StorefrontEnvironmentError(
      "STOREFRONT_API_BASE_URL must be a safe HTTPS origin.",
    );
  }

  return url.toString().replace(/\/$/, "");
}

export function parseStorefrontRuntimeEnvironment(
  source: Readonly<Record<string, unknown>>,
): StorefrontRuntimeEnvironment {
  const stageValue = requiredString(source, "STOREFRONT_STAGE");
  if (!STAGES.includes(stageValue as StorefrontRuntimeStage)) {
    throw new StorefrontEnvironmentError("STOREFRONT_STAGE is unsupported.");
  }
  const stage = stageValue as StorefrontRuntimeStage;
  const buildId = requiredString(source, "STOREFRONT_BUILD_ID");
  if (!BUILD_ID.test(buildId)) {
    throw new StorefrontEnvironmentError("STOREFRONT_BUILD_ID is invalid.");
  }

  return Object.freeze({
    stage,
    apiBaseUrl: normalizeApiBaseUrl(
      requiredString(source, "STOREFRONT_API_BASE_URL"),
      stage,
    ),
    platformBaseDomain: normalizeStorefrontHostname(
      requiredString(source, "STOREFRONT_PLATFORM_BASE_DOMAIN"),
    ),
    buildId,
  });
}
