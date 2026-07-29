import type { RequestContext } from "../../../packages/foundation/src/context.js";
import type { NeonDatabase } from "../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../../packages/foundation/src/ids.js";
import { AccountingService } from "../../../modules/accounting/src/service.js";
import { NeonAccountingStore } from "../../../modules/accounting/src/store.js";
import {
  bodyRecord,
  dataResponse,
  idempotencyKey,
  isRecord,
  optionalRecord,
  optionalString,
  optionalUuid,
  parseMoney,
  pathUuid,
  requestHash,
  requiredArray,
  requiredEnum,
  requiredIntegerString,
  requiredRecord,
  requiredString,
  requiredUuid,
} from "./finance-handler-utils.js";

const journalTypes = ["system", "manual", "adjustment", "reversal", "opening", "closing", "revaluation"] as const;
const postingKinds = ["ordinary", "adjustment", "reversal"] as const;
const partyTypes = ["customer", "supplier"] as const;
const directions = ["receivable", "payable"] as const;

function service(database: NeonDatabase): AccountingService {
  return new AccountingService(new NeonAccountingStore(database));
}

function dimensions(value: Record<string, unknown> | undefined): Readonly<Record<string, string>> | undefined {
  if (!value) return undefined;
  const normalized: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string" || key.trim().length === 0) {
      throw new PlatformError("VALIDATION_FAILED", "dimensions must contain string values", 400);
    }
    normalized[key] = item;
  }
  return normalized;
}

function journalLine(value: unknown, index: number) {
  if (!isRecord(value)) throw new PlatformError("VALIDATION_FAILED", `lines[${index}] must be an object`, 400);
  const partyType = value.partyType === undefined ? undefined : requiredEnum(value, "partyType", partyTypes);
  const partyId = optionalString(value, "partyId", 256);
  const lineDimensions = dimensions(optionalRecord(value, "dimensions"));
  const sourceLineId = optionalString(value, "sourceLineId", 256);
  const memo = optionalString(value, "memo", 1000);
  if ((partyType === undefined) !== (partyId === undefined)) {
    throw new PlatformError("VALIDATION_FAILED", `lines[${index}] partyType and partyId must be supplied together`, 400);
  }
  return {
    accountId: requiredUuid(value, "accountId"),
    accountCode: requiredString(value, "accountCode", 80),
    debit: parseMoney(value.debit, `lines[${index}].debit`),
    credit: parseMoney(value.credit, `lines[${index}].credit`),
    baseDebit: parseMoney(value.baseDebit, `lines[${index}].baseDebit`),
    baseCredit: parseMoney(value.baseCredit, `lines[${index}].baseCredit`),
    ...(lineDimensions ? { dimensions: lineDimensions } : {}),
    ...(partyType ? { partyType } : {}),
    ...(partyId ? { partyId } : {}),
    ...(sourceLineId ? { sourceLineId } : {}),
    ...(memo ? { memo } : {}),
  };
}

export async function handlePostJournal(request: Request, context: RequestContext, database: NeonDatabase): Promise<Response> {
  const body = await bodyRecord(request);
  const source = requiredRecord(body, "source");
  const key = idempotencyKey(request);
  const postingRuleVersionId = optionalUuid(body, "postingRuleVersionId");
  const approvalRequestId = optionalUuid(body, "approvalRequestId");
  const reason = optionalString(body, "reason", 1000);
  const reversalOfJournalId = optionalUuid(body, "reversalOfJournalId");
  const command = {
    journalId: optionalUuid(body, "journalId") ?? uuidV7(),
    postingGroupId: optionalUuid(body, "postingGroupId") ?? uuidV7(),
    chartId: requiredUuid(body, "chartId"),
    fiscalPeriodId: requiredUuid(body, "fiscalPeriodId"),
    ...(postingRuleVersionId ? { postingRuleVersionId } : {}),
    journalType: requiredEnum(body, "journalType", journalTypes),
    postingKind: requiredEnum(body, "postingKind", postingKinds),
    source: {
      type: requiredString(source, "type", 80),
      id: requiredString(source, "id", 256),
      version: requiredString(source, "version", 80),
    },
    transactionCurrency: requiredString(body, "transactionCurrency", 3),
    baseCurrency: requiredString(body, "baseCurrency", 3),
    exchangeRateNumerator: requiredIntegerString(body, "exchangeRateNumerator"),
    exchangeRateDenominator: requiredIntegerString(body, "exchangeRateDenominator"),
    lines: requiredArray(body, "lines").map(journalLine),
    ...(approvalRequestId ? { approvalRequestId } : {}),
    ...(reason ? { reason } : {}),
    ...(reversalOfJournalId ? { reversalOfJournalId } : {}),
    idempotencyKey: key,
  };
  const hash = await requestHash(command);
  const result = await service(database).postJournal(context, { ...command, requestHash: hash });
  return dataResponse(result, result.replayed ? 200 : 201);
}

export async function handleReverseJournal(
  request: Request,
  context: RequestContext,
  database: NeonDatabase,
  originalJournalId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const key = idempotencyKey(request);
  const command = {
    originalJournalId: pathUuid(originalJournalId, "journalId"),
    reversalJournalId: optionalUuid(body, "reversalJournalId") ?? uuidV7(),
    reversalPostingGroupId: optionalUuid(body, "reversalPostingGroupId") ?? uuidV7(),
    businessDate: context.businessDate,
    reason: requiredString(body, "reason", 1000),
    approvalRequestId: requiredUuid(body, "approvalRequestId"),
    idempotencyKey: key,
  };
  const hash = await requestHash(command);
  const result = await service(database).reverseJournal(context, { ...command, requestHash: hash });
  return dataResponse(result, result.replayed ? 200 : 201);
}

export async function handleCreateOpenItem(request: Request, context: RequestContext, database: NeonDatabase): Promise<Response> {
  const body = await bodyRecord(request);
  const key = idempotencyKey(request);
  const dueDate = optionalString(body, "dueDate", 10);
  const command = {
    openItemId: optionalUuid(body, "openItemId") ?? uuidV7(),
    controlAccountId: requiredUuid(body, "controlAccountId"),
    partyType: requiredEnum(body, "partyType", partyTypes),
    partyId: requiredString(body, "partyId", 256),
    direction: requiredEnum(body, "direction", directions),
    documentType: requiredString(body, "documentType", 80),
    documentId: requiredString(body, "documentId", 256),
    documentVersion: requiredString(body, "documentVersion", 80),
    amount: parseMoney(body.amount),
    ...(dueDate ? { dueDate } : {}),
    journalId: requiredUuid(body, "journalId"),
    idempotencyKey: key,
  };
  const hash = await requestHash(command);
  const result = await service(database).createOpenItem(context, { ...command, requestHash: hash });
  return dataResponse(result, result.replayed ? 200 : 201);
}

export async function handleAllocateOpenItem(
  request: Request,
  context: RequestContext,
  database: NeonDatabase,
  openItemId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const key = idempotencyKey(request);
  const reason = optionalString(body, "reason", 1000);
  const reversalOfAllocationId = optionalUuid(body, "reversalOfAllocationId");
  const command = {
    allocationId: optionalUuid(body, "allocationId") ?? uuidV7(),
    openItemId: pathUuid(openItemId, "openItemId"),
    sourceType: requiredString(body, "sourceType", 80),
    sourceId: requiredString(body, "sourceId", 256),
    amount: parseMoney(body.amount),
    journalId: requiredUuid(body, "journalId"),
    ...(reason ? { reason } : {}),
    ...(reversalOfAllocationId ? { reversalOfAllocationId } : {}),
    idempotencyKey: key,
  };
  const hash = await requestHash(command);
  const result = await service(database).allocateOpenItem(context, { ...command, requestHash: hash });
  return dataResponse(result, 200);
}

export async function handleClosePeriod(
  request: Request,
  context: RequestContext,
  database: NeonDatabase,
  periodId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const key = idempotencyKey(request);
  const command = {
    periodId: pathUuid(periodId, "periodId"),
    approvalRequestId: requiredUuid(body, "approvalRequestId"),
    evidence: requiredRecord(body, "evidence"),
    idempotencyKey: key,
  };
  const hash = await requestHash(command);
  const result = await service(database).closePeriod(context, { ...command, requestHash: hash });
  return dataResponse(result);
}

export async function handleReopenPeriod(
  request: Request,
  context: RequestContext,
  database: NeonDatabase,
  periodId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const key = idempotencyKey(request);
  const command = {
    periodId: pathUuid(periodId, "periodId"),
    approvalRequestId: requiredUuid(body, "approvalRequestId"),
    reason: requiredString(body, "reason", 1000),
    idempotencyKey: key,
  };
  const hash = await requestHash(command);
  const result = await service(database).reopenPeriod(context, { ...command, requestHash: hash });
  return dataResponse(result);
}

export async function handleTrialBalance(url: URL, context: RequestContext, database: NeonDatabase): Promise<Response> {
  const chartId = url.searchParams.get("chartId");
  const periodId = url.searchParams.get("periodId");
  if (!chartId || !periodId) throw new PlatformError("VALIDATION_FAILED", "chartId and periodId are required", 400);
  return dataResponse(await service(database).trialBalance(context, {
    chartId: pathUuid(chartId, "chartId"),
    periodId: pathUuid(periodId, "periodId"),
  }));
}

export async function handleGeneralLedger(url: URL, context: RequestContext, database: NeonDatabase): Promise<Response> {
  const accountId = url.searchParams.get("accountId");
  const fromDate = url.searchParams.get("fromDate");
  const toDate = url.searchParams.get("toDate");
  if (!accountId || !fromDate || !toDate) throw new PlatformError("VALIDATION_FAILED", "accountId, fromDate and toDate are required", 400);
  return dataResponse(await service(database).generalLedger(context, {
    accountId: pathUuid(accountId, "accountId"),
    fromDate,
    toDate,
  }));
}

export async function handleOpenItemAging(url: URL, context: RequestContext, database: NeonDatabase): Promise<Response> {
  const partyType = url.searchParams.get("partyType");
  const asOfDate = url.searchParams.get("asOfDate");
  if (partyType !== "customer" && partyType !== "supplier") throw new PlatformError("VALIDATION_FAILED", "partyType is invalid", 400);
  if (!asOfDate) throw new PlatformError("VALIDATION_FAILED", "asOfDate is required", 400);
  return dataResponse(await service(database).openItemAging(context, { partyType, asOfDate }));
}
