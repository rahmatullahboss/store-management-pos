import assert from "node:assert/strict";
import test from "node:test";
import {
  renderStorefrontAdminPage,
} from "../../build/apps/admin-web/src/app-shell/index.js";
import {
  renderStorefrontOperationsPage,
} from "../../build/apps/admin-web/src/modules/storefront/page.js";
import {
  STOREFRONT_ADMIN_ROUTES,
} from "../../build/apps/admin-web/src/modules/storefront/routes.js";

const shell = {
  displayName: "Amina Rahman",
  tenantName: "Dhaka Demo Store",
  permissions: new Set([
    "storefront.storefront.read",
    "storefront.storefront.manage",
    "storefront.publication.manage",
    "storefront.content.manage",
    "storefront.domain.manage",
  ]),
  location: "Flagship store",
  businessDate: "Business date · 30 Jul 2026",
  locale: "en-GB",
};

const page = {
  state: "ready",
  tenantName: "Dhaka Demo Store",
  observedAtLabel: "07:15 Asia/Dhaka",
  summary: {
    storefrontCount: 2,
    activeChannelCount: 3,
    publishedItemCount: 42,
    scheduledItemCount: 4,
    domainAttentionCount: 1,
  },
  storefronts: [
    {
      storefrontId: "storefront-1",
      displayName: "Main <script>alert(1)</script>",
      status: "active",
      channelCount: 2,
      primaryDomain: "shop.example.com",
      domainStatus: "active",
      locale: "en-GB",
      currency: "BDT",
      updatedAtLabel: "2 minutes ago",
    },
    {
      storefrontId: "storefront-2",
      displayName: "Wholesale",
      status: "draft",
      channelCount: 1,
      primaryDomain: "wholesale.example.com",
      domainStatus: "verification_pending",
      locale: "ar",
      currency: "BDT",
      updatedAtLabel: "18 minutes ago",
    },
  ],
  publicationQueue: [
    {
      id: "publication-1",
      kind: "variant",
      label: "Linen shirt · blue large",
      state: "published",
      scopeLabel: "Main storefront · Online",
      revisionLabel: "Version 8",
      updatedAtLabel: "3 minutes ago",
    },
    {
      id: "content-1",
      kind: "content_page",
      label: "Shipping policy",
      state: "scheduled",
      scopeLabel: "Main storefront",
      revisionLabel: "Revision 3",
      scheduledForLabel: "1 Aug 2026 · 10:00",
      updatedAtLabel: "9 minutes ago",
    },
  ],
  canManageStorefront: true,
  canManagePublication: true,
  canManageContent: true,
  canManageDomains: true,
};

test("storefront admin route is exact, ordered and permission-scoped", () => {
  assert.equal(STOREFRONT_ADMIN_ROUTES.length, 1);
  assert.deepEqual(STOREFRONT_ADMIN_ROUTES[0], {
    id: "storefront.operations",
    path: "/storefront",
    navigationLabel: "Storefront",
    permission: "storefront.storefront.read",
    module: "storefront",
    order: 740,
    exact: true,
  });
});

test("storefront operations page renders summaries, publication evidence and escaped labels", () => {
  const html = renderStorefrontOperationsPage(page);
  assert.match(html, /Storefront publishing/u);
  assert.match(html, /Storefront and domain health/u);
  assert.match(html, /Content and catalog queue/u);
  assert.match(html, /Domain attention/u);
  assert.match(html, /Shipping policy/u);
  assert.match(html, /Revision 3/u);
  assert.match(
    html,
    /tabindex="0" role="region" aria-label="Storefront and domain health table"/u,
  );
  assert.doesNotMatch(html, /<script>alert/u);
  assert.match(html, /Main &lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.match(html, /Price, tax, inventory, customer, order, payment and accounting authority/u);
});

test("storefront actions are disabled independently by permission evidence", () => {
  const html = renderStorefrontOperationsPage({
    ...page,
    canManageStorefront: false,
    canManagePublication: false,
    canManageContent: false,
    canManageDomains: false,
  });
  for (const label of [
    "New storefront",
    "Manage catalog",
    "New content revision",
    "Manage domains",
  ]) {
    assert.match(
      html,
      new RegExp(`<button type="button" disabled>${label}</button>`, "u"),
    );
  }
});

test("admin shell permission-filters storefront navigation and supports RTL", () => {
  const html = renderStorefrontAdminPage(shell, page);
  assert.match(
    html,
    /<a href="\/storefront" aria-current="page">[\s\S]*?<span>Storefront<\/span><\/a>/u,
  );

  const restricted = renderStorefrontAdminPage(
    { ...shell, permissions: new Set([]) },
    { ...page, state: "denied", storefronts: [], publicationQueue: [] },
  );
  assert.doesNotMatch(restricted, /<span>Storefront<\/span>/u);
  assert.match(restricted, /Access restricted/u);

  const rtl = renderStorefrontAdminPage({ ...shell, direction: "rtl" }, page);
  assert.match(rtl, /dir="rtl"/u);
});

test("storefront admin page exposes loading, empty, error and denied states", () => {
  for (const state of ["loading", "empty", "error", "denied"]) {
    const html = renderStorefrontOperationsPage({
      ...page,
      state,
      storefronts: [],
      publicationQueue: [],
    });
    assert.match(html, new RegExp(`data-state="${state}"`, "u"));
    assert.match(html, /role="(?:status|alert)"/u);
  }
});
