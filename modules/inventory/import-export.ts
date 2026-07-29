import { PlatformError } from "../../packages/foundation/src/errors.js";
import type { InventoryBalance, StockLedgerEntry } from "./types.js";

export interface CsvRow {
  readonly [column: string]: string;
}

const DANGEROUS_PREFIX = /^[=+\-@\t\r]/u;

function escapeCell(value: string): string {
  const safe = DANGEROUS_PREFIX.test(value) ? `'${value}` : value;
  return /[",\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function exportCsv(columns: readonly string[], rows: readonly CsvRow[]): string {
  if (columns.length === 0) throw new PlatformError("VALIDATION_FAILED", "CSV export requires at least one column", 400);
  const unique = new Set(columns);
  if (unique.size !== columns.length) throw new PlatformError("VALIDATION_FAILED", "CSV export columns must be unique", 400);
  return [
    columns.map(escapeCell).join(","),
    ...rows.map((row) => columns.map((column) => escapeCell(row[column] ?? "")).join(",")),
  ].join("\r\n");
}

export function parseCsv(input: string, requiredColumns: readonly string[], maximumRows = 10_000): readonly CsvRow[] {
  if (input.length > 10_000_000) throw new PlatformError("VALIDATION_FAILED", "CSV file exceeds the 10 MB limit", 413);
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n") {
      row.push(cell.replace(/\r$/u, ""));
      records.push(row);
      row = [];
      cell = "";
      if (records.length > maximumRows + 1) throw new PlatformError("VALIDATION_FAILED", `CSV row count exceeds ${maximumRows}`, 413);
    } else cell += character;
  }
  if (quoted) throw new PlatformError("VALIDATION_FAILED", "CSV contains an unterminated quoted field", 400);
  if (cell.length > 0 || row.length > 0) { row.push(cell); records.push(row); }
  const header = records.shift()?.map((value) => value.trim()) ?? [];
  if (header.length === 0) throw new PlatformError("VALIDATION_FAILED", "CSV header is required", 400);
  if (new Set(header).size !== header.length) throw new PlatformError("VALIDATION_FAILED", "CSV header columns must be unique", 400);
  const missing = requiredColumns.filter((column) => !header.includes(column));
  if (missing.length > 0) throw new PlatformError("VALIDATION_FAILED", `CSV is missing required columns: ${missing.join(", ")}`, 400);
  return records.filter((record) => record.some((value) => value.trim().length > 0)).map((record, rowIndex) => {
    if (record.length !== header.length) throw new PlatformError("VALIDATION_FAILED", `CSV row ${rowIndex + 2} has ${record.length} columns; expected ${header.length}`, 400);
    return Object.fromEntries(header.map((column, index) => [column, record[index] ?? ""]));
  });
}

export function exportStockMovement(entries: readonly StockLedgerEntry[]): string {
  return exportCsv([
    "id", "posting_group_id", "movement_type", "variant_id", "warehouse_id", "stock_status",
    "quantity_amount", "quantity_scale", "unit", "value_delta_minor", "currency", "source_document_type",
    "source_document_id", "business_date", "posted_at",
  ], entries.map((entry) => ({
    id: entry.id,
    posting_group_id: entry.postingGroupId,
    movement_type: entry.movementType,
    variant_id: entry.variantId,
    warehouse_id: entry.warehouseId,
    stock_status: entry.stockStatus,
    quantity_amount: entry.quantityDelta.toString(),
    quantity_scale: entry.quantityScale.toString(),
    unit: entry.unit,
    value_delta_minor: entry.valueDeltaMinor?.toString() ?? "",
    currency: entry.currency ?? "",
    source_document_type: entry.sourceDocumentType,
    source_document_id: entry.sourceDocumentId,
    business_date: entry.businessDate,
    posted_at: entry.postedAt,
  })));
}

export function exportInventoryBalances(balances: readonly InventoryBalance[]): string {
  return exportCsv([
    "warehouse_id", "variant_id", "stock_status", "quantity_amount", "quantity_scale", "unit", "value_minor", "currency", "as_of",
  ], balances.map((balance) => ({
    warehouse_id: balance.warehouseId,
    variant_id: balance.variantId,
    stock_status: balance.stockStatus,
    quantity_amount: balance.quantity.toString(),
    quantity_scale: balance.scale.toString(),
    unit: balance.unit,
    value_minor: balance.valueMinor.toString(),
    currency: balance.currency ?? "",
    as_of: balance.asOf,
  })));
}

export interface ReorderPolicyImportRow {
  readonly id: string;
  readonly variantId: string;
  readonly warehouseId: string;
  readonly supplierId?: string;
  readonly reorderPoint: string;
  readonly safetyStock: string;
  readonly minimumQuantity: string;
  readonly maximumQuantity: string;
  readonly scale: number;
  readonly unit: string;
  readonly leadTimeDays: number;
}

export function parseReorderPolicyImport(csv: string): readonly ReorderPolicyImportRow[] {
  const rows = parseCsv(csv, ["id", "variant_id", "warehouse_id", "reorder_point", "safety_stock", "minimum_quantity", "maximum_quantity", "scale", "unit", "lead_time_days"]);
  const ids = new Set<string>();
  return rows.map((row, index) => {
    const id = row.id!.trim();
    if (id.length === 0 || ids.has(id)) throw new PlatformError("VALIDATION_FAILED", `Reorder policy row ${index + 2} has a missing or duplicate id`, 400);
    ids.add(id);
    const scale = Number(row.scale);
    const leadTimeDays = Number(row.lead_time_days);
    if (!Number.isInteger(scale) || scale < 0 || scale > 18) throw new PlatformError("VALIDATION_FAILED", `Reorder policy row ${index + 2} has an invalid scale`, 400);
    if (!Number.isInteger(leadTimeDays) || leadTimeDays < 0 || leadTimeDays > 3650) throw new PlatformError("VALIDATION_FAILED", `Reorder policy row ${index + 2} has an invalid lead time`, 400);
    for (const column of ["reorder_point", "safety_stock", "minimum_quantity", "maximum_quantity"] as const) {
      if (!/^\d+(?:\.\d+)?$/u.test(row[column]!)) throw new PlatformError("VALIDATION_FAILED", `Reorder policy row ${index + 2} has an invalid ${column}`, 400);
    }
    return {
      id,
      variantId: row.variant_id!.trim(),
      warehouseId: row.warehouse_id!.trim(),
      ...(row.supplier_id?.trim() ? { supplierId: row.supplier_id.trim() } : {}),
      reorderPoint: row.reorder_point!,
      safetyStock: row.safety_stock!,
      minimumQuantity: row.minimum_quantity!,
      maximumQuantity: row.maximum_quantity!,
      scale,
      unit: row.unit!.trim().toUpperCase(),
      leadTimeDays,
    };
  });
}

export interface ImportedReorderPolicy {
  readonly id: string;
  readonly tenantId: string;
  readonly variantId: string;
  readonly warehouseId: string;
  readonly supplierId?: string;
  readonly reorderPoint: { readonly amount: string; readonly unit: string; readonly scale: number };
  readonly safetyStock: { readonly amount: string; readonly unit: string; readonly scale: number };
  readonly minimumQuantity: { readonly amount: string; readonly unit: string; readonly scale: number };
  readonly maximumQuantity: { readonly amount: string; readonly unit: string; readonly scale: number };
  readonly leadTimeDays: number;
  readonly active: boolean;
}

export function reorderPolicyFromImport(tenantId: string, row: ReorderPolicyImportRow): ImportedReorderPolicy {
  return {
    id: row.id,
    tenantId,
    variantId: row.variantId,
    warehouseId: row.warehouseId,
    ...(row.supplierId === undefined ? {} : { supplierId: row.supplierId }),
    reorderPoint: { amount: row.reorderPoint, unit: row.unit, scale: row.scale },
    safetyStock: { amount: row.safetyStock, unit: row.unit, scale: row.scale },
    minimumQuantity: { amount: row.minimumQuantity, unit: row.unit, scale: row.scale },
    maximumQuantity: { amount: row.maximumQuantity, unit: row.unit, scale: row.scale },
    leadTimeDays: row.leadTimeDays,
    active: true,
  };
}
