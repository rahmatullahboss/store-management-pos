import { NeonDatabase } from "../../../packages/foundation/src/db.js";
import { errorResponse } from "../../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../../packages/foundation/src/ids.js";
import { createTokenVerifier } from "./token-verifier.js";
import { buildRequestContext } from "./request-context.js";
import { handleCreateReference } from "./reference-handler.js";
import { handleAllocateOpenItem, handleClosePeriod, handleCreateOpenItem, handleGeneralLedger, handleOpenItemAging, handlePostJournal, handleReopenPeriod, handleReverseJournal, handleTrialBalance } from "./accounting-handler.js";
import { handleImportBankStatement, handleListUnreconciled, handleReconcileStatementLine, handleRecordReconciliationRun, handleReverseReconciliation } from "./banking-handler.js";
import { handleCreatePaymentIntent, handleCreateRefund, handleImportSettlement, handlePaymentAction } from "./payment-handler.js";

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
      if (request.method === "POST" && url.pathname === "/v1/payments/intents") return await handleCreatePaymentIntent(request, context, database, env);
      const paymentAction = url.pathname.match(/^\/v1\/payments\/intents\/([^/]+)\/(authorize|capture|void|recover)$/u);
      if (request.method === "POST" && paymentAction?.[1] && paymentAction[2]) {
        return await handlePaymentAction(request, context, database, env, paymentAction[1], paymentAction[2] as "authorize" | "capture" | "void" | "recover");
      }
      if (request.method === "POST" && url.pathname === "/v1/refunds") return await handleCreateRefund(request, context, database, env);
      if (request.method === "POST" && url.pathname === "/v1/settlements/import") return await handleImportSettlement(request, context, database, env);
      if (request.method === "POST" && url.pathname === "/v1/accounting/journals") return await handlePostJournal(request, context, database);
      const journalReversal = url.pathname.match(/^\/v1\/accounting\/journals\/([^/]+)\/reverse$/u);
      if (request.method === "POST" && journalReversal?.[1]) return await handleReverseJournal(request, context, database, journalReversal[1]);
      if (request.method === "POST" && url.pathname === "/v1/accounting/open-items") return await handleCreateOpenItem(request, context, database);
      const openItemAllocation = url.pathname.match(/^\/v1\/accounting\/open-items\/([^/]+)\/allocations$/u);
      if (request.method === "POST" && openItemAllocation?.[1]) return await handleAllocateOpenItem(request, context, database, openItemAllocation[1]);
      const periodAction = url.pathname.match(/^\/v1\/accounting\/periods\/([^/]+)\/(close|reopen)$/u);
      if (request.method === "POST" && periodAction?.[1] && periodAction[2] === "close") return await handleClosePeriod(request, context, database, periodAction[1]);
      if (request.method === "POST" && periodAction?.[1] && periodAction[2] === "reopen") return await handleReopenPeriod(request, context, database, periodAction[1]);
      if (request.method === "GET" && url.pathname === "/v1/accounting/reports/trial-balance") return await handleTrialBalance(url, context, database);
      if (request.method === "GET" && url.pathname === "/v1/accounting/reports/general-ledger") return await handleGeneralLedger(url, context, database);
      if (request.method === "GET" && url.pathname === "/v1/accounting/reports/open-item-aging") return await handleOpenItemAging(url, context, database);
      if (request.method === "POST" && url.pathname === "/v1/banking/statements/import") return await handleImportBankStatement(request, context, database);
      if (request.method === "POST" && url.pathname === "/v1/banking/reconciliations") return await handleReconcileStatementLine(request, context, database);
      const reconciliationReversal = url.pathname.match(/^\/v1\/banking\/reconciliations\/([^/]+)\/reverse$/u);
      if (request.method === "POST" && reconciliationReversal?.[1]) return await handleReverseReconciliation(request, context, database, reconciliationReversal[1]);
      if (request.method === "POST" && url.pathname === "/v1/banking/reconciliation-runs") return await handleRecordReconciliationRun(request, context, database);
      if (request.method === "GET" && url.pathname === "/v1/banking/unreconciled") return await handleListUnreconciled(url, context, database);
      return Response.json({ error: { code: "NOT_FOUND", message: "Route not found", requestId } }, { status: 404 });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  },
};
