import type { InventoryReconciliation, StockLedgerEntry, StockReservation } from "./types.js";

export interface MetricPoint {
  readonly name: string;
  readonly value: number;
  readonly kind: "counter" | "gauge" | "histogram";
  readonly labels: Readonly<Record<string, string>>;
  readonly observedAt: string;
}

export interface OperationalAlert {
  readonly code: string;
  readonly severity: "warning" | "critical";
  readonly message: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly observedAt: string;
}

export class InventoryTelemetry {
  private readonly metrics: MetricPoint[] = [];
  private readonly alerts: OperationalAlert[] = [];
  constructor(private readonly now: () => Date = () => new Date()) {}

  recordPosting(entry: StockLedgerEntry, durationMs: number): void {
    const labels = { tenantId: entry.tenantId, warehouseId: entry.warehouseId, movementType: entry.movementType, status: entry.stockStatus };
    this.metrics.push({ name: "inventory_stock_postings_total", value: 1, kind: "counter", labels, observedAt: this.now().toISOString() });
    this.metrics.push({ name: "inventory_stock_posting_duration_ms", value: durationMs, kind: "histogram", labels, observedAt: this.now().toISOString() });
  }

  recordReservation(reservation: StockReservation): void {
    this.metrics.push({ name: "inventory_reservations_total", value: 1, kind: "counter", labels: { tenantId: reservation.tenantId, state: reservation.state }, observedAt: this.now().toISOString() });
  }

  recordReconciliation(result: InventoryReconciliation): void {
    this.metrics.push({ name: "inventory_reconciliation_mismatches", value: result.mismatches.length, kind: "gauge", labels: { tenantId: result.tenantId, status: result.status }, observedAt: this.now().toISOString() });
    if (result.status === "mismatch") this.alerts.push({ code: "INVENTORY_RECONCILIATION_MISMATCH", severity: "critical", message: `${result.mismatches.length} inventory projection mismatches detected`, labels: { tenantId: result.tenantId, runId: result.id }, observedAt: this.now().toISOString() });
  }

  recordExpiredReservations(tenantId: string, count: number): void {
    this.metrics.push({ name: "inventory_reservations_expired_total", value: count, kind: "counter", labels: { tenantId }, observedAt: this.now().toISOString() });
    if (count > 500) this.alerts.push({ code: "RESERVATION_EXPIRY_BACKLOG", severity: "warning", message: `Expired reservation backlog is ${count}`, labels: { tenantId }, observedAt: this.now().toISOString() });
  }

  snapshot(): { readonly metrics: readonly MetricPoint[]; readonly alerts: readonly OperationalAlert[] } {
    return { metrics: this.metrics.map((metric) => ({ ...metric, labels: { ...metric.labels } })), alerts: this.alerts.map((alert) => ({ ...alert, labels: { ...alert.labels } })) };
  }
}
