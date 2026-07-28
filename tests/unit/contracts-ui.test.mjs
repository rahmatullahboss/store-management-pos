import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseDomainEventEnvelopeV1 } from "../../build/packages/contracts/src/v1/validators.js";
import { permittedRoutes, renderAppShell } from "../../build/packages/ui/src/app-shell.js";
import { renderAdminFoundationPreview } from "../../build/apps/admin-web/src/app-shell/index.js";
import { renderPosFoundationPreview, renderPosShell } from "../../build/apps/pos-web/src/app-shell/index.js";

test("Contract parser rejects unknown schema versions", () => {
  assert.throws(() => parseDomainEventEnvelopeV1({ schemaVersion: "2.0" }));
  const event = parseDomainEventEnvelopeV1({ schemaVersion: "1.0", eventId: "event", eventType: "test.v1", aggregateType: "test", aggregateId: "one", tenantId: "tenant", occurredAt: "2026-07-28T00:00:00Z", businessDate: "2026-07-28", correlationId: "request", payload: {}, metadata: {} });
  assert.equal(event.eventType, "test.v1");
});

test("App shell removes unauthorized routes and exposes accessible landmarks", () => {
  const routes = [{ path: "/", label: "Home" }, { path: "/audit", label: "Audit", permission: "audit.read" }];
  assert.deepEqual(permittedRoutes(routes, new Set()).map((route) => route.path), ["/"]);
  const html = renderAppShell({ title: "Admin", identity: { displayName: "User", tenantName: "Tenant", permissions: new Set() }, routes, currentPath: "/", content: "<h1>Overview</h1>" });
  assert.match(html, /Skip to content/);
  assert.match(html, /<main class="shell-main" id="main" tabindex="-1">/);
  assert.doesNotMatch(html, />Audit</);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /THESIS: Operations Ledger/);
  assert.match(html, /prefers-reduced-motion/);
});

test("Admin Foundation preview exposes work, provenance and truthful fixture labelling", () => {
  const html = renderAdminFoundationPreview({
    displayName: "Synthetic Director",
    tenantName: "Synthetic Alpha Retail",
    permissions: new Set(["platform.reference.read", "platform.audit.read"]),
    location: "Dhaka Central",
    businessDate: "Business date · 28 Jul 2026",
  });
  assert.match(html, /Today’s operating picture/);
  assert.match(html, /Synthetic operational data for UI validation only/);
  assert.match(html, /Work requiring attention/);
  assert.match(html, /Trace a number/);
  assert.match(html, /Foundation controls/);
  assert.match(html, /Foundation reference/);
  assert.match(html, /Audit history/);
  assert.doesNotMatch(html, /Access control/);
  assert.match(html, /aria-label="Review price override REF-2026-0042"/);
});

test("POS Foundation preview keeps scan, cart, tender and synthetic data visible", () => {
  const html = renderPosFoundationPreview({
    displayName: "Synthetic Cashier",
    tenantName: "Synthetic Alpha Retail",
    permissions: new Set(["platform.register.use", "platform.device.read"]),
    offlineState: { online: true, pendingOperations: 0, lastSyncAt: "2026-07-28T05:00:00Z" },
  });
  assert.match(html, /Illustrative Dhaka fixture/);
  assert.match(html, /Scan barcode or search products/);
  assert.match(html, /Current sale/);
  assert.match(html, /Pay BDT 1,870\.00/);
  assert.match(html, /Stock and ledger effects post only after payment confirmation/);
  assert.match(html, /Online · synced/);
  assert.match(html, /<kbd>F8<\/kbd>/);
});

test("POS shell exposes offline recovery state and supports RTL document direction", () => {
  const html = renderPosShell({
    displayName: "Synthetic Cashier",
    tenantName: "Synthetic Alpha Retail",
    permissions: new Set(["platform.register.use"]),
    currentPath: "/",
    content: "<h1>Register</h1>",
    offlineState: { online: false, pendingOperations: 3 },
    direction: "rtl",
    locale: "ar",
  });
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /Offline operating mode/);
  assert.match(html, /3 operations are queued for sync/);
  assert.doesNotMatch(html, />Sync status</);
  assert.doesNotMatch(html, />Device</);
});

test("Published event fixture remains compatible with contract pack v1", async () => {
  const fixture = JSON.parse(await readFile("docs/contracts/fixtures/v1/platform-reference-created.json", "utf8"));
  const event = parseDomainEventEnvelopeV1(fixture);
  assert.equal(event.eventType, "platform.reference.created.v1");
  assert.equal(event.schemaVersion, "1.0");
});
