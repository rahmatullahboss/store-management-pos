import test from "node:test";
import assert from "node:assert/strict";
import { renderStorefrontOperationsPage } from "../../build/apps/admin-web/src/modules/storefront/page.js";
import { renderStorefrontAdminPage } from "../../build/apps/admin-web/src/app-shell/index.js";

const page = {
  state: "ready",
  tenantName: "Synthetic Retail Group",
  observedAtLabel: "30 Jul 2026, 07:30",
  summary: {
    storefrontCount: 2,
    activeChannelCount: 3,
    publishedItemCount: 124,
    scheduledItemCount: 7,
    domainAttentionCount: 1,
  },
  storefronts: [
    {
      storefrontId: "018f0000-0000-4000-8000-000000000010",
      displayName: "Main online store",
      status: "active",
      channelCount: 2,
      primaryDomain: "shop.example.test",
      domainStatus: "active",
      locale: "en-GB",
      currency: "GBP",
      updatedAtLabel: "2 minutes ago",
    },
    {
      storefrontId: "018f0000-0000-4000-8000-000000000011",
      displayName: "Pakistan store",
      status: "draft",
      channelCount: 1,
      primaryDomain: "pk.example.test",
      domainStatus: "verification_pending",
      locale: "ur-PK",
      currency: "PKR",
      updatedAtLabel: "10 minutes ago",
    },
  ],
  publicationQueue: [
    {
      id: "018f0000-0000-4000-8000-000000000020",
      kind: "collection",
      label: "Summer collection",
      state: "scheduled",
      scopeLabel: "Pakistan Web",
      revisionLabel: "Revision 4",
      scheduledForLabel: "1 Aug 2026, 09:00",
      updatedAtLabel: "5 minutes ago",
    },
    {
      id: "018f0000-0000-4000-8000-000000000021",
      kind: "homepage",
      label: "Homepage",
      state: "published",
      scopeLabel: "Main online store",
      revisionLabel: "Revision 8",
      updatedAtLabel: "12 minutes ago",
    },
  ],
  canManageStorefront: true,
  canManagePublication: true,
  canManageContent: false,
  canManageDomains: false,
};

const identity = {
  displayName: "Synthetic Storefront Manager",
  tenantName: "Synthetic Retail Group",
  permissions: new Set([
    "storefront.storefront.read",
    "storefront.storefront.manage",
    "storefront.publication.manage",
  ]),
  direction: "ltr",
  locale: "en-GB",
  location: "All locations",
  businessDate: "Business date · 30 Jul 2026",
};

test("storefront operations page renders bounded management evidence", () => {
  const html = renderStorefrontOperationsPage(page);
  assert.match(html, /Storefront publishing/);
  assert.match(html, /Main online store/);
  assert.match(html, /shop\.example\.test/);
  assert.match(html, /Summer collection/);
  assert.match(html, /verification pending/);
  assert.match(html, /Published<\/dt><dd>124/);
  assert.match(html, /New content revision<\/button>/);
  assert.match(html, /New content revision<\/button>/);
  assert.match(html, /button type="button" disabled>New content revision/);
  assert.match(html, /button type="button" disabled>Manage domains/);
  assert.match(html, /role="region" aria-label="Storefront and domain health table"/);
});

test("storefront operations escapes tenant and buyer-facing labels", () => {
  const html = renderStorefrontOperationsPage({
    ...page,
    tenantName: '<img src=x onerror="alert(1)">',
    storefronts: [
      {
        ...page.storefronts[0],
        displayName: "<script>alert(1)</script>",
        primaryDomain: "shop.example.test<script>",
      },
    ],
  });
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test("non-ready states expose safe status and alert semantics", () => {
  const denied = renderStorefrontOperationsPage({ ...page, state: "denied", message: undefined });
  const error = renderStorefrontOperationsPage({ ...page, state: "error", message: undefined });
  const empty = renderStorefrontOperationsPage({ ...page, state: "empty", message: undefined });
  assert.match(denied, /role="status"/);
  assert.match(denied, /Access restricted/);
  assert.match(error, /role="alert"/);
  assert.match(error, /No publication or domain state was changed/);
  assert.match(empty, /Create a storefront and sales channel/);
});

test("admin shell integrates the storefront route without nested main landmarks", () => {
  const html = renderStorefrontAdminPage(identity, page);
  assert.equal((html.match(/<main\b/g) ?? []).length, 1);
  assert.match(html, /href="\/storefront"/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /Storefront publishing/);
  assert.match(html, /Operations admin/);
});

test("storefront navigation is permission scoped", () => {
  const denied = renderStorefrontAdminPage(
    { ...identity, permissions: new Set(["catalog.read"]) },
    { ...page, state: "denied" },
  );
  assert.doesNotMatch(denied, /href="\/storefront"/);
  assert.match(denied, /Access restricted/);
});

test("RTL shell retains semantic storefront content", () => {
  const html = renderStorefrontAdminPage(
    { ...identity, direction: "rtl", locale: "ar" },
    { ...page, tenantName: "مجموعة متاجر تجريبية" },
  );
  assert.match(html, /dir="rtl"/);
  assert.match(html, /lang="ar"/);
  assert.match(html, /مجموعة متاجر تجريبية/);
  assert.match(html, /\[dir=rtl\] \.modh-page/);
});
