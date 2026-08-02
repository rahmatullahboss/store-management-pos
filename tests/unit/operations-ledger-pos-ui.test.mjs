import test from "node:test";
import assert from "node:assert/strict";
import {
  renderPosDevicePage,
  renderPosRegisterPage,
  renderPosSyncPage,
} from "../../build/apps/pos-web/src/app-shell/index.js";
import { operationsLedgerBridgeStyles } from "../../build/packages/ui/src/operations-ledger.js";

const shell = {
  displayName: "রহিম অপারেটর",
  tenantName: "Ozzyl Retail Group",
  permissions: new Set(["platform.register.use", "platform.device.read"]),
  offlineState: { online: true, pendingOperations: 0, lastSyncAt: "2026-08-03T00:10:00+06:00" },
  location: "Dhaka Flagship",
  businessDate: "Business date · 03 Aug 2026",
  locale: "bn",
};

const evidence = [
  { label: "Register session", value: "SESSION-DHK-03-991", detail: "Opened by the authenticated cashier" },
  { label: "Price snapshot", value: "PRICE-SNAP-8821", detail: "Effective for store and business date" },
  { label: "Posting boundary", value: "Awaiting payment confirmation", detail: "No stock or journal effect yet" },
];

test("shared Operations Ledger compatibility layer removes decorative module gradients and enforces ledger surfaces", () => {
  assert.match(operationsLedgerBridgeStyles, /data-operations-ledger-bridge/);
  assert.match(operationsLedgerBridgeStyles, /background-image:none/);
  assert.match(operationsLedgerBridgeStyles, /font-variant-numeric:tabular-nums/);
  assert.match(operationsLedgerBridgeStyles, /modg-metric-grid/);
  assert.doesNotMatch(operationsLedgerBridgeStyles, /linear-gradient/);
});

test("POS Register keeps scan, cart, payment boundary and provenance visible in offline mode", () => {
  const html = renderPosRegisterPage(
    { ...shell, offlineState: { online: false, pendingOperations: 2 } },
    {
      state: "offline",
      registerLabel: "REG-DHK-03",
      deviceLabel: "POS-ANDROID-03",
      businessDateLabel: "03 Aug 2026",
      syncLabel: "Offline · local queue active",
      pendingOperations: 2,
      customerLabel: "Walk-in",
      products: [
        { sku: "RICE-5KG", name: "Premium Basmati Rice 5 kg", unit: "bag", available: "18", price: "1,420.00", currency: "BDT", status: "sellable" },
        { sku: "OIL-5L", name: "Soybean Oil 5 L", unit: "bottle", available: "0", price: "920.00", currency: "BDT", status: "out_of_stock" },
      ],
      cart: [{ lineId: "LINE-1", sku: "RICE-5KG", name: "Premium Basmati Rice 5 kg", quantity: "1", unitPrice: "1,420.00", lineTotal: "1,420.00" }],
      subtotal: "1,420.00",
      discount: "0.00",
      tax: "0.00",
      total: "1,420.00",
      currency: "BDT",
      evidence,
      canSell: true,
      canDiscount: true,
    },
  );

  assert.match(html, /POS Register/);
  assert.match(html, /Scan barcode or search product/);
  assert.match(html, /Sellable product ledger/);
  assert.match(html, /Take payment/);
  assert.match(html, /Offline operating mode/);
  assert.match(html, /Local operations remain distinct from server-confirmed posting/);
  assert.match(html, /Sale provenance/);
  assert.match(html, /dir="ltr"/);
  assert.match(html, /lang="bn"/);
});

test("POS Sync exposes conflicts as blocking evidence instead of presenting queued work as confirmed", () => {
  const html = renderPosSyncPage(shell, {
    state: "conflict",
    registerLabel: "REG-DHK-03",
    businessDateLabel: "03 Aug 2026",
    lastSyncLabel: "Last sync 00:10",
    queued: 3,
    conflicts: 1,
    failed: 0,
    operations: [
      { localOperationId: "LOCAL-00031", kind: "sale.commit", createdAtLabel: "00:13:22", status: "conflict", attempts: 2 },
      { localOperationId: "LOCAL-00032", kind: "cash.movement", createdAtLabel: "00:14:05", status: "queued", attempts: 0 },
    ],
    evidence: [
      { label: "Local operation log", value: "OPLOG-REG-DHK-03", detail: "Durable local authority" },
      { label: "Server cursor", value: "CURSOR-88412", detail: "Last confirmed acknowledgement" },
    ],
    canRetry: false,
  });

  assert.match(html, /Sync &amp; Offline Operations/);
  assert.match(html, /Conflicts block blind replay/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Not confirmed/);
  assert.match(html, /Sync provenance/);
  assert.match(html, /disabled>Retry eligible</);
});

test("POS device diagnostics renders component health, evidence rail and RTL-safe shell", () => {
  const html = renderPosDevicePage(
    { ...shell, direction: "rtl", locale: "ar", displayName: "مشغل المتجر", location: "فرع دكا" },
    {
      state: "ready",
      registerLabel: "REG-DHK-03",
      deviceLabel: "POS-ANDROID-03",
      appVersion: "1.14.8",
      lastHeartbeatLabel: "12 seconds ago",
      syncLabel: "Online",
      components: [
        { component: "Barcode scanner", identity: "USB-SCN-03", status: "healthy", observedAtLabel: "00:18:12", detail: "HID input verified" },
        { component: "Receipt printer", identity: "EPSON-TM-T82", status: "attention", observedAtLabel: "00:18:05", detail: "Paper below 15%" },
      ],
      evidence: [
        { label: "Device registration", value: "DEVICE-DHK-03", detail: "Bound to register and store" },
        { label: "Heartbeat", value: "HB-77192", detail: "Signed device health event" },
      ],
      canManageDevice: true,
    },
  );

  assert.match(html, /Register &amp; Device Diagnostics/);
  assert.match(html, /Device health ledger/);
  assert.match(html, /Receipt printer/);
  assert.match(html, /Device provenance/);
  assert.match(html, /dir="rtl"/);
  assert.match(html, /مشغل المتجر/u);
  assert.match(html, /فرع دكا/u);
});
