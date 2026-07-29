import type { RequestContext } from "../../../packages/foundation/src/context.js";
import type { NeonDatabase } from "../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../../packages/foundation/src/ids.js";
import { BankingService } from "../../../modules/banking/src/service.js";
import { NeonBankingStore } from "../../../modules/banking/src/store.js";
import {
  bodyRecord,
  dataResponse,
  idempotencyKey,
  isRecord,
  optionalInteger,
  optionalRecord,
  optionalString,
  optionalUuid,
  parseMoney,
  pathUuid,
  requestHash,
  requiredArray,
  requiredEnum,
  requiredInteger,
  requiredString,
  requiredUuid,
} from "./finance-handler-utils.js";

const sourceTypes = ["csv", "ofx", "camt", "api", "manual"] as const;
const candidateTypes = ["settlement", "payment", "refund", "supplier_payment", "cash_deposit", "journal", "opening_balance"] as const;
const matchMethods = ["automatic", "manual", "imported"] as const;

function service(database: NeonDatabase): BankingService {
  return new BankingService(new NeonBankingStore(database));
}

function statementLine(value: unknown, index: number) {
  if (!isRecord(value)) throw new PlatformError("VALIDATION_FAILED", `lines[${index}] must be an object`, 400);
  const runningBalance = value.runningBalance === undefined ? undefined : parseMoney(value.runningBalance, `lines[${index}].runningBalance`);
  const rawMetadata = optionalRecord(value, "rawMetadata");
  const valueDate = optionalString(value, "valueDate", 10);
  const externalId = optionalString(value, "externalId", 256);
  const counterpartyName = optionalString(value, "counterpartyName", 256);
  const counterpartyReference = optionalString(value, "counterpartyReference", 256);
  return {
    statementLineId: optionalUuid(value, "statementLineId") ?? uuidV7(),
    lineNumber: requiredInteger(value, "lineNumber"),
    bookedAt: requiredString(value, "bookedAt", 64),
    amount: parseMoney(value.amount, `lines[${index}].amount`),
    reference: requiredString(value, "reference", 1000),
    ...(valueDate ? { valueDate } : {}),
    ...(runningBalance ? { runningBalance } : {}),
    ...(externalId ? { externalId } : {}),
    ...(counterpartyName ? { counterpartyName } : {}),
    ...(counterpartyReference ? { counterpartyReference } : {}),
    ...(rawMetadata ? { rawMetadata } : {}),
  };
}

export async function handleImportBankStatement(request: Request, context: RequestContext, database: NeonDatabase): Promise<Response> {
  const body = await bodyRecord(request);
  const key = idempotencyKey(request);
  const command = {
    statementImportId: optionalUuid(body, "statementImportId") ?? uuidV7(),
    bankAccountId: requiredUuid(body, "bankAccountId"),
    sourceType: requiredEnum(body, "sourceType", sourceTypes),
    sourceName: requiredString(body, "sourceName", 256),
    sourceHash: requiredString(body, "sourceHash", 256),
    lines: requiredArray(body, "lines").map(statementLine),
    idempotencyKey: key,
  };
  const hash = await requestHash(command);
  const result = await service(database).importStatement(context, { ...command, requestHash: hash });
  return dataResponse(result, result.replayed ? 200 : 201);
}

export async function handleReconcileStatementLine(request: Request, context: RequestContext, database: NeonDatabase): Promise<Response> {
  const body = await bodyRecord(request);
  const key = idempotencyKey(request);
  const confidenceBasisPoints = optionalInteger(body, "confidenceBasisPoints");
  const ruleId = optionalUuid(body, "ruleId");
  const journalId = optionalUuid(body, "journalId");
  const reason = optionalString(body, "reason", 1000);
  const command = {
    reconciliationId: optionalUuid(body, "reconciliationId") ?? uuidV7(),
    statementLineId: requiredUuid(body, "statementLineId"),
    candidateType: requiredEnum(body, "candidateType", candidateTypes),
    candidateId: requiredString(body, "candidateId", 256),
    amount: parseMoney(body.amount),
    matchMethod: requiredEnum(body, "matchMethod", matchMethods),
    ...(confidenceBasisPoints === undefined ? {} : { confidenceBasisPoints }),
    ...(ruleId ? { ruleId } : {}),
    ...(journalId ? { journalId } : {}),
    ...(reason ? { reason } : {}),
    idempotencyKey: key,
  };
  const hash = await requestHash(command);
  const result = await service(database).reconcileStatementLine(context, { ...command, requestHash: hash });
  return dataResponse(result, result.replayed ? 200 : 201);
}

export async function handleReverseReconciliation(
  request: Request,
  context: RequestContext,
  database: NeonDatabase,
  originalReconciliationId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const key = idempotencyKey(request);
  const journalId = optionalUuid(body, "journalId");
  const command = {
    reconciliationId: optionalUuid(body, "reconciliationId") ?? uuidV7(),
    originalReconciliationId: pathUuid(originalReconciliationId, "reconciliationId"),
    reason: requiredString(body, "reason", 1000),
    ...(journalId ? { journalId } : {}),
    idempotencyKey: key,
  };
  const hash = await requestHash(command);
  const result = await service(database).reverseReconciliation(context, { ...command, requestHash: hash });
  return dataResponse(result, result.replayed ? 200 : 201);
}

export async function handleRecordReconciliationRun(request: Request, context: RequestContext, database: NeonDatabase): Promise<Response> {
  const body = await bodyRecord(request);
  const key = idempotencyKey(request);
  const command = {
    runId: optionalUuid(body, "runId") ?? uuidV7(),
    bankAccountId: requiredUuid(body, "bankAccountId"),
    periodStart: requiredString(body, "periodStart", 10),
    periodEnd: requiredString(body, "periodEnd", 10),
    idempotencyKey: key,
  };
  const hash = await requestHash(command);
  const result = await service(database).recordReconciliationRun(context, { ...command, requestHash: hash });
  return dataResponse(result, result.replayed ? 200 : 201);
}

export async function handleListUnreconciled(url: URL, context: RequestContext, database: NeonDatabase): Promise<Response> {
  const bankAccountId = url.searchParams.get("bankAccountId");
  return dataResponse(await service(database).listUnreconciled(
    context,
    bankAccountId ? pathUuid(bankAccountId, "bankAccountId") : undefined,
  ));
}
