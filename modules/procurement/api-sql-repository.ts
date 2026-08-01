import type { RequestContext } from "../../packages/foundation/src/context.js";
import type { TransactionClient } from "../../packages/foundation/src/db.js";
import { ProcurementSqlRepository } from "./sql-repository.js";

export class ProcurementApiSqlRepository extends ProcurementSqlRepository {
  override async listOpenPurchaseOrders(
    client: TransactionClient,
    context: RequestContext,
    input: {
      readonly supplierId?: string;
      readonly warehouseId?: string;
      readonly limit?: number;
    },
  ): Promise<readonly Record<string, unknown>[]> {
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
              po.version::text,
              (
                SELECT COUNT(*)::integer
                FROM procurement.purchase_order_lines pol
                WHERE pol.tenant_id = po.tenant_id
                  AND pol.purchase_order_id = po.id
              ) AS line_count
         FROM procurement.purchase_orders po
        WHERE po.tenant_id = $1::uuid
          AND po.state IN ('submitted','approved','partially_received')
          AND ($2::uuid IS NULL OR po.supplier_id = $2::uuid)
          AND ($3::uuid IS NULL OR po.warehouse_id = $3::uuid)
        ORDER BY po.updated_at DESC, po.order_number, po.id
        LIMIT $4`,
      [
        context.tenantId,
        input.supplierId ?? null,
        input.warehouseId ?? null,
        limit,
      ],
    );
    return result.rows;
  }
}
