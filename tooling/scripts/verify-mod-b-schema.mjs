import { Client } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const client = new Client({ connectionString });
await client.connect();
try {
  const migrations = await client.query(
    `SELECT migration_id, module, checksum
       FROM platform.schema_migrations
      WHERE migration_id IN ('INV-0001','INV-0002','PUR-0001')
      ORDER BY migration_id`,
  );
  const expected = ["INV-0001", "INV-0002", "PUR-0001"];
  if (migrations.rows.length !== expected.length || migrations.rows.some((row, index) => row.migration_id !== expected[index])) {
    throw new Error(`MOD-B migration markers are incomplete: ${JSON.stringify(migrations.rows)}`);
  }

  const rls = await client.query(
    `SELECT n.nspname AS schema_name, c.relname AS table_name, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('inventory','procurement')
        AND c.relkind = 'r'
      ORDER BY n.nspname, c.relname`,
  );
  if (rls.rows.length < 20) throw new Error(`Expected MOD-B tables, found ${rls.rows.length}`);
  const unprotected = rls.rows.filter((row) => row.relrowsecurity !== true || row.relforcerowsecurity !== true);
  if (unprotected.length > 0) throw new Error(`RLS is not forced on: ${unprotected.map((row) => `${row.schema_name}.${row.table_name}`).join(", ")}`);

  const triggers = await client.query(
    `SELECT event_object_schema, event_object_table, trigger_name
       FROM information_schema.triggers
      WHERE trigger_name IN (
        'stock_ledger_append_only','stock_ledger_projection_trigger','cost_consumptions_append_only',
        'goods_receipt_lines_append_only','supplier_return_lines_append_only','landed_cost_allocations_append_only'
      )`,
  );
  const requiredTriggers = new Set([
    "stock_ledger_append_only", "stock_ledger_projection_trigger", "cost_consumptions_append_only",
    "goods_receipt_lines_append_only", "supplier_return_lines_append_only", "landed_cost_allocations_append_only",
  ]);
  for (const row of triggers.rows) requiredTriggers.delete(row.trigger_name);
  if (requiredTriggers.size > 0) throw new Error(`Missing MOD-B trigger(s): ${[...requiredTriggers].join(", ")}`);

  const permissions = await client.query(
    `SELECT code FROM platform.permissions
      WHERE module IN ('inventory','procurement')`,
  );
  if (permissions.rows.length < 20) throw new Error(`Expected MOD-B permissions, found ${permissions.rows.length}`);

  const forbiddenCatalogForeignKeys = await client.query(
    `SELECT conname
       FROM pg_constraint constraint_row
       JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
       JOIN pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace
       JOIN pg_class referenced_table ON referenced_table.oid = constraint_row.confrelid
       JOIN pg_namespace referenced_namespace ON referenced_namespace.oid = referenced_table.relnamespace
      WHERE constraint_row.contype = 'f'
        AND namespace_row.nspname IN ('inventory','procurement')
        AND referenced_namespace.nspname = 'catalog'`,
  );
  if (forbiddenCatalogForeignKeys.rows.length > 0) throw new Error("MOD-B contains a foreign key to unmerged MOD-A catalog tables");

  console.log(`verified MOD-B schema: ${rls.rows.length} RLS tables, ${triggers.rows.length} critical triggers, ${permissions.rows.length} permissions`);
} finally {
  await client.end();
}
