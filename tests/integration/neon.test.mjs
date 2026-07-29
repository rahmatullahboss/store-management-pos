import test from "node:test";
import assert from "node:assert/strict";

const enabled = process.env.FND_NEON_INTEGRATION === "1";
const websocketAttemptLimit = 2;

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isTransientConnectionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /connection terminated|endpoint cannot be found|econnreset|socket hang up|websocket.*closed|fetch failed|network/i.test(message);
}

async function runWebSocketChecks(Client, connectionString) {
  let lastError;
  for (let attempt = 1; attempt <= websocketAttemptLimit; attempt += 1) {
    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 15_000,
      query_timeout: 15_000,
      statement_timeout: 15_000,
      application_name: "store-management-foundation-ci",
    });
    let asynchronousError = null;
    client.on("error", (error) => {
      asynchronousError = error;
      console.warn(`[neon-integration] asynchronous client error on attempt ${attempt}: ${error.message}`);
    });

    try {
      console.log(`[neon-integration] websocket connect attempt ${attempt}/${websocketAttemptLimit}`);
      await client.connect();
      await client.query("BEGIN");
      await client.query("SET ROLE store_app_runtime");

      console.log("[neon-integration] verify tenant alpha isolation");
      await client.query("SELECT platform.set_request_context($1,$2,NULL,NULL,NULL,NULL,$3,$4,$5)", [
        "018f0000-0000-7000-8000-000000000001",
        "018f0000-0000-7000-8000-000000000101",
        "2026-07-28",
        "ci-reference-001",
        "ci-trace-001",
      ]);
      const alphaStores = await client.query("SELECT code FROM platform.stores ORDER BY code");
      assert.deepEqual(alphaStores.rows.map((row) => row.code), ["LON-01"]);
      const alphaUsers = await client.query("SELECT display_name FROM platform.users ORDER BY display_name");
      assert.deepEqual(alphaUsers.rows.map((row) => row.display_name), ["Alpha Owner"]);

      console.log("[neon-integration] verify idempotency, audit and outbox effects");
      const key = `ci-${crypto.randomUUID()}`;
      const first = await client.query("SELECT id::text,name,version::text,replayed FROM platform.create_reference_record($1,$2,$3,$4)", [key, "ci-hash-v1", "CI reference", "ci-reference-001"]);
      const replay = await client.query("SELECT id::text,name,version::text,replayed FROM platform.create_reference_record($1,$2,$3,$4)", [key, "ci-hash-v1", "CI reference", "ci-reference-001"]);
      assert.equal(first.rows[0].replayed, false);
      assert.equal(replay.rows[0].replayed, true);
      assert.equal(first.rows[0].id, replay.rows[0].id);

      const effects = await client.query("SELECT (SELECT count(*)::int FROM platform.reference_records WHERE id=$1) AS records,(SELECT count(*)::int FROM platform.audit_events WHERE target_id=$1::text) AS audits,(SELECT count(*)::int FROM platform.outbox_events WHERE aggregate_id=$1::text) AS outbox", [first.rows[0].id]);
      assert.deepEqual(effects.rows[0], { records: 1, audits: 1, outbox: 1 });

      console.log("[neon-integration] verify inbox and identity revocation invariants");
      const eventId = crypto.randomUUID();
      const claimed = await client.query("SELECT platform.claim_inbox_event($1,$2,$3) AS claimed", ["ci-foundation-consumer-v1", eventId, "ci-event-hash"]);
      const duplicate = await client.query("SELECT platform.claim_inbox_event($1,$2,$3) AS claimed", ["ci-foundation-consumer-v1", eventId, "ci-event-hash"]);
      assert.equal(claimed.rows[0].claimed, true);
      assert.equal(duplicate.rows[0].claimed, false);

      const activeSession = await client.query("SELECT platform.is_identity_revoked($1,$2,$3,NULL) AS revoked", [
        "018f0000-0000-7000-8000-000000000001",
        "018f0000-0000-7000-8000-000000000101",
        "ci-active-session",
      ]);
      assert.equal(activeSession.rows[0].revoked, false);

      const directInsertPrivilege = await client.query("SELECT has_table_privilege('store_app_runtime','platform.session_revocations','INSERT') AS allowed");
      assert.equal(directInsertPrivilege.rows[0].allowed, false);
      await client.query("SAVEPOINT direct_session_revocation_insert");
      await assert.rejects(
        client.query(
          "INSERT INTO platform.session_revocations(id,tenant_id,session_id,user_id,revoked_by,reason,request_id,trace_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
          [crypto.randomUUID(), "018f0000-0000-7000-8000-000000000001", `ci-direct-${crypto.randomUUID()}`, "018f0000-0000-7000-8000-000000000101", "018f0000-0000-7000-8000-000000000101", "must fail", "ci-direct", "ci-direct"],
        ),
        /permission denied/i,
      );
      await client.query("ROLLBACK TO SAVEPOINT direct_session_revocation_insert");

      const sessionId = `ci-session-${crypto.randomUUID()}`;
      const firstRevocation = await client.query("SELECT platform.revoke_identity_session($1,$2,$3) AS revoked", [sessionId, "018f0000-0000-7000-8000-000000000101", "CI revocation verification"]);
      const duplicateRevocation = await client.query("SELECT platform.revoke_identity_session($1,$2,$3) AS revoked", [sessionId, "018f0000-0000-7000-8000-000000000101", "CI revocation verification"]);
      const revokedSession = await client.query("SELECT platform.is_identity_revoked($1,$2,$3,NULL) AS revoked", [
        "018f0000-0000-7000-8000-000000000001",
        "018f0000-0000-7000-8000-000000000101",
        sessionId,
      ]);
      assert.equal(firstRevocation.rows[0].revoked, true);
      assert.equal(duplicateRevocation.rows[0].revoked, false);
      assert.equal(revokedSession.rows[0].revoked, true);

      console.log("[neon-integration] verify tenant beta isolation");
      await client.query("SELECT platform.set_request_context($1,$2,NULL,NULL,NULL,NULL,$3,$4,$5)", [
        "018f0000-0000-7000-8000-000000000002",
        "018f0000-0000-7000-8000-000000000102",
        "2026-07-28",
        "ci-reference-002",
        "ci-trace-002",
      ]);
      const betaStores = await client.query("SELECT code FROM platform.stores ORDER BY code");
      assert.deepEqual(betaStores.rows.map((row) => row.code), ["DHK-01"]);
      const betaUsers = await client.query("SELECT display_name FROM platform.users ORDER BY display_name");
      assert.deepEqual(betaUsers.rows.map((row) => row.display_name), ["Beta Owner"]);

      if (asynchronousError) throw asynchronousError;
      await client.query("ROLLBACK");
      console.log(`[neon-integration] websocket attempt ${attempt} passed`);
      return;
    } catch (error) {
      lastError = error;
      await client.query("ROLLBACK").catch(() => undefined);
      if (!isTransientConnectionError(error) || attempt === websocketAttemptLimit) throw error;
      console.warn(`[neon-integration] transient websocket failure on attempt ${attempt}; retrying`);
      await sleep(1_000 * attempt);
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Neon websocket integration failed");
}

test("Foundation direct Neon HTTP and WebSocket integration", { skip: !enabled, timeout: 90_000 }, async () => {
  const { neon, Client } = await import("@neondatabase/serverless");
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL is required");

  console.log("[neon-integration] verify HTTP migrations and policies");
  const sql = neon(connectionString);
  const migrations = await sql`SELECT migration_id FROM platform.schema_migrations ORDER BY migration_id`;
  assert.deepEqual(migrations.map((row) => row.migration_id), ["FND-0001", "FND-0002", "FND-0003", "FND-0004", "FND-0005"]);
  const policies = await sql`SELECT count(*)::int AS count FROM pg_policies WHERE schemaname = 'platform'`;
  assert.ok(policies[0].count >= 23);

  await runWebSocketChecks(Client, connectionString);
});
