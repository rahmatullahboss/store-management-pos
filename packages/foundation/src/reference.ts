import type { RequestContext } from "./context.js";
import { requirePermission } from "./context.js";
import type { TransactionClient } from "./db.js";

export interface ReferenceCommand { readonly idempotencyKey: string; readonly requestHash: string; readonly name: string }
export interface ReferenceResult { readonly id: string; readonly name: string; readonly version: bigint; readonly createdAt: string; readonly replayed: boolean }

export async function createReferenceRecord(client: TransactionClient, context: RequestContext, command: ReferenceCommand): Promise<ReferenceResult> {
  requirePermission(context, "platform.reference.create");
  const result = await client.query<{ id: string; name: string; version: string; created_at: string; replayed: boolean }>(
    "SELECT id::text, name, version::text, created_at::text, replayed FROM platform.create_reference_record($1, $2, $3, $4)",
    [command.idempotencyKey, command.requestHash, command.name, context.requestId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Reference command returned no result");
  return { id: row.id, name: row.name, version: BigInt(row.version), createdAt: row.created_at, replayed: row.replayed };
}
