import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const enabled = process.env.MOD_F_NEON_INTEGRATION === "1";

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
    tenantAlpha: randomUUID(),
    tenantBeta: randomUUID(),
    actorAlpha: randomUUID(),
    actorBeta: randomUUID(),
    legalEntityAlpha: randomUUID(),
    storeAlpha: randomUUID(),
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
      `INSERT INTO platform.tenants(
        id,code,display_name,home_region,status,default_locale,default_time_zone
      ) VALUES
        ($1,$2,'MOD-F Alpha','test','active','bn-BD','Asia/Dhaka'),
        ($3,$4,'MOD-F Beta','test','active','en-GB','Europe/London')`,
      [ids.tenantAlpha, `mod-f-alpha-${suffix}`, ids.tenantBeta, `mod-f-beta-${suffix}`],
    );
    await client.query(
      `INSERT INTO platform.users(id,identity_subject,display_name,status) VALUES
        ($1,$2,'MOD-F Alpha Actor','active'),
        ($3,$4,'MOD-F Beta Actor','active')`,
      [ids.actorAlpha, `mod-f-alpha-${suffix}`, ids.actorBeta, `mod-f-beta-${suffix}`],
    );
    await client.query(
      `INSERT INTO platform.legal_entities(
        id,tenant_id,code,legal_name,base_currency,country_code,time_zone,status
      ) VALUES ($1,$2,$3,'MOD-F Alpha Legal Entity','BDT','BD','Asia/Dhaka','active')`,
      [ids.legalEntityAlpha, ids.tenantAlpha, `LE-${suffix}`],
    );
    await client.query(
      `INSERT INTO platform.stores(
        id,tenant_id,legal_entity_id,code,display_name,time_zone,status
      ) VALUES ($1,$2,$3,$4,'MOD-F Alpha Store','Asia/Dhaka','active')`,
      [ids.storeAlpha, ids.tenantAlpha, ids.legalEntityAlpha, `STORE-${suffix}`],
    );
    await setContext(client, ids.tenantAlpha, ids.actorAlpha, `${requestId}-fixture`);

    await client.query(
      `INSERT INTO localization.country_pack_versions(
        id,tenant_id,pack_id,country_code,version,support_level,effective_from,
        default_locale,manifest,manifest_hash,signature,signing_key_id,published_at,published_by
      ) VALUES ($1,$2,$3,'BD','1.0.0','limited','2026-01-01','bn-BD',$4,$5,'fixture-signature','fixture-key',now(),$6)`,
      [ids.packVersion, ids.tenantAlpha, `bd-primary-${suffix}`, { schemaVersion: "1.0", packId: `bd-primary-${suffix}` }, "a".repeat(64), ids.actorAlpha],
    );
    await client.query(
      "INSERT INTO localization.locale_profiles(id,tenant_id,pack_version_id,locale,fallback_locales,direction,numbering_system,calendar) VALUES ($1,$2,$3,'bn-BD',ARRAY['bn','en'],'ltr','beng','gregory')",
      [ids.locale, ids.tenantAlpha, ids.packVersion],
    );
    await client.query(
      "INSERT INTO localization.currency_metadata(id,tenant_id,pack_version_id,currency,accounting_scale,cash_increment_minor,cash_rounding_mode,effective_from,metadata_version) VALUES ($1,$2,$3,'BDT',2,1,'nearest','2026-01-01',$4)",
      [ids.currency, ids.tenantAlpha, ids.packVersion, `bdt-${suffix}`],
    );
    await client.query(
      "INSERT INTO localization.business_day_boundaries(id,tenant_id,pack_version_id,time_zone,local_start_time,effective_from,boundary_version) VALUES ($1,$2,$3,'Asia/Dhaka','04:00','2026-01-01',$4)",
      [ids.boundary, ids.tenantAlpha, ids.packVersion, `dhaka-${suffix}`],
    );
    await client.query(
      `INSERT INTO localization.legal_number_scopes(
        id,tenant_id,legal_entity_id,store_id,document_type,fiscal_year,prefix,suffix,
        minimum_value,maximum_value,next_value,width,effective_from,offline_allocation_allowed,
        sequence_version,created_by
      ) VALUES ($1,$2,$3,$4,'receipt','2026',$5,'',1,999999,1,6,'2026-01-01',false,$6,$7)`,
      [ids.scope, ids.tenantAlpha, ids.legalEntityAlpha, ids.storeAlpha, `BD-${suffix}-`, `receipt-${suffix}`, ids.actorAlpha],
    );
    await client.query(
      `INSERT INTO localization.legal_documents(
        id,tenant_id,legal_entity_id,store_id,document_type,legal_number,business_date,issued_at,
        pack_version_id,template_id,template_version,tax_rule_version,currency_metadata_version,
        source_type,source_id,source_version,totals,semantic_payload_hash,rendered_document_hash,
        archive_object_key,fiscal_status,issued_by,request_id,trace_id
      ) VALUES ($1,$2,$3,$4,'receipt',$5,'2026-07-29',now(),$6,'receipt-standard','1.0','bd-tax-v1',$7,'pos.receipt',$8,'1',$9,$10,$11,$12,'pending',$13,$14,$14)`,
      [
        ids.document, ids.tenantAlpha, ids.legalEntityAlpha, ids.storeAlpha, `FIXTURE-${suffix}`,
        ids.packVersion, `bdt-${suffix}`, `receipt-${suffix}`, { grossMinor: "1000" },
        "b".repeat(64), "c".repeat(64), `legal/bd/${suffix}.pdf`, ids.actorAlpha, requestId,
      ],
    );
    await client.query(
      `INSERT INTO localization.fiscal_submissions(
        id,tenant_id,document_id,provider_capability_id,country_pack_version,payload_hash,
        idempotency_key,request_hash,status,submitted_at,last_observed_at
      ) VALUES ($1,$2,$3,'bd-fixture-provider','1.0.0',$4,$5,$6,'pending',now(),now())`,
      [ids.submission, ids.tenantAlpha, ids.document, "d".repeat(64), `fiscal-${suffix}`, "e".repeat(64)],
    );

    await client.query("SET LOCAL ROLE store_app_runtime");
    await client.query("SET LOCAL row_security = on");
    await setContext(client, ids.tenantAlpha, ids.actorAlpha, requestId);

    const activation = await client.query(
      "SELECT * FROM localization.activate_country_pack($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [ids.activation, ids.tenantAlpha, ids.legalEntityAlpha, ids.storeAlpha, ids.packVersion, "2026-01-01", ids.actorAlpha, "Initial Bangladesh pack", `activation-${suffix}`, "f".repeat(64)],
    );
    const activationReplay = await client.query(
      "SELECT * FROM localization.activate_country_pack($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [ids.activation, ids.tenantAlpha, ids.legalEntityAlpha, ids.storeAlpha, ids.packVersion, "2026-01-01", ids.actorAlpha, "Initial Bangladesh pack", `activation-${suffix}`, "f".repeat(64)],
    );
    assert.equal(activation.rows[0].replayed, false);
    assert.equal(activationReplay.rows[0].replayed, true);

    const allocation = await client.query(
      "SELECT * FROM localization.allocate_legal_number($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [ids.allocation, ids.tenantAlpha, ids.scope, "2026-07-29", `operation-${suffix}`, "online", null, ids.actorAlpha, requestId, requestId],
    );
    const allocationReplay = await client.query(
      "SELECT * FROM localization.allocate_legal_number($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [ids.allocation, ids.tenantAlpha, ids.scope, "2026-07-29", `operation-${suffix}`, "online", null, ids.actorAlpha, requestId, requestId],
    );
    assert.equal(allocation.rows[0].legal_number, `BD-${suffix}-000001`);
    assert.equal(allocation.rows[0].replayed, false);
    assert.equal(allocationReplay.rows[0].legal_number, `BD-${suffix}-000001`);
    assert.equal(allocationReplay.rows[0].replayed, true);

    const unknown = await client.query(
      "SELECT localization.record_fiscal_transition($1,$2,$3,'unknown',NULL,NULL,now(),$4,$5,$6) AS status",
      [ids.fiscalUnknown, ids.tenantAlpha, ids.submission, ids.actorAlpha, requestId, requestId],
    );
    const accepted = await client.query(
      "SELECT localization.record_fiscal_transition($1,$2,$3,'accepted',$4,NULL,now(),$5,$6,$7) AS status",
      [ids.fiscalAccepted, ids.tenantAlpha, ids.submission, `BD-FISCAL-${suffix}`, ids.actorAlpha, requestId, requestId],
    );
    assert.equal(unknown.rows[0].status, "unknown");
    assert.equal(accepted.rows[0].status, "accepted");

    const evidence = await client.query(
      `SELECT event_type, count(*)::int AS count
         FROM platform.audit_events
        WHERE tenant_id = $1::uuid AND event_type LIKE 'localization.%'
        GROUP BY event_type
        ORDER BY event_type`,
      [ids.tenantAlpha],
    );
    const eventCounts = Object.fromEntries(evidence.rows.map((row) => [row.event_type, row.count]));
    assert.equal(eventCounts["localization.country_pack.published.v1"], 1);
    assert.equal(eventCounts["localization.country_pack.activated.v1"], 1);
    assert.equal(eventCounts["localization.legal_number.allocated.v1"], 1);
    assert.equal(eventCounts["localization.legal_document.published.v1"], 1);
    assert.equal(eventCounts["localization.fiscal_submission.created.v1"], 1);
    assert.equal(eventCounts["localization.fiscal_submission.status_observed.v1"], 2);
    const outbox = await client.query(
      "SELECT count(*)::int AS count FROM platform.outbox_events WHERE tenant_id = $1::uuid AND event_type LIKE 'localization.%'",
      [ids.tenantAlpha],
    );
    assert.equal(outbox.rows[0].count, 7);

    await client.query("SAVEPOINT direct_write_denied");
    await assert.rejects(
      client.query(
        "INSERT INTO localization.legal_documents(id,tenant_id,legal_entity_id,document_type,legal_number,business_date,issued_at,pack_version_id,template_id,template_version,tax_rule_version,currency_metadata_version,source_type,source_id,source_version,totals,semantic_payload_hash,rendered_document_hash,archive_object_key,fiscal_status,issued_by,request_id,trace_id) VALUES ($1,$2,$3,'receipt',$4,'2026-07-29',now(),$5,'x','1','x','x','x','x','1','{}',$6,$7,'x','not_required',$8,'x','x')",
        [ids.forbiddenDocument, ids.tenantAlpha, ids.legalEntityAlpha, `ILLEGAL-${suffix}`, ids.packVersion, "1".repeat(64), "2".repeat(64), ids.actorAlpha],
      ),
      /permission denied/i,
    );
    await client.query("ROLLBACK TO SAVEPOINT direct_write_denied");

    await setContext(client, ids.tenantBeta, ids.actorBeta, `${requestId}-beta`);
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
