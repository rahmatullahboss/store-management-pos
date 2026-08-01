import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ADMIN_ROLE_MATRIX_ROUTES,
  CROSS_ROLE_P0_JOURNEYS,
  E2E_PERSONAS,
} from "../../tooling/fixtures/main-web-role-matrix.mjs";

const expectedPersonas = [
  "business-owner",
  "managing-director-cfo",
  "store-manager",
  "cashier",
  "inventory-manager",
  "purchaser",
  "accountant",
  "sales-representative",
  "warehouse-operator",
  "platform-administrator",
  "integration-developer",
];

test("role E2E matrix covers every PRD persona and every connected Admin route", () => {
  assert.deepEqual(E2E_PERSONAS.map((persona) => persona.id), expectedPersonas);
  assert.equal(ADMIN_ROLE_MATRIX_ROUTES.length, 24);
  assert.equal(new Set(ADMIN_ROLE_MATRIX_ROUTES.map((route) => route.id)).size, 24);
  assert.equal(new Set(ADMIN_ROLE_MATRIX_ROUTES.map((route) => route.pattern)).size, 24);
});

test("every Admin permission receives positive and negative role coverage", () => {
  for (const route of ADMIN_ROLE_MATRIX_ROUTES) {
    const allowed = E2E_PERSONAS.filter((persona) => persona.permissions.includes(route.permission));
    const denied = E2E_PERSONAS.filter((persona) => !persona.permissions.includes(route.permission));
    assert.ok(allowed.length > 0, `${route.permission} has no allow persona`);
    assert.ok(denied.length > 0, `${route.permission} has no deny persona`);
  }
});

test("cross-role P0 journey definitions reference only declared personas", () => {
  const ids = new Set(E2E_PERSONAS.map((persona) => persona.id));
  assert.ok(CROSS_ROLE_P0_JOURNEYS.length >= 8);
  for (const journey of CROSS_ROLE_P0_JOURNEYS) {
    assert.ok(journey.personas.length > 0, `${journey.id} must have at least one persona`);
    for (const persona of journey.personas) assert.ok(ids.has(persona), `${journey.id} references unknown persona ${persona}`);
  }
});

test("operational Admin worker enforces permission before route rendering", async () => {
  const source = await readFile(new URL("../../apps/api/src/staging-operational-worker.ts", import.meta.url), "utf8");
  assert.match(source, /requiredPermissionForStagingAdminPath/u);
  assert.match(source, /data-permission-denied/u);
  assert.match(source, /status = 403/u);
  assert.match(source, /renderOperationalAdminHtml/u);
});
