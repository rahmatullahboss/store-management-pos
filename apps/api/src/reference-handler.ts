import { sha256Hex } from "../../../packages/foundation/src/crypto.js";
import type { RequestContext } from "../../../packages/foundation/src/context.js";
import type { NeonDatabase } from "../../../packages/foundation/src/db.js";
import { createReferenceRecord } from "../../../packages/foundation/src/reference.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";

export async function handleCreateReference(request: Request, context: RequestContext, database: NeonDatabase): Promise<Response> {
  const body = await request.json() as unknown;
  if (typeof body !== "object" || body === null || typeof (body as Record<string, unknown>).name !== "string") throw new PlatformError("VALIDATION_FAILED", "name is required", 400);
  const name = (body as { name: string }).name.trim();
  if (name.length < 1 || name.length > 120) throw new PlatformError("VALIDATION_FAILED", "name must contain 1 to 120 characters", 400);
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) throw new PlatformError("VALIDATION_FAILED", "idempotency-key header is required", 400);
  const requestHash = await sha256Hex(JSON.stringify({ name }));
  const result = await database.withClientTransaction(context, async (client) => await createReferenceRecord(client, context, { idempotencyKey, requestHash, name }));
  return Response.json({ data: { ...result, version: result.version.toString() } }, { status: result.replayed ? 200 : 201, headers: { etag: `W/\"v${result.version.toString()}\"` } });
}
