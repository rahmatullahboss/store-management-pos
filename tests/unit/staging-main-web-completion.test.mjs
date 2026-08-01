import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CONNECTED_ADMIN_PATHS,
  renderAdminNotFoundPage,
  renderConnectedAdminPage,
} from "../../build/apps/api/src/staging-connected-admin-pages.js";

const root = new URL("../../", import.meta.url);

const permissions = [
  "catalog.product.read",
  "catalog.import.execute",
  "catalog.unit.manage",
  "pricing.price.read",
  "pricing.promotion.manage",
  "pricing.discount.approve",
  "tax.calculation.read",
  "tax.exemption.manage",
  "inventory.stock.read",
  "procurement.purchase_order.read",
  "customer.profile.read",
  "sales.order.read",
  "fulfillment.plan.read",
  "payment.read",
  "accounting.read",
  "banking.read",
  "platform.audit.read",
  "pos.sync.read",
  "localization.pack.read",
  "localization.document.read",
  "reporting.metric.read",
  "integration.connector.read",
  "saas.subscription.read",
];

const base = {
  displayName: "Main Web Test User",
  tenantName: "Synthetic Main Web Tenant",
  permissions: new Set(permissions),
  currentPath: "/",
  content: "",
  direction: "ltr",
  location: "Synthetic Dhaka Store",
  businessDate: "Release candidate · 30 Jul 2026",
  locale: "en-GB",
  offline: false,
};

const data = {
  context: {
    user: {
      id: "018f0000-0000-7000-8000-000000009001",
      email: "main-web@example.invalid",
      name: "Main Web Test User",
    },
    tenant: {
      id: "018f0000-0000-7000-8000-000000000002",
      name: "Synthetic Main Web Tenant",
    },
    role: "staging-read-only",
    permissions,
    scope: {
      legalEntityId: "018f0000-0000-7000-8000-000000000003",
      storeId: "018f0000-0000-7000-8000-000000000004",
      warehouseId: "018f0000-0000-7000-8000-000000000005",
      registerId: "018f0000-0000-7000-8000-000000000006",
    },
  },
  dashboard: {
    productCount: 5,
    availableUnits: "২৩৪",
    reservedUnits: "৪",
    inventoryValue: "৳১১৪,৪৮০.০০",
    openPurchaseOrders: 3,
    openPurchaseValue: "৳৩৫,৫০০.০০",
    activeCustomers: 4,
    activeSalesOrders: 3,
    salesOrderValue: "৳৫,১০০.০০",
    lowStockCount: 1,
    recentOrders: [],
  },
  catalog: [
    {
      productId: "018f0000-0000-7000-8000-000000000101",
      product: "Synthetic Linen Shirt",
      variant: "Blue / M",
      sku: "SYN-SHIRT-BLUE-M",
      category: "Apparel",
      price: "৳১,২০০.০০",
      available: "১২",
      inventoryValue: "৳১৪,৪০০.০০",
      status: "attention",
    },
  ],
  inventory: {
    reconciledAt: "Current",
    availableUnits: "২৩৪",
    reservedUnits: "৪",
    exceptionCount: 1,
    balances: [],
    tasks: [],
    trace: [],
  },
  procurement: {
    approvedOpenValue: "৳৩৫,৫০০.০০",
    receiptsDue: 2,
    matchExceptions: 0,
    purchaseOrders: [
      {
        order: "PO-STG-001",
        supplier: "Synthetic Supplier",
        destination: "Synthetic Dhaka Warehouse",
        promised: "2026-07-31",
        ordered: "10 EA",
        received: "0 EA",
        value: "৳১০,০০০.০০",
        state: "approved",
      },
    ],
    suppliers: [],
  },
  customers: {
    locale: "en-GB",
    direction: "ltr",
    state: "ready",
    customers: [],
    pendingApprovals: 0,
  },
  sales: {
    locale: "en-GB",
    direction: "ltr",
    state: "ready",
    orders: [
      {
        id: "018f0000-0000-7000-8000-000000000201",
        documentNumber: "SO-STG-001",
        customer: "Synthetic Customer",
        total: "৳১,২০০.০০",
        orderStatus: "confirmed",
        paymentStatus: "pending",
        fulfillmentStatus: "allocated",
        invoiceStatus: "not_invoiced",
      },
    ],
    approvalCount: 0,
  },
  pos: {
    locale: "en-GB",
    currency: "BDT",
    scale: 2,
    online: true,
    pendingOperations: 0,
    registerLabel: "Synthetic Dhaka Register",
    shiftStatus: "open",
    cashierName: "Main Web Test User",
    cartReference: "WEB-E2E-001",
    lines: [],
    subtotalMinor: 0n,
    discountMinor: 0n,
    taxMinor: 0n,
    payableMinor: 0n,
    tenders: [],
    canCheckout: false,
    checkoutBlockReason: "Synthetic test",
  },
};

const cases = [
  ["/catalog/products/demo", /Catalog operations/u],
  ["/catalog/imports", /Import control/u],
  ["/catalog/units", /Units and conversions/u],
  ["/pricing", /Pricing and tax control/u],
  ["/pricing/promotions", /Promotions/u],
  ["/pricing/discount-approvals", /Approval/u],
  ["/tax", /Tax/u],
  ["/tax/exemptions", /Tax/u],
  ["/fulfillment", /Fulfilment floor/u],
  ["/finance/payments", /Payment operations/u],
  ["/finance/accounting", /Accounting control/u],
  ["/finance/banking", /Bank reconciliation/u],
  ["/finance/readiness", /Finance readiness/u],
  ["/pos/reconciliation", /POS reconciliation/u],
  ["/localization", /Localization &amp; compliance/u],
  ["/compliance", /Compliance evidence/u],
  ["/reporting", /Owner reporting/u],
  ["/integrations", /Integration health/u],
  ["/platform/saas", /SaaS administration/u],
];

test("every registered non-primary Admin route renders a real module workspace", () => {
  assert.equal(CONNECTED_ADMIN_PATHS.length, 19);
  assert.equal(cases.length, CONNECTED_ADMIN_PATHS.length);
  for (const [path, marker] of cases) {
    const html = renderConnectedAdminPage(path, { ...base, currentPath: path }, data);
    assert.equal(typeof html, "string", path);
    assert.match(html, /Store Management Admin/u, path);
    assert.match(html, marker, path);
    assert.doesNotMatch(html, /next connected workflow/u, path);
    assert.doesNotMatch(html, /connected-next/u, path);
  }
});

test("connected finance, reporting and fulfilment pages preserve operational evidence", () => {
  const fulfilment = renderConnectedAdminPage("/fulfillment", base, data);
  assert.match(fulfilment, /SO-STG-001/u);
  assert.match(fulfilment, /allocated/u);

  const payments = renderConnectedAdminPage("/finance/payments", base, data);
  assert.match(payments, /SO-STG-001/u);
  assert.match(payments, /Sales order snapshot/u);
  assert.match(payments, /unknown/u);

  const readiness = renderConnectedAdminPage("/finance/readiness", base, data);
  assert.match(readiness, /Tenant-scoped database context/u);
  assert.match(readiness, /Production finance commands/u);
  assert.match(readiness, /degraded/u);

  const reporting = renderConnectedAdminPage("/reporting", base, data);
  assert.match(reporting, /Active products/u);
  assert.match(reporting, /Available units/u);
  assert.match(reporting, /Open purchase orders/u);
  assert.match(reporting, /Active sales orders/u);
});

test("unknown Admin routes fail with an escaped, non-mutating not-found page", () => {
  assert.equal(renderConnectedAdminPage("/unknown", base, data), null);
  const html = renderAdminNotFoundPage(base, '/<script>alert("x")</script>');
  assert.match(html, /Page not found/u);
  assert.match(html, /No command was executed/u);
  assert.match(html, /&lt;script&gt;/u);
  assert.doesNotMatch(html, /<script>alert/u);
});

test("operational worker no longer serves a generic success placeholder", async () => {
  const source = await readFile(new URL("apps/api/src/staging-operational-worker.ts", root), "utf8");
  assert.match(source, /renderConnectedAdminPage/u);
  assert.match(source, /renderAdminNotFoundPage/u);
  assert.match(source, /status = 404/u);
  assert.doesNotMatch(source, /function genericPage/u);
  assert.doesNotMatch(source, /connected-next/u);
});
