import {
  parseStorefrontCheckoutSubmissionIntentV1,
  type StorefrontCheckoutSubmissionIntentV1,
} from "../../../packages/storefront-contracts/src/checkout-submit.js";

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function hex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashStorefrontCheckoutSubmissionIntent(
  value: StorefrontCheckoutSubmissionIntentV1 | unknown,
): Promise<string> {
  const intent = parseStorefrontCheckoutSubmissionIntentV1(value);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stableJson(intent)),
  );
  return hex(new Uint8Array(digest));
}
