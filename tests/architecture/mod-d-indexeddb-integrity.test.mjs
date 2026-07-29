import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../../modules/offline/src/indexeddb-store.ts", import.meta.url);

test("browser offline store owns explicit operation log metadata and projection schemas", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /const OPERATION_STORE = "operation_log"/u);
  assert.match(source, /const META_STORE = "operation_log_meta"/u);
  assert.match(source, /const PROJECTION_STORE = "pos_local"/u);
  assert.match(source, /createIndex\("sequence", "sequence", \{ unique: true \}\)/u);
  assert.match(source, /createIndex\("state", "state", \{ unique: false \}\)/u);
  assert.match(source, /createIndex\("projection", "projection", \{ unique: false \}\)/u);
});

test("IndexedDB persistence uses strict durability and revision compare-and-swap", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /durability: "strict"/u);
  assert.match(source, /actualRevision !== expectedRevision/u);
  assert.match(source, /ConcurrentLocalStoreMutationError/u);
  assert.match(source, /metadata\.get\("revision"\)/u);
  assert.match(source, /nextRevision = expectedRevision \+ 1n/u);
  assert.doesNotMatch(source, /operations\.clear\(\)/u);
  assert.doesNotMatch(source, /deleteDatabase\(/u);
});

test("IndexedDB adapter stores exact sequences as strings and reconstructs bigint", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /sequence: record\.sequence\.toString\(\)/u);
  assert.match(source, /const sequence = BigInt\(stored\.sequence\)/u);
  assert.match(source, /if \(sequence <= 0n\)/u);
  assert.match(source, /authorizationExpiresAt === undefined/u);
});
