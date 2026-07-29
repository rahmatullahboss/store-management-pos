import assert from "node:assert/strict";
import test from "node:test";
import { executeSqlStatements, splitSqlStatements } from "../../tooling/scripts/sql-statements.mjs";

test("SQL splitter preserves dollar-quoted procedural bodies", () => {
  const statements = splitSqlStatements(`
    BEGIN;
    CREATE FUNCTION demo() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE NOTICE 'inside; function';
      RETURN NEW;
    END $$;
    DO $policy$
    BEGIN
      EXECUTE 'CREATE POLICY tenant_isolation ON demo USING (true)';
    END $policy$;
    COMMIT;
  `);

  assert.equal(statements.length, 4);
  assert.match(statements[1], /inside; function/u);
  assert.match(statements[2], /CREATE POLICY/u);
});

test("SQL splitter ignores semicolons in quoted values and comments", () => {
  const statements = splitSqlStatements(`
    -- comment; remains attached
    SELECT 'value;with;semicolons';
    /* outer; /* nested; */ block; */
    SELECT "quoted;identifier";
  `);

  assert.equal(statements.length, 2);
  assert.match(statements[0], /value;with;semicolons/u);
  assert.match(statements[1], /quoted;identifier/u);
});

test("SQL splitter rejects unterminated bodies", () => {
  assert.throws(() => splitSqlStatements("DO $$ BEGIN;"), /unterminated SQL dollar-quote/i);
});

test("statement executor rolls back a failed open transaction", async () => {
  const calls = [];
  const client = {
    async query(statement) {
      calls.push(statement);
      if (/BROKEN/u.test(statement)) throw new Error("broken statement");
      return { rows: [] };
    },
  };

  await assert.rejects(
    () => executeSqlStatements(client, "BEGIN; SELECT 1; BROKEN; COMMIT;"),
    /broken statement/u,
  );
  assert.equal(calls.at(-1), "ROLLBACK");
});
