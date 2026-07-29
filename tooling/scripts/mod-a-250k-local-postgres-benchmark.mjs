import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(root, "docs", "architecture", "mod-a");
const jsonPath = path.join(outputDir, "performance-report-local-postgresql.json");
const markdownPath = path.join(outputDir, "performance-report-local-postgresql.md");
const socket = process.env.MOD_A_PG_SOCKET ?? "/tmp/store-pos-mod-a-socket";
const port = process.env.MOD_A_PG_PORT ?? "55439";
const database = process.env.MOD_A_PG_DATABASE ?? "postgres";
const variantCount = 250_000;
const tenantId = "018f0000-0000-7000-8000-000000000001";
const otherTenantId = "018f0000-0000-7000-8000-000000000002";

const budgets = Object.freeze({
  importMaxMs: 120_000,
  exactSkuP95Ms: 25,
  exactBarcodeP95Ms: 25,
  fullTextP95Ms: 100,
  combinedSearchP95Ms: 200,
});

async function psql(sql) {
  const { stdout } = await execFileAsync(
    "psql",
    ["-h", socket, "-p", port, "-d", database, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      cwd: root,
      maxBuffer: 24 * 1024 * 1024,
      env: { ...process.env, LC_ALL: "C" },
    },
  );
  return stdout.trim();
}

function parseJson(value) {
  if (!value) throw new Error("PostgreSQL returned an empty JSON result");
  return JSON.parse(value);
}

await psql("CREATE EXTENSION IF NOT EXISTS pg_trgm");
await psql("DROP SCHEMA IF EXISTS mod_a_benchmark CASCADE; CREATE SCHEMA mod_a_benchmark");

let report;
try {
  await psql(`
    CREATE UNLOGGED TABLE mod_a_benchmark.variant_search_documents (
      tenant_id uuid NOT NULL,
      variant_id uuid NOT NULL,
      normalized_sku text NOT NULL,
      product_code text NOT NULL,
      barcodes text[] NOT NULL DEFAULT '{}',
      searchable_text text NOT NULL,
      search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, searchable_text)) STORED,
      status text NOT NULL DEFAULT 'active',
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, variant_id)
    );
    CREATE UNIQUE INDEX benchmark_sku_idx
      ON mod_a_benchmark.variant_search_documents(tenant_id, normalized_sku);
    CREATE INDEX benchmark_product_code_idx
      ON mod_a_benchmark.variant_search_documents(tenant_id, product_code);
    CREATE INDEX benchmark_barcode_array_idx
      ON mod_a_benchmark.variant_search_documents USING gin(barcodes);
    CREATE INDEX benchmark_search_vector_idx
      ON mod_a_benchmark.variant_search_documents USING gin(search_vector);
    CREATE INDEX benchmark_trgm_idx
      ON mod_a_benchmark.variant_search_documents USING gin(searchable_text public.gin_trgm_ops);

    CREATE UNLOGGED TABLE mod_a_benchmark.variant_barcodes (
      tenant_id uuid NOT NULL,
      variant_id uuid NOT NULL,
      normalized_value text NOT NULL,
      PRIMARY KEY (tenant_id, normalized_value)
    );
    CREATE INDEX benchmark_barcode_variant_idx
      ON mod_a_benchmark.variant_barcodes(tenant_id, variant_id);

    CREATE UNLOGGED TABLE mod_a_benchmark.timings (
      query_name text NOT NULL,
      elapsed_ms double precision NOT NULL,
      rows_returned integer NOT NULL
    );

    CREATE OR REPLACE FUNCTION mod_a_benchmark.search_variants(
      p_tenant_id uuid,
      p_query text,
      p_limit integer DEFAULT 20
    ) RETURNS TABLE(result_variant_id uuid, result_sku text)
    LANGUAGE plpgsql STABLE SET search_path=pg_catalog,mod_a_benchmark,public AS $function$
    #variable_conflict use_column
    DECLARE
      v_query text := upper(btrim(COALESCE(p_query,'')));
      v_limit integer := LEAST(GREATEST(p_limit,1),500);
      v_rows integer;
      v_pattern text;
    BEGIN
      RETURN QUERY
      WITH exact_matches AS (
        SELECT d.variant_id,d.normalized_sku,0 AS match_rank
        FROM mod_a_benchmark.variant_barcodes barcode
        JOIN mod_a_benchmark.variant_search_documents d
          ON d.tenant_id=barcode.tenant_id AND d.variant_id=barcode.variant_id
        WHERE barcode.tenant_id=p_tenant_id AND barcode.normalized_value=v_query
        UNION ALL
        SELECT d.variant_id,d.normalized_sku,1 AS match_rank
        FROM mod_a_benchmark.variant_search_documents d
        WHERE d.tenant_id=p_tenant_id AND d.normalized_sku=v_query
        UNION ALL
        SELECT d.variant_id,d.normalized_sku,2 AS match_rank
        FROM mod_a_benchmark.variant_search_documents d
        WHERE d.tenant_id=p_tenant_id AND d.product_code=v_query
      ), ranked AS (
        SELECT exact_matches.*,
          row_number() OVER (PARTITION BY exact_matches.variant_id ORDER BY exact_matches.match_rank,exact_matches.normalized_sku) AS duplicate_rank
        FROM exact_matches
      )
      SELECT ranked.variant_id,ranked.normalized_sku
      FROM ranked
      WHERE ranked.duplicate_rank=1
      ORDER BY ranked.match_rank,ranked.normalized_sku
      LIMIT v_limit;

      GET DIAGNOSTICS v_rows=ROW_COUNT;
      IF v_rows>0 THEN RETURN; END IF;

      RETURN QUERY
      SELECT d.variant_id,d.normalized_sku
      FROM mod_a_benchmark.variant_search_documents d
      WHERE d.tenant_id=p_tenant_id
        AND d.search_vector @@ plainto_tsquery('simple'::regconfig,p_query)
      ORDER BY ts_rank_cd(d.search_vector,plainto_tsquery('simple'::regconfig,p_query)) DESC,d.normalized_sku
      LIMIT v_limit;

      GET DIAGNOSTICS v_rows=ROW_COUNT;
      IF v_rows>0 THEN RETURN; END IF;
      IF char_length(btrim(p_query))<3 OR v_query ~ '^[A-Z0-9._/-]+$' THEN RETURN; END IF;

      v_pattern := '%' || btrim(p_query) || '%';
      RETURN QUERY
      SELECT d.variant_id,d.normalized_sku
      FROM mod_a_benchmark.variant_search_documents d
      WHERE d.tenant_id=p_tenant_id
        AND d.searchable_text ILIKE v_pattern
      ORDER BY d.normalized_sku
      LIMIT v_limit;
    END
    $function$;
  `);

  const importStartedAt = performance.now();
  await psql(`
    INSERT INTO mod_a_benchmark.variant_search_documents(
      tenant_id, variant_id, normalized_sku, product_code, barcodes,
      searchable_text, status, updated_at
    )
    SELECT
      '${tenantId}'::uuid,
      md5('mod-a-variant-' || series)::uuid,
      'SKU-' || lpad(series::text, 6, '0'),
      'PRODUCT-' || lpad(((series - 1) / 10 + 1)::text, 6, '0'),
      ARRAY['BAR-' || lpad(series::text, 12, '0')],
      concat_ws(' ',
        'Representative product', series,
        'variant', series,
        'colour', CASE series % 5 WHEN 0 THEN 'black' WHEN 1 THEN 'blue' WHEN 2 THEN 'green' WHEN 3 THEN 'red' ELSE 'white' END,
        'size', CASE series % 4 WHEN 0 THEN 'small' WHEN 1 THEN 'medium' WHEN 2 THEN 'large' ELSE 'extra-large' END,
        'SKU-' || lpad(series::text, 6, '0')
      ),
      CASE WHEN series % 97 = 0 THEN 'inactive' ELSE 'active' END,
      timestamp with time zone '2026-07-28 00:00:00+00' + make_interval(secs => series % 86400)
    FROM generate_series(1, ${variantCount}) AS series;

    INSERT INTO mod_a_benchmark.variant_barcodes(tenant_id,variant_id,normalized_value)
    SELECT tenant_id,variant_id,barcodes[1]
    FROM mod_a_benchmark.variant_search_documents;
  `);
  const importMs = performance.now() - importStartedAt;
  await psql("ANALYZE mod_a_benchmark.variant_search_documents; ANALYZE mod_a_benchmark.variant_barcodes");

  await psql(`
    DO $benchmark$
    DECLARE
      iteration integer;
      started_at timestamptz;
      returned integer;
    BEGIN
      FOR iteration IN 1..35 LOOP
        started_at := clock_timestamp();
        SELECT count(*) INTO returned FROM (
          SELECT variant_id
          FROM mod_a_benchmark.variant_search_documents
          WHERE tenant_id='${tenantId}'::uuid AND normalized_sku='SKU-249999'
          LIMIT 20
        ) result;
        IF iteration>5 THEN
          INSERT INTO mod_a_benchmark.timings VALUES ('exactSku',extract(epoch FROM clock_timestamp()-started_at)*1000,returned);
        END IF;

        started_at := clock_timestamp();
        SELECT count(*) INTO returned FROM (
          SELECT d.variant_id
          FROM mod_a_benchmark.variant_barcodes barcode
          JOIN mod_a_benchmark.variant_search_documents d
            ON d.tenant_id=barcode.tenant_id AND d.variant_id=barcode.variant_id
          WHERE barcode.tenant_id='${tenantId}'::uuid AND barcode.normalized_value='BAR-000000249999'
          LIMIT 20
        ) result;
        IF iteration>5 THEN
          INSERT INTO mod_a_benchmark.timings VALUES ('exactBarcode',extract(epoch FROM clock_timestamp()-started_at)*1000,returned);
        END IF;

        started_at := clock_timestamp();
        SELECT count(*) INTO returned FROM (
          SELECT variant_id
          FROM mod_a_benchmark.variant_search_documents
          WHERE tenant_id='${tenantId}'::uuid
            AND search_vector @@ plainto_tsquery('simple'::regconfig,'representative product 249999')
          ORDER BY updated_at DESC
          LIMIT 20
        ) result;
        IF iteration>5 THEN
          INSERT INTO mod_a_benchmark.timings VALUES ('fullText',extract(epoch FROM clock_timestamp()-started_at)*1000,returned);
        END IF;

        started_at := clock_timestamp();
        SELECT count(*) INTO returned
        FROM mod_a_benchmark.search_variants('${tenantId}'::uuid,'SKU-249999',20);
        IF iteration>5 THEN
          INSERT INTO mod_a_benchmark.timings VALUES ('combinedSearch',extract(epoch FROM clock_timestamp()-started_at)*1000,returned);
        END IF;
      END LOOP;
    END
    $benchmark$;
  `);

  const metrics = parseJson(await psql(`
    SELECT json_object_agg(query_name,metrics ORDER BY query_name)
    FROM (
      SELECT query_name,json_build_object(
        'count',count(*),
        'rowsReturned',max(rows_returned),
        'minMs',round(min(elapsed_ms)::numeric,3),
        'meanMs',round(avg(elapsed_ms)::numeric,3),
        'p50Ms',round(percentile_cont(0.50) WITHIN GROUP (ORDER BY elapsed_ms)::numeric,3),
        'p95Ms',round(percentile_cont(0.95) WITHIN GROUP (ORDER BY elapsed_ms)::numeric,3),
        'p99Ms',round(percentile_cont(0.99) WITHIN GROUP (ORDER BY elapsed_ms)::numeric,3),
        'maxMs',round(max(elapsed_ms)::numeric,3)
      ) AS metrics
      FROM mod_a_benchmark.timings
      GROUP BY query_name
    ) values_by_query;
  `));

  const counts = parseJson(await psql(`
    SELECT json_build_object(
      'representativeVariants',(SELECT count(*) FROM mod_a_benchmark.variant_search_documents WHERE tenant_id='${tenantId}'::uuid),
      'representativeBarcodes',(SELECT count(*) FROM mod_a_benchmark.variant_barcodes WHERE tenant_id='${tenantId}'::uuid),
      'otherTenantVariants',(SELECT count(*) FROM mod_a_benchmark.variant_search_documents WHERE tenant_id='${otherTenantId}'::uuid)
    );
  `));

  const plans = {
    exactSku: parseJson(await psql(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT variant_id FROM mod_a_benchmark.variant_search_documents WHERE tenant_id='${tenantId}'::uuid AND normalized_sku='SKU-249999' LIMIT 20`))[0],
    exactBarcode: parseJson(await psql(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT d.variant_id FROM mod_a_benchmark.variant_barcodes barcode JOIN mod_a_benchmark.variant_search_documents d ON d.tenant_id=barcode.tenant_id AND d.variant_id=barcode.variant_id WHERE barcode.tenant_id='${tenantId}'::uuid AND barcode.normalized_value='BAR-000000249999' LIMIT 20`))[0],
    fullText: parseJson(await psql(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT variant_id FROM mod_a_benchmark.variant_search_documents WHERE tenant_id='${tenantId}'::uuid AND search_vector @@ plainto_tsquery('simple'::regconfig,'representative product 249999') ORDER BY updated_at DESC LIMIT 20`))[0],
    combinedSearch: parseJson(await psql(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM mod_a_benchmark.search_variants('${tenantId}'::uuid,'SKU-249999',20)`))[0],
  };

  const server = parseJson(await psql("SELECT json_build_object('serverVersion',current_setting('server_version'),'databaseName',current_database(),'databaseUser',current_user,'observedAt',now())"));
  const checks = {
    representativeVariantCount: Number(counts.representativeVariants)===variantCount,
    representativeBarcodeCount: Number(counts.representativeBarcodes)===variantCount,
    tenantIsolation: Number(counts.otherTenantVariants)===0,
    importWithinBudget: importMs<=budgets.importMaxMs,
    exactSkuWithinBudget: Number(metrics.exactSku.p95Ms)<=budgets.exactSkuP95Ms,
    exactBarcodeWithinBudget: Number(metrics.exactBarcode.p95Ms)<=budgets.exactBarcodeP95Ms,
    fullTextWithinBudget: Number(metrics.fullText.p95Ms)<=budgets.fullTextP95Ms,
    combinedSearchWithinBudget: Number(metrics.combinedSearch.p95Ms)<=budgets.combinedSearchP95Ms,
  };

  report = {
    schemaVersion: 1,
    status: Object.values(checks).every(Boolean) ? "passed" : "failed",
    evidenceClass: "local-postgresql-shape-validation",
    generatedAt: new Date().toISOString(),
    fixture: { kind: "disposable-unlogged-postgresql-table", variantCount, tenantId, otherTenantId },
    budgets,
    import: {
      rows: variantCount,
      barcodeRows: variantCount,
      elapsedMs: Number(importMs.toFixed(2)),
      rowsPerSecond: Number((variantCount/(importMs/1000)).toFixed(2)),
    },
    queries: metrics,
    checks,
    plans,
    server,
    limitation: "This validates PostgreSQL 18.3 query shape and budgets locally. The required Neon branch rerun remains separate and must use br-fancy-bird-axo3z9ek.",
  };
} finally {
  await psql("DROP SCHEMA IF EXISTS mod_a_benchmark CASCADE").catch(() => undefined);
}

await mkdir(outputDir,{ recursive:true });
await writeFile(jsonPath,`${JSON.stringify(report,null,2)}\n`);
const queryRows = Object.entries(report.queries)
  .map(([name,value])=>`| ${name} | ${value.rowsReturned} | ${value.p50Ms} | ${value.p95Ms} | ${value.p99Ms} | ${value.maxMs} |`)
  .join("\n");
const checkRows = Object.entries(report.checks)
  .map(([name,passed])=>`| ${name} | ${passed ? "Pass" : "Fail"} |`)
  .join("\n");
const markdown = `# MOD-A 250,000-Variant Local PostgreSQL Report\n\n**Generated:** ${report.generatedAt}\n**Status:** ${report.status}\n**Evidence class:** ${report.evidenceClass}\n**PostgreSQL:** ${report.server.serverVersion}\n\nThis disposable benchmark validates the catalog projection's tenant, exact SKU, unique barcode, generated tsvector and staged search resolver shapes. It does not replace the required Neon branch rerun.\n\n## Import\n\n- Representative variants: ${report.import.rows.toLocaleString('en-GB')}\n- Representative barcode rows: ${report.import.barcodeRows.toLocaleString('en-GB')}\n- Elapsed: ${report.import.elapsedMs} ms\n- Throughput: ${report.import.rowsPerSecond} variant rows/second\n\n## Search latency\n\n| Query | Rows returned | p50 ms | p95 ms | p99 ms | max ms |\n|---|---:|---:|---:|---:|---:|\n${queryRows}\n\n## Gate checks\n\n| Check | Result |\n|---|---|\n${checkRows}\n\n## Limitation\n\n${report.limitation}\n\nMachine-readable metrics and execution plans are in [performance-report-local-postgresql.json](performance-report-local-postgresql.json).\n`;
await writeFile(markdownPath,markdown);
console.log(JSON.stringify({ status:report.status,import:report.import,queries:report.queries,checks:report.checks,limitation:report.limitation },null,2));
if (report.status!=="passed") process.exit(1);
