import { PlatformError } from "../../packages/foundation/src/errors.js";
import { exportCsv, parseCsv } from "../inventory/import-export.js";
import type { GoodsReceipt, PurchaseOrder, Supplier } from "./types.js";

export interface SupplierImportRow {
  readonly id: string;
  readonly code: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly currency: string;
  readonly paymentTermsDays: number;
  readonly leadTimeDays: number;
  readonly email?: string;
  readonly phone?: string;
}

export function parseSupplierImport(csv: string): readonly SupplierImportRow[] {
  const rows = parseCsv(csv, ["id", "code", "legal_name", "display_name", "currency", "payment_terms_days", "lead_time_days"]);
  const ids = new Set<string>();
  const codes = new Set<string>();
  return rows.map((row, index) => {
    const id = row.id!.trim();
    const code = row.code!.trim().toUpperCase();
    if (!id || ids.has(id)) throw new PlatformError("VALIDATION_FAILED", `Supplier row ${index + 2} has a missing or duplicate id`, 400);
    if (!code || codes.has(code)) throw new PlatformError("VALIDATION_FAILED", `Supplier row ${index + 2} has a missing or duplicate code`, 400);
    ids.add(id); codes.add(code);
    const currency = row.currency!.trim().toUpperCase();
    if (!/^[A-Z]{3}$/u.test(currency)) throw new PlatformError("VALIDATION_FAILED", `Supplier row ${index + 2} has an invalid currency`, 400);
    const paymentTermsDays = Number(row.payment_terms_days);
    const leadTimeDays = Number(row.lead_time_days);
    if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 3650) throw new PlatformError("VALIDATION_FAILED", `Supplier row ${index + 2} has invalid payment terms`, 400);
    if (!Number.isInteger(leadTimeDays) || leadTimeDays < 0 || leadTimeDays > 3650) throw new PlatformError("VALIDATION_FAILED", `Supplier row ${index + 2} has invalid lead time`, 400);
    return {
      id, code,
      legalName: row.legal_name!.trim(),
      displayName: row.display_name!.trim(),
      currency, paymentTermsDays, leadTimeDays,
      ...(row.email?.trim() ? { email: row.email.trim() } : {}),
      ...(row.phone?.trim() ? { phone: row.phone.trim() } : {}),
    };
  });
}

export function supplierFromImport(tenantId: string, legalEntityId: string, row: SupplierImportRow): Omit<Supplier, "createdAt" | "updatedAt" | "version"> {
  return {
    id: row.id, tenantId, legalEntityId, code: row.code, legalName: row.legalName, displayName: row.displayName,
    status: "active", currency: row.currency, paymentTermsDays: row.paymentTermsDays, leadTimeDays: row.leadTimeDays,
    ...(row.email === undefined ? {} : { email: row.email }), ...(row.phone === undefined ? {} : { phone: row.phone }),
  };
}

export function exportSuppliers(suppliers: readonly Supplier[]): string {
  return exportCsv(["id", "code", "legal_name", "display_name", "status", "currency", "payment_terms_days", "lead_time_days", "email", "phone", "updated_at"], suppliers.map((supplier) => ({
    id: supplier.id, code: supplier.code, legal_name: supplier.legalName, display_name: supplier.displayName,
    status: supplier.status, currency: supplier.currency, payment_terms_days: supplier.paymentTermsDays.toString(),
    lead_time_days: supplier.leadTimeDays.toString(), email: supplier.email ?? "", phone: supplier.phone ?? "", updated_at: supplier.updatedAt,
  })));
}

export function exportPurchaseOrders(orders: readonly PurchaseOrder[]): string {
  return exportCsv(["order_id", "order_number", "supplier_id", "warehouse_id", "state", "currency", "line_id", "variant_id", "ordered_quantity", "quantity_scale", "unit", "unit_cost_minor", "received_quantity", "returned_quantity", "promised_date"], orders.flatMap((order) => order.lines.map((line) => ({
    order_id: order.id, order_number: order.orderNumber, supplier_id: order.supplierId, warehouse_id: order.warehouseId,
    state: order.state, currency: order.currency, line_id: line.id, variant_id: line.item.variantId,
    ordered_quantity: line.quantity.amount, quantity_scale: line.quantity.scale.toString(), unit: line.quantity.unit,
    unit_cost_minor: line.unitCost.amountMinor, received_quantity: line.receivedQuantity, returned_quantity: line.returnedQuantity,
    promised_date: line.promisedDate ?? "",
  }))));
}

export function exportGoodsReceipts(receipts: readonly GoodsReceipt[]): string {
  return exportCsv(["receipt_id", "receipt_number", "purchase_order_id", "supplier_id", "warehouse_id", "line_id", "purchase_order_line_id", "variant_id", "quantity", "quantity_scale", "unit", "disposition", "batch_id", "expiry_date", "posting_group_id", "received_at"], receipts.flatMap((receipt) => receipt.lines.map((line) => ({
    receipt_id: receipt.id, receipt_number: receipt.receiptNumber, purchase_order_id: receipt.purchaseOrderId,
    supplier_id: receipt.supplierId, warehouse_id: receipt.warehouseId, line_id: line.id,
    purchase_order_line_id: line.purchaseOrderLineId, variant_id: line.item.variantId,
    quantity: line.receivedQuantity.amount, quantity_scale: line.receivedQuantity.scale.toString(), unit: line.receivedQuantity.unit,
    disposition: line.disposition, batch_id: line.batchId ?? "", expiry_date: line.expiryDate ?? "",
    posting_group_id: receipt.postingGroupId, received_at: receipt.receivedAt,
  }))));
}
