import test from "node:test";
import assert from "node:assert/strict";
import { observeFinanceOperation } from "../../build/apps/api/src/finance-observability.js";
import { handleFinanceReadiness, readFinanceReadiness } from "../../build/apps/api/src/finance-readiness-handler.js";
import { renderFinanceReadinessPage } from "../../build/apps/admin-web/src/modules/reporting/finance-readiness-page.js";

const context = {
  requestId: "018f0000-0000-7000-8000-000000000401",
  traceId: "finance-readiness-test",
  tenantId: "018f0000-0000-7000-8000-000000000402",
  actorId: "018f0000-0000-7000-8000-000000000403",
  legalEntityId: "018f0000-0000-7000-8000-000000000404",
  locale: "en-GB",
  timeZone: "UTC",
  businessDate: "2026-07-29",
  region: "test",
  permissions: new Set(["platform.audit.read"]),
};

function database(row) {
  return {
    async withClientTransaction(_context, work) {
      return await work({ async query(sql) {
        assert.match(sql, /PAY-0002/u);
        assert.match(sql, /unbalanced_journal_count/u);
        assert.match(sql, /finance_dead_letter_count/u);
        return { rows: [row] };
      } });
    },
  };
}

function readinessRow(overrides = {}) {
  return {
    migration_count: "3",
    unknown_payment_count: "0",
    stuck_idempotency_count: "0",
    unbalanced_journal_count: "0",
    stale_unreconciled_count: "0",
    open_reconciliation_exception_count: "0",
    stale_outbox_count: "0",
    finance_dead_letter_count: "0",
    generated_at: "2026-07-29T02:00:00Z",
    ...overrides,
  };
}

test("finance readiness reports ready only when all controls pass", async () => {
  const report = await readFinanceReadiness(context, database(readinessRow()));
  assert.equal(report.overall, "ready");
  assert.equal(report.checks.length, 8);
  assert.ok(report.checks.every((item) => item.status === "pass"));
  const response = await handleFinanceReadiness(context, database(readinessRow()));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.overall, "ready");
  assert.equal(payload.data.checks[0].observed, "3");
});

test("finance readiness distinguishes degraded operational backlog from blocked integrity failures", async () => {
  const degraded = await readFinanceReadiness(context, database(readinessRow({
    unknown_payment_count: "2",
    stale_unreconciled_count: "4",
  })));
  assert.equal(degraded.overall, "degraded");
  assert.equal(degraded.checks.find((item) => item.code === "unknown_payments").status, "warning");

  const blocked = await readFinanceReadiness(context, database(readinessRow({
    migration_count: "2",
    unbalanced_journal_count: "1",
    stale_outbox_count: "3",
  })));
  assert.equal(blocked.overall, "blocked");
  assert.equal(blocked.checks.filter((item) => item.status === "fail").length, 3);
});

test("finance readiness requires audit permission", async () => {
  await assert.rejects(() => readFinanceReadiness({ ...context, permissions: new Set() }, database(readinessRow())), /platform\.audit\.read/u);
});

test("readiness page shows release control without exposing unsafe markup", () => {
  const html = renderFinanceReadinessPage({
    overall: "blocked",
    generatedAt: "2026-07-29T02:00:00Z",
    checks: [{
      code: "stale_outbox",
      label: "Outbox <script>",
      status: "fail",
      observed: "3",
      expected: "0",
      detail: "Replay & inspect",
    }],
  });
  assert.match(html, /Finance readiness/u);
  assert.match(html, /blocked/u);
  assert.match(html, /Outbox &lt;script&gt;/u);
  assert.match(html, /Replay &amp; inspect/u);
  assert.ok(!html.includes("<script>"));
});

test("finance operation observer emits low-cardinality duration and outcome metrics", async () => {
  const increments = [];
  const observations = [];
  const metrics = {
    increment(name, value, attributes) { increments.push({ name, value, attributes }); },
    observe(name, value, attributes) { observations.push({ name, value, attributes }); },
  };
  const response = await observeFinanceOperation(context, { metrics }, "accounting", "journal.post", async () => Response.json({ data: { journalId: "journal-1" } }, { status: 201 }));
  assert.equal(response.status, 201);
  assert.deepEqual(increments[0], {
    name: "mod_e.finance.operation",
    value: 1,
    attributes: { module: "accounting", operation: "journal.post", outcome: "success" },
  });
  assert.equal(observations[0].name, "mod_e.finance.operation.duration_ms");
  assert.deepEqual(Object.keys(observations[0].attributes).sort(), ["module", "operation", "outcome"]);
});
