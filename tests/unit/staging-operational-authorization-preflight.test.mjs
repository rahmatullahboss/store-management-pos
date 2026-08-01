import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import stagingEntry from "../../build/apps/api/src/staging-entry.js";

const baseContext = {
  sessionId: "018f0000-0000-7000-8000-000000009002",
  expiresAt: "2030-01-01T00:00:00.000Z",
  user: {
    id: "018f0000-0000-7000-8000-000000009001",
    name: "Preflight User",
    email: "preflight.user@example.com",
  },
  tenant: {
    id: "018f0000-0000-7000-8000-000000000002",
    name: "Synthetic Beta Retail",
  },
  membershipId: "018f0000-0000-7000-8000-000000009003",
  role: "preflight-role",
  scope: {
    legalEntityId: "018f0000-0000-7000-8000-000000000202",
    storeId: "018f0000-0000-7000-8000-000000000302",
    warehouseId: "018f0000-0000-7000-8000-000000000402",
    registerId: "018f0000-0000-7000-8000-000000000502",
  },
  permissions: ["catalog.product.read"],
};

function environment(context = baseContext) {
  return {
    DATABASE_URL: "postgresql://must-not-be-used.invalid/neondb",
    APP_ENV: "staging-test",
    REGION: "test",
    STAGING_GIT_SHA: "0123456789abcdef",
    STAGING_AUTH_REQUIRED: "1",
    STAGING_READ_CONTEXT_RESOLVER: async () => context,
  };
}

function authenticatedRequest(pathname) {
  return new Request(`https://staging.example.test${pathname}`, {
    headers: { Cookie: `ozzyl_staging_session=${"a".repeat(43)}` },
  });
}

test("unauthorized Admin route returns 403 before any operational database load", async () => {
  const response = await stagingEntry.fetch(
    authenticatedRequest("/admin/finance/accounting"),
    environment(),
  );
  const html = await response.text();
  assert.equal(response.status, 403);
  assert.match(html, /data-permission-denied/u);
  assert.match(html, /business data for this route was loaded or rendered/u);
  assert.doesNotMatch(html, /Accounting control/u);
});

test("POS requires pos.checkout.read before any operational database load", async () => {
  const response = await stagingEntry.fetch(
    authenticatedRequest("/pos"),
    environment(),
  );
  const html = await response.text();
  assert.equal(response.status, 403);
  assert.match(html, /data-permission-denied/u);
  assert.match(html, /pos\.checkout\.read/u);
  assert.match(html, /POS business data was not loaded or rendered/u);
  assert.doesNotMatch(html, /Demo Linen Shirt/u);
});

test("source keeps route and POS authorization ahead of release-candidate data loading", async () => {
  const source = await readFile(
    new URL("../../apps/api/src/staging-operational-worker.ts", import.meta.url),
    "utf8",
  );
  const contextIndex = source.lastIndexOf("const context = await resolveStagingReadContext");
  const adminAuthorizationIndex = source.lastIndexOf("if (requiredPermission && !context.permissions.includes(requiredPermission))");
  const posAuthorizationIndex = source.lastIndexOf("if (pos && !context.permissions.includes(STAGING_POS_PERMISSION))");
  const dataLoadIndex = source.lastIndexOf("const data = await loadReleaseCandidateOperationalData");
  assert.ok(contextIndex >= 0);
  assert.ok(adminAuthorizationIndex > contextIndex);
  assert.ok(posAuthorizationIndex > adminAuthorizationIndex);
  assert.ok(dataLoadIndex > posAuthorizationIndex);
});
