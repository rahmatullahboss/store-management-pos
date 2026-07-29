import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryUrl = new URL("../../modules/cash/src/sql-repository.ts", import.meta.url);
const runtimeCommandsUrl = new URL(
  "../../database/modules/cash/migrations/CSH-0003-runtime-commands.sql",
  import.meta.url,
);

async function sources() {
  const [repository, runtimeCommands] = await Promise.all([
    readFile(repositoryUrl, "utf8"),
    readFile(runtimeCommandsUrl, "utf8"),
  ]);
  return { repository, runtimeCommands };
}

test("cash writes use reviewed runtime commands instead of direct table DML", async () => {
  const { repository, runtimeCommands } = await sources();
  for (const command of ["open_shift_v1", "append_event_v1", "close_shift_v1"]) {
    assert.match(repository, new RegExp(`cash\\.${command}`, "u"));
    assert.match(runtimeCommands, new RegExp(`CREATE OR REPLACE FUNCTION cash\\.${command}`, "u"));
  }
  assert.doesNotMatch(repository, /INSERT INTO cash\./u);
  assert.doesNotMatch(repository, /UPDATE cash\./u);
  assert.doesNotMatch(repository, /DELETE FROM cash\./u);
  assert.match(runtimeCommands, /SECURITY DEFINER/u);
  assert.match(runtimeCommands, /GRANT EXECUTE ON FUNCTION cash\.open_shift_v1/u);
  assert.match(runtimeCommands, /GRANT EXECUTE ON FUNCTION cash\.append_event_v1/u);
  assert.match(runtimeCommands, /GRANT EXECUTE ON FUNCTION cash\.close_shift_v1/u);
});

test("cash runtime commands bind exact replay, approval and audit evidence", async () => {
  const { runtimeCommands } = await sources();
  assert.match(runtimeCommands, /cash shift was replayed with a different opening float/u);
  assert.match(runtimeCommands, /cash event was replayed with different content/u);
  assert.match(runtimeCommands, /cash closure was replayed with different content/u);
  assert.match(runtimeCommands, /action_code = 'cash\.adjustment\.approve'/u);
  assert.match(runtimeCommands, /action_code = 'cash\.variance\.approve'/u);
  assert.match(runtimeCommands, /target_type = 'cash_adjustment'/u);
  assert.match(runtimeCommands, /target_type = 'cash_shift_variance'/u);
  assert.match(runtimeCommands, /platform\.audit_events/u);
  assert.match(runtimeCommands, /platform\.outbox_events/u);
  assert.match(runtimeCommands, /VALUES \('CSH-0004'/u);
});

test("cash read surface is tenant-scoped and bounded", async () => {
  const { repository } = await sources();
  assert.match(repository, /WHERE tenant_id=\$1::uuid AND shift_id=\$2::uuid/u);
  assert.match(repository, /limit < 1 \|\| limit > 500/u);
  assert.match(repository, /ORDER BY sequence,id/u);
});
