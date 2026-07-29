import assert from "node:assert/strict";
import test from "node:test";
import { visiblePosModuleRoutes } from "../../build/apps/pos-web/src/modules/register/routes.js";
import { renderRegisterWorkspace } from "../../build/apps/pos-web/src/modules/register/surface.js";

function workspace(overrides = {}) {
  return {
    locale: "en-US",
    currency: "USD",
    scale: 2,
    online: true,
    pendingOperations: 0,
    registerLabel: "Register 02",
    shiftStatus: "open",
    cashierName: "Cashier One",
    cartReference: "CART-1001",
    lines: [
      {
        lineId: "line-1",
        name: "Coffee & Tea <Large>",
        variant: "Large / Hot",
        quantity: "2",
        lineTotalMinor: 2_000n,
      },
    ],
    subtotalMinor: 2_000n,
    discountMinor: 100n,
    taxMinor: 190n,
    payableMinor: 2_090n,
    tenders: [
      {
        tenderId: "cash-1",
        kind: "cash",
        label: "Cash",
        amountMinor: 2_090n,
        state: "accepted",
      },
    ],
    canCheckout: true,
    ...overrides,
  };
}

test("POS module routes are permission-scoped and offline-safe", () => {
  const permissions = new Set([
    "pos.checkout.execute",
    "sales.return.create",
    "cash.shift.read",
    "pos.sync.read",
  ]);

  assert.deepEqual(
    visiblePosModuleRoutes(permissions, true).map((route) => route.id),
    ["pos.register", "pos.returns", "pos.cash", "pos.sync"],
  );
  assert.deepEqual(
    visiblePosModuleRoutes(permissions, false).map((route) => route.id),
    ["pos.register", "pos.cash", "pos.sync"],
  );
});

test("register workspace renders accessible checkout controls and escapes product content", () => {
  const html = renderRegisterWorkspace(workspace());

  assert.match(html, /<main class="modd-register"/u);
  assert.match(html, /<form class="modd-command" role="search"/u);
  assert.match(html, /aria-label="Decrease Coffee &amp; Tea &lt;Large&gt; quantity"/u);
  assert.match(html, /Coffee &amp; Tea &lt;Large&gt;/u);
  assert.doesNotMatch(html, /Coffee & Tea <Large>/u);
  assert.match(html, /Complete checkout/u);
  assert.match(html, /\$20\.90/u);
  assert.match(html, /Unknown provider status blocks retry/u);
});

test("offline checkout explains durable queue state and unsupported actions", () => {
  const html = renderRegisterWorkspace(workspace({
    online: false,
    pendingOperations: 3,
    canCheckout: false,
    checkoutBlockReason: "External card payments are unavailable offline.",
    tenders: [
      {
        tenderId: "card-1",
        kind: "external_card",
        label: "Card",
        amountMinor: 2_090n,
        state: "unknown",
      },
    ],
  }));

  assert.match(html, /Offline · 3 queued/u);
  assert.match(html, /Approved offline window/u);
  assert.match(html, /committed/u);
  assert.match(html, /External card payments are unavailable offline\./u);
  assert.match(html, /modd-tender-state--warn">unknown/u);
  assert.match(html, /Complete checkout" type="button" disabled/u);
});

test("error and conflict states expose assertive status without removing confirmed values", () => {
  const errorHtml = renderRegisterWorkspace(workspace({ state: "error" }));
  const conflictHtml = renderRegisterWorkspace(workspace({ state: "conflict" }));

  assert.match(errorHtml, /role="alert"/u);
  assert.match(errorHtml, /Do not repeat a completed payment/u);
  assert.match(conflictHtml, /The local receipt remains unchanged/u);
  assert.match(conflictHtml, /\$20\.90/u);
});
