import type { FiscalProviderRegistry } from "../../../modules/compliance/src/provider.js";
import { NeonDatabase } from "../../../packages/foundation/src/db.js";
import { errorResponse } from "../../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../../packages/foundation/src/ids.js";
import type { MetricSink } from "../../../packages/foundation/src/observability.js";
import { handleAllocateOpenItem, handleClosePeriod, handleCreateOpenItem, handleGeneralLedger, handleOpenItemAging, handlePostJournal, handleReopenPeriod, handleReverseJournal, handleTrialBalance } from "./accounting-handler.js";
import { handleImportBankStatement, handleListUnreconciled, handleReconcileStatementLine, handleRecordReconciliationRun, handleReverseReconciliation } from "./banking-handler.js";
import { observeFinanceOperation } from "./finance-observability.js";
import { handleFinanceReadiness } from "./finance-readiness-handler.js";
import { handleCashRequest } from "./modules/cash/handler.js";
import { handleComplianceRequest } from "./modules/compliance/handler.js";
import { handleInventoryRequest } from "./modules/inventory/handler.js";
import { handleLocalizationRequest } from "./modules/localization/handler.js";
import { handlePosRequest } from "./modules/pos/handler.js";
import { handlePosReceiptRequest } from "./modules/pos/receipt-handler.js";
import { handleProcurementRequest } from "./modules/procurement/handler.js";
import { handleStorefrontRequest } from "./modules/storefront/handler.js";
import { handleStorefrontPublishingRequest } from "./modules/storefront/publishing-handler.js";
import { handlePublicStorefrontRequest } from "./modules/storefront/public-handler.js";
import { handleStorefrontReadRequest } from "./modules/storefront/read-handler.js";
import { handleCreatePaymentIntent, handleCreateRefund, handleImportSettlement, handlePaymentAction } from "./payment-handler.js";
import { handlePublicApiDiscovery } from "./public-api-discovery.js";
import { handlePublicPartnerApi, type PublicPartnerApiBindings } from "./public-partner-api.js";
import { buildRequestContext } from "./request-context.js";
import { handleCreateReference } from "./reference-handler.js";
import { createTokenVerifier } from "./token-verifier.js";

export interface ApiEnvironment extends PublicPartnerApiBindings {
  readonly DATABASE_URL: string;
  readonly APP_ENV: string;
  readonly REGION: string;
  readonly OIDC_ISSUER?: string;
  readonly OIDC_AUDIENCE?: string;
  readonly OIDC_JWKS_URI?: string;
  readonly OIDC_MFA_ACR_VALUES?: string;
  readonly FINANCE_METRICS?: MetricSink;
  readonly FISCAL_PROVIDERS?: FiscalProviderRegistry;
}

export default {
  async fetch(request: Request, env: ApiEnvironment): Promise<Response> {
    const requestId = request.headers.get("x-request-id") ?? uuidV7();
    try {
      const url = new URL(request.url);
      const discoveryResponse = handlePublicApiDiscovery(request, url);
      if (discoveryResponse) return discoveryResponse;
      if (request.method === "GET" && url.pathname === "/health") return Response.json({ status: "healthy", service: "api", databaseMode: "direct-neon", region: env.REGION });
      const database = new NeonDatabase({ connectionString: env.DATABASE_URL });
      const publicStorefrontResponse = await handlePublicStorefrontRequest(request, url, database);
      if (publicStorefrontResponse) return publicStorefrontResponse;
      const publicPartnerResponse = await handlePublicPartnerApi({ request, url, database, bindings: env, requestId, region: env.REGION });
      if (publicPartnerResponse) return publicPartnerResponse;
      const verifier = createTokenVerifier(env, database);
      const context = await buildRequestContext(new Request(request, { headers: new Headers([...request.headers, ["x-request-id", requestId]]) }), verifier, env.REGION);
      const financeObserver = env.FINANCE_METRICS ? { metrics: env.FINANCE_METRICS } : {};
      const observeFinance = async (module: "payment" | "accounting" | "banking" | "finance", operation: string, work: () => Promise<Response>): Promise<Response> => await observeFinanceOperation(context, financeObserver, module, operation, work);

      if (request.method === "POST" && url.pathname === "/v1/platform/reference-records") return await handleCreateReference(request, context, database);
      const inventoryResponse = await handleInventoryRequest(request, url, context, database);
      if (inventoryResponse) return inventoryResponse;
      const procurementResponse = await handleProcurementRequest(request, url, context, database);
      if (procurementResponse) return procurementResponse;
      const posResponse = await handlePosRequest(request, url, context, database);
      if (posResponse) return posResponse;
      const receiptResponse = await handlePosReceiptRequest(request, url, context, database);
      if (receiptResponse) return receiptResponse;
      const cashResponse = await handleCashRequest(request, url, context, database);
      if (cashResponse) return cashResponse;
      const localizationResponse = await handleLocalizationRequest(request, url, context, database);
      if (localizationResponse) return localizationResponse;
      const complianceResponse = await handleComplianceRequest(request, url, context, database, env.FISCAL_PROVIDERS);
      if (complianceResponse) return complianceResponse;
      const storefrontReadResponse = await handleStorefrontReadRequest(request, url, context, database);
      if (storefrontReadResponse) return storefrontReadResponse;
      const storefrontPublishingResponse = await handleStorefrontPublishingRequest(request, url, context, database);
      if (storefrontPublishingResponse) return storefrontPublishingResponse;
      const storefrontResponse = await handleStorefrontRequest(request, url, context, database);
      if (storefrontResponse) return storefrontResponse;

      if (request.method === "POST" && url.pathname === "/v1/payments/intents") return await observeFinance("payment", "intent.create", async () => await handleCreatePaymentIntent(request, context, database, env));
      const paymentAction = url.pathname.match(/^\/v1\/payments\/intents\/([^/]+)\/(authorize|capture|void|recover)$/u);
      if (request.method === "POST" && paymentAction?.[1] && paymentAction[2]) {
        const intentId = paymentAction[1];
        const action = paymentAction[2] as "authorize" | "capture" | "void" | "recover";
        return await observeFinance("payment", `intent.${action}`, async () => await handlePaymentAction(request, context, database, env, intentId, action));
      }
      if (request.method === "POST" && url.pathname === "/v1/refunds") return await observeFinance("payment", "refund.create", async () => await handleCreateRefund(request, context, database, env));
      if (request.method === "POST" && url.pathname === "/v1/settlements/import") return await observeFinance("payment", "settlement.import", async () => await handleImportSettlement(request, context, database, env));
      if (request.method === "POST" && url.pathname === "/v1/accounting/journals") return await observeFinance("accounting", "journal.post", async () => await handlePostJournal(request, context, database));
      const journalReversal = url.pathname.match(/^\/v1\/accounting\/journals\/([^/]+)\/reverse$/u);
      if (request.method === "POST" && journalReversal?.[1]) {
        const journalId = journalReversal[1];
        return await observeFinance("accounting", "journal.reverse", async () => await handleReverseJournal(request, context, database, journalId));
      }
      if (request.method === "POST" && url.pathname === "/v1/accounting/open-items") return await observeFinance("accounting", "open_item.create", async () => await handleCreateOpenItem(request, context, database));
      const openItemAllocation = url.pathname.match(/^\/v1\/accounting\/open-items\/([^/]+)\/allocations$/u);
      if (request.method === "POST" && openItemAllocation?.[1]) {
        const openItemId = openItemAllocation[1];
        return await observeFinance("accounting", "open_item.allocate", async () => await handleAllocateOpenItem(request, context, database, openItemId));
      }
      const periodAction = url.pathname.match(/^\/v1\/accounting\/periods\/([^/]+)\/(close|reopen)$/u);
      if (request.method === "POST" && periodAction?.[1] && periodAction[2] === "close") {
        const periodId = periodAction[1];
        return await observeFinance("accounting", "period.close", async () => await handleClosePeriod(request, context, database, periodId));
      }
      if (request.method === "POST" && periodAction?.[1] && periodAction[2] === "reopen") {
        const periodId = periodAction[1];
        return await observeFinance("accounting", "period.reopen", async () => await handleReopenPeriod(request, context, database, periodId));
      }
      if (request.method === "GET" && url.pathname === "/v1/accounting/reports/trial-balance") return await observeFinance("accounting", "report.trial_balance", async () => await handleTrialBalance(url, context, database));
      if (request.method === "GET" && url.pathname === "/v1/accounting/reports/general-ledger") return await observeFinance("accounting", "report.general_ledger", async () => await handleGeneralLedger(url, context, database));
      if (request.method === "GET" && url.pathname === "/v1/accounting/reports/open-item-aging") return await observeFinance("accounting", "report.open_item_aging", async () => await handleOpenItemAging(url, context, database));
      if (request.method === "POST" && url.pathname === "/v1/banking/statements/import") return await observeFinance("banking", "statement.import", async () => await handleImportBankStatement(request, context, database));
      if (request.method === "POST" && url.pathname === "/v1/banking/reconciliations") return await observeFinance("banking", "reconciliation.match", async () => await handleReconcileStatementLine(request, context, database));
      const reconciliationReversal = url.pathname.match(/^\/v1\/banking\/reconciliations\/([^/]+)\/reverse$/u);
      if (request.method === "POST" && reconciliationReversal?.[1]) {
        const reconciliationId = reconciliationReversal[1];
        return await observeFinance("banking", "reconciliation.reverse", async () => await handleReverseReconciliation(request, context, database, reconciliationId));
      }
      if (request.method === "POST" && url.pathname === "/v1/banking/reconciliation-runs") return await observeFinance("banking", "reconciliation.run", async () => await handleRecordReconciliationRun(request, context, database));
      if (request.method === "GET" && url.pathname === "/v1/banking/unreconciled") return await observeFinance("banking", "reconciliation.unreconciled", async () => await handleListUnreconciled(url, context, database));
      if (request.method === "GET" && url.pathname === "/v1/finance/readiness") return await observeFinance("finance", "readiness.read", async () => await handleFinanceReadiness(context, database));
      return Response.json({ error: { code: "NOT_FOUND", message: "Route not found", requestId } }, { status: 404 });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  },
};
