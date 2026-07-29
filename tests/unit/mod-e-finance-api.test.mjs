import test from "node:test";
import assert from "node:assert/strict";
import { handlePostJournal, handleReverseJournal } from "../../build/apps/api/src/accounting-handler.js";
import { handleImportBankStatement, handleRecordReconciliationRun } from "../../build/apps/api/src/banking-handler.js";
import { jsonSafe } from "../../build/apps/api/src/finance-handler-utils.js";

const ids = {
  tenant: "018f0000-0000-7000-8000-000000000201",
  actor: "018f0000-0000-7000-8000-000000000202",
  legalEntity: "018f0000-0000-7000-8000-000000000203",
  chart: "018f0000-0000-7000-8000-000000000204",
  period: "018f0000-0000-7000-8000-000000000205",
  accountDebit: "018f0000-0000-7000-8000-000000000206",
  accountCredit: "018f0000-0000-7000-8000-000000000207",
  journal: "018f0000-0000-7000-8000-000000000208",
  postingGroup: "018f0000-0000-7000-8000-000000000209",
  originalJournal: "018f0000-0000-7000-8000-000000000210",
  originalPostingGroup: "018f0000-0000-7000-8000-000000000211",
  reversalJournal: "018f0000-0000-7000-8000-000000000212",
  reversalPostingGroup: "018f0000-0000-7000-8000-000000000213",
  approval: "018f0000-0000-7000-8000-000000000214",
  bankAccount: "018f0000-0000-7000-8000-000000000215",
  statementImport: "018f0000-0000-7000-8000-000000000216",
  statementLine: "018f0000-0000-7000-8000-000000000217",
  run: "018f0000-0000-7000-8000-000000000218",
};

const context = {
  requestId: "018f0000-0000-7000-8000-000000000219",
  traceId: "finance-api-test",
  tenantId: ids.tenant,
  actorId: ids.actor,
  legalEntityId: ids.legalEntity,
  locale: "en-GB",
  timeZone: "UTC",
  businessDate: "2026-07-29",
  region: "test",
  permissions: new Set([
    "accounting.journal.post",
    "accounting.journal.reverse",
    "banking.statement.import",
    "banking.reconcile.auto",
  ]),
};

function fakeDatabase(query) {
  return {
    async withClientTransaction(_context, work) {
      return await work({ query });
    },
  };
}

function journalBody(overrides = {}) {
  return {
    journalId: ids.journal,
    postingGroupId: ids.postingGroup,
    chartId: ids.chart,
    fiscalPeriodId: ids.period,
    journalType: "system",
    postingKind: "ordinary",
    source: { type: "invoice", id: "invoice-001", version: "1" },
    transactionCurrency: "GBP",
    baseCurrency: "GBP",
    exchangeRateNumerator: "1",
    exchangeRateDenominator: "1",
    lines: [
      {
        accountId: ids.accountDebit,
        accountCode: "1200",
        debit: { amountMinor: "10000", currency: "GBP", scale: 2 },
        credit: { amountMinor: "0", currency: "GBP", scale: 2 },
        baseDebit: { amountMinor: "10000", currency: "GBP", scale: 2 },
        baseCredit: { amountMinor: "0", currency: "GBP", scale: 2 },
      },
      {
        accountId: ids.accountCredit,
        accountCode: "4000",
        debit: { amountMinor: "0", currency: "GBP", scale: 2 },
        credit: { amountMinor: "10000", currency: "GBP", scale: 2 },
        baseDebit: { amountMinor: "0", currency: "GBP", scale: 2 },
        baseCredit: { amountMinor: "10000", currency: "GBP", scale: 2 },
      },
    ],
    ...overrides,
  };
}

test("accounting API posts exact money and emits JSON-safe integer strings", async () => {
  let parameters;
  const database = fakeDatabase(async (sql, values) => {
    assert.match(sql, /accounting\.post_journal_v1/u);
    parameters = values;
    return {
      rows: [{
        journal_id: ids.journal,
        posting_group_id: ids.postingGroup,
        status: "posted",
        transaction_currency: "GBP",
        transaction_scale: 2,
        total_debit_minor: "10000",
        total_credit_minor: "10000",
        business_date: "2026-07-29",
        posted_at: "2026-07-29T00:00:00.000Z",
        replayed: false,
      }],
    };
  });
  const request = new Request("https://api.test/v1/accounting/journals", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "journal-api-001" },
    body: JSON.stringify(journalBody()),
  });
  const response = await handlePostJournal(request, context, database);
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.data.totalDebit.amountMinor, "10000");
  assert.equal(payload.data.totalCredit.amountMinor, "10000");
  assert.equal(parameters[0], ids.journal);
  assert.equal(parameters[1], ids.postingGroup);
  assert.match(parameters[16], /"debitMinor":"10000"/u);
});

test("journal reversal uses a new posting-group identity", async () => {
  const calls = [];
  const database = fakeDatabase(async (sql, values) => {
    calls.push({ sql, values });
    if (/FROM accounting\.journal_entries/u.test(sql)) {
      return { rows: [{
        journal_id: ids.originalJournal,
        posting_group_id: ids.originalPostingGroup,
        chart_id: ids.chart,
        fiscal_period_id: ids.period,
        journal_type: "system",
        posting_kind: "ordinary",
        source_type: "payment",
        source_id: "payment-001",
        source_version: "1",
        transaction_currency: "GBP",
        transaction_scale: 2,
        base_currency: "GBP",
        base_scale: 2,
        exchange_rate_numerator: "1",
        exchange_rate_denominator: "1",
        reversal_of_journal_id: null,
        correction_reason: null,
        business_date: "2026-07-28",
      }] };
    }
    if (/FROM accounting\.journal_lines/u.test(sql)) {
      return { rows: [
        {
          account_id: ids.accountDebit,
          account_code: "1100",
          transaction_debit_minor: "4000",
          transaction_credit_minor: "0",
          base_debit_minor: "4000",
          base_credit_minor: "0",
          dimensions: {},
          party_type: null,
          party_id: null,
          source_line_id: null,
          memo: null,
        },
        {
          account_id: ids.accountCredit,
          account_code: "1200",
          transaction_debit_minor: "0",
          transaction_credit_minor: "4000",
          base_debit_minor: "0",
          base_credit_minor: "4000",
          dimensions: {},
          party_type: "customer",
          party_id: "customer-001",
          source_line_id: null,
          memo: null,
        },
      ] };
    }
    assert.match(sql, /accounting\.post_journal_v1/u);
    return { rows: [{
      journal_id: ids.reversalJournal,
      posting_group_id: ids.reversalPostingGroup,
      status: "posted",
      transaction_currency: "GBP",
      transaction_scale: 2,
      total_debit_minor: "4000",
      total_credit_minor: "4000",
      business_date: "2026-07-29",
      posted_at: "2026-07-29T00:00:00.000Z",
      replayed: false,
    }] };
  });
  const request = new Request(`https://api.test/v1/accounting/journals/${ids.originalJournal}/reverse`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "journal-reverse-api-001" },
    body: JSON.stringify({
      reversalJournalId: ids.reversalJournal,
      reversalPostingGroupId: ids.reversalPostingGroup,
      approvalRequestId: ids.approval,
      reason: "Incorrect receipt",
    }),
  });
  const response = await handleReverseJournal(request, context, database, ids.originalJournal);
  assert.equal(response.status, 201);
  const postCall = calls.find((call) => /post_journal_v1/u.test(call.sql));
  assert.equal(postCall.values[1], ids.reversalPostingGroup);
  assert.notEqual(postCall.values[1], ids.originalPostingGroup);
});

test("banking API imports statement lines and returns immutable fingerprints", async () => {
  let importPayload;
  const database = fakeDatabase(async (sql, values) => {
    if (/banking\.import_statement_v1/u.test(sql)) {
      importPayload = JSON.parse(values[5]);
      return { rows: [{
        statement_import_id: ids.statementImport,
        bank_account_id: ids.bankAccount,
        status: "completed",
        line_count: 1,
        replayed: false,
      }] };
    }
    assert.match(sql, /FROM banking\.statement_lines/u);
    return { rows: [{
      statement_line_id: ids.statementLine,
      bank_account_id: ids.bankAccount,
      statement_import_id: ids.statementImport,
      line_number: 1,
      booked_at: "2026-07-29T00:00:00.000Z",
      value_date: "2026-07-29",
      currency: "GBP",
      scale: 2,
      amount_minor: "10000",
      running_balance_minor: "25000",
      reference: "provider-settlement-001",
      external_id: "bank-line-001",
      counterparty_name: "Provider",
      counterparty_reference: null,
      raw_metadata: {},
      fingerprint: importPayload[0].fingerprint,
      reconciliation_status: "unmatched",
    }] };
  });
  const request = new Request("https://api.test/v1/banking/statements/import", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "bank-import-api-001" },
    body: JSON.stringify({
      statementImportId: ids.statementImport,
      bankAccountId: ids.bankAccount,
      sourceType: "csv",
      sourceName: "statement.csv",
      sourceHash: "statement-source-hash",
      lines: [{
        statementLineId: ids.statementLine,
        lineNumber: 1,
        bookedAt: "2026-07-29T00:00:00.000Z",
        valueDate: "2026-07-29",
        amount: { amountMinor: "10000", currency: "GBP", scale: 2 },
        runningBalance: { amountMinor: "25000", currency: "GBP", scale: 2 },
        reference: "provider-settlement-001",
        externalId: "bank-line-001",
      }],
    }),
  });
  const response = await handleImportBankStatement(request, context, database);
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.match(payload.data.lines[0].fingerprint, /^[0-9a-f]{16}$/u);
  assert.equal(importPayload[0].amountMinor, "10000");
});

test("reconciliation-run API serializes bigint controls", async () => {
  const database = fakeDatabase(async (sql) => {
    assert.match(sql, /banking\.record_reconciliation_run_v1/u);
    return { rows: [{
      run_id: ids.run,
      status: "completed",
      source_line_count: "2",
      matched_line_count: "2",
      exception_count: "0",
      statement_total_minor: "7500",
      matched_total_minor: "7500",
      difference_minor: "0",
      currency: "GBP",
      scale: 2,
      replayed: false,
    }] };
  });
  const request = new Request("https://api.test/v1/banking/reconciliation-runs", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "bank-run-api-001" },
    body: JSON.stringify({
      runId: ids.run,
      bankAccountId: ids.bankAccount,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    }),
  });
  const response = await handleRecordReconciliationRun(request, context, database);
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.data.sourceLineCount, "2");
  assert.equal(payload.data.difference.amountMinor, "0");
});

test("finance JSON serializer converts nested bigint values", () => {
  assert.deepEqual(jsonSafe({ total: 5n, nested: [{ value: -2n }] }), { total: "5", nested: [{ value: "-2" }] });
});

test("finance APIs require an idempotency key", async () => {
  const request = new Request("https://api.test/v1/accounting/journals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(journalBody()),
  });
  await assert.rejects(() => handlePostJournal(request, context, fakeDatabase(async () => ({ rows: [] }))), /idempotency-key header is required/i);
});
