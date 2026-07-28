import test from "node:test";
import assert from "node:assert/strict";

const enabled = process.env.MOD_E_NEON_INTEGRATION === "1";

test("MOD-E database invariants, immutability and tenant isolation", { skip: !enabled, timeout: 60_000 }, async () => {
  const { Client } = await import("@neondatabase/serverless");
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL is required");
  const client = new Client({ connectionString });
  await client.connect();
  const id = () => crypto.randomUUID();
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  const tenantA = id();
  const tenantB = id();
  const userA = id();
  const userB = id();
  const entityA = id();
  const entityB = id();
  const chartA = id();
  const debitAccountA = id();
  const creditAccountA = id();
  const bankLedgerA = id();
  const periodA = id();
  const providerA = id();
  const providerB = id();
  const intentA = id();
  const intentB = id();
  const postingGroupA = id();
  const journalA = id();
  const bankA = id();
  const importA = id();
  const statementLineA = id();

  try {
    const migrations = await client.query("SELECT migration_id FROM platform.schema_migrations WHERE migration_id IN ('PAY-0001','ACC-0001','BNK-0001') ORDER BY migration_id");
    assert.deepEqual(migrations.rows.map((row) => row.migration_id), ["ACC-0001", "BNK-0001", "PAY-0001"]);
    const directDml = await client.query("SELECT count(*)::int AS count FROM information_schema.role_table_grants WHERE grantee='store_app_runtime' AND table_schema IN ('payment','accounting','banking') AND privilege_type IN ('INSERT','UPDATE','DELETE')");
    assert.equal(directDml.rows[0].count, 0);

    await client.query("BEGIN");
    await client.query("SET LOCAL row_security = off");
    await client.query("INSERT INTO platform.tenants(id,code,display_name,home_region,status,default_locale,default_time_zone) VALUES ($1,$2,$3,'test','active','en-GB','UTC'),($4,$5,$6,'test','active','en-GB','UTC')", [tenantA, `a${suffix}`, "MOD-E Tenant A", tenantB, `b${suffix}`, "MOD-E Tenant B"]);
    await client.query("INSERT INTO platform.users(id,identity_subject,display_name,status) VALUES ($1,$2,'MOD-E User A','active'),($3,$4,'MOD-E User B','active')", [userA, `mod-e-a-${suffix}`, userB, `mod-e-b-${suffix}`]);
    await client.query("INSERT INTO platform.memberships(id,tenant_id,user_id,status) VALUES ($1,$2,$3,'active'),($4,$5,$6,'active')", [id(), tenantA, userA, id(), tenantB, userB]);
    await client.query("INSERT INTO platform.legal_entities(id,tenant_id,code,legal_name,base_currency,country_code,time_zone,status) VALUES ($1,$2,'A','Entity A','GBP','GB','UTC','active'),($3,$4,'B','Entity B','GBP','GB','UTC','active')", [entityA, tenantA, entityB, tenantB]);
    await client.query("INSERT INTO accounting.charts(id,tenant_id,legal_entity_id,code,display_name,base_currency) VALUES ($1,$2,$3,'MAIN','Main chart','GBP')", [chartA, tenantA, entityA]);
    await client.query("INSERT INTO accounting.accounts(id,tenant_id,chart_id,code,display_name,account_type,normal_balance,control_type,allow_manual_posting,effective_from) VALUES ($1,$2,$3,'1100','Bank','asset','debit','bank',true,'2026-01-01'),($4,$2,$3,'1200','Receivable','asset','debit','accounts_receivable',true,'2026-01-01'),($5,$2,$3,'4000','Revenue','revenue','credit',NULL,true,'2026-01-01')", [bankLedgerA, tenantA, chartA, debitAccountA, creditAccountA]);
    await client.query("INSERT INTO accounting.fiscal_periods(id,tenant_id,legal_entity_id,code,start_date,end_date,status) VALUES ($1,$2,$3,'2026-07','2026-07-01','2026-07-31','open')", [periodA, tenantA, entityA]);
    await client.query("INSERT INTO payment.provider_accounts(id,tenant_id,legal_entity_id,code,provider_key,display_name) VALUES ($1,$2,$3,'SIM','simulator','Simulator A'),($4,$5,$6,'SIM','simulator','Simulator B')", [providerA, tenantA, entityA, providerB, tenantB, entityB]);
    await client.query("INSERT INTO payment.payment_intents(id,tenant_id,legal_entity_id,provider_account_id,source_type,source_id,source_version,currency,scale,amount_minor,created_by) VALUES ($1,$2,$3,$4,'invoice','invoice-a','1','GBP',2,10000,$5),($6,$7,$8,$9,'invoice','invoice-b','1','GBP',2,2500,$10)", [intentA, tenantA, entityA, providerA, userA, intentB, tenantB, entityB, providerB, userB]);

    await client.query("SAVEPOINT payment_identity_guard");
    await assert.rejects(client.query("UPDATE payment.payment_intents SET amount_minor=9999 WHERE id=$1", [intentA]), /immutable/i);
    await client.query("ROLLBACK TO SAVEPOINT payment_identity_guard");

    await client.query("SAVEPOINT settlement_arithmetic_guard");
    await assert.rejects(client.query("INSERT INTO payment.settlements(id,tenant_id,legal_entity_id,provider_account_id,provider_settlement_id,currency,scale,gross_minor,fee_minor,adjustment_minor,net_minor,settled_at,source_hash) VALUES ($1,$2,$3,$4,'bad','GBP',2,10000,300,0,9999,now(),'bad')", [id(), tenantA, entityA, providerA]), /check constraint/i);
    await client.query("ROLLBACK TO SAVEPOINT settlement_arithmetic_guard");

    await client.query("INSERT INTO accounting.posting_groups(id,tenant_id,legal_entity_id,source_type,source_id,source_version,business_date,correlation_id) VALUES ($1,$2,$3,'payment','payment-a','1','2026-07-28','mod-e-test')", [postingGroupA, tenantA, entityA]);
    await client.query("INSERT INTO accounting.journal_entries(id,tenant_id,legal_entity_id,chart_id,fiscal_period_id,posting_group_id,journal_type,source_type,source_id,source_version,transaction_currency,transaction_scale,base_currency,base_scale,total_debit_minor,total_credit_minor,total_base_debit_minor,total_base_credit_minor,business_date,posted_by,request_id,trace_id) VALUES ($1,$2,$3,$4,$5,$6,'system','payment','payment-a','1','GBP',2,'GBP',2,10000,10000,10000,10000,'2026-07-28',$7,'mod-e-test','mod-e-test')", [journalA, tenantA, entityA, chartA, periodA, postingGroupA, userA]);
    await client.query("INSERT INTO accounting.journal_lines(id,tenant_id,journal_entry_id,line_number,account_id,transaction_debit_minor,transaction_credit_minor,base_debit_minor,base_credit_minor) VALUES ($1,$2,$3,1,$4,10000,0,10000,0),($5,$2,$3,2,$6,0,10000,0,10000)", [id(), tenantA, journalA, debitAccountA, id(), creditAccountA]);
    await client.query("SET CONSTRAINTS accounting.accounting_journal_balance_deferred IMMEDIATE");
    await client.query("SET CONSTRAINTS accounting.accounting_journal_balance_deferred DEFERRED");

    await client.query("SAVEPOINT journal_immutable_guard");
    await assert.rejects(client.query("UPDATE accounting.journal_entries SET source_version='2' WHERE id=$1", [journalA]), /immutable/i);
    await client.query("ROLLBACK TO SAVEPOINT journal_immutable_guard");

    await client.query("SAVEPOINT journal_balance_guard");
    const badGroup = id();
    const badJournal = id();
    await client.query("INSERT INTO accounting.posting_groups(id,tenant_id,legal_entity_id,source_type,source_id,source_version,business_date,correlation_id) VALUES ($1,$2,$3,'manual','bad','1','2026-07-28','mod-e-bad')", [badGroup, tenantA, entityA]);
    await client.query("INSERT INTO accounting.journal_entries(id,tenant_id,legal_entity_id,chart_id,fiscal_period_id,posting_group_id,journal_type,source_type,source_id,source_version,transaction_currency,transaction_scale,base_currency,base_scale,total_debit_minor,total_credit_minor,total_base_debit_minor,total_base_credit_minor,business_date,posted_by,request_id,trace_id) VALUES ($1,$2,$3,$4,$5,$6,'manual','manual','bad','1','GBP',2,'GBP',2,100,100,100,100,'2026-07-28',$7,'mod-e-bad','mod-e-bad')", [badJournal, tenantA, entityA, chartA, periodA, badGroup, userA]);
    await client.query("INSERT INTO accounting.journal_lines(id,tenant_id,journal_entry_id,line_number,account_id,transaction_debit_minor,transaction_credit_minor,base_debit_minor,base_credit_minor) VALUES ($1,$2,$3,1,$4,100,0,100,0),($5,$2,$3,2,$6,0,90,0,90)", [id(), tenantA, badJournal, debitAccountA, id(), creditAccountA]);
    await assert.rejects(client.query("SET CONSTRAINTS accounting.accounting_journal_balance_deferred IMMEDIATE"), /not balanced/i);
    await client.query("ROLLBACK TO SAVEPOINT journal_balance_guard");

    await client.query("INSERT INTO banking.bank_accounts(id,tenant_id,legal_entity_id,ledger_account_id,code,display_name,bank_name,account_reference_masked,currency,scale) VALUES ($1,$2,$3,$4,'BANK-1','Primary bank','Test Bank','****1234','GBP',2)", [bankA, tenantA, entityA, bankLedgerA]);
    await client.query("INSERT INTO banking.statement_imports(id,tenant_id,bank_account_id,source_type,source_name,source_hash,status,line_count,imported_by,request_id,trace_id) VALUES ($1,$2,$3,'csv','test.csv','hash-a','completed',1,$4,'mod-e-test','mod-e-test')", [importA, tenantA, bankA, userA]);
    await client.query("INSERT INTO banking.statement_lines(id,tenant_id,bank_account_id,statement_import_id,line_number,fingerprint,booked_at,currency,scale,amount_minor,reference) VALUES ($1,$2,$3,$4,1,'fingerprint-a',now(),'GBP',2,10000,'SETTLEMENT-A')", [statementLineA, tenantA, bankA, importA]);
    await client.query("SAVEPOINT statement_immutable_guard");
    await assert.rejects(client.query("UPDATE banking.statement_lines SET reference='CHANGED' WHERE id=$1", [statementLineA]), /immutable/i);
    await client.query("ROLLBACK TO SAVEPOINT statement_immutable_guard");

    await client.query("SET LOCAL row_security = on");
    await client.query("SET LOCAL ROLE store_app_runtime");
    await client.query("SELECT platform.set_request_context($1,$2,NULL,NULL,NULL,NULL,'2026-07-28','mod-e-rls','mod-e-rls')", [tenantA, userA]);
    const visible = await client.query("SELECT id::text FROM payment.payment_intents ORDER BY id");
    assert.deepEqual(visible.rows.map((row) => row.id), [intentA]);
    await client.query("SAVEPOINT runtime_dml_guard");
    await assert.rejects(client.query("INSERT INTO payment.provider_accounts(id,tenant_id,legal_entity_id,code,provider_key,display_name) VALUES ($1,$2,$3,'NO','none','Denied')", [id(), tenantA, entityA]), /permission denied/i);
    await client.query("ROLLBACK TO SAVEPOINT runtime_dml_guard");
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
});
