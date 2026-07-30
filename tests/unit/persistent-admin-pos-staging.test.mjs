import assert from "node:assert/strict";
import test from "node:test";
import stagingWorker from "../../build/apps/api/src/staging.js";

const environment = {
  DATABASE_URL: "postgresql://unused.invalid/neondb",
  APP_ENV: "staging-test",
  REGION: "test",
  STAGING_GIT_SHA: "0123456789abcdef",
};

async function request(path, init) {
  return await stagingWorker.fetch(
    new Request(`https://staging.example.test${path}`, init),
    environment,
  );
}

test("persistent staging redirects the root to Admin", async () => {
  const response = await request("/");
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://staging.example.test/admin");
});

test("persistent staging renders the current Admin shell and real fixture pages", async () => {
  for (const [path, marker] of [
    ["/admin", "Store Management Admin"],
    ["/admin/inventory", "Inventory"],
    ["/admin/procurement", "Procurement"],
    ["/admin/catalog", "Catalog"],
  ]) {
    const response = await request(path);
    const html = await response.text();
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/u);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    assert.match(html, new RegExp(marker, "u"), path);
    assert.match(html, /Persistent staging/u, path);
    assert.match(html, /href="\/admin\/inventory"/u, path);
    assert.doesNotMatch(html, /postgresql:\/\//u, path);
  }
});

test("persistent staging renders a read-only POS register with exact demo totals", async () => {
  const response = await request("/pos");
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Persistent staging · synthetic POS/u);
  assert.match(html, /Demo Linen Shirt/u);
  assert.match(html, /Complete checkout/u);
  assert.match(html, /authoritative checkout disabled/u);
  assert.match(html, /disabled/u);
});

test("persistent staging delegates API health without requiring authentication", async () => {
  const response = await request("/api/health");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "healthy");
  assert.equal(body.service, "api");
  assert.equal(body.databaseMode, "direct-neon");
});

test("persistent staging exposes a bounded status document", async () => {
  const response = await request("/staging/status");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "healthy",
    service: "persistent-admin-pos-staging",
    version: "0123456789ab",
    database: "dedicated-neon-staging",
    browserMode: "synthetic-read-only",
  });
});

test("persistent staging preserves HEAD and fail-closed method and route behavior", async () => {
  const head = await request("/pos", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const method = await request("/admin", { method: "POST" });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "GET, HEAD");

  const missing = await request("/not-found");
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /Staging route not found/u);
});
