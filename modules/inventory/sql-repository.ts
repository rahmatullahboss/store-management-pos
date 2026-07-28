import type { StockAvailabilityV1 } from "../../packages/contracts/src/v1/index.js";
import type { RequestContext } from "../../packages/foundation/src/context.js";
import type { TransactionClient } from "../../packages/foundation/src/db.js";
import { PlatformError } from "../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../packages/foundation/src/ids.js";
import type { StockPostingResult } from "./inventory-service.js";
import type { CostConsumption, StockLedgerEntry, StockPostingCommand, StockPostingLine, StockStatus } from "./types.js";

export interface InventoryBalanceRow extends Record<string, unknown> {
  readonly variant_id: string;
  readonly warehouse_id: string;
  readonly quantity_amount: string;
  readonly quantity_scale: number;
  readonly unit_code: string;
  readonly reserved_amount: string;
  readonly updated_at: string;
  readonly version: string;
}

interface LedgerRow extends Record<string, unknown> {
  readonly id: string;
  readonly operation_id: string;
  readonly posting_group_id: string;
  readonly tenant_id: string;
  readonly legal_entity_id: string;
  readonly variant_id: string;
  readonly warehouse_id: string;
  readonly bin_id: string | null;
  readonly stock_status: StockStatus;
  readonly batch_id: string | null;
  readonly serial_id: string | null;
  readonly expiry_date: string | null;
  readonly quantity_amount: string;
  readonly quantity_scale: number;
  readonly unit_code: string;
  readonly unit_cost_minor: string | null;
  readonly currency: string | null;
  readonly value_delta_minor: string | null;
  readonly movement_type: StockLedgerEntry["movementType"];
  readonly source_document_type: string;
  readonly source_document_id: string;
  readonly source_document_line_id: string | null;
  readonly business_date: string;
  readonly posted_at: string;
  readonly actor_id: string;
  readonly request_id: string;
  readonly trace_id: string;
  readonly reversal_of_entry_id: string | null;
}

interface CostLayerRow extends Record<string, unknown> {
  readonly id: string;
  readonly original_quantity: string;
  readonly remaining_quantity: string;
  readonly quantity_scale: number;
  readonly unit_code: string;
  readonly unit_cost_minor: string;
  readonly currency: string;
  readonly landed_cost_minor: string;
}

const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/u;
const INTEGER_PATTERN = /^-?\d+$/u;

function factor(scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) throw new PlatformError("VALIDATION_FAILED", "Quantity scale must be between 0 and 18", 400);
  return 10n ** BigInt(scale);
}

function parseQuantity(line: StockPostingLine): bigint {
  const raw = line.quantityDelta.amount.trim();
  if (!DECIMAL_PATTERN.test(raw)) throw new PlatformError("VALIDATION_FAILED", "Quantity must be an exact decimal string", 400);
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  if (fraction.length > line.quantityDelta.scale) throw new PlatformError("VALIDATION_FAILED", "Quantity precision exceeds scale", 400);
  const normalized = `${whole}${fraction.padEnd(line.quantityDelta.scale, "0")}`.replace(/^0+(?=\d)/u, "");
  const value = BigInt(normalized || "0");
  return negative ? -value : value;
}

function parseMinor(value: string | undefined): bigint | undefined {
  if (value === undefined) return undefined;
  if (!INTEGER_PATTERN.test(value)) throw new PlatformError("VALIDATION_FAILED", "Money values must be integer minor-unit strings", 400);
  return BigInt(value);
}

function formatQuantity(value: bigint, scale: number): string {
  if (scale === 0) return value.toString();
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const raw = absolute.toString().padStart(scale + 1, "0");
  const whole = raw.slice(0, -scale);
  const fraction = raw.slice(-scale).replace(/0+$/u, "");
  const formatted = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  return negative ? `-${formatted}` : formatted;
}

function rowToEntry(row: LedgerRow): StockLedgerEntry {
  return {
    id: row.id,
    operationId: row.operation_id,
    postingGroupId: row.posting_group_id,
    tenantId: row.tenant_id,
    legalEntityId: row.legal_entity_id,
    variantId: row.variant_id,
    warehouseId: row.warehouse_id,
    ...(row.bin_id === null ? {} : { binId: row.bin_id }),
    stockStatus: row.stock_status,
    ...(row.batch_id === null ? {} : { batchId: row.batch_id }),
    ...(row.serial_id === null ? {} : { serialId: row.serial_id }),
    ...(row.expiry_date === null ? {} : { expiryDate: row.expiry_date }),
    quantityDelta: BigInt(row.quantity_amount),
    quantityScale: row.quantity_scale,
    unit: row.unit_code,
    ...(row.unit_cost_minor === null ? {} : { unitCostMinor: BigInt(row.unit_cost_minor) }),
    ...(row.currency === null ? {} : { currency: row.currency }),
    ...(row.value_delta_minor === null ? {} : { valueDeltaMinor: BigInt(row.value_delta_minor) }),
    movementType: row.movement_type,
    sourceDocumentType: row.source_document_type,
    sourceDocumentId: row.source_document_id,
    ...(row.source_document_line_id === null ? {} : { sourceDocumentLineId: row.source_document_line_id }),
    businessDate: row.business_date,
    postedAt: row.posted_at,
    actorId: row.actor_id,
    requestId: row.request_id,
    traceId: row.trace_id,
    ...(row.reversal_of_entry_id === null ? {} : { reversalOfEntryId: row.reversal_of_entry_id }),
  };
}

const ledgerSelect = `SELECT id::text, operation_id, posting_group_id, tenant_id::text, legal_entity_id::text,
  variant_id::text, warehouse_id::text, bin_id::text, stock_status, batch_id::text, serial_id::text,
  expiry_date::text, quantity_amount::text, quantity_scale, unit_code, unit_cost_minor::text, currency,
  value_delta_minor::text, movement_type, source_document_type, source_document_id, source_document_line_id,
  business_date::text, posted_at::text, actor_id::text, request_id, trace_id, reversal_of_entry_id::text
  FROM inventory.stock_ledger_entries`;

export class InventorySqlRepository {
  async postStock(client: TransactionClient, context: RequestContext, command: StockPostingCommand): Promise<StockPostingResult> {
    if (command.context.tenantId !== context.tenantId) throw new PlatformError("PERMISSION_DENIED", "Tenant context mismatch", 403);
    if (command.lines.length === 0) throw new PlatformError("VALIDATION_FAILED", "Stock posting requires at least one line", 400);
    const replay = await client.query<LedgerRow>(`${ledgerSelect} WHERE tenant_id = $1::uuid AND operation_id = $2 ORDER BY operation_line_index`, [context.tenantId, command.operationId]);
    if (replay.rows.length > 0) {
      const entries = replay.rows.map(rowToEntry);
      return { operationId: command.operationId, postingGroupId: command.postingGroupId, entries, costConsumptions: [], replayed: true, postedAt: entries[0]!.postedAt };
    }

    const legalEntityId = command.context.legalEntityId ?? context.legalEntityId;
    if (legalEntityId === undefined) throw new PlatformError("VALIDATION_FAILED", "Legal entity context is required for stock posting", 400);
    const postedAt = new Date().toISOString();
    const entries: StockLedgerEntry[] = [];
    const costConsumptions: CostConsumption[] = [];
    const pairedUnitCosts = new Map<string, { readonly unitCostMinor: bigint; readonly currency: string }>();

    for (const [lineIndex, line] of command.lines.entries()) {
      const quantity = parseQuantity(line);
      if (quantity === 0n && command.movementType !== "landed_cost_revaluation") throw new PlatformError("VALIDATION_FAILED", "Stock quantity cannot be zero", 400);
      const stockStatus = line.stockStatus ?? "sellable";
      let unitCostMinor = parseMinor(line.unitCostMinor);
      const pairKey = `${line.sourceDocumentLineId ?? line.sourceDocumentId}::${line.item.variantId}::${line.quantityDelta.unit}::${line.quantityDelta.scale}`;
      const paired = pairedUnitCosts.get(pairKey);
      let currency = line.currency ?? paired?.currency;
      if (unitCostMinor === undefined && paired !== undefined) unitCostMinor = paired.unitCostMinor;
      let valueDeltaMinor: bigint | undefined;
      const entryId = uuidV7();
      const pendingConsumptions: CostConsumption[] = [];

      if (quantity < 0n && stockStatus !== "in_transit") {
        let remaining = -quantity;
        let consumedValue = 0n;
        const layers = await client.query<CostLayerRow>(
          `SELECT layer.id::text, layer.original_quantity::text, layer.remaining_quantity::text,
                  layer.quantity_scale, layer.unit_code, layer.unit_cost_minor::text, layer.currency,
                  COALESCE((
                    SELECT SUM(adjustment.amount_minor)
                      FROM inventory.cost_layer_adjustments adjustment
                     WHERE adjustment.tenant_id = layer.tenant_id
                       AND adjustment.cost_layer_id = layer.id
                  ), 0)::text AS landed_cost_minor
             FROM inventory.cost_layers layer
            WHERE layer.tenant_id = $1::uuid
              AND layer.warehouse_id = $2::uuid
              AND layer.variant_id = $3::uuid
              AND layer.remaining_quantity > 0
              AND ($4::uuid IS NULL OR layer.batch_id = $4::uuid)
              AND ($5::uuid IS NULL OR layer.serial_id = $5::uuid)
            ORDER BY layer.received_at, layer.id
            FOR UPDATE OF layer`,
          [context.tenantId, line.warehouseId, line.item.variantId, line.batchId ?? null, line.serialId ?? null],
        );
        for (const layer of layers.rows) {
          if (remaining === 0n) break;
          if (layer.quantity_scale !== line.quantityDelta.scale || layer.unit_code !== line.quantityDelta.unit) throw new PlatformError("CONFLICT", "Cost layer dimensions do not match stock issue", 409);
          const layerRemaining = BigInt(layer.remaining_quantity);
          const consumed = layerRemaining < remaining ? layerRemaining : remaining;
          const original = BigInt(layer.original_quantity);
          const layerValue = original * BigInt(layer.unit_cost_minor) / factor(layer.quantity_scale) + BigInt(layer.landed_cost_minor);
          const effectiveUnitCost = layerValue * factor(layer.quantity_scale) / original;
          const value = consumed * effectiveUnitCost / factor(layer.quantity_scale);
          const consumptionId = uuidV7();
          await client.query(
            `UPDATE inventory.cost_layers
                SET remaining_quantity = remaining_quantity - $3::numeric,
                    status = CASE WHEN remaining_quantity - $3::numeric = 0 THEN 'consumed' ELSE status END,
                    updated_at = now(), version = version + 1
              WHERE tenant_id = $1::uuid AND id = $2::uuid`,
            [context.tenantId, layer.id, consumed.toString()],
          );
          pendingConsumptions.push({ id: consumptionId, tenantId: context.tenantId, issueLedgerEntryId: entryId, costLayerId: layer.id, quantity: consumed, quantityScale: layer.quantity_scale, unitCostMinor: effectiveUnitCost, valueMinor: value, createdAt: postedAt });
          remaining -= consumed;
          consumedValue += value;
        }
        valueDeltaMinor = -consumedValue;
        if (unitCostMinor === undefined && -quantity - remaining > 0n) unitCostMinor = consumedValue * factor(line.quantityDelta.scale) / (-quantity - remaining);
      } else if (quantity < 0n && stockStatus === "in_transit") {
        const balance = await client.query<{ quantity_amount: string; value_minor: string; currency: string | null } & Record<string, unknown>>(
          `SELECT SUM(quantity_amount)::text AS quantity_amount, SUM(value_minor)::text AS value_minor, MAX(currency) AS currency
             FROM inventory.stock_balances
            WHERE tenant_id = $1::uuid AND warehouse_id = $2::uuid AND variant_id = $3::uuid
              AND stock_status = 'in_transit' AND unit_code = $4 AND quantity_scale = $5`,
          [context.tenantId, line.warehouseId, line.item.variantId, line.quantityDelta.unit, line.quantityDelta.scale],
        );
        const onHand = BigInt(balance.rows[0]?.quantity_amount ?? "0");
        const value = BigInt(balance.rows[0]?.value_minor ?? "0");
        if (onHand <= 0n || -quantity > onHand) throw new PlatformError("CONFLICT", "In-transit issue exceeds available quantity", 409);
        unitCostMinor = value * factor(line.quantityDelta.scale) / onHand;
        currency = balance.rows[0]?.currency ?? currency;
        valueDeltaMinor = quantity * unitCostMinor / factor(line.quantityDelta.scale);
      } else if (unitCostMinor !== undefined) {
        valueDeltaMinor = quantity * unitCostMinor / factor(line.quantityDelta.scale);
      }
      if (quantity < 0n && unitCostMinor !== undefined && currency !== undefined) pairedUnitCosts.set(pairKey, { unitCostMinor, currency });

      const inserted = await client.query<LedgerRow>(
        `INSERT INTO inventory.stock_ledger_entries(
           id, tenant_id, legal_entity_id, operation_id, operation_line_index, posting_group_id,
           variant_id, warehouse_id, bin_id, stock_status, batch_id, serial_id, expiry_date,
           quantity_amount, quantity_scale, unit_code, unit_cost_minor, currency, value_delta_minor,
           movement_type, source_document_type, source_document_id, source_document_line_id,
           business_date, posted_at, actor_id, request_id, trace_id, approval_id, reversal_of_entry_id
         ) VALUES (
           $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::uuid,$8::uuid,$9::uuid,$10,$11::uuid,$12::uuid,$13::date,
           $14::numeric,$15,$16,$17::numeric,$18,$19::numeric,$20,$21,$22,$23,$24::date,$25::timestamptz,
           $26::uuid,$27,$28,$29::uuid,$30::uuid
         ) RETURNING id::text, operation_id, posting_group_id, tenant_id::text, legal_entity_id::text,
           variant_id::text, warehouse_id::text, bin_id::text, stock_status, batch_id::text, serial_id::text,
           expiry_date::text, quantity_amount::text, quantity_scale, unit_code, unit_cost_minor::text, currency,
           value_delta_minor::text, movement_type, source_document_type, source_document_id, source_document_line_id,
           business_date::text, posted_at::text, actor_id::text, request_id, trace_id, reversal_of_entry_id::text`,
        [
          entryId, context.tenantId, legalEntityId, command.operationId, lineIndex, command.postingGroupId,
          line.item.variantId, line.warehouseId, line.binId ?? null, stockStatus, line.batchId ?? null, line.serialId ?? null, line.expiryDate ?? null,
          quantity.toString(), line.quantityDelta.scale, line.quantityDelta.unit, unitCostMinor?.toString() ?? null,
          currency ?? null, valueDeltaMinor?.toString() ?? null, command.movementType, command.sourceDocumentType,
          line.sourceDocumentId, line.sourceDocumentLineId ?? null, command.context.businessDate, postedAt,
          command.audit.actorId, command.audit.requestId, command.audit.traceId, command.approvalId ?? null, line.reversalOfEntryId ?? null,
        ],
      );
      const entry = rowToEntry(inserted.rows[0]!);
      entries.push(entry);

      for (const consumption of pendingConsumptions) {
        await client.query(
          `INSERT INTO inventory.cost_consumptions(
             id, tenant_id, issue_ledger_entry_id, cost_layer_id, quantity, quantity_scale, unit_cost_minor, value_minor
           ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::numeric,$6,$7::numeric,$8::numeric)`,
          [consumption.id, consumption.tenantId, consumption.issueLedgerEntryId, consumption.costLayerId, consumption.quantity.toString(), consumption.quantityScale, consumption.unitCostMinor.toString(), consumption.valueMinor.toString()],
        );
        costConsumptions.push(consumption);
      }

      if (quantity > 0n && unitCostMinor !== undefined && currency !== undefined && stockStatus !== "in_transit") {
        await client.query(
          `INSERT INTO inventory.cost_layers(
             id, tenant_id, warehouse_id, variant_id, batch_id, serial_id, receipt_ledger_entry_id,
             received_at, original_quantity, remaining_quantity, quantity_scale, unit_code, unit_cost_minor, currency
           ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::timestamptz,$9::numeric,$9::numeric,$10,$11,$12::numeric,$13)`,
          [uuidV7(), context.tenantId, line.warehouseId, line.item.variantId, line.batchId ?? null, line.serialId ?? null, entry.id, postedAt, quantity.toString(), line.quantityDelta.scale, line.quantityDelta.unit, unitCostMinor.toString(), currency],
        );
      }
    }

    await client.query(
      `INSERT INTO platform.audit_events(
         id, tenant_id, event_type, action, outcome, actor_id, approver_id, impersonator_id,
         target_type, target_id, reason, request_id, trace_id, device_id, metadata, business_date, source_version
       ) VALUES ($1::uuid,$2::uuid,'inventory.stock.posted.v1','stock.post','success',$3::uuid,$4::uuid,$5::uuid,
         'posting_group',$6,$7,$8,$9,$10::uuid,$11::jsonb,$12::date,'MOD-B-v1')`,
      [uuidV7(), context.tenantId, context.actorId, command.audit.approverId ?? null, context.impersonatorId ?? null, command.postingGroupId, command.audit.reason ?? null, context.requestId, context.traceId, context.deviceId ?? null, JSON.stringify({ operationId: command.operationId, movementType: command.movementType, entryIds: entries.map((entry) => entry.id) }), context.businessDate],
    );
    await client.query(
      `INSERT INTO platform.outbox_events(
         id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version, payload, metadata,
         correlation_id, causation_id, business_date
       ) VALUES ($1::uuid,$2::uuid,'inventory.stock.posted.v1','posting_group',$3,'1.0',$4::jsonb,$5::jsonb,$6,$7,$8::date)`,
      [uuidV7(), context.tenantId, command.postingGroupId, JSON.stringify({ operationId: command.operationId, movementType: command.movementType, entries: entries.map((entry) => ({ id: entry.id, variantId: entry.variantId, warehouseId: entry.warehouseId, quantityDelta: entry.quantityDelta.toString(), quantityScale: entry.quantityScale, unit: entry.unit })) }), JSON.stringify({ actorId: context.actorId, requestId: context.requestId, traceId: context.traceId }), command.postingGroupId, command.operationId, context.businessDate],
    );
    return { operationId: command.operationId, postingGroupId: command.postingGroupId, entries, costConsumptions, replayed: false, postedAt };
  }

  async availability(client: TransactionClient, context: RequestContext, input: { readonly variantId: string; readonly warehouseId: string }): Promise<StockAvailabilityV1> {
    const result = await client.query<InventoryBalanceRow>(
      `SELECT b.variant_id::text,
              b.warehouse_id::text,
              b.quantity_amount::text,
              b.quantity_scale,
              b.unit_code,
              COALESCE(r.reserved_amount, 0)::text AS reserved_amount,
              b.updated_at::text,
              b.version::text
         FROM inventory.stock_balances b
         LEFT JOIN LATERAL (
           SELECT SUM(l.reserved_quantity - l.consumed_quantity - l.released_quantity) AS reserved_amount
             FROM inventory.stock_reservation_lines l
             JOIN inventory.stock_reservations h
               ON h.tenant_id = l.tenant_id AND h.id = l.reservation_id
            WHERE l.tenant_id = b.tenant_id
              AND l.variant_id = b.variant_id
              AND l.warehouse_id = b.warehouse_id
              AND l.unit_code = b.unit_code
              AND l.quantity_scale = b.quantity_scale
              AND h.state IN ('fully_reserved','partially_reserved','partially_consumed')
         ) r ON true
        WHERE b.tenant_id = $1::uuid
          AND b.variant_id = $2::uuid
          AND b.warehouse_id = $3::uuid
          AND b.stock_status = 'sellable'
        ORDER BY b.updated_at DESC
        LIMIT 1`,
      [context.tenantId, input.variantId, input.warehouseId],
    );
    const row = result.rows[0];
    const scale = row?.quantity_scale ?? 0;
    const unit = row?.unit_code ?? "EA";
    const onHand = BigInt(row?.quantity_amount ?? "0");
    const reserved = BigInt(row?.reserved_amount ?? "0");
    const available = onHand - reserved;
    return {
      variantId: input.variantId,
      warehouseId: input.warehouseId,
      onHand: { amount: formatQuantity(onHand, scale), unit, scale },
      reserved: { amount: formatQuantity(reserved, scale), unit, scale },
      available: { amount: formatQuantity(available, scale), unit, scale },
      asOf: row?.updated_at ?? new Date(0).toISOString(),
      version: row?.version ?? "0",
    };
  }

  async listMovement(client: TransactionClient, context: RequestContext, input: { readonly variantId?: string; readonly warehouseId?: string; readonly limit?: number }): Promise<readonly Record<string, unknown>[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
    const result = await client.query(
      `SELECT id::text,
              operation_id,
              posting_group_id,
              variant_id::text,
              warehouse_id::text,
              stock_status,
              quantity_amount::text,
              quantity_scale,
              unit_code,
              unit_cost_minor::text,
              currency,
              value_delta_minor::text,
              movement_type,
              source_document_type,
              source_document_id,
              source_document_line_id,
              business_date::text,
              posted_at::text,
              reversal_of_entry_id::text
         FROM inventory.stock_ledger_entries
        WHERE tenant_id = $1::uuid
          AND ($2::uuid IS NULL OR variant_id = $2::uuid)
          AND ($3::uuid IS NULL OR warehouse_id = $3::uuid)
        ORDER BY posted_at DESC, sequence_id DESC
        LIMIT $4`,
      [context.tenantId, input.variantId ?? null, input.warehouseId ?? null, limit],
    );
    return result.rows;
  }

  async reconciliationSummary(client: TransactionClient, context: RequestContext): Promise<readonly Record<string, unknown>[]> {
    const result = await client.query(
      `WITH ledger AS (
         SELECT tenant_id, warehouse_id, variant_id, stock_status, unit_code, quantity_scale,
                SUM(quantity_amount) AS quantity_amount,
                SUM(COALESCE(value_delta_minor, 0)) AS value_minor
           FROM inventory.stock_ledger_entries
          WHERE tenant_id = $1::uuid
          GROUP BY tenant_id, warehouse_id, variant_id, stock_status, unit_code, quantity_scale
       ), balances AS (
         SELECT tenant_id, warehouse_id, variant_id, stock_status, unit_code, quantity_scale,
                SUM(quantity_amount) AS quantity_amount, SUM(value_minor) AS value_minor
           FROM inventory.stock_balances
          WHERE tenant_id = $1::uuid
          GROUP BY tenant_id, warehouse_id, variant_id, stock_status, unit_code, quantity_scale
       )
       SELECT COALESCE(l.warehouse_id, b.warehouse_id)::text AS warehouse_id,
              COALESCE(l.variant_id, b.variant_id)::text AS variant_id,
              COALESCE(l.stock_status, b.stock_status) AS stock_status,
              COALESCE(l.unit_code, b.unit_code) AS unit_code,
              COALESCE(l.quantity_scale, b.quantity_scale) AS quantity_scale,
              COALESCE(l.quantity_amount, 0)::text AS ledger_quantity,
              COALESCE(b.quantity_amount, 0)::text AS projection_quantity,
              (COALESCE(l.quantity_amount, 0) = COALESCE(b.quantity_amount, 0)) AS matched
         FROM ledger l
         FULL OUTER JOIN balances b
           ON b.tenant_id = l.tenant_id
          AND b.warehouse_id = l.warehouse_id
          AND b.variant_id = l.variant_id
          AND b.stock_status = l.stock_status
          AND b.unit_code = l.unit_code
          AND b.quantity_scale = l.quantity_scale`,
      [context.tenantId],
    );
    return result.rows;
  }
}
