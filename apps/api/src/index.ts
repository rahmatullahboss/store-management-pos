import { NeonDatabase } from "../../../packages/foundation/src/db.js";
import { errorResponse } from "../../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../../packages/foundation/src/ids.js";
import { DevelopmentTokenVerifier } from "./auth.js";
import { buildRequestContext } from "./request-context.js";
import { handleCreateReference } from "./reference-handler.js";

export interface ApiEnvironment {
  readonly DATABASE_URL: string;
  readonly APP_ENV: string;
  readonly REGION: string;
}

export default {
  async fetch(request: Request, env: ApiEnvironment): Promise<Response> {
    const requestId = request.headers.get("x-request-id") ?? uuidV7();
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") return Response.json({ status: "healthy", service: "api", databaseMode: "direct-neon", region: env.REGION });
      const verifier = new DevelopmentTokenVerifier(env.APP_ENV === "local" || env.APP_ENV === "development" || env.APP_ENV === "preview");
      const context = await buildRequestContext(new Request(request, { headers: new Headers([...request.headers, ["x-request-id", requestId]]) }), verifier, env.REGION);
      const database = new NeonDatabase({ connectionString: env.DATABASE_URL });
      if (request.method === "POST" && url.pathname === "/v1/platform/reference-records") return await handleCreateReference(request, context, database);
      return Response.json({ error: { code: "NOT_FOUND", message: "Route not found", requestId } }, { status: 404 });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  },
};
