import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseDomainEventEnvelopeV1 } from "../../build/packages/contracts/src/v1/validators.js";
import { permittedRoutes, renderAppShell } from "../../build/packages/ui/src/app-shell.js";

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
  assert.doesNotMatch(html, />Audit</);
  assert.match(html, /aria-current="page"/);
});


test("Published event fixture remains compatible with contract pack v1", async () => {
  const fixture = JSON.parse(await readFile("docs/contracts/fixtures/v1/platform-reference-created.json", "utf8"));
  const event = parseDomainEventEnvelopeV1(fixture);
  assert.equal(event.eventType, "platform.reference.created.v1");
  assert.equal(event.schemaVersion, "1.0");
});
