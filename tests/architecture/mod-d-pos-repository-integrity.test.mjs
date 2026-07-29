import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryUrl = new URL("../../modules/pos/src/sql-repository.ts", import.meta.url);
const runtimeCommandsUrl = new URL("../../database/modules/pos/migrations/POS-0006-runtime-commands.sql", import.meta.url);

async function sources() {
  const [repository, runtimeCommands] = await Promise.all([
    readFile(repositoryUrl, "utf8"),
    readFile(runtimeCommandsUrl, "utf8"),
  ]);
  return { repository, runtimeCommands };
}

test("POS repository resolves foundation imports from the module root", async () => {
  const { repository } = await sources();
  assert.match(repository, /from "\.\.\/\.\.\/\.\.\/packages\/foundation\/src\/context\.js"/u);
  assert.match(repository, /from "\.\.\/\.\.\/\.\.\/packages\/foundation\/src\/db\.js"/u);
  assert.doesNotMatch(repository, /from "\.\.\/\.\.\/packages\/foundation/u);
});

test("POS writes use reviewed runtime commands rather than direct table DML", async () => {
  const { repository, runtimeCommands } = await sources();
  for (const command of [
    "enroll_device_v1",
    "open_session_v1",
    "create_cart_v1",
    "record_checkout_v1",
    "register_offline_operation_v1",
  ]) {
    assert.match(repository, new RegExp(`pos\\.${command}`, "u"));
    assert.match(runtimeCommands, new RegExp(`SECURITY DEFINER[\\s\\S]*?${command}|${command}[\\s\\S]*?SECURITY DEFINER`, "u"));
  }
  assert.doesNotMatch(repository, /INSERT INTO pos\./u);
  assert.doesNotMatch(repository, /UPDATE pos\./u);
  assert.match(runtimeCommands, /GRANT EXECUTE ON FUNCTION pos\.record_checkout_v1/u);
  assert.match(runtimeCommands, /GRANT EXECUTE ON FUNCTION pos\.register_offline_operation_v1/u);
});

test("offline authorization is evaluated against operation time inside the runtime command", async () => {
  const { repository, runtimeCommands } = await sources();
  assert.match(repository, /pos\.register_offline_operation_v1/u);
  assert.match(runtimeCommands, /p_recorded_at < v_authorization\.issued_at/u);
  assert.match(runtimeCommands, /p_recorded_at >= v_authorization\.expires_at/u);
  assert.match(runtimeCommands, /revoked_at IS NOT NULL AND p_recorded_at >= v_authorization\.revoked_at/u);
  assert.doesNotMatch(repository, /expires_at > now\(\)/u);
});

test("offline replay compares the immutable envelope and reconciliation limits are bounded", async () => {
  const { repository } = await sources();
  for (const field of [
    "register_id",
    "authorization_id",
    "device_sequence",
    "operation_type",
    "aggregate_id",
    "aggregate_version",
    "payload_hash",
    "recorded_at",
    "local_schema_version",
    "app_version",
  ]) assert.match(repository, new RegExp(field, "u"));
  assert.match(repository, /sameOfflineEnvelope/u);
  assert.match(repository, /Offline operation was replayed with different envelope content/u);
  assert.match(repository, /limit < 1 \|\| limit > 500/u);
});
