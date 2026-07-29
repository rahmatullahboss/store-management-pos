import assert from "node:assert/strict";
import test from "node:test";
import {
  renderIntegrationsAdminPage,
  renderReportingAdminPage,
  renderSaasOperationsAdminPage,
} from "../../build/apps/admin-web/src/app-shell/index.js";
import { renderIntegrationConsolePage } from "../../build/apps/admin-web/src/modules/integrations/page.js";
import { renderReportingOperationsPage } from "../../build/apps/admin-web/src/modules/reporting/operations-page.js";
import { MOD_G_ADMIN_ROUTES } from "../../build/apps/admin-web/src/modules/reporting/routes.js";
import { renderSaasAdminPage } from "../../build/apps/admin-web/src/modules/saas-admin/page.js";

const shell = {
  displayName: "Amina Rahman",
  tenantName: "Dhaka Demo Store",
  permissions: new Set([
    "reporting.metric.read",
    "reporting.export.request",
    "integration.connector.read",
    "integration.connector.manage",
    "integration.webhook.read",
    "integration.webhook.manage",
    "saas.subscription.read",
    "saas.subscription.manage",
    "saas.lifecycle.manage",
    "saas.support.impersonate",
  ]),
  location: "Flagship store",
  businessDate: "Business date · 30 Jul 2026",
  locale: "en-GB",
};

const reportingPage = {
  state: "ready",
  audience: "owner",
  tenantName: "Dhaka Demo Store",
  scopeLabel: "All locations",
  businessDateLabel: "30 Jul 2026",
  generatedAtLabel: "01:30 Asia/Dhaka",
  timeZone: "Asia/Dhaka",
  currency: "BDT",
  canRequestExport: true,
  metrics: [
    {
      metricId: "sales.net",
      label: "Net sales <script>alert(1)</script>",
      value: "125000",
      unit: "minor",
      currency: "BDT",
      periodLabel: "30 Jul 2026",
      version: "sales.net@1",
      freshnessLabel: "42 seconds",
      health: "fresh",
      reconciled: true,
      controlTotal: "125000 BDT",
      drillThroughHref: "/reporting/drill-through?sales=net",
    },
    {
      metricId: "stock.exceptions",
      label: "Stock exceptions",
      value: "7",
      unit: "count",
      periodLabel: "Current",
      version: "stock.exceptions@1",
      freshnessLabel: "4 minutes",
      health: "stale",
      reconciled: false,
    },
  ],
  exceptions: [
    { exceptionId: "exception-1", severity: "high", title: "Payment mismatch", owner: "Finance", ageLabel: "18 minutes", href: "/finance/readiness" },
  ],
  exports: [
    { exportId: "export-1", reportName: "Owner daily control", format: "xlsx", status: "running", requestedAtLabel: "01:20", expiresAtLabel: "6 Aug 2026" },
  ],
};

const integrationsPage = {
  state: "ready",
  tenantName: "Dhaka Demo Store",
  observedAtLabel: "01:30 Asia/Dhaka",
  canManage: true,
  canReplay: true,
  connections: [
    {
      connectionId: "connection-1",
      displayName: "Shopify products",
      connectorType: "shopify_graphql",
      provider: "Shopify",
      status: "active",
      credentialLabel: "secret://…/shopify",
      resourceTypes: ["product"],
      cursorLabel: "cursor …r31",
      lastHealthyLabel: "2 minutes ago",
      conflictCount: 0,
    },
    {
      connectionId: "connection-2",
      displayName: "Partner REST",
      connectorType: "generic_rest",
      provider: "Partner API",
      status: "degraded",
      credentialLabel: "vault://…/partner",
      resourceTypes: ["order", "customer"],
      cursorLabel: "page 148",
      conflictCount: 3,
    },
  ],
  webhooks: [
    {
      subscriptionId: "webhook-1",
      endpointLabel: "https://partner.example/webhooks",
      eventTypes: ["sales.order.completed.v1"],
      status: "active",
      queued: 2,
      retrying: 1,
      deadLetter: 1,
      lastDeliveryLabel: "4 minutes ago",
    },
  ],
};

const saasPage = {
  state: "ready",
  observedAtLabel: "01:30 Asia/Dhaka",
  canManageSubscription: true,
  canManageLifecycle: true,
  canManageSupport: true,
  subscription: {
    tenantId: "tenant-1",
    tenantName: "Dhaka Demo Store",
    planName: "Growth",
    planVersion: "2026-07",
    status: "active",
    periodLabel: "1 Jul – 1 Aug 2026",
    version: "4",
  },
  usage: [
    { meterCode: "catalog.products", label: "Products", quantity: "740", limit: "1000", enforcement: "hard", periodLabel: "Jul 2026" },
    { meterCode: "reporting.exports", label: "Exports", quantity: "18", enforcement: "observe", periodLabel: "Jul 2026" },
  ],
  lifecycle: [
    { jobId: "job-1", operation: "export", status: "review", requestedBy: "Platform admin", requestedAtLabel: "01:10", reason: "Offboarding evidence review" },
  ],
  rollouts: [
    { featureCode: "reporting.new-dashboard", status: "enabled", percentage: 25, reason: "Pilot", version: "2" },
  ],
  incidents: [
    { incidentCode: "INC-2026-001", severity: "high", status: "investigating", summary: "Provider throttling", ageLabel: "22 minutes" },
  ],
  impersonation: [
    { grantId: "grant-1", supportActor: "Support engineer", approvedBy: "Duty manager", scopeLabel: "integration.connector.read", expiresAtLabel: "03:00", status: "active" },
  ],
};

test("MOD-G admin routes are ordered, exact and permission-scoped", () => {
  assert.deepEqual(MOD_G_ADMIN_ROUTES.map(({ path }) => path), ["/reporting", "/integrations", "/platform/saas"]);
  assert.deepEqual(MOD_G_ADMIN_ROUTES.map(({ permission }) => permission), [
    "reporting.metric.read",
    "integration.connector.read",
    "saas.subscription.read",
  ]);
  assert.ok(MOD_G_ADMIN_ROUTES.every((route) => route.exact === true));
  assert.ok(MOD_G_ADMIN_ROUTES[0].order < MOD_G_ADMIN_ROUTES[1].order);
});

test("reporting dashboard renders provenance, role views, exceptions and escaped metric labels", () => {
  const html = renderReportingOperationsPage(reportingPage);
  assert.match(html, /Owner reporting/u);
  for (const label of ["Owner", "Store manager", "Finance", "Inventory", "Platform"]) assert.match(html, new RegExp(label, "u"));
  assert.match(html, /Metric version/u);
  assert.match(html, /Freshness/u);
  assert.match(html, /Control total/u);
  assert.match(html, /Reconciled/u);
  assert.match(html, /Payment mismatch/u);
  assert.match(html, /Report exports/u);
  assert.doesNotMatch(html, /<script>alert/u);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.match(html, /tabindex="0" role="region" aria-label="Report exports table"/u);
});

test("integration console keeps credential labels redacted and gates replay actions", () => {
  const html = renderIntegrationConsolePage(integrationsPage);
  assert.match(html, /Integration health/u);
  assert.match(html, /Shopify products/u);
  assert.match(html, /secret:\/\/…\/shopify/u);
  assert.match(html, /Webhooks and DLQ/u);
  assert.match(html, /Open replay queue/u);
  assert.match(html, /Connector connections table/u);
  assert.doesNotMatch(html, /resolved-outside-database/u);

  const deniedActions = renderIntegrationConsolePage({ ...integrationsPage, canManage: false, canReplay: false });
  assert.match(deniedActions, /<button type="button" disabled>New connection<\/button>/u);
  assert.match(deniedActions, /<button type="button" disabled>Open replay queue<\/button>/u);
});

test("SaaS console exposes data-preserving lifecycle, usage, incidents and approved support access", () => {
  const html = renderSaasAdminPage(saasPage);
  assert.match(html, /SaaS administration/u);
  assert.match(html, /Usage and entitlements/u);
  assert.match(html, /Tenant lifecycle jobs/u);
  assert.match(html, /Offboarding evidence review/u);
  assert.match(html, /Feature rollouts/u);
  assert.match(html, /Provider throttling/u);
  assert.match(html, /Support access/u);
  assert.match(html, /Support engineer/u);
  assert.match(html, /Duty manager/u);
  assert.match(html, /Support impersonation grants table/u);
});

test("admin shell composes and permission-filters MOD-G navigation", () => {
  const reporting = renderReportingAdminPage(shell, reportingPage);
  assert.match(reporting, /aria-current="page"[^>]*>Reporting|>Reporting<\/a>/u);
  assert.match(reporting, /Integrations/u);
  assert.match(reporting, /SaaS administration/u);

  const restricted = renderReportingAdminPage({ ...shell, permissions: new Set(["reporting.metric.read"]) }, reportingPage);
  assert.match(restricted, />Reporting<\/a>/u);
  assert.doesNotMatch(restricted, />Integrations<\/a>/u);
  assert.doesNotMatch(restricted, />SaaS administration<\/a>/u);

  assert.match(renderIntegrationsAdminPage(shell, integrationsPage), /data-state="ready"/u);
  assert.match(renderSaasOperationsAdminPage({ ...shell, direction: "rtl" }, saasPage), /dir="rtl"/u);
});

test("all MOD-G admin surfaces render explicit loading, empty, error and denied states", () => {
  for (const state of ["loading", "empty", "error", "denied"]) {
    const reporting = renderReportingOperationsPage({ ...reportingPage, state, metrics: [], exceptions: [], exports: [] });
    const integrations = renderIntegrationConsolePage({ ...integrationsPage, state, connections: [], webhooks: [] });
    const saas = renderSaasAdminPage({ ...saasPage, state, subscription: undefined, usage: [], lifecycle: [], rollouts: [], incidents: [], impersonation: [] });
    assert.match(reporting, new RegExp(`data-state="${state}"`, "u"));
    assert.match(integrations, new RegExp(`data-state="${state}"`, "u"));
    assert.match(saas, new RegExp(`data-state="${state}"`, "u"));
  }
});
