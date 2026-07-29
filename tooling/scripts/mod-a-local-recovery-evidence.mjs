import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(root, "docs", "architecture", "mod-a");
const socket = process.env.MOD_A_PG_SOCKET ?? "/tmp/store-pos-mod-a-socket";
const port = process.env.MOD_A_PG_PORT ?? "55439";
const database = process.env.MOD_A_PG_RECOVERY_DB ?? "mod_a_recovery_validation";

const files = [
  "database/foundation/migrations/FND-0001-platform.sql",
  "database/foundation/migrations/FND-0002-rls.sql",
  "database/foundation/migrations/FND-0003-reference-slice.sql",
  "database/foundation/migrations/FND-0004-identity-revocation.sql",
  "database/foundation/migrations/FND-0005-session-revocation-privilege-hardening.sql",
  "database/foundation/seeds/dev.sql",
  "database/migrations/catalog/CAT-0001-core.sql",
  "database/migrations/catalog/CAT-0002-search-performance.sql",
  "database/migrations/catalog/CAT-0003-pos-feed.sql",
  "database/migrations/pricing/PRC-0001-core.sql",
  "database/migrations/tax/TAX-0001-core.sql",
  "database/migrations/pricing/PRC-0002-price-tax-snapshot.sql",
  "database/migrations/pricing/PRC-0003-publishing.sql",
  "database/migrations/tax/TAX-0002-publishing.sql",
];

async function run(command, args) {
  return await execFileAsync(command, args, {
    cwd: root,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
  });
}

async function psql(sql) {
  const { stdout } = await run("psql", ["-h", socket, "-p", port, "-d", database, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql]);
  return stdout.trim();
}

await run("dropdb", ["-h", socket, "-p", port, "--if-exists", database]);
await run("createdb", ["-h", socket, "-p", port, database]);

try {
  for (const file of files) await run("psql", ["-h", socket, "-p", port, "-d", database, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", file]);

  const result = await psql(`
    CREATE TEMP TABLE recovery_results(
      check_name text PRIMARY KEY,
      expected_state text NOT NULL,
      observed_state text NOT NULL,
      passed boolean NOT NULL,
      detail text NOT NULL
    );
    GRANT ALL ON recovery_results TO store_app_runtime;

    SET ROLE store_app_runtime;
    SELECT platform.set_request_context(
      '018f0000-0000-7000-8000-000000000001',
      '018f0000-0000-7000-8000-000000000101',
      NULL,NULL,NULL,NULL,'2026-07-28','recovery-setup','trace-recovery'
    );

    INSERT INTO catalog.units(id,tenant_id,code,display_name,dimension,decimal_scale,is_base_unit,created_by)
    VALUES(
      '018fd000-0000-7000-8000-000000000001',
      '018f0000-0000-7000-8000-000000000001',
      'EA','Each','count',0,true,
      '018f0000-0000-7000-8000-000000000101'
    );

    SELECT * FROM catalog.save_product(
      'recovery-product-key',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      jsonb_build_object(
        'id','018fd000-0000-7000-8000-000000000010',
        'code','recovery-product','normalizedCode','RECOVERY-PRODUCT',
        'kind','stock','status','active','defaultLocale','en-GB',
        'localized',jsonb_build_array(jsonb_build_object('locale','en-GB','name','Recovery fixture','description','Synthetic recovery evidence')),
        'variants',jsonb_build_array(jsonb_build_object(
          'id','018fd000-0000-7000-8000-000000000011',
          'sku','recovery-sku','normalizedSku','RECOVERY-SKU',
          'title','Default','combinationKey','DEFAULT','unitCode','EA','trackingMode','none',
          'attributeValues','[]'::jsonb,
          'barcodes',jsonb_build_array(jsonb_build_object('value','BAR-RECOVERY','normalizedValue','BAR-RECOVERY','symbology','CODE128','isPrimary',true))
        ))
      ),
      NULL,
      'recovery-setup'
    );

    SELECT * FROM pricing.publish_price_list_version(
      'recovery-price-key',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      jsonb_build_object(
        'id','018fd000-0000-7000-8000-000000000020',
        'code','RECOVERY-GBP','name','Recovery GBP','currency','GBP','scale',2,'expectedCurrentVersion',0
      ),
      jsonb_build_object(
        'id','018fd000-0000-7000-8000-000000000021',
        'status','active','priority',10,'channel','pos',
        'effectiveFrom','2026-08-01T00:00:00Z','effectiveUntil','2026-09-01T00:00:00Z',
        'reason','Recovery baseline publish'
      ),
      jsonb_build_array(jsonb_build_object(
        'id','018fd000-0000-7000-8000-000000000022',
        'variantId','018fd000-0000-7000-8000-000000000011',
        'unitCode','EA','minimumQuantityMinor','1','quantityScale',0,
        'unitPriceMinor','1000','priority',10,'ruleVersion','1'
      )),
      'recovery-setup'
    );

    SELECT * FROM pricing.record_price_tax_snapshot(
      'recovery-snapshot-key',
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      jsonb_build_object(
        'schemaVersion','1.0','snapshotId','018fd000-0000-7000-8000-000000000030',
        'sourceLineId','recovery-line','productId','018fd000-0000-7000-8000-000000000010',
        'variantId','018fd000-0000-7000-8000-000000000011','unitCode','EA',
        'quantityMinor','1','quantityScale',0,'currency','GBP','moneyScale',2,
        'priceListId','018fd000-0000-7000-8000-000000000020',
        'priceRuleId','018fd000-0000-7000-8000-000000000022',
        'priceListVersion','1','priceRuleVersion','1','unitPriceMinor','1000',
        'subtotalMinor','1000','discountMinor','0','promotedAmountMinor','1000',
        'promotions','[]'::jsonb,
        'taxCodeId','018fd000-0000-7000-8000-000000000040',
        'jurisdictionId','018fd000-0000-7000-8000-000000000041',
        'taxTreatment','standard','taxPriceMode','exclusive',
        'netMinor','1000','taxMinor','200','grossMinor','1200',
        'taxCalculationVersion','tax-v1:1:1','taxComponents','[]'::jsonb,
        'roundingMode','half_up','calculatedAt','2026-07-28T10:00:00Z',
        'calculationHash','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
      ),
      'recovery-setup'
    );

    DO $checks$
    DECLARE
      v_state text;
      v_message text;
      v_replayed boolean;
      v_count bigint;
    BEGIN
      BEGIN
        UPDATE pricing.price_tax_snapshots
        SET gross_minor=gross_minor
        WHERE tenant_id='018f0000-0000-7000-8000-000000000001'
          AND id='018fd000-0000-7000-8000-000000000030';
        INSERT INTO recovery_results VALUES('runtime_snapshot_mutation_denied','42501','none',false,'Mutation unexpectedly succeeded');
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_message=MESSAGE_TEXT;
        INSERT INTO recovery_results VALUES('runtime_snapshot_mutation_denied','42501',v_state,v_state='42501',v_message);
      END;

      BEGIN
        PERFORM pricing.record_price_tax_snapshot(
          'recovery-snapshot-key',
          'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          jsonb_build_object(
            'snapshotId','018fd000-0000-7000-8000-000000000030',
            'calculationHash','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
          ),
          'recovery-idempotency-mismatch'
        );
        INSERT INTO recovery_results VALUES('idempotency_hash_mismatch','P0001','none',false,'Mismatch unexpectedly succeeded');
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_message=MESSAGE_TEXT;
        INSERT INTO recovery_results VALUES('idempotency_hash_mismatch','P0001',v_state,v_state='P0001',v_message);
      END;

      BEGIN
        PERFORM pricing.publish_price_list_version(
          'recovery-version-conflict',
          'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          jsonb_build_object(
            'id','018fd000-0000-7000-8000-000000000020',
            'code','RECOVERY-GBP','name','Recovery GBP','currency','GBP','scale',2,'expectedCurrentVersion',0
          ),
          jsonb_build_object(
            'id','018fd000-0000-7000-8000-000000000050',
            'status','scheduled','channel','web','effectiveFrom','2026-09-01T00:00:00Z',
            'reason','Expected version conflict'
          ),
          jsonb_build_array(jsonb_build_object(
            'id','018fd000-0000-7000-8000-000000000051',
            'variantId','018fd000-0000-7000-8000-000000000011',
            'unitCode','EA','minimumQuantityMinor','1','quantityScale',0,
            'unitPriceMinor','1100','ruleVersion','1'
          )),
          'recovery-version-conflict'
        );
        INSERT INTO recovery_results VALUES('optimistic_version_conflict','40001','none',false,'Conflict unexpectedly succeeded');
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_message=MESSAGE_TEXT;
        INSERT INTO recovery_results VALUES('optimistic_version_conflict','40001',v_state,v_state='40001',v_message);
      END;

      BEGIN
        PERFORM pricing.publish_price_list_version(
          'recovery-overlap-conflict',
          'abababababababababababababababababababababababababababababababab',
          jsonb_build_object(
            'id','018fd000-0000-7000-8000-000000000020',
            'code','RECOVERY-GBP','name','Recovery GBP','currency','GBP','scale',2,'expectedCurrentVersion',1
          ),
          jsonb_build_object(
            'id','018fd000-0000-7000-8000-000000000060',
            'status','scheduled','channel','pos','effectiveFrom','2026-08-15T00:00:00Z',
            'effectiveUntil','2026-08-20T00:00:00Z','reason','Expected overlap conflict'
          ),
          jsonb_build_array(jsonb_build_object(
            'id','018fd000-0000-7000-8000-000000000061',
            'variantId','018fd000-0000-7000-8000-000000000011',
            'unitCode','EA','minimumQuantityMinor','1','quantityScale',0,
            'unitPriceMinor','1100','ruleVersion','1'
          )),
          'recovery-overlap-conflict'
        );
        INSERT INTO recovery_results VALUES('effective_window_overlap','23P01','none',false,'Overlap unexpectedly succeeded');
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_message=MESSAGE_TEXT;
        INSERT INTO recovery_results VALUES('effective_window_overlap','23P01',v_state,v_state='23P01',v_message);
      END;

      SELECT replayed INTO v_replayed FROM pricing.record_price_tax_snapshot(
        'recovery-snapshot-key',
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        jsonb_build_object(
          'snapshotId','018fd000-0000-7000-8000-000000000030',
          'calculationHash','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
        ),
        'recovery-replay'
      );
      INSERT INTO recovery_results VALUES('idempotent_replay','replayed=true',concat('replayed=',v_replayed),v_replayed,'Existing immutable snapshot returned');

      PERFORM platform.set_request_context(
        '018f0000-0000-7000-8000-000000000002',
        '018f0000-0000-7000-8000-000000000102',
        NULL,NULL,NULL,NULL,'2026-07-28','recovery-beta','trace-recovery-beta'
      );
      SELECT count(*) INTO v_count FROM pricing.price_tax_snapshots;
      INSERT INTO recovery_results VALUES('runtime_tenant_isolation','0 rows',concat(v_count,' rows'),v_count=0,'Beta tenant cannot see Alpha snapshot');
    END
    $checks$;

    RESET ROLE;
    SELECT json_agg(json_build_object(
      'check',check_name,'expected',expected_state,'observed',observed_state,
      'passed',passed,'detail',detail
    ) ORDER BY check_name)
    FROM recovery_results;
  `);

  const checks = JSON.parse(result.split(/\r?\n/).filter(Boolean).at(-1));
  let appendOnlyTrigger;
  try {
    await run("psql", [
      "-h", socket, "-p", port, "-d", database, "-X", "-q",
      "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose",
      "-c", "UPDATE pricing.price_tax_snapshots SET gross_minor=gross_minor WHERE id='018fd000-0000-7000-8000-000000000030'",
    ]);
    appendOnlyTrigger = { check: "append_only_trigger", expected: "55000", observed: "none", passed: false, detail: "Owner mutation unexpectedly succeeded" };
  } catch (error) {
    const detail = error instanceof Error && "stderr" in error ? String(error.stderr) : String(error);
    const observed = /55000/.test(detail) ? "55000" : "unknown";
    appendOnlyTrigger = { check: "append_only_trigger", expected: "55000", observed, passed: observed === "55000", detail: detail.trim().split(/\r?\n/)[0] ?? "Append-only trigger rejected mutation" };
  }
  checks.push(appendOnlyTrigger);
  checks.sort((left, right) => left.check.localeCompare(right.check));
  const report = {
    schemaVersion: 1,
    status: checks.every((check) => check.passed) ? "passed" : "failed",
    generatedAt: new Date().toISOString(),
    evidenceClass: "fresh-local-postgresql-recovery",
    database,
    checks,
  };
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "recovery-evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
  const rows = checks.map((check) => `| ${check.check} | ${check.expected} | ${check.observed} | ${check.passed ? "Pass" : "Fail"} | ${check.detail} |`).join("\n");
  const markdown = `# MOD-A Local Recovery Evidence\n\n**Generated:** ${report.generatedAt}\n**Status:** ${report.status}\n\nA disposable fresh PostgreSQL database exercised controlled failure and replay paths under \`store_app_runtime\`. The database was removed after capture.\n\n| Check | Expected | Observed | Result | Detail |\n|---|---|---|---|---|\n${rows}\n\nMachine-readable results are in [recovery-evidence.json](recovery-evidence.json).\n`;
  await writeFile(path.join(outputDir, "recovery-evidence.md"), markdown);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "passed") process.exitCode = 1;
} finally {
  await run("dropdb", ["-h", socket, "-p", port, "--if-exists", database]).catch(() => undefined);
}
