import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryUrl = new URL("../../modules/pos/src/sql-repository.ts", import.meta.url);

async function source() {
  return await readFile(repositoryUrl, "utf8");
}

test("POS repository resolves foundation imports from the module root", async () => {
  const text = await source();
  assert.match(text, /from "\.\.\/\.\.\/\.\.\/packages\/foundation\/src\/context\.js"/u);
  assert.match(text, /from "\.\.\/\.\.\/\.\.\/packages\/foundation\/src\/db\.js"/u);
  assert.doesNotMatch(text, /from "\.\.\/\.\.\/packages\/foundation/u);
});

test("offline authorization is evaluated at operation time rather than upload time", async () => {
  const text = await source();
  assert.match(text, /issued_at <= \$5::timestamptz/u);
  assert.match(text, /expires_at > \$5::timestamptz/u);
  assert.match(text, /revoked_at IS NULL OR revoked_at > \$5::timestamptz/u);
  assert.doesNotMatch(text, /expires_at > now\(\)/u);
});

test("offline replay compares the immutable envelope and reconciliation limits are bounded", async () => {
  const text = await source();
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
  ]) {
    assert.match(text, new RegExp(field, "u"));
  }
  assert.match(text, /sameOfflineEnvelope/u);
  assert.match(text, /Offline operation was replayed with different envelope content/u);
  assert.match(text, /limit < 1 \|\| limit > 500/u);
});
