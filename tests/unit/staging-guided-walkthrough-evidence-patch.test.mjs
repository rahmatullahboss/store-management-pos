import assert from "node:assert/strict";
import test from "node:test";
import { addGuidedWalkthroughBrowserEvidence } from "../../tooling/scripts/staging-guided-walkthrough-evidence-patch.mjs";

const source = `
      if (scenario.kind === "admin") {
        await sessionPage.keyboard.press("Home");
        await sessionPage.keyboard.press("Tab");
        await sessionPage.keyboard.press("Enter");
        metrics.skipFocusedMain = await sessionPage.evaluate(() => document.activeElement?.id === "main");
      }
      scenarios.push({
          evidence: {
            skipFocusedMain: metrics.skipFocusedMain ?? null,
          },
          passed: violations.length === 0 && (scenario.kind !== "admin" || metrics.skipFocusedMain === true),
      });
`;

test("staging browser evidence dismisses the first-use walkthrough before testing skip navigation", () => {
  const patched = addGuidedWalkthroughBrowserEvidence(source);

  assert.match(patched, /data-store-walkthrough/);
  assert.match(patched, /aria-modal/);
  assert.match(patched, /data-guide-dismiss/);
  assert.match(patched, /walkthroughOffered/);
  assert.match(patched, /walkthroughModal/);
  assert.match(patched, /walkthroughDismissed/);
  assert.match(patched, /scenario\.id !== "admin-dashboard-desktop"/);
  assert.match(patched, /metrics\.skipFocusedMain === true/);
  assert.equal(addGuidedWalkthroughBrowserEvidence(patched), patched);
});

test("staging browser evidence patch fails closed when its integration anchors drift", () => {
  assert.throws(
    () => addGuidedWalkthroughBrowserEvidence("const unrelated = true;"),
    /patch target is missing/,
  );
});
