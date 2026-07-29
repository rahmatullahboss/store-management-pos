import test from "node:test";
import assert from "node:assert/strict";
import { InventoryService } from "../../build/modules/inventory/inventory-service.js";
import { ProcurementService } from "../../build/modules/procurement/procurement-service.js";

function harness() {
  let sequence = 0;
  const clock = new Date("2026-07-28T10:00:00.000Z");
  const ids = () => `id-${String(++sequence).padStart(4, "0")}`;
  const now = () => new Date(clock);
  const inventory = new InventoryService({ now, idFactory: ids });
  const context = {
    tenantId: "tenant-1",
    legalEntityId: "entity-1",
    actorId: "actor-1",
    locale: "en-GB",
    timeZone: "Asia/Dhaka",
    businessDate: "2026-07-28",
  };
  const audit = { actorId: "actor-1", requestId: "request-1", traceId: "trace-1" };
  inventory.registerWarehouse({
    id: "warehouse-a",
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    code: "WH-A",
    displayName: "Warehouse A",
    status: "active",
    negativeStockPolicy: "deny",
    costingMethod: "fifo",
    timeZone: context.timeZone,
  });
  inventory.registerWarehouse({
    id: "warehouse-b",
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    code: "WH-B",
    displayName: "Warehouse B",
    status: "active",
    negativeStockPolicy: "deny",
    costingMethod: "fifo",
    timeZone: context.timeZone,
  });
  return { inventory, context, audit, ids, clock };
}

function opening(inventory, context, audit, quantity = "10", operationId = "open-1", unitCostMinor = "100") {
  return inventory.postStock({
    schemaVersion: "1.0",
    context,
    operationId,
    postingGroupId: `group-${operationId}`,
    movementType: "opening_balance",
    sourceDocumentType: "opening_balance",
    lines: [{
      item: { itemId: "item-1", variantId: "variant-1" },
      warehouseId: "warehouse-a",
      quantityDelta: { amount: quantity, unit: "EA", scale: 0 },
      unitCostMinor,
      currency: "GBP",
      sourceDocumentId: operationId,
    }],
    audit,
  });
}

test("immutable stock ledger is idempotent, exact and reconciles", () => {
  const { inventory, context, audit } = harness();
  const first = opening(inventory, context, audit);
  const replay = opening(inventory, context, audit);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(inventory.getLedger(context.tenantId).length, 1);
  assert.equal(inventory.getBalance(context.tenantId, "warehouse-a", "variant-1").quantity, 10n);
  assert.equal(inventory.getBalance(context.tenantId, "warehouse-a", "variant-1").valueMinor, 1000n);

  const issue = inventory.postStock({
    schemaVersion: "1.0",
    context,
    operationId: "sale-1",
    postingGroupId: "group-sale-1",
    movementType: "sale_issue",
    sourceDocumentType: "sale",
    lines: [{
      item: { itemId: "item-1", variantId: "variant-1" },
      warehouseId: "warehouse-a",
      quantityDelta: { amount: "-3", unit: "EA", scale: 0 },
      sourceDocumentId: "sale-1",
    }],
    audit,
  });
  assert.equal(issue.costConsumptions.length, 1);
  assert.equal(issue.costConsumptions[0].valueMinor, 300n);
  assert.equal(inventory.getBalance(context.tenantId, "warehouse-a", "variant-1").quantity, 7n);
  assert.equal(inventory.getBalance(context.tenantId, "warehouse-a", "variant-1").valueMinor, 700n);
  assert.equal(inventory.reconcile(context.tenantId).status, "matched");

  assert.throws(() => inventory.postStock({
    schemaVersion: "1.0",
    context,
    operationId: "oversell-1",
    postingGroupId: "group-oversell-1",
    movementType: "sale_issue",
    sourceDocumentType: "sale",
    lines: [{
      item: { itemId: "item-1", variantId: "variant-1" },
      warehouseId: "warehouse-a",
      quantityDelta: { amount: "-8", unit: "EA", scale: 0 },
      sourceDocumentId: "oversell-1",
    }],
    audit,
  }), /negative sellable stock/i);
  assert.equal(inventory.getBalance(context.tenantId, "warehouse-a", "variant-1").quantity, 7n);
});

test("reservations, transfers, adjustments and counts enforce state transitions", () => {
  const { inventory, context, audit } = harness();
  opening(inventory, context, audit);
  const reservation = inventory.createReservation({
    schemaVersion: "1.0",
    context,
    reservationId: "reservation-1",
    sourceType: "sale",
    sourceId: "sale-1",
    fulfillmentPolicy: "all_or_nothing",
    lines: [{ item: { itemId: "item-1", variantId: "variant-1" }, warehouseId: "warehouse-a", quantity: { amount: "4", unit: "EA", scale: 0 } }],
  });
  assert.equal(reservation.state, "fully_reserved");
  assert.equal(inventory.getAvailability(context.tenantId, "warehouse-a", "variant-1").available.amount, "6");
  inventory.releaseReservation(context.tenantId, reservation.id);
  assert.equal(inventory.getAvailability(context.tenantId, "warehouse-a", "variant-1").available.amount, "10");

  const transfer = inventory.createTransfer({
    id: "transfer-1",
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    sourceWarehouseId: "warehouse-a",
    destinationWarehouseId: "warehouse-b",
    requestedBy: context.actorId,
    lines: [{ id: "transfer-line-1", variantId: "variant-1", quantity: { amount: "2", unit: "EA", scale: 0 } }],
  });
  inventory.approveTransfer(context.tenantId, transfer.id, "approver-1");
  inventory.dispatchTransfer({ tenantId: context.tenantId, transferId: transfer.id, actorId: context.actorId, operationId: "transfer-dispatch-1", postingGroupId: "group-transfer-1", businessDate: context.businessDate });
  assert.equal(inventory.getBalance(context.tenantId, "warehouse-a", "variant-1").quantity, 8n);
  assert.equal(inventory.getBalance(context.tenantId, "warehouse-b", "variant-1", "in_transit").quantity, 2n);
  const received = inventory.receiveTransfer({
    tenantId: context.tenantId,
    transferId: transfer.id,
    actorId: context.actorId,
    operationId: "transfer-receipt-1",
    postingGroupId: "group-transfer-receipt-1",
    businessDate: context.businessDate,
    lines: [{ lineId: "transfer-line-1", received: { amount: "1", unit: "EA", scale: 0 }, damaged: { amount: "1", unit: "EA", scale: 0 } }],
  });
  assert.equal(received.state, "received");
  assert.equal(inventory.getBalance(context.tenantId, "warehouse-b", "variant-1").quantity, 1n);
  assert.equal(inventory.getBalance(context.tenantId, "warehouse-b", "variant-1", "damaged").quantity, 1n);
  assert.equal(inventory.closeTransfer(context.tenantId, transfer.id).state, "closed");

  assert.throws(() => inventory.postAdjustment({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    warehouseId: "warehouse-a",
    actorId: context.actorId,
    operationId: "adjust-1",
    postingGroupId: "group-adjust-1",
    businessDate: context.businessDate,
    reason: "Damage",
    lines: [{ variantId: "variant-1", quantityDelta: { amount: "-1", unit: "EA", scale: 0 } }],
  }), /require approval/i);

  const count = inventory.createCount({
    id: "count-1",
    tenantId: context.tenantId,
    warehouseId: "warehouse-a",
    createdBy: context.actorId,
    blind: true,
    items: [{ variantId: "variant-1", unit: "EA", scale: 0 }],
  });
  const first = inventory.submitCount(context.tenantId, count.id, { [count.lines[0].id]: { amount: "7", unit: "EA", scale: 0 } });
  assert.equal(first.state, "recount_required");
  const recount = inventory.submitCount(context.tenantId, count.id, { [count.lines[0].id]: { amount: "7", unit: "EA", scale: 0 } });
  assert.equal(recount.state, "submitted");
  const posted = inventory.approveAndPostCount({ tenantId: context.tenantId, countId: count.id, approverId: "approver-1", operationId: "count-post-1", postingGroupId: "group-count-1", businessDate: context.businessDate });
  assert.equal(posted.state, "posted");
  assert.equal(inventory.getBalance(context.tenantId, "warehouse-a", "variant-1").quantity, 7n);
  assert.equal(inventory.reconcile(context.tenantId).status, "matched");
});

test("procurement posts stock only on receiving and preserves receipt lineage", () => {
  const { inventory, context, audit } = harness();
  const procurement = new ProcurementService(inventory, { now: () => new Date("2026-07-28T10:00:00.000Z"), idFactory: (() => { let id = 1000; return () => `id-${++id}`; })() });
  procurement.createSupplier({
    id: "supplier-1",
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    code: "SUP-1",
    legalName: "Supplier One Limited",
    displayName: "Supplier One",
    status: "active",
    currency: "GBP",
    paymentTermsDays: 30,
    leadTimeDays: 7,
  });
  const order = procurement.createPurchaseOrder({
    schemaVersion: "1.0",
    context,
    id: "po-1",
    orderNumber: "PO-0001",
    supplierId: "supplier-1",
    warehouseId: "warehouse-a",
    lines: [{
      id: "po-line-1",
      item: { itemId: "item-1", variantId: "variant-1" },
      warehouseId: "warehouse-a",
      quantity: { amount: "10", unit: "EA", scale: 0 },
      unitCost: { amountMinor: "100", currency: "GBP", scale: 2 },
      overReceiptToleranceBasisPoints: 0,
    }],
    audit,
  });
  procurement.submitPurchaseOrder(context.tenantId, order.id, context.actorId);
  procurement.approvePurchaseOrder({ tenantId: context.tenantId, purchaseOrderId: order.id, approverId: "approver-1", approvalId: "approval-1" });
  assert.equal(inventory.getBalance(context.tenantId, "warehouse-a", "variant-1"), undefined, "approved PO must not create stock");

  const receipt1 = procurement.receivePurchaseOrder({
    context,
    purchaseOrderId: order.id,
    receiptId: "receipt-1",
    receiptNumber: "GRN-0001",
    operationId: "receipt-operation-1",
    postingGroupId: "receipt-group-1",
    lines: [{ purchaseOrderLineId: "po-line-1", quantity: { amount: "6", unit: "EA", scale: 0 }, disposition: "accepted", batchId: "batch-1" }],
    audit,
  });
  assert.equal(receipt1.lines[0].stockLedgerEntryIds.length, 1);
  assert.equal(procurement.getPurchaseOrder(context.tenantId, order.id).state, "partially_received");
  assert.equal(inventory.getBalance(context.tenantId, "warehouse-a", "variant-1").quantity, 6n);

  const receipt2 = procurement.receivePurchaseOrder({
    context,
    purchaseOrderId: order.id,
    receiptId: "receipt-2",
    receiptNumber: "GRN-0002",
    operationId: "receipt-operation-2",
    postingGroupId: "receipt-group-2",
    lines: [{ purchaseOrderLineId: "po-line-1", quantity: { amount: "4", unit: "EA", scale: 0 }, disposition: "accepted", batchId: "batch-2" }],
    audit,
  });
  assert.equal(procurement.getPurchaseOrder(context.tenantId, order.id).state, "received");
  assert.equal(inventory.getBalance(context.tenantId, "warehouse-a", "variant-1").quantity, 10n);

  const landed = procurement.createLandedCost({
    id: "landed-1",
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    goodsReceiptId: receipt1.id,
    total: { amountMinor: "60", currency: "GBP", scale: 2 },
    allocationBasis: "quantity",
  });
  assert.equal(landed.allocations.reduce((sum, allocation) => sum + BigInt(allocation.amount.amountMinor), 0n), 60n);
  procurement.postLandedCost({ tenantId: context.tenantId, landedCostId: landed.id, actorId: context.actorId, postingGroupId: "landed-group-1", businessDate: context.businessDate });
  assert.equal(inventory.getBalance(context.tenantId, "warehouse-a", "variant-1").valueMinor, 1060n);

  const supplierReturn = procurement.postSupplierReturn({
    context,
    returnId: "return-1",
    goodsReceiptId: receipt1.id,
    operationId: "return-operation-1",
    postingGroupId: "return-group-1",
    lines: [{ goodsReceiptLineId: receipt1.lines[0].id, quantity: { amount: "2", unit: "EA", scale: 0 }, reason: "Supplier quality defect" }],
    audit,
  });
  assert.equal(supplierReturn.lines[0].stockLedgerEntryIds.length, 1);
  assert.equal(inventory.getBalance(context.tenantId, "warehouse-a", "variant-1").quantity, 8n);
  assert.equal(procurement.getPurchaseOrder(context.tenantId, order.id).lines[0].returnedQuantity, "2");

  procurement.createSupplierBill({
    id: "bill-1",
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    supplierId: "supplier-1",
    billNumber: "INV-1001",
    billDate: context.businessDate,
    currency: "GBP",
    subtotal: { amountMinor: "1000", currency: "GBP", scale: 2 },
    tax: { amountMinor: "0", currency: "GBP", scale: 2 },
    total: { amountMinor: "1000", currency: "GBP", scale: 2 },
    purchaseOrderIds: [order.id],
    goodsReceiptIds: [receipt1.id, receipt2.id],
  });
  const match = procurement.matchSupplierBill({ tenantId: context.tenantId, supplierBillId: "bill-1", context, audit });
  assert.equal(match.status, "matched");
  assert.equal(match.accountingInstruction.lines.reduce((sum, line) => sum + BigInt(line.debit.amountMinor) - BigInt(line.credit.amountMinor), 0n), 0n);

  procurement.setReorderPolicy({
    id: "reorder-1",
    tenantId: context.tenantId,
    variantId: "variant-1",
    warehouseId: "warehouse-a",
    supplierId: "supplier-1",
    reorderPoint: { amount: "10", unit: "EA", scale: 0 },
    safetyStock: { amount: "2", unit: "EA", scale: 0 },
    minimumQuantity: { amount: "5", unit: "EA", scale: 0 },
    maximumQuantity: { amount: "20", unit: "EA", scale: 0 },
    leadTimeDays: 7,
    active: true,
  });
  const proposals = procurement.generateReplenishmentProposals(context.tenantId);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].suggestedOrderQuantity.amount, "12");
});

test("receipt tolerance and rejected inspection lines cannot inflate stock", () => {
  const { inventory, context, audit } = harness();
  const procurement = new ProcurementService(inventory);
  procurement.createSupplier({ id: "supplier-1", tenantId: context.tenantId, legalEntityId: context.legalEntityId, code: "SUP", legalName: "Supplier", displayName: "Supplier", status: "active", currency: "GBP", paymentTermsDays: 0, leadTimeDays: 0 });
  procurement.createPurchaseOrder({ schemaVersion: "1.0", context, id: "po-1", orderNumber: "PO-1", supplierId: "supplier-1", warehouseId: "warehouse-a", lines: [{ id: "line-1", item: { itemId: "item-1", variantId: "variant-1" }, warehouseId: "warehouse-a", quantity: { amount: "5", unit: "EA", scale: 0 }, unitCost: { amountMinor: "100", currency: "GBP", scale: 2 }, overReceiptToleranceBasisPoints: 0 }], audit });
  procurement.submitPurchaseOrder(context.tenantId, "po-1", context.actorId);
  procurement.approvePurchaseOrder({ tenantId: context.tenantId, purchaseOrderId: "po-1", approverId: "approver", approvalId: "approval" });
  assert.throws(() => procurement.receivePurchaseOrder({ context, purchaseOrderId: "po-1", receiptId: "receipt-over", receiptNumber: "GRN-OVER", operationId: "op-over", postingGroupId: "group-over", lines: [{ purchaseOrderLineId: "line-1", quantity: { amount: "6", unit: "EA", scale: 0 }, disposition: "accepted" }], audit }), /exceeds purchase order tolerance/i);
  const rejected = procurement.receivePurchaseOrder({ context, purchaseOrderId: "po-1", receiptId: "receipt-rejected", receiptNumber: "GRN-REJ", operationId: "op-rej", postingGroupId: "group-rej", lines: [{ purchaseOrderLineId: "line-1", quantity: { amount: "5", unit: "EA", scale: 0 }, disposition: "rejected", discrepancyReason: "Wrong item" }], audit });
  assert.equal(rejected.lines[0].stockLedgerEntryIds.length, 0);
  assert.equal(inventory.getBalance(context.tenantId, "warehouse-a", "variant-1"), undefined);
  assert.equal(procurement.getPurchaseOrder(context.tenantId, "po-1").state, "partially_received");
});
