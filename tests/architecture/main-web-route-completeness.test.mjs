import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function source(pathname) {
  return await readFile(new URL(pathname, root), "utf8");
}

function routePaths(value) {
  return [...value.matchAll(/\bpath:\s*"([^"]+)"/gu)].map((match) => match[1]);
}

const primaryRoutes = new Set([
  "/catalog",
  "/inventory",
  "/procurement",
  "/customers",
  "/sales",
]);

test("every permission-visible Admin route has an explicit connected renderer", async () => {
  const [catalog, pricing, shell, localization, reporting, connected] = await Promise.all([
    source("apps/admin-web/src/modules/catalog/routes.ts"),
    source("apps/admin-web/src/modules/pricing/routes.ts"),
    source("apps/admin-web/src/app-shell/index.ts"),
    source("apps/admin-web/src/modules/localization/routes.ts"),
    source("apps/admin-web/src/modules/reporting/routes.ts"),
    source("apps/api/src/staging-connected-admin-pages.ts"),
  ]);

  const registered = new Set([
    ...routePaths(catalog),
    ...routePaths(pricing),
    ...routePaths(shell),
    ...routePaths(localization),
    ...routePaths(reporting),
  ]);

  assert.equal(registered.size, 24);
  for (const path of registered) {
    assert.ok(
      primaryRoutes.has(path) || connected.includes(`"${path}"`),
      `registered Admin route ${path} has no connected main-web renderer`,
    );
  }
});

test("main-web completion remains fail closed instead of serving success placeholders", async () => {
  const [worker, connected] = await Promise.all([
    source("apps/api/src/staging-operational-worker.ts"),
    source("apps/api/src/staging-connected-admin-pages.ts"),
  ]);

  assert.match(worker, /renderConnectedAdminPage/u);
  assert.match(worker, /renderAdminNotFoundPage/u);
  assert.match(worker, /status = 404/u);
  assert.match(worker, /normalizeAdminLandmarks/u);
  assert.doesNotMatch(worker, /function genericPage/u);
  assert.doesNotMatch(worker, /connected-next/u);
  assert.match(connected, /No command was executed/u);
  assert.match(connected, /escapeHtml\(localPath\)/u);
});

test("connected main-web models preserve production command and compliance boundaries", async () => {
  const connected = await source("apps/api/src/staging-connected-admin-pages.ts");
  assert.match(connected, /Production finance commands/u);
  assert.match(connected, /Disabled in persistent staging/u);
  assert.match(connected, /supportLevel:\s*"limited"/u);
  assert.match(connected, /Local legal, tax and accounting validation is not yet approved/u);
  assert.match(connected, /Production fiscal and electronic-invoice providers are not connected/u);
  assert.match(connected, /No production bank account connected/u);
  assert.doesNotMatch(connected, /production[_ -]?ready/iu);
});
