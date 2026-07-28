import test from "node:test";
import assert from "node:assert/strict";
import { executeIdempotently } from "../../build/packages/foundation/src/idempotency.js";
import { consumeAtLeastOnce } from "../../build/packages/foundation/src/events.js";
import { InMemoryConsumerInbox, InMemoryIdempotencyStore } from "../../build/packages/testing/src/fakes.js";

test("Idempotent execution stores and replays one result", async () => {
  const store = new InMemoryIdempotencyStore();
  let effects = 0;
  const input = { tenantId: "tenant-a", scope: "test", key: "stable-key", requestHash: "hash-a" };
  const first = await executeIdempotently(store, input, async () => ({ sequence: ++effects }));
  const second = await executeIdempotently(store, input, async () => ({ sequence: ++effects }));
  assert.deepEqual(first, { sequence: 1 });
  assert.deepEqual(second, first);
  assert.equal(effects, 1);
  await assert.rejects(() => executeIdempotently(store, { ...input, requestHash: "hash-b" }, async () => ({ sequence: 2 })), /different request/);
});

test("At-least-once consumer processes a duplicate once", async () => {
  const inbox = new InMemoryConsumerInbox();
  let effects = 0;
  const input = { consumer: "consumer-v1", eventId: "event-1", payloadHash: "hash" };
  assert.equal(await consumeAtLeastOnce(inbox, input, async () => { effects += 1; }), "processed");
  assert.equal(await consumeAtLeastOnce(inbox, input, async () => { effects += 1; }), "duplicate");
  assert.equal(effects, 1);
});
