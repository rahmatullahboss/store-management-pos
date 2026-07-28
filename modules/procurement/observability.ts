import type { GoodsReceipt, PurchaseOrder, ThreeWayMatchResult } from "./types.js";
import type { MetricPoint, OperationalAlert } from "../inventory/observability.js";

export class ProcurementTelemetry {
  private readonly metrics: MetricPoint[] = [];
  private readonly alerts: OperationalAlert[] = [];
  constructor(private readonly now: () => Date = () => new Date()) {}

  recordPurchaseOrder(order: PurchaseOrder): void {
    this.metrics.push({ name: "procurement_purchase_orders_total", value: 1, kind: "counter", labels: { tenantId: order.tenantId, supplierId: order.supplierId, state: order.state }, observedAt: this.now().toISOString() });
  }

  recordReceipt(receipt: GoodsReceipt): void {
    this.metrics.push({ name: "procurement_receipts_total", value: 1, kind: "counter", labels: { tenantId: receipt.tenantId, supplierId: receipt.supplierId }, observedAt: this.now().toISOString() });
    const exceptions = receipt.lines.filter((line) => line.disposition !== "accepted").length;
    this.metrics.push({ name: "procurement_receipt_exception_lines", value: exceptions, kind: "gauge", labels: { tenantId: receipt.tenantId, receiptId: receipt.id }, observedAt: this.now().toISOString() });
    if (exceptions > 0) this.alerts.push({ code: "RECEIPT_INSPECTION_EXCEPTION", severity: "warning", message: `${exceptions} receipt lines require follow-up`, labels: { tenantId: receipt.tenantId, receiptId: receipt.id }, observedAt: this.now().toISOString() });
  }

  recordThreeWayMatch(result: ThreeWayMatchResult): void {
    this.metrics.push({ name: "procurement_three_way_match_total", value: 1, kind: "counter", labels: { tenantId: result.tenantId, status: result.status }, observedAt: this.now().toISOString() });
    if (result.status !== "matched") this.alerts.push({ code: "THREE_WAY_MATCH_VARIANCE", severity: result.status === "failed" ? "critical" : "warning", message: `Supplier bill match completed with ${result.status}`, labels: { tenantId: result.tenantId, supplierBillId: result.supplierBillId }, observedAt: this.now().toISOString() });
  }

  snapshot(): { readonly metrics: readonly MetricPoint[]; readonly alerts: readonly OperationalAlert[] } {
    return { metrics: this.metrics.map((metric) => ({ ...metric, labels: { ...metric.labels } })), alerts: this.alerts.map((alert) => ({ ...alert, labels: { ...alert.labels } })) };
  }
}
