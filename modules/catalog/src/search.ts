import type { CatalogProduct, CatalogVariant } from "./model.js";
import { productDisplayName } from "./model.js";

export interface CatalogSearchDocument {
  readonly productId: string;
  readonly variantId: string;
  readonly sku: string;
  readonly barcodeValues: readonly string[];
  readonly productCode: string;
  readonly displayName: string;
  readonly variantTitle: string;
  readonly tags: readonly string[];
  readonly status: string;
  readonly searchableText: string;
}

export interface CatalogSearchResult {
  readonly document: CatalogSearchDocument;
  readonly score: number;
  readonly matchedBy: readonly ("barcode" | "sku" | "code" | "token")[];
}

export interface CatalogSearchOptions {
  readonly limit?: number;
  readonly includeInactive?: boolean;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("und")
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokens(value: string): readonly string[] {
  return [...new Set(normalizeSearchText(value).split(" ").filter((token) => token.length > 0))];
}

function buildDocument(product: CatalogProduct, variant: CatalogVariant, locale: string): CatalogSearchDocument {
  const displayName = productDisplayName(product, locale);
  const searchableText = normalizeSearchText([
    product.normalizedCode,
    displayName,
    variant.normalizedSku,
    variant.title,
    ...product.localized.flatMap((entry) => [entry.name, entry.description ?? "", ...(entry.searchKeywords ?? [])]),
    ...product.tags,
    ...variant.attributeValues.flatMap((attribute) => [attribute.code, attribute.label]),
    ...variant.barcodes.map((barcode) => barcode.normalizedValue),
  ].join(" "));
  return Object.freeze({
    productId: product.id,
    variantId: variant.id,
    sku: variant.normalizedSku,
    barcodeValues: Object.freeze(variant.barcodes.map((barcode) => barcode.normalizedValue)),
    productCode: product.normalizedCode,
    displayName,
    variantTitle: variant.title,
    tags: product.tags,
    status: product.status,
    searchableText,
  });
}

export class CatalogSearchIndex {
  private readonly documents = new Map<string, CatalogSearchDocument>();
  private readonly barcodeIndex = new Map<string, string>();
  private readonly skuIndex = new Map<string, string>();
  private readonly codeIndex = new Map<string, Set<string>>();
  private readonly tokenIndex = new Map<string, Set<string>>();
  private readonly prefixIndex = new Map<string, Set<string>>();

  upsertProduct(product: CatalogProduct, locale = product.defaultLocale): void {
    this.removeProduct(product.id);
    for (const variant of product.variants) {
      const document = buildDocument(product, variant, locale);
      this.documents.set(document.variantId, document);
      this.skuIndex.set(document.sku, document.variantId);
      for (const barcode of document.barcodeValues) this.barcodeIndex.set(barcode, document.variantId);
      const codeEntries = this.codeIndex.get(document.productCode) ?? new Set<string>();
      codeEntries.add(document.variantId);
      this.codeIndex.set(document.productCode, codeEntries);
      for (const token of tokens(document.searchableText)) {
        const entries = this.tokenIndex.get(token) ?? new Set<string>();
        entries.add(document.variantId);
        this.tokenIndex.set(token, entries);
        for (let length = 3; length <= Math.min(token.length, 16); length += 1) {
          const prefix = token.slice(0, length);
          const prefixEntries = this.prefixIndex.get(prefix) ?? new Set<string>();
          prefixEntries.add(document.variantId);
          this.prefixIndex.set(prefix, prefixEntries);
        }
      }
    }
  }

  removeProduct(productId: string): void {
    for (const document of [...this.documents.values()]) {
      if (document.productId !== productId) continue;
      this.documents.delete(document.variantId);
      this.skuIndex.delete(document.sku);
      for (const barcode of document.barcodeValues) this.barcodeIndex.delete(barcode);
      this.removeFromIndex(this.codeIndex, document.productCode, document.variantId);
      for (const token of tokens(document.searchableText)) {
        this.removeFromIndex(this.tokenIndex, token, document.variantId);
        for (let length = 3; length <= Math.min(token.length, 16); length += 1) {
          this.removeFromIndex(this.prefixIndex, token.slice(0, length), document.variantId);
        }
      }
    }
  }

  search(query: string, options: CatalogSearchOptions = {}): readonly CatalogSearchResult[] {
    const normalized = normalizeSearchText(query);
    if (normalized.length === 0) return [];
    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new RangeError("Search limit must be between 1 and 200");
    const scored = new Map<string, { score: number; matchedBy: Set<CatalogSearchResult["matchedBy"][number]> }>();
    const add = (variantId: string | undefined, score: number, matchedBy: CatalogSearchResult["matchedBy"][number]): void => {
      if (!variantId) return;
      const current = scored.get(variantId) ?? { score: 0, matchedBy: new Set() };
      current.score += score;
      current.matchedBy.add(matchedBy);
      scored.set(variantId, current);
    };
    add(this.barcodeIndex.get(normalized.toUpperCase()), 1_000, "barcode");
    add(this.skuIndex.get(normalized.toUpperCase()), 900, "sku");
    for (const variantId of this.codeIndex.get(normalized.toUpperCase()) ?? []) add(variantId, 800, "code");
    const queryTokens = tokens(normalized);
    for (const token of queryTokens) {
      for (const variantId of this.tokenIndex.get(token) ?? []) add(variantId, 100, "token");
      if (token.length >= 3) {
        for (const variantId of this.prefixIndex.get(token.slice(0, 16)) ?? []) add(variantId, 25, "token");
      }
    }
    return [...scored.entries()]
      .flatMap(([variantId, score]): CatalogSearchResult[] => {
        const document = this.documents.get(variantId);
        return document === undefined ? [] : [{ document, score: score.score, matchedBy: [...score.matchedBy] }];
      })
      .filter((result) => options.includeInactive === true || result.document.status === "active")
      .sort((left, right) => right.score - left.score || left.document.sku.localeCompare(right.document.sku))
      .slice(0, limit)
      .map((result) => Object.freeze({ ...result, matchedBy: Object.freeze(result.matchedBy) }));
  }

  get size(): number {
    return this.documents.size;
  }

  private removeFromIndex(index: Map<string, Set<string>>, key: string, variantId: string): void {
    const entries = index.get(key);
    if (!entries) return;
    entries.delete(variantId);
    if (entries.size === 0) index.delete(key);
  }
}

export function benchmarkCatalogSearch(index: CatalogSearchIndex, queries: readonly string[], now = performance.now.bind(performance)): {
  readonly count: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
} {
  if (queries.length === 0) throw new TypeError("At least one benchmark query is required");
  const durations = queries.map((query) => {
    const start = now();
    index.search(query, { limit: 20, includeInactive: true });
    return now() - start;
  }).sort((left, right) => left - right);
  const percentile = (value: number): number => durations[Math.min(durations.length - 1, Math.ceil(durations.length * value) - 1)] ?? 0;
  return Object.freeze({ count: index.size, p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99) });
}
