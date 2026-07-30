import { Client } from "@neondatabase/serverless";
import type { InventoryDashboardFixture } from "../../admin-web/src/modules/inventory/index.js";
import type { ProcurementDashboardFixture } from "../../admin-web/src/modules/procurement/index.js";
import type { CustomerWorkspaceInput } from "../../admin-web/src/modules/customer/surface.js";
import type { SalesWorkspaceInput } from "../../admin-web/src/modules/sales/surface.js";
import type { RegisterWorkspaceModel } from "../../pos-web/src/modules/register/surface.js";
import type { StagingReadContext } from "./staging-read-context.js";

interface Row extends Record<string, unknown> {}

export interface StagingCatalogRow {
  readonly productId: string;
  readonly product: string;
  readonly variant: string;
  readonly sku: string;
  readonly category: string;
  readonly price: string;
  readonly available: string;
  readonly inventoryValue: string;
  readonly status: "healthy" | "attention" | "blocked";
}

export interface StagingDashboardModel {
  readonly productCount: number;
  readonly availableUnits: string;
  readonly reservedUnits: string;
  readonly inventoryValue: string;
  readonly openPurchaseOrders: number;
  readonly openPurchaseValue: string;
  readonly activeCustomers: number;
  readonly activeSalesOrders: number;
  readonly salesOrderValue: string;
  readonly lowStockCount: number;
  readonly recentOrders: readonly {
    readonly number: string;
    readonly customer: string;
    readonly total: string;
    readonly state: string;
  }[];
}

export interface StagingOperationalData {
  readonly context: StagingReadContext;
  readonly dashboard: StagingDashboardModel;
  readonly catalog: readonly StagingCatalogRow[];
  readonly inventory: InventoryDashboardFixture;
  readonly procurement: ProcurementDashboardFixture;
  readonly customers: CustomerWorkspaceInput;
  readonly sales: SalesWorkspaceInput;
  readonly pos: RegisterWorkspaceModel;
}

function scalar(row: Row | undefined, key: string): string {
  const value = row?.[key];
  return value === null || value === undefined ? "0" : String(value);
}

function integer(row: Row | undefined, key: string): number {
  const value = Number(scalar(row, key));
  return Number.isSafeInteger(value) ? value : 0;
}

function formatQuantity(value: unknown, scale = 0): string {
  const amount = BigInt(String(value ?? "0"));
  if (scale <= 0) return new Intl.NumberFormat("bn-BD").format(amount);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const divisor = 10n ** BigInt(scale);
  const whole = absolute / divisor;
  const fraction = (absolute % divisor).toString().padStart(scale, "0");
  return `${negative ? "−" : ""}${new Intl.NumberFormat("bn-BD").format(whole)}.${fraction}`;
}

function formatBdt(value: unknown): string {
  const amount = BigInt(String(value ?? "0"));
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "−" : ""}৳${new Intl.NumberFormat("bn-BD").format(whole)}.${fraction}`;
}

function displayProduct(metadata: unknown, fallback: string): string {
  if (metadata && typeof metadata === "object" && "displayName" in metadata) {
    const value = (metadata as { displayName?: unknown }).displayName;
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

function category(metadata: unknown): string {
  if (metadata && typeof metadata === "object" && "category" in metadata) {
    const value = (metadata as { category?: unknown }).category;
    if (typeof value === "string" && value.trim()) return value;
  }
  return "General";
}

function asStatus(available: bigint): "healthy" | "attention" | "blocked" {
  if (available <= 0n) return "blocked";
  if (available <= 15n) return "attention";
  return "healthy";
}

async function query(client: Client, text: string, values: readonly unknown[]): Promise<Row[]> {
  const result = await client.query<Row>(text, values);
  return result.rows;
}

export async function loadStagingOperationalData(
  connectionString: string,
  context: StagingReadContext,
): Promise<StagingOperationalData> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT set_config('statement_timeout', '8000ms', true)");
    await client.query("SELECT set_config('lock_timeout', '1000ms', true)");
    await client.query(
      "SELECT platform.set_request_context($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::date,$8::text,$9::text)",
      [
        context.tenant.id,
        context.user.id,
        context.scope.legalEntityId ?? null,
        context.scope.storeId ?? null,
        context.scope.warehouseId ?? null,
        context.scope.registerId ?? null,
        "2026-07-30",
        crypto.randomUUID(),
        crypto.randomUUID(),
      ],
    );

    const [catalogRows, dashboardRows, procurementRows, supplierRows, customerRows, salesRows] = await Promise.all([
      query(
        client,
        `SELECT p.id AS product_id, p.code, p.metadata, v.id AS variant_id,
                v.title, v.sku, v.status,
                coalesce(pr.unit_price_minor, 0)::text AS price_minor,
                coalesce(sb.sellable, 0)::text AS sellable,
                coalesce(sr.reserved, 0)::text AS reserved,
                (coalesce(sb.sellable, 0) - coalesce(sr.reserved, 0))::text AS available,
                coalesce(sb.value_minor, 0)::text AS value_minor
           FROM catalog.products p
           JOIN catalog.variants v
             ON v.tenant_id = p.tenant_id AND v.product_id = p.id
           LEFT JOIN LATERAL (
             SELECT rule.unit_price_minor
               FROM pricing.price_rules rule
               JOIN pricing.price_list_versions version
                 ON version.tenant_id = rule.tenant_id
                AND version.id = rule.price_list_version_id
              WHERE rule.tenant_id = p.tenant_id
                AND rule.variant_id = v.id
                AND version.status = 'active'
                AND (version.store_id IS NULL OR version.store_id = $2::uuid)
              ORDER BY version.priority DESC, rule.priority DESC, rule.rule_version DESC
              LIMIT 1
           ) pr ON true
           LEFT JOIN LATERAL (
             SELECT sum(quantity_amount)::numeric AS sellable,
                    sum(value_minor)::numeric AS value_minor
               FROM inventory.stock_balances
              WHERE tenant_id = p.tenant_id
                AND variant_id = v.id
                AND warehouse_id = $3::uuid
                AND stock_status = 'sellable'
           ) sb ON true
           LEFT JOIN LATERAL (
             SELECT sum(line.reserved_quantity - line.consumed_quantity - line.released_quantity)::numeric AS reserved
               FROM inventory.stock_reservation_lines line
               JOIN inventory.stock_reservations reservation
                 ON reservation.tenant_id = line.tenant_id
                AND reservation.id = line.reservation_id
              WHERE line.tenant_id = p.tenant_id
                AND line.variant_id = v.id
                AND line.warehouse_id = $3::uuid
                AND reservation.state IN ('fully_reserved','partially_reserved','partially_consumed')
           ) sr ON true
          WHERE p.tenant_id = $1::uuid
            AND p.status = 'active'
            AND v.status = 'active'
          ORDER BY p.code, v.sku`,
        [context.tenant.id, context.scope.storeId ?? null, context.scope.warehouseId ?? null],
      ),
      query(
        client,
        `SELECT
           (SELECT count(*) FROM catalog.products WHERE tenant_id=$1::uuid AND status='active')::text AS product_count,
           (SELECT coalesce(sum(quantity_amount),0) FROM inventory.stock_balances WHERE tenant_id=$1::uuid AND warehouse_id=$2::uuid AND stock_status='sellable')::text AS sellable_units,
           (SELECT coalesce(sum(line.reserved_quantity-line.consumed_quantity-line.released_quantity),0)
              FROM inventory.stock_reservation_lines line
              JOIN inventory.stock_reservations reservation ON reservation.tenant_id=line.tenant_id AND reservation.id=line.reservation_id
             WHERE line.tenant_id=$1::uuid AND line.warehouse_id=$2::uuid
               AND reservation.state IN ('fully_reserved','partially_reserved','partially_consumed'))::text AS reserved_units,
           (SELECT coalesce(sum(value_minor),0) FROM inventory.stock_balances WHERE tenant_id=$1::uuid AND warehouse_id=$2::uuid)::text AS inventory_value_minor,
           (SELECT count(*) FROM procurement.purchase_orders WHERE tenant_id=$1::uuid AND state IN ('submitted','approved','partially_received'))::text AS open_po_count,
           (SELECT coalesce(sum(line.ordered_quantity * line.unit_cost_minor),0)
              FROM procurement.purchase_order_lines line
              JOIN procurement.purchase_orders po ON po.tenant_id=line.tenant_id AND po.id=line.purchase_order_id
             WHERE line.tenant_id=$1::uuid AND po.state IN ('submitted','approved','partially_received'))::text AS open_po_value_minor,
           (SELECT count(*) FROM customer.customers WHERE tenant_id=$1::uuid AND status='active')::text AS active_customers,
           (SELECT count(*) FROM sales.orders WHERE tenant_id=$1::uuid AND order_status IN ('confirmed','on_hold'))::text AS active_sales_orders,
           (SELECT coalesce(sum((totals_snapshot->>'totalMinor')::numeric),0) FROM sales.orders WHERE tenant_id=$1::uuid AND order_status IN ('confirmed','on_hold'))::text AS sales_order_value_minor`,
        [context.tenant.id, context.scope.warehouseId ?? null],
      ),
      query(
        client,
        `SELECT po.order_number, po.state, po.metadata, supplier.display_name AS supplier,
                warehouse.display_name AS destination,
                coalesce(sum(line.ordered_quantity),0)::text AS ordered,
                coalesce(sum(line.received_quantity),0)::text AS received,
                coalesce(sum(line.ordered_quantity * line.unit_cost_minor),0)::text AS value_minor
           FROM procurement.purchase_orders po
           JOIN procurement.suppliers supplier ON supplier.tenant_id=po.tenant_id AND supplier.id=po.supplier_id
           JOIN platform.warehouses warehouse ON warehouse.tenant_id=po.tenant_id AND warehouse.id=po.warehouse_id
           LEFT JOIN procurement.purchase_order_lines line ON line.tenant_id=po.tenant_id AND line.purchase_order_id=po.id
          WHERE po.tenant_id=$1::uuid
          GROUP BY po.order_number, po.state, po.metadata, supplier.display_name, warehouse.display_name, po.created_at
          ORDER BY po.created_at DESC`,
        [context.tenant.id],
      ),
      query(
        client,
        `SELECT supplier.display_name,
                count(po.id) FILTER (WHERE po.state IN ('submitted','approved','partially_received'))::text AS open_orders,
                supplier.lead_time_days::text AS lead_time_days,
                max(po.updated_at)::text AS last_activity
           FROM procurement.suppliers supplier
           LEFT JOIN procurement.purchase_orders po ON po.tenant_id=supplier.tenant_id AND po.supplier_id=supplier.id
          WHERE supplier.tenant_id=$1::uuid AND supplier.status='active'
          GROUP BY supplier.id, supplier.display_name, supplier.lead_time_days
          ORDER BY supplier.display_name`,
        [context.tenant.id],
      ),
      query(
        client,
        `SELECT id::text, display_name, customer_kind, status, updated_at::text
           FROM customer.customers
          WHERE tenant_id=$1::uuid
          ORDER BY updated_at DESC, display_name`,
        [context.tenant.id],
      ),
      query(
        client,
        `SELECT id::text, document_number,
                customer_snapshot->>'displayName' AS customer,
                totals_snapshot->>'totalMinor' AS total_minor,
                order_status, payment_status, fulfillment_status, invoice_status,
                updated_at::text
           FROM sales.orders
          WHERE tenant_id=$1::uuid
          ORDER BY updated_at DESC, document_number`,
        [context.tenant.id],
      ),
    ]);

    const catalog: StagingCatalogRow[] = catalogRows.map((row) => {
      const sellable = BigInt(scalar(row, "sellable"));
      const reserved = BigInt(scalar(row, "reserved"));
      const available = BigInt(scalar(row, "available"));
      return {
        productId: scalar(row, "product_id"),
        product: displayProduct(row.metadata, scalar(row, "code")),
        variant: scalar(row, "title"),
        sku: scalar(row, "sku"),
        category: category(row.metadata),
        price: formatBdt(row.price_minor),
        available: formatQuantity(available),
        inventoryValue: formatBdt(row.value_minor),
        status: asStatus(available),
        sellable,
        reserved,
      } as StagingCatalogRow & { sellable: bigint; reserved: bigint };
    });

    const dashboardRow = dashboardRows[0];
    const recentOrders = salesRows.slice(0, 5).map((row) => ({
      number: scalar(row, "document_number"),
      customer: scalar(row, "customer"),
      total: formatBdt(row.total_minor),
      state: `${scalar(row, "order_status")} · ${scalar(row, "payment_status")}`,
    }));
    const lowStockCount = catalog.filter((item) => item.status !== "healthy").length;

    const inventoryBalances = catalog.map((item) => {
      const internal = item as StagingCatalogRow & { sellable: bigint; reserved: bigint };
      return {
        variant: `${item.product} · ${item.variant}`,
        sku: item.sku,
        warehouse: "Synthetic Dhaka Warehouse",
        sellable: formatQuantity(internal.sellable),
        reserved: formatQuantity(internal.reserved),
        inTransit: "০",
        value: item.inventoryValue,
        status: item.status,
      };
    });

    const purchaseOrders: ProcurementDashboardFixture["purchaseOrders"] = procurementRows.map((row) => {
      const state = scalar(row, "state");
      const mappedState = state === "submitted"
        ? "submitted"
        : state === "approved"
          ? "approved"
          : state === "partially_received"
            ? "partially_received"
            : "exception";
      const metadata = row.metadata && typeof row.metadata === "object"
        ? row.metadata as { promisedDate?: unknown }
        : {};
      return {
        order: scalar(row, "order_number"),
        supplier: scalar(row, "supplier"),
        destination: scalar(row, "destination"),
        promised: typeof metadata.promisedDate === "string" ? metadata.promisedDate : "Not set",
        ordered: `${formatQuantity(row.ordered)} EA`,
        received: `${formatQuantity(row.received)} EA`,
        value: formatBdt(row.value_minor),
        state: mappedState,
      };
    });

    const openPoValue = scalar(dashboardRow, "open_po_value_minor");
    const procurement: ProcurementDashboardFixture = {
      approvedOpenValue: formatBdt(openPoValue),
      receiptsDue: procurementRows.filter((row) => ["approved", "partially_received"].includes(scalar(row, "state"))).length,
      matchExceptions: 0,
      purchaseOrders,
      suppliers: supplierRows.map((row) => ({
        supplier: scalar(row, "display_name"),
        openOrders: integer(row, "open_orders"),
        averageReceipt: `${integer(row, "lead_time_days")} days`,
        exceptionRate: "0.0%",
        lastReceipt: scalar(row, "last_activity").slice(0, 10) || "No receipt",
        state: "healthy" as const,
      })),
    };

    const customers: CustomerWorkspaceInput = {
      locale: "en-GB",
      direction: "ltr",
      state: customerRows.length > 0 ? "ready" : "empty",
      customers: customerRows.map((row) => ({
        id: scalar(row, "id"),
        displayName: scalar(row, "display_name"),
        kind: scalar(row, "customer_kind") === "company" ? "company" : "person",
        status: scalar(row, "status") === "inactive" ? "inactive" : scalar(row, "status") === "merged" ? "merged" : "active",
        credit: "Read-only",
        updatedAt: scalar(row, "updated_at").slice(0, 10),
      })),
      pendingApprovals: 0,
    };

    const sales: SalesWorkspaceInput = {
      locale: "en-GB",
      direction: "ltr",
      state: salesRows.length > 0 ? "ready" : "empty",
      orders: salesRows.map((row) => ({
        id: scalar(row, "id"),
        documentNumber: scalar(row, "document_number"),
        customer: scalar(row, "customer"),
        total: formatBdt(row.total_minor),
        orderStatus: scalar(row, "order_status"),
        paymentStatus: scalar(row, "payment_status"),
        fulfillmentStatus: scalar(row, "fulfillment_status"),
        invoiceStatus: scalar(row, "invoice_status"),
      })),
      approvalCount: salesRows.filter((row) => scalar(row, "order_status") === "on_hold").length,
    };

    const posLines = catalog.slice(0, 3).map((item, index) => ({
      lineId: `release-candidate-${index + 1}`,
      name: item.product,
      variant: `${item.variant} · ${item.sku} · available ${item.available}`,
      quantity: "1",
      lineTotalMinor: BigInt(item.price.replace(/[^0-9]/gu, "")),
      ...(item.status === "blocked" ? { warning: "No available stock" } : {}),
    }));
    const subtotalMinor = posLines.reduce((sum, line) => sum + line.lineTotalMinor, 0n);

    await client.query("COMMIT");
    return {
      context,
      dashboard: {
        productCount: integer(dashboardRow, "product_count"),
        availableUnits: formatQuantity(BigInt(scalar(dashboardRow, "sellable_units")) - BigInt(scalar(dashboardRow, "reserved_units"))),
        reservedUnits: formatQuantity(dashboardRow?.reserved_units),
        inventoryValue: formatBdt(dashboardRow?.inventory_value_minor),
        openPurchaseOrders: integer(dashboardRow, "open_po_count"),
        openPurchaseValue: formatBdt(dashboardRow?.open_po_value_minor),
        activeCustomers: integer(dashboardRow, "active_customers"),
        activeSalesOrders: integer(dashboardRow, "active_sales_orders"),
        salesOrderValue: formatBdt(dashboardRow?.sales_order_value_minor),
        lowStockCount,
        recentOrders,
      },
      catalog,
      inventory: {
        reconciledAt: "30 Jul 2026 · live staging query",
        availableUnits: formatQuantity(BigInt(scalar(dashboardRow, "sellable_units")) - BigInt(scalar(dashboardRow, "reserved_units"))),
        reservedUnits: formatQuantity(dashboardRow?.reserved_units),
        exceptionCount: lowStockCount,
        balances: inventoryBalances,
        tasks: catalog.filter((item) => item.status !== "healthy").map((item) => ({
          priority: item.status === "blocked" ? "critical" as const : "attention" as const,
          task: item.status === "blocked" ? "Restore product availability" : "Review low stock",
          source: item.sku,
          quantity: `${item.available} available`,
          age: "Current",
          action: "Open catalog",
        })),
        trace: [
          { label: "Seed document", reference: "STG-OPEN-001…005", detail: "Deterministic synthetic opening stock" },
          { label: "Posting group", reference: "STG-PG-OPENING", detail: "Five immutable inventory entries" },
          { label: "Balance projection", reference: "Synthetic Dhaka Warehouse", detail: `${catalog.length} variant balances reconciled` },
        ],
      },
      procurement,
      customers,
      sales,
      pos: {
        locale: "en-GB",
        currency: "BDT",
        scale: 2,
        online: true,
        pendingOperations: 0,
        registerLabel: "Synthetic Dhaka Register",
        shiftStatus: "open",
        cashierName: context.user.name,
        cartReference: "RC-LIVE-0001",
        lines: posLines,
        subtotalMinor,
        discountMinor: 0n,
        taxMinor: 0n,
        payableMinor: subtotalMinor,
        tenders: [],
        canCheckout: false,
        checkoutBlockReason: "Release-candidate read journey only. Payment and authoritative checkout remain disabled until controlled-write gates pass.",
      },
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  } finally {
    await client.end();
  }
}
