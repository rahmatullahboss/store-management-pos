import { requirePermission, type RequestContext, type TransactionClient } from "../../../packages/foundation/src/index.js";
import type { CatalogProduct } from "./model.js";

export const CATALOG_PERMISSIONS = Object.freeze({
  read: "catalog.product.read",
  write: "catalog.product.write",
  publish: "catalog.product.publish",
  import: "catalog.import.execute",
  export: "catalog.export.read",
  unitManage: "catalog.unit.manage",
} as const);

export interface CatalogWriteCommand {
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly product: CatalogProduct;
  readonly expectedVersion?: bigint;
}

export interface CatalogWriteResult {
  readonly productId: string;
  readonly version: bigint;
  readonly status: string;
  readonly replayed: boolean;
  readonly updatedAt: string;
}

export interface CatalogVariantFeedRow {
  readonly productId: string;
  readonly variantId: string;
  readonly productCode: string;
  readonly sku: string;
  readonly displayName: string;
  readonly variantTitle: string;
  readonly status: string;
  readonly unitCode: string;
  readonly taxCode?: string;
  readonly barcodes: readonly string[];
  readonly version: bigint;
}

function serializeProduct(product: CatalogProduct): Record<string, unknown> {
  return {
    ...product,
    variants: product.variants.map((variant) => ({
      ...variant,
      weightMinor: variant.weightMinor?.toString(),
      supplierReferences: variant.supplierReferences.map((reference) => ({
        ...reference,
        minimumOrderQuantityMinor: reference.minimumOrderQuantityMinor?.toString(),
      })),
    })),
  };
}

export async function saveCatalogProduct(
  client: TransactionClient,
  context: RequestContext,
  command: CatalogWriteCommand,
): Promise<CatalogWriteResult> {
  requirePermission(context, CATALOG_PERMISSIONS.write);
  if (command.idempotencyKey.length < 8) throw new TypeError("Idempotency key must contain at least eight characters");
  if (!/^[a-f0-9]{64}$/i.test(command.requestHash)) throw new TypeError("Request hash must be a SHA-256 hex digest");
  const result = await client.query<{
    product_id: string;
    version: string;
    status: string;
    replayed: boolean;
    updated_at: string;
  }>(
    "SELECT product_id::text, version::text, status, replayed, updated_at::text FROM catalog.save_product($1, $2, $3::jsonb, $4, $5)",
    [command.idempotencyKey, command.requestHash, JSON.stringify(serializeProduct(command.product)), command.expectedVersion?.toString() ?? null, context.requestId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Catalog save command returned no result");
  return Object.freeze({ productId: row.product_id, version: BigInt(row.version), status: row.status, replayed: row.replayed, updatedAt: row.updated_at });
}

export async function changeCatalogProductStatus(
  client: TransactionClient,
  context: RequestContext,
  input: { readonly productId: string; readonly status: "draft" | "active" | "inactive" | "archived"; readonly expectedVersion: bigint; readonly reason: string },
): Promise<CatalogWriteResult> {
  requirePermission(context, input.status === "active" ? CATALOG_PERMISSIONS.publish : CATALOG_PERMISSIONS.write);
  if (input.reason.trim().length < 4 || input.reason.length > 500) throw new TypeError("A status-change reason is required");
  const result = await client.query<{
    product_id: string;
    version: string;
    status: string;
    replayed: boolean;
    updated_at: string;
  }>(
    "SELECT product_id::text, version::text, status, replayed, updated_at::text FROM catalog.change_product_status($1::uuid, $2, $3, $4, $5)",
    [input.productId, input.status, input.expectedVersion.toString(), input.reason.trim(), context.requestId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Catalog status command returned no result");
  return Object.freeze({ productId: row.product_id, version: BigInt(row.version), status: row.status, replayed: row.replayed, updatedAt: row.updated_at });
}

export async function queryCatalogVariantFeed(
  client: TransactionClient,
  context: RequestContext,
  input: { readonly locale: string; readonly query?: string; readonly limit?: number; readonly cursor?: string },
): Promise<readonly CatalogVariantFeedRow[]> {
  requirePermission(context, CATALOG_PERMISSIONS.read);
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError("Catalog feed limit must be between 1 and 500");
  const result = await client.query<{
    product_id: string;
    variant_id: string;
    product_code: string;
    sku: string;
    display_name: string;
    variant_title: string;
    status: string;
    unit_code: string;
    tax_code: string | null;
    barcodes: string[];
    version: string;
  }>(
    "SELECT product_id::text, variant_id::text, product_code, sku, display_name, variant_title, status, unit_code, tax_code, barcodes, version::text FROM catalog.search_variant_feed($1, $2, $3, $4)",
    [input.locale, input.query ?? null, limit, input.cursor ?? null],
  );
  return Object.freeze(result.rows.map((row) => Object.freeze({
    productId: row.product_id,
    variantId: row.variant_id,
    productCode: row.product_code,
    sku: row.sku,
    displayName: row.display_name,
    variantTitle: row.variant_title,
    status: row.status,
    unitCode: row.unit_code,
    ...(row.tax_code === null ? {} : { taxCode: row.tax_code }),
    barcodes: Object.freeze(row.barcodes),
    version: BigInt(row.version),
  })));
}

export async function recordCatalogImport(
  client: TransactionClient,
  context: RequestContext,
  input: { readonly importId: string; readonly sourceHash: string; readonly acceptedRows: number; readonly warningCount: number },
): Promise<void> {
  requirePermission(context, CATALOG_PERMISSIONS.import);
  await client.query(
    "SELECT catalog.record_import($1, $2, $3, $4, $5)",
    [input.importId, input.sourceHash, input.acceptedRows, input.warningCount, context.requestId],
  );
}
