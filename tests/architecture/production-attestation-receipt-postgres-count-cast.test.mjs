import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const compatibilityMigrationUrl = new URL(
  "../../database/foundation/migrations/FND-0022-internal-token-production-attestation-receipt-count-cast-fix.sql",
  import.meta.url,
);
const hardeningMigrationUrl = new URL(
  "../../database/foundation/migrations/FND-0020-internal-token-production-attestation-receipt-append-hardening.sql",
  import.meta.url,
);

test("FND-0022 resolves the receipt-count literal through a restricted integer overload", async () => {
  const [compatibilitySql, hardeningSql] = await Promise.all([
    readFile(compatibilityMigrationUrl, "utf8"),
    readFile(hardeningMigrationUrl, "utf8"),
  ]);

  assert.match(
    hardeningSql,
    /internal_token_production_attestation_entry_digest\([\s\S]*\n\s+13,\n\s+v_recorded_at_epoch_ms/u,
  );
  assert.match(
    compatibilitySql,
    /CREATE OR REPLACE FUNCTION platform\.internal_token_production_attestation_entry_digest\([\s\S]*p_receipt_count integer/u,
  );
  assert.match(
    compatibilitySql,
    /platform\.internal_token_production_attestation_entry_digest\([\s\S]*p_receipt_count::smallint/u,
  );
  assert.match(compatibilitySql, /LANGUAGE sql/u);
  assert.match(compatibilitySql, /IMMUTABLE/u);
  assert.match(compatibilitySql, /STRICT/u);
  assert.match(compatibilitySql, /SET search_path = pg_catalog, platform/u);
  assert.match(
    compatibilitySql,
    /REVOKE ALL ON FUNCTION platform\.internal_token_production_attestation_entry_digest\([\s\S]*integer[\s\S]*\) FROM PUBLIC/u,
  );
  assert.doesNotMatch(compatibilitySql, /SECURITY DEFINER/u);
  assert.doesNotMatch(
    compatibilitySql,
    /GRANT EXECUTE[\s\S]*store_key_governance_runtime/u,
  );
  assert.match(compatibilitySql, /'FND-0022'/u);
});

test("foundation manifest preserves the exact FND-0022 compatibility migration", async () => {
  const migration = await readFile(compatibilityMigrationUrl);
  const checksum = createHash("sha256").update(migration).digest("hex");
  const manifest = JSON.parse(
    await readFile(
      new URL("../../database/foundation/manifest.json", import.meta.url),
      "utf8",
    ),
  );

  assert.deepEqual(manifest.migrations.find((entry) => entry.id === "FND-0022"), {
    id: "FND-0022",
    file: "FND-0022-internal-token-production-attestation-receipt-count-cast-fix.sql",
    sha256: checksum,
  });
  assert.equal(
    checksum,
    "be7401fb8f3aa0164aea432cf81902f7abbf01f64dfc2cffa68af415cf976064",
  );
});
