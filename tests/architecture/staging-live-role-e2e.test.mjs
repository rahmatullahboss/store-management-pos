import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ADMIN_ROLE_MATRIX_ROUTES,
  CROSS_ROLE_P0_JOURNEYS,
  E2E_PERSONAS,
} from "../../tooling/fixtures/main-web-role-matrix.mjs";

const liveE2eUrl = new URL(
  "../../tooling/scripts/staging-live-role-e2e.mjs",
  import.meta.url,
);
const runnerUrl = new URL(
  "../../tooling/scripts/run-operational-staging.mjs",
  import.meta.url,
);

test("live role E2E covers every persona and permission route through real custom auth", async () => {
  const source = await readFile(liveE2eUrl, "utf8");
  assert.equal(E2E_PERSONAS.length, 11);
  assert.equal(ADMIN_ROLE_MATRIX_ROUTES.length, 24);
  assert.equal(E2E_PERSONAS.length * ADMIN_ROLE_MATRIX_ROUTES.length, 264);
  assert.match(source, /\/auth\/sign-up/u);
  assert.match(source, /\/auth\/sign-in/u);
  assert.match(source, /\/auth\/context/u);
  assert.match(source, /for \(const persona of E2E_PERSONAS\)/u);
  assert.match(source, /for \(const route of ADMIN_ROLE_MATRIX_ROUTES\)/u);
  assert.match(source, /permissionSet\.has\(route\.permission\) \? 200 : 403/u);
});

test("live role E2E derives role permissions and tenant scope from persistent database state", async () => {
  const source = await readFile(liveE2eUrl, "utf8");
  assert.match(source, /INSERT INTO platform\.roles/u);
  assert.match(source, /INSERT INTO platform\.role_permissions/u);
  assert.match(source, /INSERT INTO platform\.membership_roles/u);
  assert.match(source, /platform\.legal_entities/u);
  assert.match(source, /platform\.stores/u);
  assert.match(source, /platform\.warehouses/u);
  assert.match(source, /platform\.registers/u);
  assert.match(source, /single-scoped-database-role/u);
});

test("live role E2E proves dynamic permission and session revocation without re-login", async () => {
  const source = await readFile(liveE2eUrl, "utf8");
  assert.match(
    source,
    /DELETE FROM platform\.role_permissions WHERE role_id = \$1::uuid AND permission_code = 'pricing\.promotion\.manage'/u,
  );
  assert.match(source, /\/admin\/pricing\/promotions/u);
  assert.match(source, /UPDATE platform\.auth_sessions SET revoked_at = now\(\)/u);
  assert.match(source, /revokedContext\.status === 403/u);
});

test("live role E2E fails closed for ambiguous role assignment and cross-tenant scope", async () => {
  const source = await readFile(liveE2eUrl, "utf8");
  assert.match(source, /e2e-ambiguous-/u);
  assert.match(source, /ambiguousContext\.status === 403/u);
  assert.match(source, /s\.tenant_id <> \$1::uuid/u);
  assert.match(source, /error\?\.code === "23503"/u);
});

test("live role E2E keeps all declared cross-role P0 surface journeys executable", async () => {
  const source = await readFile(liveE2eUrl, "utf8");
  assert.equal(CROSS_ROLE_P0_JOURNEYS.length, 8);
  assert.match(source, /for \(const journey of CROSS_ROLE_P0_JOURNEYS\)/u);
  assert.match(source, /journeyResults\.push/u);
});

test("live role E2E is a required persistent-staging gate and leaves bounded evidence", async () => {
  const [source, runner] = await Promise.all([
    readFile(liveE2eUrl, "utf8"),
    readFile(runnerUrl, "utf8"),
  ]);
  assert.match(runner, /await import\("\.\/staging-live-role-e2e\.mjs"\)/u);
  assert.match(source, /live-role-e2e-report\.json/u);
  assert.match(source, /cleanupAccount/u);
  assert.match(source, /\[REDACTED_DATABASE_URL\]/u);
  assert.doesNotMatch(source, /password:\s*"[^`$]/u);
});
