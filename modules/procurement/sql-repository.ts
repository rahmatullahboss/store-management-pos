import type { RequestContext } from "../../packages/foundation/src/context.js";
import type { TransactionClient } from "../../packages/foundation/src/db.js";

export class ProcurementSqlRepository {
  async listOpenPurchaseOrders(client: TransactionClient, context: RequestContext, input: { readonly supplierId?: string; readonly warehouseId?: string; readonly limit?: number }): Promise<readonly Record<string, unknown>[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
    const result = await client.query(
      `SELECT po.id::text,
              po.order_number,
              po.supplier_id::text,
              po.warehouse_id::text,
              po.state,
              po.currency,
              po.revision,
              po.updated_at::text,
              COUNT(pol.id)::integer AS line_count
         FROM procurement.purchase_orders po
         JOIN procurement.purchase_order_lines pol
           ON pol.tenant_id = po.tenant_id AND pol.purchase_order_id = po.id
        WHERE po.tenant_id = $1::uuid
          AND po.state IN ('submitted','approved','partially_received')
          AND ($2::uuid IS NULL OR po.supplier_id = $2::uuid)
          AND ($3::uuid IS NULL OR po.warehouse_id = $3::uuid)
        GROUP BY po.id
        ORDER BY po.updated_at DESC
        LIMIT $4`,
      [context.tenantId, input.supplierId ?? null, input.warehouseId ?? null, limit],
    );
    return result.rows;
  }

  async supplierPerformance(client: TransactionClient, context: RequestContext): Promise<readonly Record<string, unknown>[]> {
    const result = await client.query(
      `SELECT s.id::text AS supplier_id,
              s.display_name,
              COUNT(DISTINCT po.id)::integer AS purchase_order_count,
              COUNT(DISTINCT gr.id)::integer AS receipt_count,
              COALESCE(AVG(EXTRACT(EPOCH FROM (gr.received_at - po.approved_at)) / 86400), 0)::numeric(12,2)::text AS average_receipt_days,
              COALESCE(SUM(CASE WHEN grl.disposition IN ('damaged','rejected','quarantine') THEN grl.received_quantity ELSE 0 END), 0)::text AS exception_quantity
         FROM procurement.suppliers s
         LEFT JOIN procurement.purchase_orders po
           ON po.tenant_id = s.tenant_id AND po.supplier_id = s.id
         LEFT JOIN procurement.goods_receipts gr
           ON gr.tenant_id = po.tenant_id AND gr.purchase_order_id = po.id
         LEFT JOIN procurement.goods_receipt_lines grl
           ON grl.tenant_id = gr.tenant_id AND grl.goods_receipt_id = gr.id
        WHERE s.tenant_id = $1::uuid
        GROUP BY s.id, s.display_name
        ORDER BY s.display_name`,
      [context.tenantId],
    );
    return result.rows;
  }
}
