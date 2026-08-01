import assert from "node:assert/strict";
import test from "node:test";
import { hardenAdminDocumentAccessibility } from "../../build/apps/api/src/staging-admin-accessibility.js";

test("Admin accessibility hardening keeps one main landmark and focuses the POS table region", () => {
  const input = '<!doctype html><html><body><main id="main"><main class="pos-reconciliation"><h1>POS reconciliation</h1><div class="pos-reconciliation__table-wrap"><table><tr><td>Evidence</td></tr></table></div></main></main></body></html>';
  const output = hardenAdminDocumentAccessibility(input);

  assert.equal((output.match(/<main\b/gu) ?? []).length, 1);
  assert.equal((output.match(/<section class="pos-reconciliation"/gu) ?? []).length, 1);
  assert.match(output, /class="pos-reconciliation__table-wrap" tabindex="0" role="region" aria-label="POS reconciliation evidence table"/u);
  assert.doesNotMatch(output, /<main class="pos-reconciliation"/u);
});

test("Admin accessibility hardening is idempotent and leaves unrelated documents unchanged", () => {
  const hardened = '<main id="main"><section class="pos-reconciliation"><div class="pos-reconciliation__table-wrap" tabindex="0" role="region" aria-label="POS reconciliation evidence table"></div></section></main>';
  assert.equal(hardenAdminDocumentAccessibility(hardened), hardened);

  const unrelated = '<main id="main"><section><h1>Inventory</h1></section></main>';
  assert.equal(hardenAdminDocumentAccessibility(unrelated), unrelated);
});
