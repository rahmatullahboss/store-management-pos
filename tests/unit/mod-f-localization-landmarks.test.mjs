import assert from "node:assert/strict";
import test from "node:test";
import {
  renderComplianceAdminPage,
  renderLocalizationAdminPage,
} from "../../build/apps/admin-web/src/app-shell/index.js";

const input = {
  displayName: "Synthetic Compliance Manager",
  tenantName: "Synthetic Retail",
  permissions: new Set(["localization.pack.read", "localization.document.read"]),
  locale: "en-GB",
};

const page = {
  state: "ready",
  scopeLabel: "Synthetic legal entity",
  refreshedAt: "29 Jul 2026 18:00",
  activePack: {
    packId: "bd-primary",
    countryCode: "BD",
    version: "1.0.0",
    supportLevel: "limited",
    lifecycleStatus: "active",
    defaultLocale: "bn-BD",
    effectiveFrom: "2026-07-01",
    offlineLegalCapability: "cash_only",
    fiscalSubmission: false,
    electronicInvoicing: false,
    limitations: ["Local review required."],
  },
  packs: [],
  queue: [],
  legalNumbersRemaining: "999",
  unknownFiscalCount: 0,
  pendingPrivacyCount: 0,
  immutableDocumentCount: 1,
  dataResidencySummary: "Synthetic evidence only.",
  canManagePacks: false,
  canManageCompliance: false,
};

for (const [name, render] of [
  ["country-pack", renderLocalizationAdminPage],
  ["compliance", renderComplianceAdminPage],
]) {
  test(`${name} admin workspace has one main landmark and accessible table regions`, () => {
    const html = render(input, page);
    assert.equal((html.match(/<main\b/gu) ?? []).length, 1);
    assert.equal((html.match(/<section class="modf-control"/gu) ?? []).length, 1);
    assert.equal((html.match(/class="modf-table-wrap" tabindex="0" role="region"/gu) ?? []).length, 2);
    assert.match(html, /aria-label="Country-pack versions table"/u);
    assert.match(html, /aria-label="Compliance evidence table"/u);
    assert.match(html, /<main class="shell-main" id="main" tabindex="-1">/u);
    assert.match(html, /<section class="modf-control"[^>]*aria-labelledby="modf-title"/u);
    assert.doesNotMatch(html, /<main class="modf-control"/u);
  });
}
