import type { QuantityV1 } from "../../packages/contracts/src/v1/index.js";
import type { RequestContext } from "../../packages/foundation/src/context.js";
import type { TransactionClient } from "../../packages/foundation/src/db.js";
import { PlatformError } from "../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../packages/foundation/src/ids.js";
import { InventorySqlRepository } from "../inventory/sql-repository.js";
import type { StockPostingCommand, StockPostingLine, StockStatus } from "../inventory/types.js";

const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/u;
const INTEGER_PATTERN = /^-?\d+$/u;

function factor(scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) throw new PlatformError("VALIDATION_FAILED", "Scale must be between 0 and 18", 400);
  return 10n ** BigInt(scale);
}

function parseQuantity(quantity: QuantityV1): bigint {
  const raw = quantity.amount.trim();
  if (!DECIMAL_PATTERN.test(raw)) throw new PlatformError("VALIDATION_FAILED", "Quantity must be an exact decimal string", 400);
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  if (fraction.length > quantity.scale) throw new PlatformError("VALIDATION_FAILED", "Quantity precision exceeds scale", 400);
  const normalized = `${whole}${fraction.padEnd(quantity.scale, "0")}`.replace(/^0+(?=\d)/u, "");
  const value = BigInt(normalized || "0");
  return negative ? -value : value;
}

function parseMinor(value: string): bigint {
  if (!INTEGER_PATTERN.test(value)) throw new PlatformError("VALIDATION_FAILED", "Money must be an integer minor-unit string", 400);
  return BigInt(value);
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new PlatformError("VALIDATION_FAILED", `${field} is required`, 400);
  return normalized;
}

interface SupplierRow extends Record<string, unknown> {
  readonly id: string;
  readonly legal_entity_id: string;
  readonly code: string;
  readonly legal_name: string;
  readonly display_name: string;
  readonly status: string;
  readonly currency: string;
  readonly payment_terms_days: number;
  readonly lead_time_days: number;
  readonly tax_registration: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly version: string;
}

interface PurchaseOrderHeaderRow extends Record<string, unknown> {
  readonly id: string;
  readonly legal_entity_id: string;
  readonly supplier_id: string;
  readonly order_number: string;
  readonly state: string;
  readonly currency: string;
  readonly warehouse_id: string;
  readonly revision: number;
  readonly version: string;
}

interface PurchaseOrderLineRow extends Record<string, unknown> {
  readonly id: string;
  readonly item_id: string;
  readonly variant_id: string;
  readonly warehouse_id: string;
  readonly ordered_quantity: string;
  readonly received_quantity: string;
  readonly returned_quantity: string;
  readonly cancelled_quantity: string;
  readonly quantity_scale: number;
  readonly unit_code: string;
  readonly unit_cost_minor: string;
  readonly currency: string;
  readonly over_receipt_tolerance_basis_points: number;
}

export interface CreateSupplierSqlInput {
  readonly id: string;
  readonly legalEntityId: string;
  readonly code: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly currency: string;
  readonly paymentTermsDays: number;
  readonly leadTimeDays: number;
  readonly taxRegistration?: string;
  readonly email?: string;
  readonly phone?: string;
}

export interface CreatePurchaseOrderSqlInput {
  readonly id: string;
  readonly legalEntityId: string;
  readonly supplierId: string;
  readonly orderNumber: string;
  readonly warehouseId: string;
  readonly lines: readonly {
    readonly id: string;
    readonly itemId: string;
    readonly variantId: string;
    readonly quantity: QuantityV1;
    readonly unitCostMinor: string;
    readonly taxCode?: string;
    readonly promisedDate?: string;
    readonly overReceiptToleranceBasisPoints?: number;
    readonly notes?: string;
  }[];
}

export interface ReceivePurchaseOrderSqlInput {
  readonly receiptId: string;
  readonly receiptNumber: string;
  readonly purchaseOrderId: string;
  readonly operationId: string;
  readonly postingGroupId: string;
  readonly lines: readonly {
    readonly id: string;
    readonly purchaseOrderLineId: string;
    readonly quantity: QuantityV1;
    readonly disposition: "accepted" | "quarantine" | "damaged" | "rejected";
    readonly batchId?: string;
    readonly serialIds?: readonly string[];
    readonly expiryDate?: string;
    readonly discrepancyReason?: string;
  }[];
}

export class ProcurementSqlRepository {
  constructor(private readonly inventory = new InventorySqlRepository()) {}

  async createSupplier(client: TransactionClient, context: RequestContext, input: CreateSupplierSqlInput): Promise<Record<string, unknown>> {
    if (!/^[A-Z]{3}$/u.test(input.currency)) throw new PlatformError("VALIDATION_FAILED", "Supplier currency must be ISO 4217", 400);
    if (!Number.isInteger(input.paymentTermsDays) || input.paymentTermsDays < 0 || input.paymentTermsDays > 3650) throw new PlatformError("VALIDATION_FAILED", "Payment terms are invalid", 400);
    if (!Number.isInteger(input.leadTimeDays) || input.leadTimeDays < 0 || input.leadTimeDays > 3650) throw new PlatformError("VALIDATION_FAILED", "Lead time is invalid", 400);
    const result = await client.query<SupplierRow>(
      `INSERT INTO procurement.suppliers(
         id, tenant_id, legal_entity_id, code, legal_name, display_name, currency,
         payment_terms_days, lead_time_days, tax_registration, email, phone
       ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (tenant_id, id) DO UPDATE SET id = EXCLUDED.id
       RETURNING id::text, legal_entity_id::text, code, legal_name, display_name, status, currency,
         payment_terms_days, lead_time_days, tax_registration, email, phone, created_at::text, updated_at::text, version::text`,
      [input.id, context.tenantId, input.legalEntityId, required(input.code, "Supplier code").toUpperCase(), required(input.legalName, "Supplier legal name"), required(input.displayName, "Supplier display name"), input.currency, input.paymentTermsDays, input.leadTimeDays, input.taxRegistration ?? null, input.email ?? null, input.phone ?? null],
    );
    await this.auditAndPublish(client, context, "procurement.supplier.created.v1", "supplier", input.id, { code: input.code });
    return result.rows[0]!;
  }

  async listSuppliers(client: TransactionClient, context: RequestContext, input: { readonly status?: string; readonly limit?: number }): Promise<readonly Record<string, unknown>[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
    const result = await client.query(
      `SELECT id::text, legal_entity_id::text, code, legal_name, display_name, status, currency,
              payment_terms_days, lead_time_days, tax_registration, email, phone, created_at::text, updated_at::text, version::text
         FROM procurement.suppliers
        WHERE tenant_id = $1::uuid
          AND ($2::text IS NULL OR status = $2)
        ORDER BY display_name, id
        LIMIT $3`,
      [context.tenantId, input.status ?? null, limit],
    );
    return result.rows;
  }

  async createPurchaseOrder(client: TransactionClient, context: RequestContext, input: CreatePurchaseOrderSqlInput): Promise<Record<string, unknown>> {
    if (input.lines.length === 0) throw new PlatformError("VALIDATION_FAILED", "Purchase order requires at least one line", 400);
    const supplier = await client.query<{ currency: string; status: string } & Record<string, unknown>>(
      `SELECT currency, status FROM procurement.suppliers WHERE tenant_id = $1::uuid AND id = $2::uuid FOR SHARE`,
      [context.tenantId, input.supplierId],
    );
    const supplierRow = supplier.rows[0];
    if (!supplierRow) throw new PlatformError("NOT_FOUND", "Supplier not found", 404);
    if (supplierRow.status !== "active") throw new PlatformError("CONFLICT", "Purchase orders require an active supplier", 409);
    const replay = await client.query(`SELECT id::text, order_number, state, currency, warehouse_id::text, revision, version::text FROM procurement.purchase_orders WHERE tenant_id = $1::uuid AND id = $2::uuid`, [context.tenantId, input.id]);
    if (replay.rows[0]) return replay.rows[0];
    await client.query(
      `INSERT INTO procurement.purchase_orders(
         id, tenant_id, legal_entity_id, supplier_id, order_number, currency, warehouse_id, requested_by
       ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::uuid,$8::uuid)`,
      [input.id, context.tenantId, input.legalEntityId, input.supplierId, required(input.orderNumber, "Purchase order number"), supplierRow.currency, input.warehouseId, context.actorId],
    );
    for (const line of input.lines) {
      const quantity = parseQuantity(line.quantity);
      if (quantity <= 0n) throw new PlatformError("VALIDATION_FAILED", "Purchase order quantity must be positive", 400);
      const unitCost = parseMinor(line.unitCostMinor);
      if (unitCost < 0n) throw new PlatformError("VALIDATION_FAILED", "Unit cost cannot be negative", 400);
      const tolerance = line.overReceiptToleranceBasisPoints ?? 0;
      if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 10_000) throw new PlatformError("VALIDATION_FAILED", "Over-receipt tolerance is invalid", 400);
      await client.query(
        `INSERT INTO procurement.purchase_order_lines(
           id, tenant_id, purchase_order_id, item_id, variant_id, warehouse_id,
           ordered_quantity, quantity_scale, unit_code, unit_cost_minor, currency,
           tax_code, promised_date, over_receipt_tolerance_basis_points, notes
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::numeric,$8,$9,$10::numeric,$11,$12,$13::date,$14,$15)`,
        [line.id, context.tenantId, input.id, line.itemId, line.variantId, input.warehouseId, quantity.toString(), line.quantity.scale, line.quantity.unit, unitCost.toString(), supplierRow.currency, line.taxCode ?? null, line.promisedDate ?? null, tolerance, line.notes ?? null],
      );
    }
    await this.auditAndPublish(client, context, "procurement.purchase_order.created.v1", "purchase_order", input.id, { orderNumber: input.orderNumber, supplierId: input.supplierId, lineCount: input.lines.length });
    return { id: input.id, order_number: input.orderNumber, state: "draft", currency: supplierRow.currency, warehouse_id: input.warehouseId, revision: 1, version: "1" };
  }

  async submitPurchaseOrder(client: TransactionClient, context: RequestContext, purchaseOrderId: string, expectedVersion: number): Promise<Record<string, unknown>> {
    const result = await client.query(
      `UPDATE procurement.purchase_orders
          SET state = 'submitted', submitted_by = $3::uuid, updated_at = now(), version = version + 1
        WHERE tenant_id = $1::uuid AND id = $2::uuid AND state = 'draft' AND version = $4
        RETURNING id::text, state, version::text, updated_at::text`,
      [context.tenantId, purchaseOrderId, context.actorId, expectedVersion],
    );
    if (result.rowCount !== 1) throw new PlatformError("VERSION_CONFLICT", "Purchase order state or version changed", 409);
    await this.auditAndPublish(client, context, "procurement.purchase_order.submitted.v1", "purchase_order", purchaseOrderId, { version: result.rows[0]!.version });
    return result.rows[0]!;
  }

  async approvePurchaseOrder(client: TransactionClient, context: RequestContext, input: { readonly purchaseOrderId: string; readonly approvalId: string; readonly expectedVersion: number }): Promise<Record<string, unknown>> {
    const approval = await client.query(
      `SELECT id::text FROM platform.approval_requests
        WHERE tenant_id = $1::uuid AND id = $2::uuid AND status = 'approved'
          AND target_type = 'purchase_order' AND target_id = $3`,
      [context.tenantId, input.approvalId, input.purchaseOrderId],
    );
    if (approval.rowCount !== 1) throw new PlatformError("PERMISSION_DENIED", "An approved purchase-order approval request is required", 403);
    const result = await client.query(
      `UPDATE procurement.purchase_orders
          SET state = 'approved', approved_by = $3::uuid, approval_id = $4::uuid, approved_at = now(), updated_at = now(), version = version + 1
        WHERE tenant_id = $1::uuid AND id = $2::uuid AND state = 'submitted' AND version = $5
        RETURNING id::text, state, approval_id::text, approved_at::text, version::text`,
      [context.tenantId, input.purchaseOrderId, context.actorId, input.approvalId, input.expectedVersion],
    );
    if (result.rowCount !== 1) throw new PlatformError("VERSION_CONFLICT", "Purchase order state or version changed", 409);
    await this.auditAndPublish(client, context, "procurement.purchase_order.approved.v1", "purchase_order", input.purchaseOrderId, { approvalId: input.approvalId });
    return result.rows[0]!;
  }

  async receivePurchaseOrder(client: TransactionClient, context: RequestContext, input: ReceivePurchaseOrderSqlInput): Promise<Record<string, unknown>> {
    if (input.lines.length === 0) throw new PlatformError("VALIDATION_FAILED", "Goods receipt requires at least one line", 400);
    const replay = await client.query(`SELECT id::text, receipt_number, state, posting_group_id, received_at::text FROM procurement.goods_receipts WHERE tenant_id = $1::uuid AND id = $2::uuid`, [context.tenantId, input.receiptId]);
    if (replay.rows[0]) return replay.rows[0];
    const headerResult = await client.query<PurchaseOrderHeaderRow>(
      `SELECT id::text, legal_entity_id::text, supplier_id::text, order_number, state, currency, warehouse_id::text, revision, version::text
         FROM procurement.purchase_orders
        WHERE tenant_id = $1::uuid AND id = $2::uuid FOR UPDATE`,
      [context.tenantId, input.purchaseOrderId],
    );
    const order = headerResult.rows[0];
    if (!order) throw new PlatformError("NOT_FOUND", "Purchase order not found", 404);
    if (!['approved', 'partially_received'].includes(order.state)) throw new PlatformError("CONFLICT", "Purchase order must be approved before receiving", 409);
    const poLinesResult = await client.query<PurchaseOrderLineRow>(
      `SELECT id::text, item_id::text, variant_id::text, warehouse_id::text,
              ordered_quantity::text, received_quantity::text, returned_quantity::text, cancelled_quantity::text,
              quantity_scale, unit_code, unit_cost_minor::text, currency, over_receipt_tolerance_basis_points
         FROM procurement.purchase_order_lines
        WHERE tenant_id = $1::uuid AND purchase_order_id = $2::uuid
        ORDER BY id FOR UPDATE`,
      [context.tenantId, input.purchaseOrderId],
    );
    const byId = new Map(poLinesResult.rows.map((line) => [line.id, line]));
    const increments = new Map<string, bigint>();
    const postingLines: StockPostingLine[] = [];
    const preparedLines: { input: ReceivePurchaseOrderSqlInput['lines'][number]; po: PurchaseOrderLineRow; quantity: bigint; ledgerIds: string[] }[] = [];
    for (const receiptLine of input.lines) {
      const poLine = byId.get(receiptLine.purchaseOrderLineId);
      if (!poLine) throw new PlatformError("VALIDATION_FAILED", "Receipt references an unknown purchase order line", 400);
      if (receiptLine.quantity.scale !== poLine.quantity_scale || receiptLine.quantity.unit !== poLine.unit_code) throw new PlatformError("VALIDATION_FAILED", "Receipt quantity dimensions do not match purchase order", 400);
      const quantity = parseQuantity(receiptLine.quantity);
      if (quantity <= 0n) throw new PlatformError("VALIDATION_FAILED", "Receipt quantity must be positive", 400);
      if (receiptLine.disposition === 'rejected' && !receiptLine.discrepancyReason?.trim()) throw new PlatformError("VALIDATION_FAILED", "Rejected receipt lines require a discrepancy reason", 400);
      const priorIncrement = increments.get(poLine.id) ?? 0n;
      if (receiptLine.disposition !== 'rejected') {
        const ordered = BigInt(poLine.ordered_quantity);
        const received = BigInt(poLine.received_quantity);
        const maximum = ordered * BigInt(10_000 + poLine.over_receipt_tolerance_basis_points) / 10_000n;
        if (received + priorIncrement + quantity > maximum) throw new PlatformError("CONFLICT", "Receipt exceeds purchase order tolerance", 409, { purchaseOrderLineId: poLine.id });
        increments.set(poLine.id, priorIncrement + quantity);
        const status: StockStatus = receiptLine.disposition === 'accepted' ? 'sellable' : receiptLine.disposition === 'quarantine' ? 'quarantine' : 'damaged';
        const serialIds = receiptLine.serialIds ?? [];
        if (serialIds.length > 0 && BigInt(serialIds.length) * factor(receiptLine.quantity.scale) !== quantity) throw new PlatformError("VALIDATION_FAILED", "Serial count must match received quantity", 400);
        if (serialIds.length > 0) {
          for (const serialId of serialIds) postingLines.push({ item: { itemId: poLine.item_id, variantId: poLine.variant_id }, warehouseId: poLine.warehouse_id, stockStatus: status, quantityDelta: { amount: '1', unit: poLine.unit_code, scale: poLine.quantity_scale }, unitCostMinor: poLine.unit_cost_minor, currency: poLine.currency, sourceDocumentId: input.receiptId, sourceDocumentLineId: receiptLine.id, ...(receiptLine.batchId ? { batchId: receiptLine.batchId } : {}), serialId, ...(receiptLine.expiryDate ? { expiryDate: receiptLine.expiryDate } : {}) });
        } else postingLines.push({ item: { itemId: poLine.item_id, variantId: poLine.variant_id }, warehouseId: poLine.warehouse_id, stockStatus: status, quantityDelta: { ...receiptLine.quantity }, unitCostMinor: poLine.unit_cost_minor, currency: poLine.currency, sourceDocumentId: input.receiptId, sourceDocumentLineId: receiptLine.id, ...(receiptLine.batchId ? { batchId: receiptLine.batchId } : {}), ...(receiptLine.expiryDate ? { expiryDate: receiptLine.expiryDate } : {}) });
      }
      preparedLines.push({ input: receiptLine, po: poLine, quantity, ledgerIds: [] });
    }
    await client.query(
      `INSERT INTO procurement.goods_receipts(
         id, tenant_id, legal_entity_id, supplier_id, purchase_order_id, receipt_number, warehouse_id,
         received_by, business_date, posting_group_id
       ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7::uuid,$8::uuid,$9::date,$10)`,
      [input.receiptId, context.tenantId, order.legal_entity_id, order.supplier_id, order.id, required(input.receiptNumber, "Receipt number"), order.warehouse_id, context.actorId, context.businessDate, input.postingGroupId],
    );
    const postingCommand: StockPostingCommand = {
      schemaVersion: '1.0',
      context: { tenantId: context.tenantId, legalEntityId: order.legal_entity_id, actorId: context.actorId, locale: context.locale, timeZone: context.timeZone, businessDate: context.businessDate },
      operationId: input.operationId,
      postingGroupId: input.postingGroupId,
      movementType: 'purchase_receipt',
      sourceDocumentType: 'goods_receipt',
      lines: postingLines,
      audit: { actorId: context.actorId, requestId: context.requestId, traceId: context.traceId },
    };
    const posting = postingLines.length === 0 ? undefined : await this.inventory.postStock(client, context, postingCommand);
    const ledgerByLine = new Map<string, string[]>();
    for (const entry of posting?.entries ?? []) {
      if (!entry.sourceDocumentLineId) continue;
      const ids = ledgerByLine.get(entry.sourceDocumentLineId) ?? [];
      ids.push(entry.id); ledgerByLine.set(entry.sourceDocumentLineId, ids);
    }
    for (const line of preparedLines) {
      await client.query(
        `INSERT INTO procurement.goods_receipt_lines(
           id, tenant_id, goods_receipt_id, purchase_order_line_id, item_id, variant_id, warehouse_id,
           received_quantity, quantity_scale, unit_code, disposition, unit_cost_minor, currency,
           batch_id, serial_ids, expiry_date, discrepancy_reason, stock_ledger_entry_ids
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::numeric,$9,$10,$11,$12::numeric,$13,$14::uuid,$15::uuid[],$16::date,$17,$18::uuid[])`,
        [line.input.id, context.tenantId, input.receiptId, line.po.id, line.po.item_id, line.po.variant_id, line.po.warehouse_id, line.quantity.toString(), line.po.quantity_scale, line.po.unit_code, line.input.disposition, line.po.unit_cost_minor, line.po.currency, line.input.batchId ?? null, line.input.serialIds ?? [], line.input.expiryDate ?? null, line.input.discrepancyReason ?? null, ledgerByLine.get(line.input.id) ?? []],
      );
    }
    for (const [lineId, increment] of increments) await client.query(`UPDATE procurement.purchase_order_lines SET received_quantity = received_quantity + $3::numeric, updated_at = now(), version = version + 1 WHERE tenant_id = $1::uuid AND id = $2::uuid`, [context.tenantId, lineId, increment.toString()]);
    const remaining = await client.query<{ remaining: string } & Record<string, unknown>>(
      `SELECT COUNT(*) FILTER (WHERE received_quantity + cancelled_quantity < ordered_quantity)::text AS remaining
         FROM procurement.purchase_order_lines WHERE tenant_id = $1::uuid AND purchase_order_id = $2::uuid`,
      [context.tenantId, order.id],
    );
    const nextState = BigInt(remaining.rows[0]?.remaining ?? '0') === 0n ? 'received' : 'partially_received';
    await client.query(`UPDATE procurement.purchase_orders SET state = $3, updated_at = now(), version = version + 1 WHERE tenant_id = $1::uuid AND id = $2::uuid`, [context.tenantId, order.id, nextState]);
    await this.auditAndPublish(client, context, "procurement.goods_receipt.posted.v1", "goods_receipt", input.receiptId, { purchaseOrderId: order.id, postingGroupId: input.postingGroupId, state: nextState });
    return { id: input.receiptId, receipt_number: input.receiptNumber, state: 'posted', posting_group_id: input.postingGroupId, purchase_order_state: nextState, received_at: posting?.postedAt ?? new Date().toISOString() };
  }

  async listOpenPurchaseOrders(client: TransactionClient, context: RequestContext, input: { readonly supplierId?: string; readonly warehouseId?: string; readonly limit?: number }): Promise<readonly Record<string, unknown>[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
    const result = await client.query(
      `SELECT po.id::text, po.order_number, po.supplier_id::text, po.warehouse_id::text, po.state,
              po.currency, po.revision, po.updated_at::text, po.version::text, COUNT(pol.id)::integer AS line_count
         FROM procurement.purchase_orders po
         JOIN procurement.purchase_order_lines pol ON pol.tenant_id = po.tenant_id AND pol.purchase_order_id = po.id
        WHERE po.tenant_id = $1::uuid AND po.state IN ('submitted','approved','partially_received')
          AND ($2::uuid IS NULL OR po.supplier_id = $2::uuid)
          AND ($3::uuid IS NULL OR po.warehouse_id = $3::uuid)
        GROUP BY po.id ORDER BY po.updated_at DESC LIMIT $4`,
      [context.tenantId, input.supplierId ?? null, input.warehouseId ?? null, limit],
    );
    return result.rows;
  }

  async supplierPerformance(client: TransactionClient, context: RequestContext): Promise<readonly Record<string, unknown>[]> {
    const result = await client.query(
      `SELECT s.id::text AS supplier_id, s.display_name,
              COUNT(DISTINCT po.id)::integer AS purchase_order_count,
              COUNT(DISTINCT gr.id)::integer AS receipt_count,
              COALESCE(AVG(EXTRACT(EPOCH FROM (gr.received_at - po.approved_at)) / 86400), 0)::numeric(12,2)::text AS average_receipt_days,
              COALESCE(SUM(CASE WHEN grl.disposition IN ('damaged','rejected','quarantine') THEN grl.received_quantity ELSE 0 END), 0)::text AS exception_quantity
         FROM procurement.suppliers s
         LEFT JOIN procurement.purchase_orders po ON po.tenant_id = s.tenant_id AND po.supplier_id = s.id
         LEFT JOIN procurement.goods_receipts gr ON gr.tenant_id = po.tenant_id AND gr.purchase_order_id = po.id
         LEFT JOIN procurement.goods_receipt_lines grl ON grl.tenant_id = gr.tenant_id AND grl.goods_receipt_id = gr.id
        WHERE s.tenant_id = $1::uuid GROUP BY s.id, s.display_name ORDER BY s.display_name`,
      [context.tenantId],
    );
    return result.rows;
  }

  private async auditAndPublish(client: TransactionClient, context: RequestContext, eventType: string, aggregateType: string, aggregateId: string, payload: Readonly<Record<string, unknown>>): Promise<void> {
    const eventId = uuidV7();
    await client.query(
      `INSERT INTO platform.audit_events(
         id, tenant_id, event_type, action, outcome, actor_id, impersonator_id, target_type, target_id,
         request_id, trace_id, device_id, metadata, business_date, source_version
       ) VALUES ($1::uuid,$2::uuid,$3,$4,'success',$5::uuid,$6::uuid,$7,$8,$9,$10,$11::uuid,$12::jsonb,$13::date,'MOD-B-v1')`,
      [uuidV7(), context.tenantId, eventType, eventType, context.actorId, context.impersonatorId ?? null, aggregateType, aggregateId, context.requestId, context.traceId, context.deviceId ?? null, JSON.stringify(payload), context.businessDate],
    );
    await client.query(
      `INSERT INTO platform.outbox_events(
         id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version, payload, metadata,
         correlation_id, causation_id, business_date
       ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,'1.0',$6::jsonb,$7::jsonb,$8,$9,$10::date)`,
      [eventId, context.tenantId, eventType, aggregateType, aggregateId, JSON.stringify(payload), JSON.stringify({ actorId: context.actorId, requestId: context.requestId, traceId: context.traceId }), context.traceId, context.requestId, context.businessDate],
    );
  }
}
