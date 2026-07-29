import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Client } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for the MOD-A Neon benchmark");

const expectedBranchId = "br-fancy-bird-axo3z9ek";
if (process.env.MOD_A_NEON_BRANCH_ID !== expectedBranchId) {
  throw new Error(`MOD_A_NEON_BRANCH_ID must explicitly confirm ${expectedBranchId}`);
}

const variantCount = 250_000;
const iterations = Number(process.env.MOD_A_BENCHMARK_ITERATIONS ?? 30);
if (!Number.isInteger(iterations) || iterations < 10 || iterations > 100) throw new Error("MOD_A_BENCHMARK_ITERATIONS must be from 10 to 100");

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(root, "docs", "architecture", "mod-a");
const jsonPath = path.join(outputDir, "performance-report.json");
const markdownPath = path.join(outputDir, "performance-report.md");
const tenantId = "018f0000-0000-7000-8000-000000000001";
const otherTenantId = "018f0000-0000-7000-8000-000000000002";

const budgets = Object.freeze({
  importMaxMs: 120_000,
  exactSkuP95Ms: 100,
  exactBarcodeP95Ms: 100,
  fullTextP95Ms: 250,
  combinedSearchP95Ms: 300,
});

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function summary(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    minMs: Number(Math.min(...values).toFixed(3)),
    meanMs: Number((total / values.length).toFixed(3)),
    p50Ms: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    p99Ms: Number(percentile(values, 0.99).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
  };
}

async function timedQuery(client, text, values) {
  const startedAt = performance.now();
  const result = await client.query(text, values);
  return { elapsedMs: performance.now() - startedAt, rowCount: result.rowCount ?? result.rows.length };
}

async function measureQuery(client, text, values) {
  for (let index = 0; index < 5; index += 1) await client.query(text, values);
  const durations = [];
  let rowCount = 0;
  for (let index = 0; index < iterations; index += 1) {
    const measured = await timedQuery(client, text, values);
    durations.push(measured.elapsedMs);
    rowCount = measured.rowCount;
  }
  const planResult = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${text}`, values);
  return { latency: summary(durations), rowCount, plan: planResult.rows[0]?.["QUERY PLAN"]?.[0] ?? null };
}

const client = new Client({ connectionString });
await client.connect();
let report;
try {
  await client.query("DROP SCHEMA IF EXISTS mod_a_benchmark CASCADE");
  await client.query("CREATE SCHEMA mod_a_benchmark");
  await client.query(`
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
    )
  `);
  await client.query("CREATE UNIQUE INDEX benchmark_sku_idx ON mod_a_benchmark.variant_search_documents(tenant_id, normalized_sku)");
  await client.query("CREATE INDEX benchmark_product_code_idx ON mod_a_benchmark.variant_search_documents(tenant_id, product_code)");
  await client.query("CREATE INDEX benchmark_barcode_array_idx ON mod_a_benchmark.variant_search_documents USING gin(barcodes)");
  await client.query("CREATE INDEX benchmark_search_vector_idx ON mod_a_benchmark.variant_search_documents USING gin(search_vector)");
  await client.query("CREATE INDEX benchmark_trgm_idx ON mod_a_benchmark.variant_search_documents USING gin(searchable_text public.gin_trgm_ops)");
  await client.query(`
    CREATE UNLOGGED TABLE mod_a_benchmark.variant_barcodes (
      tenant_id uuid NOT NULL,
      variant_id uuid NOT NULL,
      normalized_value text NOT NULL,
      PRIMARY KEY (tenant_id, normalized_value)
    )
  `);
  await client.query("CREATE INDEX benchmark_barcode_variant_idx ON mod_a_benchmark.variant_barcodes(tenant_id, variant_id)");
  await client.query(`
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
    $function$
  `);

  const importStartedAt = performance.now();
  await client.query(`
    INSERT INTO mod_a_benchmark.variant_search_documents(
      tenant_id, variant_id, normalized_sku, product_code, barcodes, searchable_text, status, updated_at
    )
    SELECT
      $1::uuid,
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
    FROM generate_series(1, $2::integer) AS series
  `, [tenantId, variantCount]);
  await client.query(`
    INSERT INTO mod_a_benchmark.variant_barcodes(tenant_id,variant_id,normalized_value)
    SELECT tenant_id,variant_id,barcodes[1]
    FROM mod_a_benchmark.variant_search_documents
  `);
  const importMs = performance.now() - importStartedAt;
  await client.query("ANALYZE mod_a_benchmark.variant_search_documents");
  await client.query("ANALYZE mod_a_benchmark.variant_barcodes");

  const countResult = await client.query("SELECT count(*)::integer AS count FROM mod_a_benchmark.variant_search_documents WHERE tenant_id=$1", [tenantId]);
  const barcodeCountResult = await client.query("SELECT count(*)::integer AS count FROM mod_a_benchmark.variant_barcodes WHERE tenant_id=$1", [tenantId]);
  const otherTenantResult = await client.query("SELECT count(*)::integer AS count FROM mod_a_benchmark.variant_search_documents WHERE tenant_id=$1", [otherTenantId]);

  const exactSku = await measureQuery(client,
    "SELECT variant_id, normalized_sku FROM mod_a_benchmark.variant_search_documents WHERE tenant_id=$1 AND normalized_sku=$2 LIMIT 20",
    [tenantId, "SKU-249999"],
  );
  const exactBarcode = await measureQuery(client,
    "SELECT d.variant_id, d.normalized_sku FROM mod_a_benchmark.variant_barcodes barcode JOIN mod_a_benchmark.variant_search_documents d ON d.tenant_id=barcode.tenant_id AND d.variant_id=barcode.variant_id WHERE barcode.tenant_id=$1 AND barcode.normalized_value=$2 LIMIT 20",
    [tenantId, "BAR-000000249999"],
  );
  const fullText = await measureQuery(client,
    "SELECT variant_id, normalized_sku FROM mod_a_benchmark.variant_search_documents WHERE tenant_id=$1 AND search_vector @@ plainto_tsquery('simple'::regconfig,$2) ORDER BY updated_at DESC LIMIT 20",
    [tenantId, "representative product 249999"],
  );
  const combinedSearch = await measureQuery(client,
    "SELECT * FROM mod_a_benchmark.search_variants($1,$2,20)",
    [tenantId, "SKU-249999"],
  );

  const server = await client.query(`
    SELECT current_database() AS database_name,
           current_user AS database_user,
           current_setting('server_version') AS server_version,
           now()::text AS observed_at
  `);

  const checks = {
    representativeVariantCount: countResult.rows[0]?.count === variantCount,
    representativeBarcodeCount: barcodeCountResult.rows[0]?.count === variantCount,
    tenantIsolation: otherTenantResult.rows[0]?.count === 0,
    importWithinBudget: importMs <= budgets.importMaxMs,
    exactSkuWithinBudget: exactSku.latency.p95Ms <= budgets.exactSkuP95Ms,
    exactBarcodeWithinBudget: exactBarcode.latency.p95Ms <= budgets.exactBarcodeP95Ms,
    fullTextWithinBudget: fullText.latency.p95Ms <= budgets.fullTextP95Ms,
    combinedSearchWithinBudget: combinedSearch.latency.p95Ms <= budgets.combinedSearchP95Ms,
  };

  report = {
    schemaVersion: 1,
    status: Object.values(checks).every(Boolean) ? "passed" : "failed",
    evidenceClass: "isolated-neon-branch-staged-resolver",
    generatedAt: new Date().toISOString(),
    neonProjectId: "twilight-boat-26805962",
    neonBranchId: expectedBranchId,
    fixture: { kind: "disposable-unlogged-postgresql-tables", variantCount, tenantId, otherTenantId },
    budgets,
    import: {
      rows: variantCount,
      barcodeRows: variantCount,
      elapsedMs: Number(importMs.toFixed(2)),
      rowsPerSecond: Number((variantCount / (importMs / 1000)).toFixed(2)),
    },
    queries: { exactSku, exactBarcode, fullText, combinedSearch },
    checks,
    server: server.rows[0],
  };
} finally {
  await client.query("DROP SCHEMA IF EXISTS mod_a_benchmark CASCADE").catch(() => undefined);
  await client.end();
}

await mkdir(outputDir, { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
const queryRows = Object.entries(report.queries).map(([name, result]) => `| ${name} | ${result.rowCount} | ${result.latency.p50Ms} | ${result.latency.p95Ms} | ${result.latency.p99Ms} | ${result.latency.maxMs} |`).join("\n");
const checkRows = Object.entries(report.checks).map(([name, passed]) => `| ${name} | ${passed ? "Pass" : "Fail"} |`).join("\n");
const markdown = `# MOD-A 250,000-Variant Neon Performance Report\n\n**Generated:** ${report.generatedAt}\n**Status:** ${report.status}\n**Evidence class:** ${report.evidenceClass}\n**Neon project:** \`${report.neonProjectId}\`\n**Neon branch:** \`${report.neonBranchId}\`\n\nThe benchmark uses disposable unlogged PostgreSQL tables and the CAT-0002 staged resolver shape: exact barcode, exact SKU and exact product code are attempted before full-text and guarded fallback search. The fixture is dropped after evidence capture. No production data or default branch is changed.\n\n## Import\n\n- Representative variants: ${report.import.rows.toLocaleString('en-US')}\n- Representative barcode rows: ${report.import.barcodeRows.toLocaleString('en-US')}\n- Elapsed: ${report.import.elapsedMs} ms\n- Throughput: ${report.import.rowsPerSecond} variant rows/second\n- Budget: ${report.budgets.importMaxMs} ms\n\n## Search latency\n\n| Query | Rows returned | p50 ms | p95 ms | p99 ms | max ms |\n|---|---:|---:|---:|---:|---:|\n${queryRows}\n\n## Gate checks\n\n| Check | Result |\n|---|---|\n${checkRows}\n\nExecution plans and machine-readable latency distributions are retained in [performance-report.json](performance-report.json).\n`;
await writeFile(markdownPath, markdown);
console.log(JSON.stringify({ status: report.status, import: report.import, queries: Object.fromEntries(Object.entries(report.queries).map(([name, value]) => [name, value.latency])), checks: report.checks }, null, 2));
if (report.status !== "passed") process.exit(1);
