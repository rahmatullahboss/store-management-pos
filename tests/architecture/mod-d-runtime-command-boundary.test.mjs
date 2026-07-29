import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const commandMigrationUrl = new URL("../../database/modules/pos/migrations/POS-0006-runtime-commands.sql", import.meta.url);
const repositoryUrl = new URL("../../modules/pos/src/sql-repository.ts", import.meta.url);

async function sources() {
  const [sql, repository] = await Promise.all([
    readFile(commandMigrationUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
  ]);
  return { sql, repository };
}

test("POS runtime writes are exposed only through hardened command functions", async () => {
  const { sql } = await sources();
  const commands = [
    "pos.enroll_device_v1",
    "pos.open_session_v1",
    "pos.create_cart_v1",
    "pos.record_checkout_v1",
    "pos.register_offline_operation_v1",
  ];

  for (const command of commands) {
    assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION ${command.replaceAll(".", "\\.")}`, "u"));
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION ${command.replaceAll(".", "\\.")}\\(`, "u"));
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION ${command.replaceAll(".", "\\.")}\\(`, "u"));
  }
  assert.equal((sql.match(/SECURITY DEFINER/gu) ?? []).length, commands.length);
  assert.ok((sql.match(/SET search_path = pg_catalog, platform, pos/gu) ?? []).length >= commands.length);
  assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE|DELETE) ON/u);
});

test("POS command functions emit audit and outbox evidence in the same transaction", async () => {
  const { sql } = await sources();
  assert.ok((sql.match(/INSERT INTO platform\.audit_events/gu) ?? []).length >= 5);
  assert.ok((sql.match(/INSERT INTO platform\.outbox_events/gu) ?? []).length >= 4);
  assert.match(sql, /pos\.checkout\.recorded\.v1/u);
  assert.match(sql, /pos\.offline_operation\.received\.v1/u);
  assert.match(sql, /OFFLINE_AUTHORIZATION_INVALID/u);
  assert.match(sql, /v_required_permission = ANY\(v_authorization\.permission_codes\)/u);
});

test("tender snapshots reject PAN, CVV, track data and reusable secret fields", async () => {
  const { sql } = await sources();
  assert.match(sql, /contains_sensitive_payment_key/u);
  assert.match(sql, /checkout_tender_snapshot_no_sensitive_keys/u);
  for (const key of ["pan", "cardnumber", "cvv", "track1", "track2", "paymenttoken", "clientsecret"]) {
    assert.match(sql, new RegExp(`'${key}'`, "u"));
  }
});

test("POS repository cannot bypass the command boundary with direct table writes", async () => {
  const { repository } = await sources();
  assert.doesNotMatch(repository, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+pos\./u);
  assert.match(repository, /pos\.enroll_device_v1/u);
  assert.match(repository, /pos\.open_session_v1/u);
  assert.match(repository, /pos\.create_cart_v1/u);
  assert.match(repository, /pos\.record_checkout_v1/u);
  assert.match(repository, /pos\.register_offline_operation_v1/u);
});
