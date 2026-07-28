import { NeonDatabase } from "../../../packages/foundation/src/db.js";
import { errorResponse } from "../../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../../packages/foundation/src/ids.js";
import { createTokenVerifier } from "./token-verifier.js";
import { buildRequestContext } from "./request-context.js";
import { handleCreateReference } from "./reference-handler.js";
import { handleInventoryRequest } from "./modules/inventory/handler.js";
import { handleProcurementRequest } from "./modules/procurement/handler.js";

export interface ApiEnvironment {
  readonly DATABASE_URL: string;
  readonly APP_ENV: string;
  readonly REGION: string;
  readonly OIDC_ISSUER?: string;
  readonly OIDC_AUDIENCE?: string;
  readonly OIDC_JWKS_URI?: string;
  readonly OIDC_MFA_ACR_VALUES?: string;
}

export default {
  async fetch(request: Request, env: ApiEnvironment): Promise<Response> {
    const requestId = request.headers.get("x-request-id") ?? uuidV7();
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") return Response.json({ status: "healthy", service: "api", databaseMode: "direct-neon", region: env.REGION });
      const database = new NeonDatabase({ connectionString: env.DATABASE_URL });
      const verifier = createTokenVerifier(env, database);
      const context = await buildRequestContext(new Request(request, { headers: new Headers([...request.headers, ["x-request-id", requestId]]) }), verifier, env.REGION);
      if (request.method === "POST" && url.pathname === "/v1/platform/reference-records") return await handleCreateReference(request, context, database);
      const inventoryResponse = await handleInventoryRequest(request, url, context, database);
      if (inventoryResponse) return inventoryResponse;
      const procurementResponse = await handleProcurementRequest(request, url, context, database);
      if (procurementResponse) return procurementResponse;
      return Response.json({ error: { code: "NOT_FOUND", message: "Route not found", requestId } }, { status: 404 });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  },
};
