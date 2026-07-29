import assert from "node:assert/strict";
import test from "node:test";

const enabled = process.env.MOD_F_NEON_INTEGRATION === "1";

const tenantAlpha = "018f0000-0000-7000-8000-000000000001";
const tenantBeta = "018f0000-0000-7000-8000-000000000002";
const actorAlpha = "018f0000-0000-7000-8000-000000000101";
const actorBeta = "018f0000-0000-7000-8000-000000000102";
const legalEntityAlpha = "018f0000-0000-7000-8000-000000000201";
const storeAlpha = "018f0000-0000-7000-8000-000000000301";
const packVersionId = "028f0000-0000-7000-8000-000000000001";
const localeProfileId = "028f0000-0000-7000-8000-000000000002";
const currencyMetadataId = "028f0000-0000-7000-8000-000000000003";
const boundaryId = "028f0000-0000-7000-8000-000000000004";
const activationId = "028f0000-0000-7000-8000-000000000005";
const numberScopeId = "028f0000-0000-7000-8000-000000000006";
const allocationId = "028f0000-0000-7000-8000-000000000007";
const documentId = "028f0000-0000-7000-8000-000000000008";
const fiscalSubmissionId = "028f0000-0000-7000-8000-000000000009";

async function setContext(client, tenantId, actorId, requestId) {
  await client.query(
    "SELECT platform.set_request_context($1,$2,NULL,NULL,NULL,NULL,$3,$4,$5)",
    [tenantId, actorId, "2026-07-29", requestId, requestId],
  );
}

test("MOD-F Neon migration chain enforces replay, fiscal state and tenant isolation", { skip: !enabled, timeout: 90_000 }, async () => {
  const { Client } = await import("@neondatabase/serverless");
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL is required");

  const owner = new Client({ connectionString });
  await owner.connect();
  try {
    await owner.query("BEGIN");
    await owner.query("SET LOCAL row_security = off");
    await owner.query(
      `INSERT INTO localization.country_pack_versions(
        id,tenant_id,pack_id,country_code,version,support_level,effective_from,
        default_locale,manifest,manifest_hash,signature,signing_key_id,published_at,published_by
      ) VALUES ($1,$2,'bd-primary','BD','1.0.0','limited','2026-01-01','bn-BD',$3,$4,'fixture-signature','fixture-key',now(),$5)`,
      [packVersionId, tenantAlpha, { schemaVersion: "1.0", packId: "bd-primary" }, "a".repeat(64), actorAlpha],
    );
    await owner.query(
      "INSERT INTO localization.locale_profiles(id,tenant_id,pack_version_id,locale,fallback_locales,direction,numbering_system,calendar) VALUES ($1,$2,$3,'bn-BD',ARRAY['bn','en'],'ltr','beng','gregory')",
      [localeProfileId, tenantAlpha, packVersionId],
    );
    await owner.query(
      "INSERT INTO localization.currency_metadata(id,tenant_id,pack_version_id,currency,accounting_scale,cash_increment_minor,cash_rounding_mode,effective_from,metadata_version) VALUES ($1,$2,$3,'BDT',2,1,'nearest','2026-01-01','bdt-v1')",
      [currencyMetadataId, tenantAlpha, packVersionId],
    );
    await owner.query(
      "INSERT INTO localization.business_day_boundaries(id,tenant_id,pack_version_id,time_zone,local_start_time,effective_from,boundary_version) VALUES ($1,$2,$3,'Asia/Dhaka','04:00','2026-01-01','dhaka-v1')",
      [boundaryId, tenantAlpha, packVersionId],
    );
    await owner.query(
      `INSERT INTO localization.legal_number_scopes(
        id,tenant_id,legal_entity_id,store_id,document_type,fiscal_year,prefix,suffix,
        minimum_value,maximum_value,next_value,width,effective_from,offline_allocation_allowed,
        sequence_version,created_by
      ) VALUES ($1,$2,$3,$4,'receipt','2026','BD-', '',1,999999,1,6,'2026-01-01',false,'receipt-v1',$5)`,
      [numberScopeId, tenantAlpha, legalEntityAlpha, storeAlpha, actorAlpha],
    );
    await owner.query(
      `INSERT INTO localization.legal_documents(
        id,tenant_id,legal_entity_id,store_id,document_type,legal_number,business_date,issued_at,
        pack_version_id,template_id,template_version,tax_rule_version,currency_metadata_version,
        source_type,source_id,source_version,totals,semantic_payload_hash,rendered_document_hash,
        archive_object_key,fiscal_status,issued_by,request_id,trace_id
      ) VALUES ($1,$2,$3,$4,'receipt','FIXTURE-000001','2026-07-29',now(),$5,'receipt-standard','1.0','bd-tax-v1','bdt-v1','pos.receipt','receipt-fixture','1',$6,$7,$8,'legal/bd/fixture.pdf','pending',$9,'fixture-seed','fixture-seed')`,
      [documentId, tenantAlpha, legalEntityAlpha, storeAlpha, packVersionId, { grossMinor: "1000" }, "b".repeat(64), "c".repeat(64), actorAlpha],
    );
    await owner.query(
      `INSERT INTO localization.fiscal_submissions(
        id,tenant_id,document_id,provider_capability_id,country_pack_version,payload_hash,
        idempotency_key,request_hash,status,submitted_at,last_observed_at
      ) VALUES ($1,$2,$3,'bd-fixture-provider','1.0.0',$4,'fiscal-fixture-001',$5,'pending',now(),now())`,
      [fiscalSubmissionId, tenantAlpha, documentId, "d".repeat(64), "e".repeat(64)],
    );
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await owner.end();
  }

  const runtime = new Client({ connectionString });
  await runtime.connect();
  try {
    await runtime.query("BEGIN");
    await runtime.query("SET LOCAL ROLE store_app_runtime");
    await setContext(runtime, tenantAlpha, actorAlpha, "mod-f-neon-001");

    const activation = await runtime.query(
      "SELECT * FROM localization.activate_country_pack($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [activationId, tenantAlpha, legalEntityAlpha, storeAlpha, packVersionId, "2026-01-01", actorAlpha, "Initial Bangladesh pack", "activation-fixture-001", "f".repeat(64)],
    );
    const activationReplay = await runtime.query(
      "SELECT * FROM localization.activate_country_pack($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [activationId, tenantAlpha, legalEntityAlpha, storeAlpha, packVersionId, "2026-01-01", actorAlpha, "Initial Bangladesh pack", "activation-fixture-001", "f".repeat(64)],
    );
    assert.equal(activation.rows[0].replayed, false);
    assert.equal(activationReplay.rows[0].replayed, true);

    const allocation = await runtime.query(
      "SELECT * FROM localization.allocate_legal_number($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [allocationId, tenantAlpha, numberScopeId, "2026-07-29", "operation-fixture-001", "online", null, actorAlpha, "mod-f-neon-001", "mod-f-neon-001"],
    );
    const allocationReplay = await runtime.query(
      "SELECT * FROM localization.allocate_legal_number($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [allocationId, tenantAlpha, numberScopeId, "2026-07-29", "operation-fixture-001", "online", null, actorAlpha, "mod-f-neon-001", "mod-f-neon-001"],
    );
    assert.equal(allocation.rows[0].legal_number, "BD-000001");
    assert.equal(allocation.rows[0].replayed, false);
    assert.equal(allocationReplay.rows[0].legal_number, "BD-000001");
    assert.equal(allocationReplay.rows[0].replayed, true);

    const unknown = await runtime.query(
      "SELECT localization.record_fiscal_transition($1,$2,$3,'unknown',NULL,NULL,now(),$4,$5,$6) AS status",
      ["028f0000-0000-7000-8000-000000000010", tenantAlpha, fiscalSubmissionId, actorAlpha, "mod-f-neon-001", "mod-f-neon-001"],
    );
    const accepted = await runtime.query(
      "SELECT localization.record_fiscal_transition($1,$2,$3,'accepted','BD-FISCAL-001',NULL,now(),$4,$5,$6) AS status",
      ["028f0000-0000-7000-8000-000000000011", tenantAlpha, fiscalSubmissionId, actorAlpha, "mod-f-neon-001", "mod-f-neon-001"],
    );
    assert.equal(unknown.rows[0].status, "unknown");
    assert.equal(accepted.rows[0].status, "accepted");

    await assert.rejects(
      runtime.query(
        "INSERT INTO localization.legal_documents(id,tenant_id,legal_entity_id,document_type,legal_number,business_date,issued_at,pack_version_id,template_id,template_version,tax_rule_version,currency_metadata_version,source_type,source_id,source_version,totals,semantic_payload_hash,rendered_document_hash,archive_object_key,fiscal_status,issued_by,request_id,trace_id) VALUES ($1,$2,$3,'receipt','ILLEGAL-DIRECT','2026-07-29',now(),$4,'x','1','x','x','x','x','1','{}',$5,$6,'x','not_required',$7,'x','x')",
        ["028f0000-0000-7000-8000-000000000012", tenantAlpha, legalEntityAlpha, packVersionId, "1".repeat(64), "2".repeat(64), actorAlpha],
      ),
      /permission denied/i,
    );
    await runtime.query("ROLLBACK TO SAVEPOINT direct_write_denied").catch(() => undefined);

    await runtime.query("ROLLBACK");
  } catch (error) {
    await runtime.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await runtime.end();
  }

  const isolation = new Client({ connectionString });
  await isolation.connect();
  try {
    await isolation.query("BEGIN");
    await isolation.query("SET LOCAL ROLE store_app_runtime");
    await setContext(isolation, tenantBeta, actorBeta, "mod-f-neon-002");
    const hidden = await isolation.query("SELECT count(*)::int AS count FROM localization.country_pack_versions");
    assert.equal(hidden.rows[0].count, 0);
    await isolation.query("ROLLBACK");
  } finally {
    await isolation.end();
  }
});
