import assert from "node:assert/strict";
import test from "node:test";
import { renderReceiptWorkspace } from "../../build/apps/pos-web/src/modules/register/receipts-surface.js";

function model(overrides = {}) {
  return {
    state: "ready",
    locale: "en-US",
    online: true,
    query: "R-20260729-0001",
    receipt: {
      id: "receipt-1",
      receiptNumber: "R-20260729-0001",
      businessDate: "2026-07-29",
      currency: "USD",
      scale: 2,
      totalMinor: 2_090n,
      renderStatus: "rendered",
      contentHash: "0123456789abcdef0123456789abcdef",
      createdAt: "2026-07-29T09:00:00.000Z",
    },
    canReprint: true,
    canDeliver: true,
    ...overrides,
  };
}

test("receipt workspace renders immutable exact receipt evidence and delivery actions", () => {
  const html = renderReceiptWorkspace(model());
  assert.match(html, /Immutable receipt snapshot/u);
  assert.match(html, /R-20260729-0001/u);
  assert.match(html, /\$20\.90/u);
  assert.match(html, /0123456789abcdef…/u);
  assert.match(html, /data-receipt-action="print"/u);
  assert.match(html, /data-receipt-action="email"/u);
  assert.match(html, /data-receipt-action="sms"/u);
  assert.doesNotMatch(html, /data-receipt-action="email"[^>]* disabled/u);
});

test("receipt workspace escapes query and receipt content", () => {
  const html = renderReceiptWorkspace(model({
    query: 'R-1"><script>alert(1)</script>',
    receipt: {
      ...model().receipt,
      receiptNumber: "R-<unsafe>",
      contentHash: "hash<&unsafe>0123456789",
    },
  }));
  assert.doesNotMatch(html, /<script>/u);
  assert.match(html, /R-1&quot;&gt;&lt;script&gt;/u);
  assert.match(html, /R-&lt;unsafe&gt;/u);
  assert.match(html, /hash&lt;&amp;unsafe&gt;/u);
});

test("offline receipt workspace keeps permitted local print and blocks remote delivery", () => {
  const html = renderReceiptWorkspace(model({ online: false }));
  assert.match(html, /Offline: local print remains available/u);
  assert.doesNotMatch(html, /data-receipt-action="print"[^>]* disabled/u);
  assert.match(html, /data-receipt-action="email"[^>]* disabled/u);
  assert.match(html, /data-receipt-action="sms"[^>]* disabled/u);
});

test("receipt workspace preserves exact money beyond JavaScript safe integers", () => {
  const html = renderReceiptWorkspace(model({
    receipt: {
      ...model().receipt,
      totalMinor: 9_007_199_254_740_993n,
    },
  }));
  assert.match(html, /USD 9007199254740993 × 10\^-2/u);
});

test("loading, not-found and error states expose accessible status without creating receipt actions", () => {
  const loading = renderReceiptWorkspace(model({ state: "loading", receipt: undefined }));
  const notFound = renderReceiptWorkspace(model({ state: "not_found", receipt: undefined }));
  const error = renderReceiptWorkspace(model({ state: "error", receipt: undefined }));

  assert.match(loading, /role="status"/u);
  assert.match(loading, /aria-busy="true"/u);
  assert.match(notFound, /role="alert"/u);
  assert.match(notFound, /No receipt matched/u);
  assert.match(error, /Do not create a replacement sale/u);
  assert.doesNotMatch(error, /data-receipt-action=/u);
});
