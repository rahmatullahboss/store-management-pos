import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../database/modules/cash/migrations/CSH-0005-cash-scope-and-reversal-controls.sql",
  import.meta.url,
);

async function source() {
  return await readFile(migrationUrl, "utf8");
}

test("cash event and closure commands bind writes to request store and register scope", async () => {
  const sql = await source();
  assert.ok((sql.match(/v_context_store_id/gu) ?? []).length >= 4);
  assert.ok((sql.match(/v_context_register_id/gu) ?? []).length >= 4);
  assert.match(sql, /cash event is outside request store scope/u);
  assert.match(sql, /cash event is outside request register scope/u);
  assert.match(sql, /cash closure is outside request store scope/u);
  assert.match(sql, /cash closure is outside request register scope/u);
  assert.ok((sql.match(/FROM cash\.shifts AS shift[\s\S]*?FOR UPDATE/gu) ?? []).length >= 2);
});

test("cash append and close replay checks cover immutable evidence", async () => {
  const sql = await source();
  assert.match(sql, /v_existing\.reason IS DISTINCT FROM p_reason/u);
  assert.match(sql, /v_existing\.occurred_at <> p_occurred_at/u);
  assert.match(sql, /v_existing_count\.count_type <> p_count_type/u);
  assert.match(sql, /v_existing_count\.denomination_breakdown/u);
  assert.match(sql, /v_existing\.closed_at <> p_closed_at/u);
});

test("cash reversals require explicit approval tied to the original event", async () => {
  const sql = await source();
  assert.match(sql, /cash\.reversal\.approve/u);
  assert.match(sql, /cash_event_reversal/u);
  assert.match(sql, /v_approval_target_id := p_reversal_of_event_id::text/u);
  assert.match(sql, /approval\.action_code = v_approval_action/u);
  assert.match(sql, /approval\.target_type = v_approval_target_type/u);
  assert.match(sql, /approval\.target_id = v_approval_target_id/u);
  assert.match(sql, /\('cash\.reversal\.approve','cash'/u);
});
