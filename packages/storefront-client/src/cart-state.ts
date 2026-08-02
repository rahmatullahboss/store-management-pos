import {
  parseStorefrontCartDraftItemV1,
  parseStorefrontCartDraftV1,
  type StorefrontCartDraftItemV1,
  type StorefrontCartDraftV1,
} from "../../storefront-contracts/src/cart-draft.js";

export interface StorefrontCartStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StorefrontCartDraftLoadV1 {
  readonly draft: StorefrontCartDraftV1;
  readonly recovered: boolean;
}

export interface StorefrontCartDraftStoreV1 {
  load(): StorefrontCartDraftLoadV1;
  save(value: StorefrontCartDraftV1 | unknown): StorefrontCartDraftV1;
  clear(): StorefrontCartDraftV1;
  upsertLine(value: StorefrontCartDraftItemV1 | unknown): StorefrontCartDraftV1;
  removeLine(productId: string, variantId: string): StorefrontCartDraftV1;
  setCouponCodes(couponCodes: readonly string[]): StorefrontCartDraftV1;
  setDestinationCountryCode(countryCode: string | null): StorefrontCartDraftV1;
}

const MAX_STORED_CART_BYTES = 64 * 1024;
const STOREFRONT_SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u;

function instant(now: () => string): string {
  const parsed = Date.parse(now());
  if (!Number.isFinite(parsed)) throw new TypeError("Storefront cart clock is invalid.");
  return new Date(parsed).toISOString();
}

function storageKey(storefrontId: string): string {
  const normalized = storefrontId.trim();
  if (!STOREFRONT_SCOPE_PATTERN.test(normalized)) {
    throw new TypeError("Storefront cart storage scope is invalid.");
  }
  return `ozzyl:storefront-cart:v1:${encodeURIComponent(normalized)}`;
}

function emptyDraft(now: () => string): StorefrontCartDraftV1 {
  return parseStorefrontCartDraftV1({
    contractVersion: "storefront-cart-draft.v1",
    revision: "0",
    lines: [],
    couponCodes: [],
    destinationCountryCode: null,
    updatedAt: instant(now),
  });
}

function incrementRevision(value: string): string {
  return (BigInt(value) + 1n).toString();
}

function serialized(value: StorefrontCartDraftV1): string {
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > MAX_STORED_CART_BYTES) {
    throw new RangeError("Storefront cart draft exceeds the storage limit.");
  }
  return text;
}

export function createStorefrontCartDraftStore(
  storage: StorefrontCartStorage,
  storefrontId: string,
  options: { readonly now?: () => string } = {},
): StorefrontCartDraftStoreV1 {
  const key = storageKey(storefrontId);
  const now = options.now ?? (() => new Date().toISOString());

  function load(): StorefrontCartDraftLoadV1 {
    const raw = storage.getItem(key);
    if (raw === null) {
      return Object.freeze({ draft: emptyDraft(now), recovered: false });
    }
    try {
      if (new TextEncoder().encode(raw).byteLength > MAX_STORED_CART_BYTES) {
        throw new RangeError("Stored storefront cart draft exceeds the storage limit.");
      }
      const parsed = parseStorefrontCartDraftV1(JSON.parse(raw) as unknown);
      return Object.freeze({ draft: parsed, recovered: false });
    } catch {
      storage.removeItem(key);
      return Object.freeze({ draft: emptyDraft(now), recovered: true });
    }
  }

  function save(value: StorefrontCartDraftV1 | unknown): StorefrontCartDraftV1 {
    const parsed = parseStorefrontCartDraftV1(value);
    storage.setItem(key, serialized(parsed));
    return parsed;
  }

  function replaceDraft(
    current: StorefrontCartDraftV1,
    patch: Partial<Pick<StorefrontCartDraftV1, "lines" | "couponCodes" | "destinationCountryCode">>,
  ): StorefrontCartDraftV1 {
    return save({
      ...current,
      ...patch,
      revision: incrementRevision(current.revision),
      updatedAt: instant(now),
    });
  }

  return Object.freeze({
    load,
    save,
    clear(): StorefrontCartDraftV1 {
      storage.removeItem(key);
      return emptyDraft(now);
    },
    upsertLine(value: StorefrontCartDraftItemV1 | unknown): StorefrontCartDraftV1 {
      const line = parseStorefrontCartDraftItemV1(value);
      const current = load().draft;
      const index = current.lines.findIndex(
        (candidate) =>
          candidate.productId === line.productId &&
          candidate.variantId === line.variantId,
      );
      const lines = [...current.lines];
      if (index === -1) lines.push(line);
      else lines[index] = line;
      return replaceDraft(current, { lines });
    },
    removeLine(productId: string, variantId: string): StorefrontCartDraftV1 {
      const identity = parseStorefrontCartDraftItemV1({
        productId,
        variantId,
        quantity: { amount: "1", unit: "EA", scale: 0 },
      });
      const current = load().draft;
      const lines = current.lines.filter(
        (candidate) =>
          candidate.productId !== identity.productId ||
          candidate.variantId !== identity.variantId,
      );
      if (lines.length === current.lines.length) return current;
      return replaceDraft(current, { lines });
    },
    setCouponCodes(couponCodes: readonly string[]): StorefrontCartDraftV1 {
      const current = load().draft;
      return replaceDraft(current, { couponCodes: [...couponCodes] });
    },
    setDestinationCountryCode(countryCode: string | null): StorefrontCartDraftV1 {
      const current = load().draft;
      return replaceDraft(current, { destinationCountryCode: countryCode });
    },
  });
}
