import type { QuantityV1, StockAvailabilityV1, StockPostingRequestV1 } from "../../packages/contracts/src/v1/index.js";
import { PlatformError } from "../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../packages/foundation/src/ids.js";
import type {
  CostConsumption,
  CostLayer,
  InventoryBalance,
  InventoryEvent,
  InventoryReconciliation,
  MovementType,
  ReservationLine,
  ReservationRequest,
  StockCount,
  StockCountLine,
  StockLedgerEntry,
  StockPostingCommand,
  StockPostingLine,
  StockReservation,
  StockStatus,
  StockTransfer,
  StockTransferLine,
  Warehouse,
  WarehouseBin,
  WarehouseZone,
} from "./types.js";

export interface StockPostingResult {
  readonly operationId: string;
  readonly postingGroupId: string;
  readonly entries: readonly StockLedgerEntry[];
  readonly costConsumptions: readonly CostConsumption[];
  readonly replayed: boolean;
  readonly postedAt: string;
}

export interface InventoryServiceOptions {
  readonly now?: () => Date;
  readonly idFactory?: () => string;
  readonly onEvent?: (event: InventoryEvent) => void;
}

interface ProjectionValue {
  quantity: bigint;
  valueMinor: bigint;
  currency?: string;
  asOf: string;
}

interface MutableCostLayer {
  readonly id: string;
  readonly tenantId: string;
  readonly warehouseId: string;
  readonly variantId: string;
  readonly batchId?: string;
  readonly serialId?: string;
  readonly receiptLedgerEntryId: string;
  readonly receivedAt: string;
  readonly originalQuantity: bigint;
  remainingQuantity: bigint;
  readonly quantityScale: number;
  readonly unit: string;
  readonly unitCostMinor: bigint;
  readonly currency: string;
}

interface CostLayerAdjustment {
  readonly id: string;
  readonly tenantId: string;
  readonly layerId: string;
  readonly amountMinor: bigint;
  readonly sourceDocumentId: string;
  readonly createdAt: string;
}

const INTEGER_PATTERN = /^-?\d+$/u;
const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/u;

function key(...parts: readonly string[]): string {
  return parts.join("::");
}

function scaleFactor(scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) throw new PlatformError("VALIDATION_FAILED", "Quantity scale must be between 0 and 18", 400);
  return 10n ** BigInt(scale);
}

function parseQuantity(input: QuantityV1): bigint {
  const raw = input.amount.trim();
  if (!DECIMAL_PATTERN.test(raw)) throw new PlatformError("VALIDATION_FAILED", "Quantity amount must be an exact decimal string", 400);
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  if (fraction.length > input.scale) throw new PlatformError("VALIDATION_FAILED", "Quantity precision exceeds declared scale", 400);
  const normalized = `${whole}${fraction.padEnd(input.scale, "0")}`.replace(/^0+(?=\d)/u, "");
  const amount = BigInt(normalized || "0");
  return negative ? -amount : amount;
}

function formatQuantity(amount: bigint, scale: number): string {
  if (scale === 0) return amount.toString();
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const raw = absolute.toString().padStart(scale + 1, "0");
  const whole = raw.slice(0, -scale);
  const fraction = raw.slice(-scale).replace(/0+$/u, "");
  const text = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  return negative ? `-${text}` : text;
}

function parseMinor(value: string | undefined, field: string): bigint | undefined {
  if (value === undefined) return undefined;
  if (!INTEGER_PATTERN.test(value)) throw new PlatformError("VALIDATION_FAILED", `${field} must be an integer minor-unit string`, 400);
  return BigInt(value);
}

function quantityValue(quantity: bigint, scale: number, unitCostMinor: bigint): bigint {
  return quantity * unitCostMinor / scaleFactor(scale);
}

function assertNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new PlatformError("VALIDATION_FAILED", `${field} is required`, 400);
  return normalized;
}

function optional<T>(value: T | undefined, property: string): Record<string, T> {
  return value === undefined ? {} : { [property]: value };
}

function cloneWarehouse(input: Warehouse): Warehouse {
  return { ...input };
}

function cloneReservation(input: StockReservation): StockReservation {
  return { ...input, lines: input.lines.map((line) => ({ ...line })) };
}

function cloneTransfer(input: StockTransfer): StockTransfer {
  return { ...input, lines: input.lines.map((line) => ({ ...line, serialIds: [...line.serialIds] })) };
}

function cloneCount(input: StockCount): StockCount {
  return { ...input, lines: input.lines.map((line) => ({ ...line })) };
}

export class InventoryService {
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly onEvent: ((event: InventoryEvent) => void) | undefined;
  private readonly warehouses = new Map<string, Warehouse>();
  private readonly zones = new Map<string, WarehouseZone>();
  private readonly bins = new Map<string, WarehouseBin>();
  private readonly ledger: StockLedgerEntry[] = [];
  private readonly projections = new Map<string, ProjectionValue>();
  private readonly costLayers = new Map<string, MutableCostLayer>();
  private readonly costAdjustments: CostLayerAdjustment[] = [];
  private readonly costConsumptions: CostConsumption[] = [];
  private readonly reservations = new Map<string, StockReservation>();
  private readonly transfers = new Map<string, StockTransfer>();
  private readonly counts = new Map<string, StockCount>();
  private readonly operationResults = new Map<string, StockPostingResult>();
  private readonly emittedEvents: InventoryEvent[] = [];

  constructor(options: InventoryServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => uuidV7());
    this.onEvent = options.onEvent;
  }

  registerWarehouse(input: Omit<Warehouse, "createdAt" | "version"> & { readonly createdAt?: string }): Warehouse {
    const recordKey = key(input.tenantId, input.id);
    if (this.warehouses.has(recordKey)) throw new PlatformError("CONFLICT", "Warehouse already exists", 409);
    const code = assertNonEmpty(input.code, "warehouse code").toUpperCase();
    const duplicate = [...this.warehouses.values()].some((warehouse) => warehouse.tenantId === input.tenantId && warehouse.code === code);
    if (duplicate) throw new PlatformError("CONFLICT", "Warehouse code already exists for the tenant", 409);
    const warehouse: Warehouse = {
      ...input,
      code,
      displayName: assertNonEmpty(input.displayName, "warehouse display name"),
      createdAt: input.createdAt ?? this.now().toISOString(),
      version: 1,
    };
    this.warehouses.set(recordKey, warehouse);
    this.emit(input.tenantId, "inventory.warehouse.created.v1", "warehouse", input.id, input.legalEntityId, input.tenantId, { code });
    return cloneWarehouse(warehouse);
  }

  listWarehouses(tenantId: string): readonly Warehouse[] {
    return [...this.warehouses.values()].filter((warehouse) => warehouse.tenantId === tenantId).map(cloneWarehouse);
  }

  addZone(input: WarehouseZone): WarehouseZone {
    this.requireWarehouse(input.tenantId, input.warehouseId);
    const recordKey = key(input.tenantId, input.id);
    if (this.zones.has(recordKey)) throw new PlatformError("CONFLICT", "Warehouse zone already exists", 409);
    const duplicate = [...this.zones.values()].some((zone) => zone.tenantId === input.tenantId && zone.warehouseId === input.warehouseId && zone.code === input.code);
    if (duplicate) throw new PlatformError("CONFLICT", "Warehouse zone code already exists", 409);
    const zone = { ...input, code: assertNonEmpty(input.code, "zone code").toUpperCase(), displayName: assertNonEmpty(input.displayName, "zone display name") };
    this.zones.set(recordKey, zone);
    return { ...zone };
  }

  addBin(input: WarehouseBin): WarehouseBin {
    this.requireWarehouse(input.tenantId, input.warehouseId);
    if (input.zoneId !== undefined) {
      const zone = this.zones.get(key(input.tenantId, input.zoneId));
      if (!zone || zone.warehouseId !== input.warehouseId) throw new PlatformError("VALIDATION_FAILED", "Bin zone does not belong to the warehouse", 400);
    }
    const recordKey = key(input.tenantId, input.id);
    if (this.bins.has(recordKey)) throw new PlatformError("CONFLICT", "Warehouse bin already exists", 409);
    const duplicate = [...this.bins.values()].some((bin) => bin.tenantId === input.tenantId && bin.warehouseId === input.warehouseId && bin.code === input.code);
    if (duplicate) throw new PlatformError("CONFLICT", "Warehouse bin code already exists", 409);
    const bin = { ...input, code: assertNonEmpty(input.code, "bin code").toUpperCase(), displayName: assertNonEmpty(input.displayName, "bin display name") };
    this.bins.set(recordKey, bin);
    return { ...bin };
  }

  postFromFrozenContract(request: StockPostingRequestV1, sourceDocumentType = "external_contract"): StockPostingResult {
    const movementType = this.normalizeMovementType(request.movementType);
    const lines: StockPostingLine[] = request.lines.map((line) => ({
      item: line.item,
      warehouseId: line.warehouseId,
      quantityDelta: line.quantityDelta,
      sourceDocumentId: line.sourceDocumentId,
      ...optional(line.sourceDocumentLineId, "sourceDocumentLineId"),
    })) as StockPostingLine[];
    return this.postStock({
      schemaVersion: "1.0",
      context: request.context,
      operationId: request.operationId,
      postingGroupId: request.postingGroupId,
      movementType,
      sourceDocumentType,
      lines,
      audit: request.audit,
    });
  }

  postStock(command: StockPostingCommand): StockPostingResult {
    if (command.lines.length === 0) throw new PlatformError("VALIDATION_FAILED", "At least one stock posting line is required", 400);
    const operationKey = key(command.context.tenantId, command.operationId);
    const replay = this.operationResults.get(operationKey);
    if (replay) return { ...replay, entries: replay.entries.map((entry) => ({ ...entry })), costConsumptions: replay.costConsumptions.map((item) => ({ ...item })), replayed: true };

    const prepared = command.lines.map((line) => this.preparePostingLine(command, line));
    this.validatePostingSet(command, prepared);

    const ledgerStart = this.ledger.length;
    const consumptionStart = this.costConsumptions.length;
    const layerSnapshot = new Map([...this.costLayers.entries()].map(([layerId, layer]) => [layerId, { ...layer }]));
    const projectionSnapshot = new Map([...this.projections.entries()].map(([projectionKey, projection]) => [projectionKey, { ...projection }]));
    const postedAt = this.now().toISOString();
    try {
      const entries: StockLedgerEntry[] = [];
      for (const preparedLine of prepared) {
        const entryId = this.idFactory();
        let valueDeltaMinor = preparedLine.explicitValueDeltaMinor;
        let effectiveUnitCostMinor = preparedLine.unitCostMinor;
        if (preparedLine.quantityDelta < 0n && preparedLine.stockStatus !== "in_transit") {
          const costing = this.consumeCost(command.context.tenantId, preparedLine, entryId, postedAt);
          if (effectiveUnitCostMinor === undefined && costing.consumedQuantity > 0n) effectiveUnitCostMinor = costing.valueMinor * scaleFactor(preparedLine.scale) / costing.consumedQuantity;
          if (valueDeltaMinor === undefined) valueDeltaMinor = -costing.valueMinor;
        } else if (valueDeltaMinor === undefined && effectiveUnitCostMinor !== undefined) {
          valueDeltaMinor = quantityValue(preparedLine.quantityDelta, preparedLine.scale, effectiveUnitCostMinor);
        }

        const entry: StockLedgerEntry = {
          id: entryId,
          operationId: command.operationId,
          postingGroupId: command.postingGroupId,
          tenantId: command.context.tenantId,
          legalEntityId: command.context.legalEntityId ?? this.requireWarehouse(command.context.tenantId, preparedLine.warehouseId).legalEntityId,
          variantId: preparedLine.variantId,
          warehouseId: preparedLine.warehouseId,
          ...optional(preparedLine.binId, "binId"),
          stockStatus: preparedLine.stockStatus,
          ...optional(preparedLine.batchId, "batchId"),
          ...optional(preparedLine.serialId, "serialId"),
          ...optional(preparedLine.expiryDate, "expiryDate"),
          quantityDelta: preparedLine.quantityDelta,
          quantityScale: preparedLine.scale,
          unit: preparedLine.unit,
          ...optional(effectiveUnitCostMinor, "unitCostMinor"),
          ...optional(preparedLine.currency, "currency"),
          ...optional(valueDeltaMinor, "valueDeltaMinor"),
          movementType: command.movementType,
          sourceDocumentType: command.sourceDocumentType,
          sourceDocumentId: preparedLine.sourceDocumentId,
          ...optional(preparedLine.sourceDocumentLineId, "sourceDocumentLineId"),
          businessDate: command.context.businessDate,
          postedAt,
          actorId: command.audit.actorId,
          requestId: command.audit.requestId,
          traceId: command.audit.traceId,
          ...optional(preparedLine.reversalOfEntryId, "reversalOfEntryId"),
        };
        this.ledger.push(entry);
        this.updateProjection(entry);
        if (entry.quantityDelta > 0n && entry.unitCostMinor !== undefined && entry.currency !== undefined && entry.stockStatus !== "in_transit") this.createCostLayer(entry);
        entries.push(entry);
      }
      const result: StockPostingResult = {
        operationId: command.operationId,
        postingGroupId: command.postingGroupId,
        entries: entries.map((entry) => ({ ...entry })),
        costConsumptions: this.costConsumptions.slice(consumptionStart).map((item) => ({ ...item })),
        replayed: false,
        postedAt,
      };
      this.operationResults.set(operationKey, result);
      this.emit(command.context.tenantId, "inventory.stock.posted.v1", "posting_group", command.postingGroupId, command.postingGroupId, command.context.actorId, {
        movementType: command.movementType,
        operationId: command.operationId,
        entryIds: entries.map((entry) => entry.id),
      }, command.context.businessDate);
      return { ...result, entries: result.entries.map((entry) => ({ ...entry })), costConsumptions: result.costConsumptions.map((item) => ({ ...item })) };
    } catch (error) {
      this.ledger.splice(ledgerStart);
      this.costConsumptions.splice(consumptionStart);
      this.costLayers.clear();
      for (const [layerId, layer] of layerSnapshot) this.costLayers.set(layerId, layer);
      this.projections.clear();
      for (const [projectionKey, projection] of projectionSnapshot) this.projections.set(projectionKey, projection);
      throw error;
    }
  }

  getLedger(tenantId: string): readonly StockLedgerEntry[] {
    return this.ledger.filter((entry) => entry.tenantId === tenantId).map((entry) => ({ ...entry }));
  }

  getBalance(tenantId: string, warehouseId: string, variantId: string, stockStatus: StockStatus = "sellable"): InventoryBalance | undefined {
    const matching = [...this.projections.entries()].find(([projectionKey]) => projectionKey.startsWith(`${key(tenantId, warehouseId, variantId, stockStatus)}::`));
    if (!matching) return undefined;
    const [, projection] = matching;
    const parts = matching[0].split("::");
    return {
      tenantId,
      warehouseId,
      variantId,
      stockStatus,
      unit: parts[4] ?? "EA",
      scale: Number(parts[5] ?? "0"),
      quantity: projection.quantity,
      valueMinor: projection.valueMinor,
      ...optional(projection.currency, "currency"),
      asOf: projection.asOf,
    };
  }

  listBalances(tenantId: string): readonly InventoryBalance[] {
    const balances: InventoryBalance[] = [];
    for (const [projectionKey, projection] of this.projections) {
      const [recordTenantId, warehouseId, variantId, stockStatus, unit, scale] = projectionKey.split("::");
      if (recordTenantId !== tenantId || warehouseId === undefined || variantId === undefined || stockStatus === undefined || unit === undefined || scale === undefined) continue;
      balances.push({
        tenantId,
        warehouseId,
        variantId,
        stockStatus: stockStatus as StockStatus,
        unit,
        scale: Number(scale),
        quantity: projection.quantity,
        valueMinor: projection.valueMinor,
        ...optional(projection.currency, "currency"),
        asOf: projection.asOf,
      });
    }
    return balances;
  }

  getAvailability(tenantId: string, warehouseId: string, variantId: string, quantityUnit = "EA", quantityScale = 0): StockAvailabilityV1 {
    const balance = this.getBalance(tenantId, warehouseId, variantId, "sellable");
    const onHand = balance?.quantity ?? 0n;
    const reserved = this.activeReservedQuantity(tenantId, warehouseId, variantId, quantityUnit, quantityScale);
    const available = onHand - reserved;
    const asOf = balance?.asOf ?? this.now().toISOString();
    return {
      variantId,
      warehouseId,
      onHand: { amount: formatQuantity(onHand, quantityScale), unit: quantityUnit, scale: quantityScale },
      reserved: { amount: formatQuantity(reserved, quantityScale), unit: quantityUnit, scale: quantityScale },
      available: { amount: formatQuantity(available, quantityScale), unit: quantityUnit, scale: quantityScale },
      asOf,
      version: `${this.ledger.length}:${this.reservations.size}`,
    };
  }

  createReservation(request: ReservationRequest): StockReservation {
    const reservationKey = key(request.context.tenantId, request.reservationId);
    const existing = this.reservations.get(reservationKey);
    if (existing) return cloneReservation(existing);
    if (request.lines.length === 0) throw new PlatformError("VALIDATION_FAILED", "Reservation requires at least one line", 400);
    if (request.expiresAt !== undefined && new Date(request.expiresAt).getTime() <= this.now().getTime()) throw new PlatformError("VALIDATION_FAILED", "Reservation expiry must be in the future", 400);

    const prepared = request.lines.map((line) => {
      this.requireWarehouse(request.context.tenantId, line.warehouseId);
      const requested = parseQuantity(line.quantity);
      if (requested <= 0n) throw new PlatformError("VALIDATION_FAILED", "Reservation quantity must be positive", 400);
      const availability = this.getAvailability(request.context.tenantId, line.warehouseId, line.item.variantId, line.quantity.unit, line.quantity.scale);
      const available = parseQuantity(availability.available);
      return { line, requested, available };
    });
    if (request.fulfillmentPolicy === "all_or_nothing" && prepared.some((line) => line.available < line.requested)) {
      const unfulfilled: StockReservation = {
        id: request.reservationId,
        tenantId: request.context.tenantId,
        sourceType: request.sourceType,
        sourceId: request.sourceId,
        state: "unfulfilled",
        lines: prepared.map(({ line, requested }) => ({
          id: this.idFactory(),
          variantId: line.item.variantId,
          warehouseId: line.warehouseId,
          unit: line.quantity.unit,
          scale: line.quantity.scale,
          requestedQuantity: requested,
          reservedQuantity: 0n,
          consumedQuantity: 0n,
          releasedQuantity: 0n,
        })),
        ...optional(request.expiresAt, "expiresAt"),
        createdAt: this.now().toISOString(),
        updatedAt: this.now().toISOString(),
        version: 1,
      };
      this.reservations.set(reservationKey, unfulfilled);
      this.emit(request.context.tenantId, "inventory.reservation.unfulfilled.v1", "stock_reservation", request.reservationId, request.reservationId, request.context.actorId, { sourceId: request.sourceId }, request.context.businessDate);
      return cloneReservation(unfulfilled);
    }

    const lines: ReservationLine[] = prepared.map(({ line, requested, available }) => ({
      id: this.idFactory(),
      variantId: line.item.variantId,
      warehouseId: line.warehouseId,
      unit: line.quantity.unit,
      scale: line.quantity.scale,
      requestedQuantity: requested,
      reservedQuantity: request.fulfillmentPolicy === "allow_partial" && available < requested ? (available > 0n ? available : 0n) : requested,
      consumedQuantity: 0n,
      releasedQuantity: 0n,
    }));
    const reservedTotal = lines.reduce((sum, line) => sum + line.reservedQuantity, 0n);
    const requestedTotal = lines.reduce((sum, line) => sum + line.requestedQuantity, 0n);
    const state = reservedTotal === 0n ? "unfulfilled" : reservedTotal === requestedTotal ? "fully_reserved" : "partially_reserved";
    const timestamp = this.now().toISOString();
    const reservation: StockReservation = {
      id: request.reservationId,
      tenantId: request.context.tenantId,
      sourceType: request.sourceType,
      sourceId: request.sourceId,
      state,
      lines,
      ...optional(request.expiresAt, "expiresAt"),
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    this.reservations.set(reservationKey, reservation);
    this.emit(request.context.tenantId, `inventory.reservation.${state}.v1`, "stock_reservation", request.reservationId, request.reservationId, request.context.actorId, { sourceId: request.sourceId }, request.context.businessDate);
    return cloneReservation(reservation);
  }

  consumeReservation(tenantId: string, reservationId: string, quantities?: Readonly<Record<string, QuantityV1>>, actorId = "system", businessDate = this.today()): StockReservation {
    const reservationKey = key(tenantId, reservationId);
    const reservation = this.requireReservation(tenantId, reservationId);
    if (["consumed", "released", "expired", "cancelled", "unfulfilled"].includes(reservation.state)) throw new PlatformError("CONFLICT", `Reservation cannot be consumed from state ${reservation.state}`, 409);
    const lines = reservation.lines.map((line) => {
      const remaining = line.reservedQuantity - line.consumedQuantity - line.releasedQuantity;
      const requested = quantities?.[line.id] === undefined ? remaining : parseQuantity(quantities[line.id]!);
      if (requested < 0n || requested > remaining) throw new PlatformError("VALIDATION_FAILED", "Reservation consumption exceeds remaining reserved quantity", 400);
      return { ...line, consumedQuantity: line.consumedQuantity + requested };
    });
    const remainingTotal = lines.reduce((sum, line) => sum + line.reservedQuantity - line.consumedQuantity - line.releasedQuantity, 0n);
    const consumedTotal = lines.reduce((sum, line) => sum + line.consumedQuantity, 0n);
    const state = remainingTotal === 0n ? "consumed" : consumedTotal > 0n ? "partially_consumed" : reservation.state;
    const updated: StockReservation = { ...reservation, state, lines, updatedAt: this.now().toISOString(), version: reservation.version + 1 };
    this.reservations.set(reservationKey, updated);
    this.emit(tenantId, "inventory.reservation.consumed.v1", "stock_reservation", reservationId, reservationId, actorId, { state }, businessDate);
    return cloneReservation(updated);
  }

  releaseReservation(tenantId: string, reservationId: string, actorId = "system", businessDate = this.today()): StockReservation {
    const reservationKey = key(tenantId, reservationId);
    const reservation = this.requireReservation(tenantId, reservationId);
    if (["consumed", "released", "expired", "cancelled"].includes(reservation.state)) return cloneReservation(reservation);
    const lines = reservation.lines.map((line) => ({ ...line, releasedQuantity: line.reservedQuantity - line.consumedQuantity }));
    const updated: StockReservation = { ...reservation, state: "released", lines, updatedAt: this.now().toISOString(), version: reservation.version + 1 };
    this.reservations.set(reservationKey, updated);
    this.emit(tenantId, "inventory.reservation.released.v1", "stock_reservation", reservationId, reservationId, actorId, {}, businessDate);
    return cloneReservation(updated);
  }

  expireReservations(asOf = this.now()): readonly StockReservation[] {
    const expired: StockReservation[] = [];
    for (const [reservationKey, reservation] of this.reservations) {
      if (reservation.expiresAt === undefined || new Date(reservation.expiresAt).getTime() > asOf.getTime()) continue;
      if (["consumed", "released", "expired", "cancelled"].includes(reservation.state)) continue;
      const lines = reservation.lines.map((line) => ({ ...line, releasedQuantity: line.reservedQuantity - line.consumedQuantity }));
      const updated: StockReservation = { ...reservation, state: "expired", lines, updatedAt: asOf.toISOString(), version: reservation.version + 1 };
      this.reservations.set(reservationKey, updated);
      expired.push(cloneReservation(updated));
    }
    return expired;
  }

  getReservation(tenantId: string, reservationId: string): StockReservation {
    return cloneReservation(this.requireReservation(tenantId, reservationId));
  }

  createTransfer(input: {
    readonly id: string;
    readonly tenantId: string;
    readonly legalEntityId: string;
    readonly sourceWarehouseId: string;
    readonly destinationWarehouseId: string;
    readonly requestedBy: string;
    readonly lines: readonly { readonly id?: string; readonly variantId: string; readonly quantity: QuantityV1; readonly batchId?: string; readonly serialIds?: readonly string[] }[];
  }): StockTransfer {
    if (input.sourceWarehouseId === input.destinationWarehouseId) throw new PlatformError("VALIDATION_FAILED", "Transfer source and destination must differ", 400);
    this.requireWarehouse(input.tenantId, input.sourceWarehouseId);
    this.requireWarehouse(input.tenantId, input.destinationWarehouseId);
    if (input.lines.length === 0) throw new PlatformError("VALIDATION_FAILED", "Transfer requires at least one line", 400);
    const transferKey = key(input.tenantId, input.id);
    if (this.transfers.has(transferKey)) throw new PlatformError("CONFLICT", "Transfer already exists", 409);
    const lines: StockTransferLine[] = input.lines.map((line) => {
      const quantity = parseQuantity(line.quantity);
      if (quantity <= 0n) throw new PlatformError("VALIDATION_FAILED", "Transfer quantity must be positive", 400);
      return {
        id: line.id ?? this.idFactory(),
        variantId: line.variantId,
        unit: line.quantity.unit,
        scale: line.quantity.scale,
        requestedQuantity: quantity,
        dispatchedQuantity: 0n,
        receivedQuantity: 0n,
        damagedQuantity: 0n,
        missingQuantity: 0n,
        ...optional(line.batchId, "batchId"),
        serialIds: [...(line.serialIds ?? [])],
      };
    });
    const timestamp = this.now().toISOString();
    const transfer: StockTransfer = {
      id: input.id,
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      sourceWarehouseId: input.sourceWarehouseId,
      destinationWarehouseId: input.destinationWarehouseId,
      state: "draft",
      lines,
      requestedBy: input.requestedBy,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    this.transfers.set(transferKey, transfer);
    this.emit(input.tenantId, "inventory.transfer.created.v1", "stock_transfer", input.id, input.id, input.requestedBy, {}, this.today());
    return cloneTransfer(transfer);
  }

  approveTransfer(tenantId: string, transferId: string, approverId: string): StockTransfer {
    const transferKey = key(tenantId, transferId);
    const transfer = this.requireTransfer(tenantId, transferId);
    if (transfer.state !== "draft") throw new PlatformError("CONFLICT", "Only draft transfers can be approved", 409);
    const updated: StockTransfer = { ...transfer, state: "approved", approvedBy: approverId, updatedAt: this.now().toISOString(), version: transfer.version + 1 };
    this.transfers.set(transferKey, updated);
    return cloneTransfer(updated);
  }

  dispatchTransfer(input: {
    readonly tenantId: string;
    readonly transferId: string;
    readonly actorId: string;
    readonly operationId: string;
    readonly postingGroupId: string;
    readonly businessDate: string;
    readonly quantities?: Readonly<Record<string, QuantityV1>>;
  }): StockTransfer {
    const transferKey = key(input.tenantId, input.transferId);
    const transfer = this.requireTransfer(input.tenantId, input.transferId);
    if (!['approved', 'picking'].includes(transfer.state)) throw new PlatformError("CONFLICT", "Transfer must be approved before dispatch", 409);
    const postingLines: StockPostingLine[] = [];
    const updatedLines = transfer.lines.map((line) => {
      const remaining = line.requestedQuantity - line.dispatchedQuantity;
      const dispatchQuantity = input.quantities?.[line.id] === undefined ? remaining : parseQuantity(input.quantities[line.id]!);
      if (dispatchQuantity <= 0n || dispatchQuantity > remaining) throw new PlatformError("VALIDATION_FAILED", "Dispatch quantity is outside the remaining transfer quantity", 400);
      const unitCostMinor = this.currentAverageUnitCost(input.tenantId, transfer.sourceWarehouseId, line.variantId, line.scale);
      const base = {
        item: { itemId: line.variantId, variantId: line.variantId },
        quantityDelta: { amount: formatQuantity(dispatchQuantity, line.scale), unit: line.unit, scale: line.scale },
        sourceDocumentId: transfer.id,
        sourceDocumentLineId: line.id,
        ...optional(line.batchId, "batchId"),
        ...(unitCostMinor === undefined ? {} : { unitCostMinor: unitCostMinor.toString(), currency: this.costCurrency(input.tenantId, transfer.sourceWarehouseId, line.variantId) ?? "USD" }),
      };
      postingLines.push({ ...base, warehouseId: transfer.sourceWarehouseId, stockStatus: "sellable", quantityDelta: { ...base.quantityDelta, amount: `-${base.quantityDelta.amount}` } });
      postingLines.push({ ...base, warehouseId: transfer.destinationWarehouseId, stockStatus: "in_transit" });
      return { ...line, dispatchedQuantity: line.dispatchedQuantity + dispatchQuantity };
    });
    this.postStock({
      schemaVersion: "1.0",
      context: {
        tenantId: input.tenantId,
        legalEntityId: transfer.legalEntityId,
        actorId: input.actorId,
        locale: "en-GB",
        timeZone: this.requireWarehouse(input.tenantId, transfer.sourceWarehouseId).timeZone,
        businessDate: input.businessDate,
      },
      operationId: input.operationId,
      postingGroupId: input.postingGroupId,
      movementType: "transfer_dispatch",
      sourceDocumentType: "stock_transfer",
      lines: postingLines,
      audit: { actorId: input.actorId, requestId: input.operationId, traceId: input.postingGroupId },
    });
    const timestamp = this.now().toISOString();
    const updated: StockTransfer = { ...transfer, state: "dispatched", lines: updatedLines, dispatchedAt: timestamp, updatedAt: timestamp, version: transfer.version + 1 };
    this.transfers.set(transferKey, updated);
    this.emit(input.tenantId, "inventory.transfer.dispatched.v1", "stock_transfer", transfer.id, input.postingGroupId, input.actorId, {}, input.businessDate);
    return cloneTransfer(updated);
  }

  receiveTransfer(input: {
    readonly tenantId: string;
    readonly transferId: string;
    readonly actorId: string;
    readonly operationId: string;
    readonly postingGroupId: string;
    readonly businessDate: string;
    readonly lines: readonly { readonly lineId: string; readonly received: QuantityV1; readonly damaged?: QuantityV1; readonly missing?: QuantityV1 }[];
  }): StockTransfer {
    const transferKey = key(input.tenantId, input.transferId);
    const transfer = this.requireTransfer(input.tenantId, input.transferId);
    if (!['dispatched', 'partially_received'].includes(transfer.state)) throw new PlatformError("CONFLICT", "Only dispatched transfers can be received", 409);
    const receiptByLine = new Map(input.lines.map((line) => [line.lineId, line]));
    const postingLines: StockPostingLine[] = [];
    const updatedLines = transfer.lines.map((line) => {
      const receipt = receiptByLine.get(line.id);
      if (!receipt) return line;
      const received = parseQuantity(receipt.received);
      const damaged = receipt.damaged === undefined ? 0n : parseQuantity(receipt.damaged);
      const missing = receipt.missing === undefined ? 0n : parseQuantity(receipt.missing);
      if (received < 0n || damaged < 0n || missing < 0n) throw new PlatformError("VALIDATION_FAILED", "Transfer receipt quantities cannot be negative", 400);
      const remaining = line.dispatchedQuantity - line.receivedQuantity - line.damagedQuantity - line.missingQuantity;
      if (received + damaged + missing > remaining) throw new PlatformError("VALIDATION_FAILED", "Transfer receipt exceeds dispatched quantity", 400);
      const unitCostMinor = this.currentAverageUnitCost(input.tenantId, transfer.destinationWarehouseId, line.variantId, line.scale, "in_transit");
      const currency = this.costCurrency(input.tenantId, transfer.destinationWarehouseId, line.variantId, "in_transit") ?? "USD";
      const addMovement = (quantity: bigint, status: StockStatus, sourceLineSuffix: string): void => {
        if (quantity === 0n) return;
        const common = {
          item: { itemId: line.variantId, variantId: line.variantId },
          warehouseId: transfer.destinationWarehouseId,
          quantityDelta: { amount: formatQuantity(quantity, line.scale), unit: line.unit, scale: line.scale },
          sourceDocumentId: transfer.id,
          sourceDocumentLineId: `${line.id}:${sourceLineSuffix}`,
          ...optional(line.batchId, "batchId"),
          ...(unitCostMinor === undefined ? {} : { unitCostMinor: unitCostMinor.toString(), currency }),
        };
        postingLines.push({ ...common, stockStatus: "in_transit", quantityDelta: { ...common.quantityDelta, amount: `-${common.quantityDelta.amount}` } });
        postingLines.push({ ...common, stockStatus: status });
      };
      addMovement(received, "sellable", "received");
      addMovement(damaged, "damaged", "damaged");
      if (missing > 0n) {
        postingLines.push({
          item: { itemId: line.variantId, variantId: line.variantId },
          warehouseId: transfer.destinationWarehouseId,
          stockStatus: "in_transit",
          quantityDelta: { amount: `-${formatQuantity(missing, line.scale)}`, unit: line.unit, scale: line.scale },
          sourceDocumentId: transfer.id,
          sourceDocumentLineId: `${line.id}:missing`,
          ...optional(line.batchId, "batchId"),
        });
      }
      return {
        ...line,
        receivedQuantity: line.receivedQuantity + received,
        damagedQuantity: line.damagedQuantity + damaged,
        missingQuantity: line.missingQuantity + missing,
      };
    });
    if (postingLines.length === 0) throw new PlatformError("VALIDATION_FAILED", "Transfer receipt must account for at least one unit", 400);
    this.postStock({
      schemaVersion: "1.0",
      context: {
        tenantId: input.tenantId,
        legalEntityId: transfer.legalEntityId,
        actorId: input.actorId,
        locale: "en-GB",
        timeZone: this.requireWarehouse(input.tenantId, transfer.destinationWarehouseId).timeZone,
        businessDate: input.businessDate,
      },
      operationId: input.operationId,
      postingGroupId: input.postingGroupId,
      movementType: "transfer_receipt",
      sourceDocumentType: "stock_transfer",
      lines: postingLines,
      audit: { actorId: input.actorId, requestId: input.operationId, traceId: input.postingGroupId },
    });
    const fullyAccounted = updatedLines.every((line) => line.receivedQuantity + line.damagedQuantity + line.missingQuantity === line.dispatchedQuantity);
    const timestamp = this.now().toISOString();
    const updated: StockTransfer = {
      ...transfer,
      state: fullyAccounted ? "received" : "partially_received",
      lines: updatedLines,
      ...(fullyAccounted ? { receivedAt: timestamp } : {}),
      updatedAt: timestamp,
      version: transfer.version + 1,
    };
    this.transfers.set(transferKey, updated);
    this.emit(input.tenantId, "inventory.transfer.received.v1", "stock_transfer", transfer.id, input.postingGroupId, input.actorId, { state: updated.state }, input.businessDate);
    return cloneTransfer(updated);
  }

  closeTransfer(tenantId: string, transferId: string): StockTransfer {
    const transferKey = key(tenantId, transferId);
    const transfer = this.requireTransfer(tenantId, transferId);
    if (transfer.state !== "received") throw new PlatformError("CONFLICT", "Transfer can close only after every dispatched unit is accounted for", 409);
    const updated: StockTransfer = { ...transfer, state: "closed", updatedAt: this.now().toISOString(), version: transfer.version + 1 };
    this.transfers.set(transferKey, updated);
    return cloneTransfer(updated);
  }

  getTransfer(tenantId: string, transferId: string): StockTransfer {
    return cloneTransfer(this.requireTransfer(tenantId, transferId));
  }

  createCount(input: {
    readonly id: string;
    readonly tenantId: string;
    readonly warehouseId: string;
    readonly createdBy: string;
    readonly blind: boolean;
    readonly items: readonly { readonly variantId: string; readonly unit: string; readonly scale: number }[];
  }): StockCount {
    this.requireWarehouse(input.tenantId, input.warehouseId);
    const countKey = key(input.tenantId, input.id);
    if (this.counts.has(countKey)) throw new PlatformError("CONFLICT", "Stock count already exists", 409);
    const timestamp = this.now().toISOString();
    const lines: StockCountLine[] = input.items.map((item) => ({
      id: this.idFactory(),
      variantId: item.variantId,
      unit: item.unit,
      scale: item.scale,
      expectedQuantity: this.getBalance(input.tenantId, input.warehouseId, item.variantId, "sellable")?.quantity ?? 0n,
    }));
    const count: StockCount = {
      id: input.id,
      tenantId: input.tenantId,
      warehouseId: input.warehouseId,
      state: "frozen",
      blind: input.blind,
      snapshotAt: timestamp,
      lines,
      createdBy: input.createdBy,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    this.counts.set(countKey, count);
    return cloneCount(count);
  }

  submitCount(tenantId: string, countId: string, observed: Readonly<Record<string, QuantityV1>>, requireRecountOnVariance = true): StockCount {
    const countKey = key(tenantId, countId);
    const count = this.requireCount(tenantId, countId);
    if (!['frozen', 'counting', 'recount_required'].includes(count.state)) throw new PlatformError("CONFLICT", "Stock count is not accepting observations", 409);
    const isRecount = count.state === "recount_required";
    const lines = count.lines.map((line) => {
      const quantity = observed[line.id];
      if (quantity === undefined) throw new PlatformError("VALIDATION_FAILED", `Missing observed quantity for count line ${line.id}`, 400);
      if (quantity.unit !== line.unit || quantity.scale !== line.scale) throw new PlatformError("VALIDATION_FAILED", "Count quantity unit or scale does not match the snapshot", 400);
      const parsed = parseQuantity(quantity);
      if (parsed < 0n) throw new PlatformError("VALIDATION_FAILED", "Count quantity cannot be negative", 400);
      return isRecount ? { ...line, recountQuantity: parsed } : { ...line, firstCountQuantity: parsed };
    });
    const hasVariance = lines.some((line) => (isRecount ? line.recountQuantity : line.firstCountQuantity) !== line.expectedQuantity);
    const state = !isRecount && requireRecountOnVariance && hasVariance ? "recount_required" : "submitted";
    const updated: StockCount = { ...count, state, lines, updatedAt: this.now().toISOString(), version: count.version + 1 };
    this.counts.set(countKey, updated);
    return cloneCount(updated);
  }

  approveAndPostCount(input: {
    readonly tenantId: string;
    readonly countId: string;
    readonly approverId: string;
    readonly operationId: string;
    readonly postingGroupId: string;
    readonly businessDate: string;
  }): StockCount {
    const countKey = key(input.tenantId, input.countId);
    const count = this.requireCount(input.tenantId, input.countId);
    if (count.state !== "submitted") throw new PlatformError("CONFLICT", "Only submitted counts can be approved", 409);
    const lines = count.lines.map((line) => {
      const approved = line.recountQuantity ?? line.firstCountQuantity;
      if (approved === undefined) throw new PlatformError("VALIDATION_FAILED", "Count line has no approved observation", 400);
      return { ...line, approvedQuantity: approved, varianceQuantity: approved - line.expectedQuantity };
    });
    const postingLines: StockPostingLine[] = lines.filter((line) => line.varianceQuantity !== 0n).map((line) => ({
      item: { itemId: line.variantId, variantId: line.variantId },
      warehouseId: count.warehouseId,
      stockStatus: "sellable",
      quantityDelta: { amount: formatQuantity(line.varianceQuantity!, line.scale), unit: line.unit, scale: line.scale },
      sourceDocumentId: count.id,
      sourceDocumentLineId: line.id,
    }));
    if (postingLines.length > 0) {
      this.postStock({
        schemaVersion: "1.0",
        context: {
          tenantId: input.tenantId,
          legalEntityId: this.requireWarehouse(input.tenantId, count.warehouseId).legalEntityId,
          actorId: input.approverId,
          locale: "en-GB",
          timeZone: this.requireWarehouse(input.tenantId, count.warehouseId).timeZone,
          businessDate: input.businessDate,
        },
        operationId: input.operationId,
        postingGroupId: input.postingGroupId,
        movementType: "physical_count_variance",
        sourceDocumentType: "stock_count",
        lines: postingLines,
        audit: { actorId: input.approverId, approverId: input.approverId, requestId: input.operationId, traceId: input.postingGroupId, reason: "Approved physical count variance" },
        approvalId: input.countId,
      });
    }
    const timestamp = this.now().toISOString();
    const updated: StockCount = { ...count, state: "posted", lines, approvedBy: input.approverId, postedAt: timestamp, updatedAt: timestamp, version: count.version + 1 };
    this.counts.set(countKey, updated);
    this.emit(input.tenantId, "inventory.count.posted.v1", "stock_count", count.id, input.postingGroupId, input.approverId, { varianceLineCount: postingLines.length }, input.businessDate);
    return cloneCount(updated);
  }

  getCount(tenantId: string, countId: string): StockCount {
    return cloneCount(this.requireCount(tenantId, countId));
  }

  postAdjustment(input: {
    readonly tenantId: string;
    readonly legalEntityId: string;
    readonly warehouseId: string;
    readonly actorId: string;
    readonly operationId: string;
    readonly postingGroupId: string;
    readonly businessDate: string;
    readonly reason: string;
    readonly approvalId?: string;
    readonly lines: readonly { readonly variantId: string; readonly quantityDelta: QuantityV1; readonly unitCostMinor?: string; readonly currency?: string; readonly batchId?: string; readonly serialId?: string }[];
  }): StockPostingResult {
    const hasLoss = input.lines.some((line) => parseQuantity(line.quantityDelta) < 0n);
    if (hasLoss && input.approvalId === undefined) throw new PlatformError("PERMISSION_DENIED", "Negative inventory adjustments require approval", 403);
    return this.postStock({
      schemaVersion: "1.0",
      context: {
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        actorId: input.actorId,
        locale: "en-GB",
        timeZone: this.requireWarehouse(input.tenantId, input.warehouseId).timeZone,
        businessDate: input.businessDate,
      },
      operationId: input.operationId,
      postingGroupId: input.postingGroupId,
      movementType: hasLoss ? "adjustment_loss" : "adjustment_gain",
      sourceDocumentType: "inventory_adjustment",
      lines: input.lines.map((line, index) => ({
        item: { itemId: line.variantId, variantId: line.variantId },
        warehouseId: input.warehouseId,
        stockStatus: "sellable",
        quantityDelta: line.quantityDelta,
        sourceDocumentId: input.operationId,
        sourceDocumentLineId: `${input.operationId}:${index + 1}`,
        ...optional(line.unitCostMinor, "unitCostMinor"),
        ...optional(line.currency, "currency"),
        ...optional(line.batchId, "batchId"),
        ...optional(line.serialId, "serialId"),
      })),
      audit: { actorId: input.actorId, requestId: input.operationId, traceId: input.postingGroupId, reason: input.reason, ...optional(input.approvalId, "approverId") },
      ...optional(input.approvalId, "approvalId"),
    });
  }

  applyLandedCost(input: {
    readonly tenantId: string;
    readonly layerId: string;
    readonly amountMinor: string;
    readonly sourceDocumentId: string;
    readonly actorId: string;
    readonly postingGroupId: string;
    readonly businessDate: string;
  }): CostLayer {
    const layer = this.costLayers.get(input.layerId);
    if (!layer || layer.tenantId !== input.tenantId) throw new PlatformError("NOT_FOUND", "Cost layer not found", 404);
    const amountMinor = parseMinor(input.amountMinor, "landed cost amount");
    if (amountMinor === undefined || amountMinor < 0n) throw new PlatformError("VALIDATION_FAILED", "Landed cost amount must be non-negative", 400);
    const adjustment: CostLayerAdjustment = {
      id: this.idFactory(),
      tenantId: input.tenantId,
      layerId: input.layerId,
      amountMinor,
      sourceDocumentId: input.sourceDocumentId,
      createdAt: this.now().toISOString(),
    };
    this.costAdjustments.push(adjustment);
    const revaluationEntry: StockLedgerEntry = {
      id: this.idFactory(),
      operationId: adjustment.id,
      postingGroupId: input.postingGroupId,
      tenantId: input.tenantId,
      legalEntityId: this.requireWarehouse(input.tenantId, layer.warehouseId).legalEntityId,
      variantId: layer.variantId,
      warehouseId: layer.warehouseId,
      stockStatus: "sellable",
      ...optional(layer.batchId, "batchId"),
      ...optional(layer.serialId, "serialId"),
      quantityDelta: 0n,
      quantityScale: layer.quantityScale,
      unit: layer.unit,
      currency: layer.currency,
      valueDeltaMinor: amountMinor,
      movementType: "landed_cost_revaluation",
      sourceDocumentType: "landed_cost",
      sourceDocumentId: input.sourceDocumentId,
      businessDate: input.businessDate,
      postedAt: adjustment.createdAt,
      actorId: input.actorId,
      requestId: adjustment.id,
      traceId: input.postingGroupId,
    };
    this.ledger.push(revaluationEntry);
    this.updateProjection(revaluationEntry);
    this.emit(input.tenantId, "inventory.cost.revalued.v1", "cost_layer", layer.id, input.postingGroupId, input.actorId, { amountMinor: input.amountMinor }, input.businessDate);
    return this.costLayerView(layer);
  }

  getCostLayers(tenantId: string, warehouseId?: string, variantId?: string): readonly CostLayer[] {
    return [...this.costLayers.values()]
      .filter((layer) => layer.tenantId === tenantId && (warehouseId === undefined || layer.warehouseId === warehouseId) && (variantId === undefined || layer.variantId === variantId))
      .map((layer) => this.costLayerView(layer));
  }

  getCostConsumptions(tenantId: string): readonly CostConsumption[] {
    return this.costConsumptions.filter((item) => item.tenantId === tenantId).map((item) => ({ ...item }));
  }

  reconcile(tenantId: string): InventoryReconciliation {
    const rebuilt = new Map<string, bigint>();
    for (const entry of this.ledger) {
      if (entry.tenantId !== tenantId) continue;
      const projectionKey = this.projectionKey(entry.tenantId, entry.warehouseId, entry.variantId, entry.stockStatus, entry.unit, entry.quantityScale);
      rebuilt.set(projectionKey, (rebuilt.get(projectionKey) ?? 0n) + entry.quantityDelta);
    }
    const mismatches: { key: string; ledgerQuantity: bigint; projectionQuantity: bigint }[] = [];
    const keys = new Set([...rebuilt.keys(), ...[...this.projections.keys()].filter((projectionKey) => projectionKey.startsWith(`${tenantId}::`))]);
    for (const projectionKey of keys) {
      const ledgerQuantity = rebuilt.get(projectionKey) ?? 0n;
      const projectionQuantity = this.projections.get(projectionKey)?.quantity ?? 0n;
      if (ledgerQuantity !== projectionQuantity) mismatches.push({ key: projectionKey, ledgerQuantity, projectionQuantity });
    }
    return {
      id: this.idFactory(),
      tenantId,
      status: mismatches.length === 0 ? "matched" : "mismatch",
      ledgerEntryCount: this.ledger.filter((entry) => entry.tenantId === tenantId).length,
      projectionKeyCount: keys.size,
      mismatches,
      checkedAt: this.now().toISOString(),
    };
  }

  listEvents(tenantId: string): readonly InventoryEvent[] {
    return this.emittedEvents.filter((event) => event.tenantId === tenantId).map((event) => ({ ...event, payload: { ...event.payload } }));
  }

  private preparePostingLine(command: StockPostingCommand, line: StockPostingLine): {
    readonly variantId: string;
    readonly warehouseId: string;
    readonly binId?: string;
    readonly stockStatus: StockStatus;
    readonly batchId?: string;
    readonly serialId?: string;
    readonly expiryDate?: string;
    readonly quantityDelta: bigint;
    readonly scale: number;
    readonly unit: string;
    readonly unitCostMinor?: bigint;
    readonly explicitValueDeltaMinor?: bigint;
    readonly currency?: string;
    readonly sourceDocumentId: string;
    readonly sourceDocumentLineId?: string;
    readonly reversalOfEntryId?: string;
  } {
    const warehouse = this.requireWarehouse(command.context.tenantId, line.warehouseId);
    if (warehouse.status !== "active") throw new PlatformError("CONFLICT", "Stock cannot be posted to an inactive warehouse", 409);
    if (line.binId !== undefined) {
      const bin = this.bins.get(key(command.context.tenantId, line.binId));
      if (!bin || bin.warehouseId !== line.warehouseId || bin.status !== "active") throw new PlatformError("VALIDATION_FAILED", "Stock bin is not active in the warehouse", 400);
    }
    const quantityDelta = parseQuantity(line.quantityDelta);
    if (quantityDelta === 0n && command.movementType !== "landed_cost_revaluation") throw new PlatformError("VALIDATION_FAILED", "Stock posting quantity cannot be zero", 400);
    const unitCostMinor = parseMinor(line.unitCostMinor, "unit cost");
    if (unitCostMinor !== undefined && unitCostMinor < 0n) throw new PlatformError("VALIDATION_FAILED", "Unit cost cannot be negative", 400);
    if (unitCostMinor !== undefined && line.currency === undefined) throw new PlatformError("VALIDATION_FAILED", "Currency is required when unit cost is supplied", 400);
    return {
      variantId: assertNonEmpty(line.item.variantId, "variant id"),
      warehouseId: line.warehouseId,
      ...optional(line.binId, "binId"),
      stockStatus: line.stockStatus ?? "sellable",
      ...optional(line.batchId, "batchId"),
      ...optional(line.serialId, "serialId"),
      ...optional(line.expiryDate, "expiryDate"),
      quantityDelta,
      scale: line.quantityDelta.scale,
      unit: line.quantityDelta.unit,
      ...optional(unitCostMinor, "unitCostMinor"),
      ...optional(line.currency, "currency"),
      sourceDocumentId: assertNonEmpty(line.sourceDocumentId, "source document id"),
      ...optional(line.sourceDocumentLineId, "sourceDocumentLineId"),
      ...optional(line.reversalOfEntryId, "reversalOfEntryId"),
    };
  }

  private validatePostingSet(command: StockPostingCommand, lines: readonly ReturnType<InventoryService["preparePostingLine"]>[]): void {
    const pending = new Map<string, bigint>();
    for (const line of lines) {
      if (line.serialId !== undefined) {
        const absolute = line.quantityDelta < 0n ? -line.quantityDelta : line.quantityDelta;
        if (absolute !== scaleFactor(line.scale)) throw new PlatformError("VALIDATION_FAILED", "Serialized stock movement must equal exactly one unit", 400);
        if (line.quantityDelta > 0n) this.assertSerialCanEnter(command.context.tenantId, line.serialId, line.warehouseId, line.stockStatus);
      }
      const projectionKey = this.projectionKey(command.context.tenantId, line.warehouseId, line.variantId, line.stockStatus, line.unit, line.scale);
      const current = pending.get(projectionKey) ?? this.projections.get(projectionKey)?.quantity ?? 0n;
      const next = current + line.quantityDelta;
      pending.set(projectionKey, next);
      if (next < 0n && line.stockStatus === "sellable") {
        const policy = this.requireWarehouse(command.context.tenantId, line.warehouseId).negativeStockPolicy;
        if (policy === "deny") throw new PlatformError("CONFLICT", "Stock posting would create negative sellable stock", 409, { warehouseId: line.warehouseId, variantId: line.variantId });
        if (policy === "approve" && command.approvalId === undefined) throw new PlatformError("PERMISSION_DENIED", "Negative stock override requires approval", 403);
      }
      if (line.reversalOfEntryId !== undefined) {
        const original = this.ledger.find((entry) => entry.id === line.reversalOfEntryId && entry.tenantId === command.context.tenantId);
        if (!original) throw new PlatformError("VALIDATION_FAILED", "Reversal references an unknown stock entry", 400);
        if (this.ledger.some((entry) => entry.reversalOfEntryId === original.id)) throw new PlatformError("CONFLICT", "Stock entry has already been reversed", 409);
      }
    }
  }

  private consumeCost(tenantId: string, line: ReturnType<InventoryService["preparePostingLine"]>, issueLedgerEntryId: string, createdAt: string): { readonly consumedQuantity: bigint; readonly valueMinor: bigint } {
    let remaining = -line.quantityDelta;
    let valueMinor = 0n;
    const eligible = [...this.costLayers.values()]
      .filter((layer) => layer.tenantId === tenantId && layer.warehouseId === line.warehouseId && layer.variantId === line.variantId && layer.remainingQuantity > 0n)
      .filter((layer) => line.batchId === undefined || layer.batchId === line.batchId)
      .filter((layer) => line.serialId === undefined || layer.serialId === line.serialId)
      .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt) || left.id.localeCompare(right.id));
    for (const layer of eligible) {
      if (remaining === 0n) break;
      if (layer.quantityScale !== line.scale || layer.unit !== line.unit) throw new PlatformError("CONFLICT", "Cost layer quantity dimensions do not match stock issue", 409);
      const consumed = layer.remainingQuantity < remaining ? layer.remainingQuantity : remaining;
      const landed = this.layerLandedCost(layer.id);
      const baseLayerValue = quantityValue(layer.originalQuantity, layer.quantityScale, layer.unitCostMinor) + landed;
      const effectiveUnitCost = baseLayerValue * scaleFactor(layer.quantityScale) / layer.originalQuantity;
      const consumedValue = quantityValue(consumed, layer.quantityScale, effectiveUnitCost);
      layer.remainingQuantity -= consumed;
      remaining -= consumed;
      valueMinor += consumedValue;
      this.costConsumptions.push({
        id: this.idFactory(),
        tenantId,
        issueLedgerEntryId,
        costLayerId: layer.id,
        quantity: consumed,
        quantityScale: layer.quantityScale,
        unitCostMinor: effectiveUnitCost,
        valueMinor: consumedValue,
        createdAt,
      });
    }
    return { consumedQuantity: -line.quantityDelta - remaining, valueMinor };
  }

  private createCostLayer(entry: StockLedgerEntry): void {
    const layer: MutableCostLayer = {
      id: this.idFactory(),
      tenantId: entry.tenantId,
      warehouseId: entry.warehouseId,
      variantId: entry.variantId,
      ...optional(entry.batchId, "batchId"),
      ...optional(entry.serialId, "serialId"),
      receiptLedgerEntryId: entry.id,
      receivedAt: entry.postedAt,
      originalQuantity: entry.quantityDelta,
      remainingQuantity: entry.quantityDelta,
      quantityScale: entry.quantityScale,
      unit: entry.unit,
      unitCostMinor: entry.unitCostMinor!,
      currency: entry.currency!,
    };
    this.costLayers.set(layer.id, layer);
  }

  private costLayerView(layer: MutableCostLayer): CostLayer {
    return {
      ...layer,
      landedCostMinor: this.layerLandedCost(layer.id),
    };
  }

  private layerLandedCost(layerId: string): bigint {
    return this.costAdjustments.filter((adjustment) => adjustment.layerId === layerId).reduce((sum, adjustment) => sum + adjustment.amountMinor, 0n);
  }

  private currentAverageUnitCost(tenantId: string, warehouseId: string, variantId: string, scale: number, status: StockStatus = "sellable"): bigint | undefined {
    if (status === "in_transit") {
      const balance = this.getBalance(tenantId, warehouseId, variantId, status);
      if (!balance || balance.quantity <= 0n) return undefined;
      return balance.valueMinor * scaleFactor(scale) / balance.quantity;
    }
    const layers = [...this.costLayers.values()].filter((layer) => layer.tenantId === tenantId && layer.warehouseId === warehouseId && layer.variantId === variantId && layer.remainingQuantity > 0n);
    const quantity = layers.reduce((sum, layer) => sum + layer.remainingQuantity, 0n);
    if (quantity === 0n) return undefined;
    const value = layers.reduce((sum, layer) => sum + quantityValue(layer.remainingQuantity, layer.quantityScale, layer.unitCostMinor) + this.layerLandedCost(layer.id) * layer.remainingQuantity / layer.originalQuantity, 0n);
    return value * scaleFactor(scale) / quantity;
  }

  private costCurrency(tenantId: string, warehouseId: string, variantId: string, status: StockStatus = "sellable"): string | undefined {
    if (status === "in_transit") return this.getBalance(tenantId, warehouseId, variantId, status)?.currency;
    return [...this.costLayers.values()].find((layer) => layer.tenantId === tenantId && layer.warehouseId === warehouseId && layer.variantId === variantId && layer.remainingQuantity > 0n)?.currency;
  }

  private updateProjection(entry: StockLedgerEntry): void {
    const projectionKey = this.projectionKey(entry.tenantId, entry.warehouseId, entry.variantId, entry.stockStatus, entry.unit, entry.quantityScale);
    const current = this.projections.get(projectionKey) ?? { quantity: 0n, valueMinor: 0n, asOf: entry.postedAt };
    const updated: ProjectionValue = {
      quantity: current.quantity + entry.quantityDelta,
      valueMinor: current.valueMinor + (entry.valueDeltaMinor ?? 0n),
      ...optional(entry.currency ?? current.currency, "currency"),
      asOf: entry.postedAt,
    };
    this.projections.set(projectionKey, updated);
  }

  private projectionKey(tenantId: string, warehouseId: string, variantId: string, status: StockStatus, unit: string, scale: number): string {
    return key(tenantId, warehouseId, variantId, status, unit, scale.toString());
  }

  private activeReservedQuantity(tenantId: string, warehouseId: string, variantId: string, unit: string, scale: number): bigint {
    let reserved = 0n;
    for (const reservation of this.reservations.values()) {
      if (reservation.tenantId !== tenantId || ["released", "expired", "cancelled", "consumed", "unfulfilled"].includes(reservation.state)) continue;
      for (const line of reservation.lines) {
        if (line.warehouseId === warehouseId && line.variantId === variantId && line.unit === unit && line.scale === scale) reserved += line.reservedQuantity - line.consumedQuantity - line.releasedQuantity;
      }
    }
    return reserved;
  }

  private assertSerialCanEnter(tenantId: string, serialId: string, warehouseId: string, status: StockStatus): void {
    const active = this.ledger.filter((entry) => entry.tenantId === tenantId && entry.serialId === serialId).reduce((sum, entry) => sum + entry.quantityDelta, 0n);
    if (active > 0n) {
      const current = [...this.ledger].reverse().find((entry) => entry.tenantId === tenantId && entry.serialId === serialId && entry.quantityDelta > 0n);
      if (current?.warehouseId !== warehouseId || current.stockStatus !== status) throw new PlatformError("CONFLICT", "Serial number is already active in another inventory dimension", 409);
    }
  }

  private requireWarehouse(tenantId: string, warehouseId: string): Warehouse {
    const warehouse = this.warehouses.get(key(tenantId, warehouseId));
    if (!warehouse) throw new PlatformError("NOT_FOUND", "Warehouse not found", 404);
    return warehouse;
  }

  private requireReservation(tenantId: string, reservationId: string): StockReservation {
    const reservation = this.reservations.get(key(tenantId, reservationId));
    if (!reservation) throw new PlatformError("NOT_FOUND", "Stock reservation not found", 404);
    return reservation;
  }

  private requireTransfer(tenantId: string, transferId: string): StockTransfer {
    const transfer = this.transfers.get(key(tenantId, transferId));
    if (!transfer) throw new PlatformError("NOT_FOUND", "Stock transfer not found", 404);
    return transfer;
  }

  private requireCount(tenantId: string, countId: string): StockCount {
    const count = this.counts.get(key(tenantId, countId));
    if (!count) throw new PlatformError("NOT_FOUND", "Stock count not found", 404);
    return count;
  }

  private normalizeMovementType(value: string): MovementType {
    const allowed: readonly MovementType[] = ["opening_balance", "purchase_receipt", "sale_issue", "customer_return", "supplier_return", "transfer_dispatch", "transfer_receipt", "adjustment_gain", "adjustment_loss", "physical_count_variance", "status_change", "landed_cost_revaluation", "reversal"];
    if (!allowed.includes(value as MovementType)) throw new PlatformError("VALIDATION_FAILED", `Unsupported stock movement type: ${value}`, 400);
    return value as MovementType;
  }

  private emit(tenantId: string, eventType: string, aggregateType: string, aggregateId: string, postingGroupId: string, actorId: string, payload: Readonly<Record<string, unknown>>, businessDate = this.today()): void {
    const event: InventoryEvent = {
      id: this.idFactory(),
      tenantId,
      eventType,
      aggregateType,
      aggregateId,
      postingGroupId,
      occurredAt: this.now().toISOString(),
      businessDate,
      actorId,
      payload,
    };
    this.emittedEvents.push(event);
    this.onEvent?.(event);
  }

  private today(): string {
    return this.now().toISOString().slice(0, 10);
  }
}
