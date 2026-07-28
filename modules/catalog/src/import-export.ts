import { createCatalogProduct, type CatalogProduct, type ProductInput } from "./model.js";

export interface CatalogImportRow {
  readonly rowNumber: number;
  readonly product: ProductInput;
}

export interface CatalogImportIssue {
  readonly rowNumber: number;
  readonly code: string;
  readonly message: string;
  readonly severity: "error" | "warning";
}

export interface CatalogImportPlan {
  readonly accepted: readonly CatalogProduct[];
  readonly issues: readonly CatalogImportIssue[];
  readonly canExecute: boolean;
  readonly sourceHash: string;
}

export interface CatalogImportExecution {
  readonly importId: string;
  readonly insertedProductIds: readonly string[];
  readonly insertedVariantIds: readonly string[];
  readonly completedAt: string;
}

export interface CatalogImportWriter {
  insert(product: CatalogProduct): Promise<void>;
}

function stableStringify(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function planCatalogImport(rows: readonly CatalogImportRow[]): Promise<CatalogImportPlan> {
  const accepted: CatalogProduct[] = [];
  const issues: CatalogImportIssue[] = [];
  const productCodes = new Set<string>();
  const skus = new Set<string>();
  const barcodes = new Set<string>();

  for (const row of rows) {
    if (!Number.isInteger(row.rowNumber) || row.rowNumber < 1) throw new TypeError("Import row number must be a positive integer");
    try {
      const product = createCatalogProduct(row.product);
      if (productCodes.has(product.normalizedCode)) throw new TypeError(`Duplicate product code in import: ${product.normalizedCode}`);
      productCodes.add(product.normalizedCode);
      for (const variant of product.variants) {
        if (skus.has(variant.normalizedSku)) throw new TypeError(`Duplicate SKU in import: ${variant.normalizedSku}`);
        skus.add(variant.normalizedSku);
        for (const barcode of variant.barcodes) {
          if (barcodes.has(barcode.normalizedValue)) throw new TypeError(`Duplicate barcode in import: ${barcode.normalizedValue}`);
          barcodes.add(barcode.normalizedValue);
        }
      }
      if (product.localized.length === 1) {
        issues.push(Object.freeze({ rowNumber: row.rowNumber, code: "CATALOG_SINGLE_LOCALE", message: "Only one localized entry was supplied", severity: "warning" }));
      }
      accepted.push(product);
    } catch (error) {
      issues.push(Object.freeze({
        rowNumber: row.rowNumber,
        code: "CATALOG_IMPORT_INVALID_ROW",
        message: error instanceof Error ? error.message : "Catalog import row is invalid",
        severity: "error",
      }));
    }
  }

  const sourceHash = await sha256Hex(stableStringify(rows));
  return Object.freeze({
    accepted: Object.freeze(accepted),
    issues: Object.freeze(issues),
    canExecute: !issues.some((issue) => issue.severity === "error"),
    sourceHash,
  });
}

export async function executeCatalogImport(
  importId: string,
  plan: CatalogImportPlan,
  writer: CatalogImportWriter,
  now = new Date(),
): Promise<CatalogImportExecution> {
  if (!plan.canExecute) throw new Error("Catalog import cannot execute while errors remain");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(importId)) throw new TypeError("Import ID is invalid");
  const insertedProductIds: string[] = [];
  const insertedVariantIds: string[] = [];
  for (const product of plan.accepted) {
    await writer.insert(product);
    insertedProductIds.push(product.id);
    insertedVariantIds.push(...product.variants.map((variant) => variant.id));
  }
  return Object.freeze({
    importId,
    insertedProductIds: Object.freeze(insertedProductIds),
    insertedVariantIds: Object.freeze(insertedVariantIds),
    completedAt: now.toISOString(),
  });
}

export function exportCatalog(products: readonly CatalogProduct[]): string {
  const rows = products.flatMap((product) => product.variants.map((variant) => ({
    productId: product.id,
    productCode: product.normalizedCode,
    productKind: product.kind,
    status: product.status,
    defaultLocale: product.defaultLocale,
    localized: product.localized,
    categoryIds: product.categoryIds,
    brandId: product.brandId ?? null,
    tags: product.tags,
    taxCode: product.taxCode ?? null,
    variantId: variant.id,
    sku: variant.normalizedSku,
    variantTitle: variant.title,
    attributes: variant.attributeValues,
    barcodes: variant.barcodes,
    unitCode: variant.unitCode,
    trackingMode: variant.trackingMode,
    weightMinor: variant.weightMinor?.toString() ?? null,
    weightScale: variant.weightScale ?? null,
    supplierReferences: variant.supplierReferences.map((reference) => ({
      ...reference,
      minimumOrderQuantityMinor: reference.minimumOrderQuantityMinor?.toString() ?? null,
    })),
    metadata: variant.metadata,
  })));
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}${rows.length === 0 ? "" : "\n"}`;
}
