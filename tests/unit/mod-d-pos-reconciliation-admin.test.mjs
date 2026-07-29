import test from "node:test";
import assert from "node:assert/strict";
import { renderAdminShell, renderPosReconciliationAdminPage } from "../../build/apps/admin-web/src/app-shell/index.js";
import { renderPosReconciliationPage } from "../../build/apps/admin-web/src/modules/pos/reconciliation-page.js";

const page = {
  refreshedAt: "2026-07-29T09:00:00Z",
  locationLabel: "Dhaka & North",
  rejectedCount: 1,
  reviewCount: 1,
  adjustedCount: 1,
  pendingDeviceCount: 2,
  rows: [
    {
      operationId: "op-rejected",
      operationType: "checkout",
      deviceReference: "device-1",
      registerReference: "register-1",
      status: "rejected",
      reasonCode: "FINAL_UNIT_CONFLICT",
      detail: "Stock <unavailable>",
      receivedAt: "2026-07-29T08:50:00Z",
    },
    {
      operationId: "op-adjusted",
      operationType: "cash_event",
      deviceReference: "device-2",
      registerReference: "register-2",
      status: "adjusted",
      detail: "Approved variance",
      serverReference: "cash-event-22",
      receivedAt: "2026-07-29T08:51:00Z",
      resolvedAt: "2026-07-29T08:58:00Z",
      resolutionReference: "approval-7",
    },
    {
      operationId: "op-review",
      operationType: "receipt_delivery",
      deviceReference: "device-3",
      registerReference: "register-3",
      status: "review",
      detail: "Customer reference contains & separator",
      receivedAt: "2026-07-29T08:52:00Z",
    },
  ],
};

test("POS reconciliation route is permission scoped in the integrated admin shell", () => {
  const denied = renderAdminShell({
    displayName: "Operations reviewer",
    tenantName: "Test tenant",
    permissions: new Set(),
    currentPath: "/",
    content: "<p>Overview</p>",
  });
  assert.doesNotMatch(denied, /href="\/pos\/reconciliation"/u);

  const allowed = renderAdminShell({
    displayName: "Operations reviewer",
    tenantName: "Test tenant",
    permissions: new Set(["pos.sync.read"]),
    currentPath: "/",
    content: "<p>Overview</p>",
  });
  assert.match(allowed, /href="\/pos\/reconciliation"/u);
});

test("POS reconciliation console preserves rejected, adjusted and review evidence", () => {
  const html = renderPosReconciliationPage(page);
  assert.match(html, /3 operations require traceable review or resolution/u);
  assert.equal(html.match(/data-operation-id=/gu)?.length, 3);
  assert.match(html, /data-status="rejected"/u);
  assert.match(html, /data-status="adjusted"/u);
  assert.match(html, /data-status="review"/u);
  assert.match(html, /Explicit resolution required/u);
  assert.match(html, /Resolved 2026-07-29T08:58:00Z · approval-7/u);
  assert.ok(!html.includes("<unavailable>"));
  assert.match(html, /Stock &lt;unavailable&gt;/u);
  assert.match(html, /Dhaka &amp; North/u);
  assert.match(html, /contains &amp; separator/u);
});

test("POS reconciliation page composes through the shared admin shell", () => {
  const html = renderPosReconciliationAdminPage({
    displayName: "Operations reviewer",
    tenantName: "Test tenant",
    permissions: new Set(["pos.sync.read"]),
  }, page);
  assert.match(html, /Store Management Admin/u);
  assert.match(html, /aria-current="page"[^>]*href="\/pos\/reconciliation"|href="\/pos\/reconciliation"[^>]*aria-current="page"/u);
  assert.match(html, /POS reconciliation/u);
});
