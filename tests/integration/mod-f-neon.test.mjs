import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const enabled = process.env.MOD_F_NEON_INTEGRATION === "1";

const tenantAlpha = "018f0000-0000-7000-8000-000000000001";
const tenantBeta = "018f0000-0000-7000-8000-000000000002";
const actorAlpha = "018f0000-0000-7000-8000-000000000101";
const actorBeta = "018f0000-0000-7000-8000-000000000102";
const legalEntityAlpha = "018f0000-0000-7000-8000-000000000201";
const storeAlpha = "018f0000-0000-7000-8000-000000000301";

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

  const ids = {
    packVersion: randomUUID(),
    locale: randomUUID(),
    currency: randomUUID(),
    boundary: randomUUID(),
    activation: randomUUID(),
    scope: randomUUID(),
    allocation: randomUUID(),
    document: randomUUID(),
    submission: randomUUID(),
    fiscalUnknown: randomUUID(),
    fiscalAccepted: randomUUID(),
    forbiddenDocument: randomUUID(),
  };
  const suffix = ids.packVersion.slice(0, 8);
  const requestId = `mod-f-neon-${suffix}`;

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL row_security = off");

    await client.query(
      `INSERT INTO localization.country_pack_versions(
        id,tenant_id,pack_id,country_code,version,support_level,effective_from,
        default_locale,manifest,manifest_hash,signature,signing_key_id,published_at,published_by
      ) VALUES ($1,$2,$3,'BD','1.0.0','limited','2026-01-01','bn-BD',$4,$5,'fixture-signature','fixture-key',now(),$6)`,
      [ids.packVersion, tenantAlpha, `bd-primary-${suffix}`, { schemaVersion: "1.0", packId: `bd-primary-${suffix}` }, "a".repeat(64), actorAlpha],
    );
    await client.query(
      "INSERT INTO localization.locale_profiles(id,tenant_id,pack_version_id,locale,fallback_locales,direction,numbering_system,calendar) VALUES ($1,$2,$3,'bn-BD',ARRAY['bn','en'],'ltr','beng','gregory')",
      [ids.locale, tenantAlpha, ids.packVersion],
    );
    await client.query(
      "INSERT INTO localization.currency_metadata(id,tenant_id,pack_version_id,currency,accounting_scale,cash_increment_minor,cash_rounding_mode,effective_from,metadata_version) VALUES ($1,$2,$3,'BDT',2,1,'nearest','2026-01-01',$4)",
      [ids.currency, tenantAlpha, ids.packVersion, `bdt-${suffix}`],
    );
    await client.query(
      "INSERT INTO localization.business_day_boundaries(id,tenant_id,pack_version_id,time_zone,local_start_time,effective_from,boundary_version) VALUES ($1,$2,$3,'Asia/Dhaka','04:00','2026-01-01',$4)",
      [ids.boundary, tenantAlpha, ids.packVersion, `dhaka-${suffix}`],
    );
    await client.query(
      `INSERT INTO localization.legal_number_scopes(
        id,tenant_id,legal_entity_id,store_id,document_type,fiscal_year,prefix,suffix,
        minimum_value,maximum_value,next_value,width,effective_from,offline_allocation_allowed,
        sequence_version,created_by
      ) VALUES ($1,$2,$3,$4,'receipt','2026',$5,'',1,999999,1,6,'2026-01-01',false,$6,$7)`,
      [ids.scope, tenantAlpha, legalEntityAlpha, storeAlpha, `BD-${suffix}-`, `receipt-${suffix}`, actorAlpha],
    );
    await client.query(
      `INSERT INTO localization.legal_documents(
        id,tenant_id,legal_entity_id,store_id,document_type,legal_number,business_date,issued_at,
        pack_version_id,template_id,template_version,tax_rule_version,currency_metadata_version,
        source_type,source_id,source_version,totals,semantic_payload_hash,rendered_document_hash,
        archive_object_key,fiscal_status,issued_by,request_id,trace_id
      ) VALUES ($1,$2,$3,$4,'receipt',$5,'2026-07-29',now(),$6,'receipt-standard','1.0','bd-tax-v1',$7,'pos.receipt',$8,'1',$9,$10,$11,$12,'pending',$13,$14,$14)`,
      [
        ids.document, tenantAlpha, legalEntityAlpha, storeAlpha, `FIXTURE-${suffix}`,
        ids.packVersion, `bdt-${suffix}`, `receipt-${suffix}`, { grossMinor: "1000" },
        "b".repeat(64), "c".repeat(64), `legal/bd/${suffix}.pdf`, actorAlpha, requestId,
      ],
    );
    await client.query(
      `INSERT INTO localization.fiscal_submissions(
        id,tenant_id,document_id,provider_capability_id,country_pack_version,payload_hash,
        idempotency_key,request_hash,status,submitted_at,last_observed_at
      ) VALUES ($1,$2,$3,'bd-fixture-provider','1.0.0',$4,$5,$6,'pending',now(),now())`,
      [ids.submission, tenantAlpha, ids.document, "d".repeat(64), `fiscal-${suffix}`, "e".repeat(64)],
    );

    await client.query("SET LOCAL ROLE store_app_runtime");
    await setContext(client, tenantAlpha, actorAlpha, requestId);

    const activation = await client.query(
      "SELECT * FROM localization.activate_country_pack($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [ids.activation, tenantAlpha, legalEntityAlpha, storeAlpha, ids.packVersion, "2026-01-01", actorAlpha, "Initial Bangladesh pack", `activation-${suffix}`, "f".repeat(64)],
    );
    const activationReplay = await client.query(
      "SELECT * FROM localization.activate_country_pack($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [ids.activation, tenantAlpha, legalEntityAlpha, storeAlpha, ids.packVersion, "2026-01-01", actorAlpha, "Initial Bangladesh pack", `activation-${suffix}`, "f".repeat(64)],
    );
    assert.equal(activation.rows[0].replayed, false);
    assert.equal(activationReplay.rows[0].replayed, true);

    const allocation = await client.query(
      "SELECT * FROM localization.allocate_legal_number($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [ids.allocation, tenantAlpha, ids.scope, "2026-07-29", `operation-${suffix}`, "online", null, actorAlpha, requestId, requestId],
    );
    const allocationReplay = await client.query(
      "SELECT * FROM localization.allocate_legal_number($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [ids.allocation, tenantAlpha, ids.scope, "2026-07-29", `operation-${suffix}`, "online", null, actorAlpha, requestId, requestId],
    );
    assert.equal(allocation.rows[0].legal_number, `BD-${suffix}-000001`);
    assert.equal(allocation.rows[0].replayed, false);
    assert.equal(allocationReplay.rows[0].legal_number, `BD-${suffix}-000001`);
    assert.equal(allocationReplay.rows[0].replayed, true);

    const unknown = await client.query(
      "SELECT localization.record_fiscal_transition($1,$2,$3,'unknown',NULL,NULL,now(),$4,$5,$6) AS status",
      [ids.fiscalUnknown, tenantAlpha, ids.submission, actorAlpha, requestId, requestId],
    );
    const accepted = await client.query(
      "SELECT localization.record_fiscal_transition($1,$2,$3,'accepted',$4,NULL,now(),$5,$6,$7) AS status",
      [ids.fiscalAccepted, tenantAlpha, ids.submission, `BD-FISCAL-${suffix}`, actorAlpha, requestId, requestId],
    );
    assert.equal(unknown.rows[0].status, "unknown");
    assert.equal(accepted.rows[0].status, "accepted");

    await client.query("SAVEPOINT direct_write_denied");
    await assert.rejects(
      client.query(
        "INSERT INTO localization.legal_documents(id,tenant_id,legal_entity_id,document_type,legal_number,business_date,issued_at,pack_version_id,template_id,template_version,tax_rule_version,currency_metadata_version,source_type,source_id,source_version,totals,semantic_payload_hash,rendered_document_hash,archive_object_key,fiscal_status,issued_by,request_id,trace_id) VALUES ($1,$2,$3,'receipt',$4,'2026-07-29',now(),$5,'x','1','x','x','x','x','1','{}',$6,$7,'x','not_required',$8,'x','x')",
        [ids.forbiddenDocument, tenantAlpha, legalEntityAlpha, `ILLEGAL-${suffix}`, ids.packVersion, "1".repeat(64), "2".repeat(64), actorAlpha],
      ),
      /permission denied/i,
    );
    await client.query("ROLLBACK TO SAVEPOINT direct_write_denied");

    await setContext(client, tenantBeta, actorBeta, `${requestId}-beta`);
    const hidden = await client.query("SELECT count(*)::int AS count FROM localization.country_pack_versions");
    assert.equal(hidden.rows[0].count, 0);

    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
});
