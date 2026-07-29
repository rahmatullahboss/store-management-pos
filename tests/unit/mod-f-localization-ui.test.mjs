import assert from "node:assert/strict";
import test from "node:test";
import {
  renderAdminShell,
  renderComplianceAdminPage,
  renderLocalizationAdminPage,
} from "../../build/apps/admin-web/src/app-shell/index.js";
import { renderLocalizationControlPage } from "../../build/apps/admin-web/src/modules/localization/page.js";
import {
  applyPosLocalization,
  renderPosLocalizationStatus,
} from "../../build/apps/pos-web/src/localization/register-adapter.js";

const shellInput = (permissions) => ({
  displayName: "Amina Rahman",
  tenantName: "Dhaka Retail",
  permissions,
  direction: "ltr",
  location: "Dhanmondi",
  businessDate: "Business date · 29 Jul 2026",
  locale: "bn-BD",
});

const activePack = (overrides = {}) => ({
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
  limitations: ["Fiscal submission requires an approved provider."],
  ...overrides,
});

const controlPage = (overrides = {}) => ({
  state: "ready",
  scopeLabel: "Bangladesh legal entity · Dhanmondi store",
  refreshedAt: "29 Jul 2026 17:30",
  activePack: activePack(),
  packs: [activePack()],
  queue: [{
    resourceId: "submission-001",
    kind: "fiscal_submission",
    status: "unknown",
    detail: "Provider result is unknown; blind retry is blocked.",
    observedAt: "29 Jul 2026 17:27",
    countryPackVersion: "bd-primary@1.0.0",
    actionRequired: true,
  }],
  legalNumbersRemaining: "998,421",
  unknownFiscalCount: 1,
  pendingPrivacyCount: 2,
  immutableDocumentCount: 1432,
  dataResidencySummary: "Primary and backup storage remain in approved Singapore regions.",
  canManagePacks: true,
  canManageCompliance: true,
  ...overrides,
});

const registerModel = (overrides = {}) => ({
  state: "ready",
  locale: "en-GB",
  currency: "GBP",
  scale: 2,
  online: false,
  pendingOperations: 2,
  registerLabel: "DHK-01 / Register 2",
  shiftStatus: "open",
  cashierName: "Amina Rahman",
  cartReference: "CART-001",
  lines: [],
  subtotalMinor: 1000n,
  discountMinor: 0n,
  taxMinor: 0n,
  payableMinor: 1000n,
  tenders: [],
  canCheckout: true,
  ...overrides,
});

const capabilities = (overrides = {}) => ({
  taxConfiguration: true,
  accountingMapping: true,
  legalReceipts: true,
  legalInvoices: true,
  creditDebitDocuments: true,
  fiscalSubmission: false,
  electronicInvoicing: false,
  privacyWorkflow: true,
  offlineLegalCapability: "cash_only",
  ...overrides,
});

const localizationSnapshot = (overrides = {}) => ({
  packId: "bd-primary",
  packVersion: "1.0.0",
  countryCode: "BD",
  locale: "bn-BD",
  direction: "ltr",
  currency: "BDT",
  accountingScale: 2,
  supportLevel: "limited",
  capabilities: capabilities(),
  limitations: ["Offline legal checkout is cash-only."],
  ...overrides,
});

test("admin shell exposes MOD-F routes only with matching read permissions", () => {
  const visible = renderAdminShell({
    ...shellInput(new Set(["localization.pack.read", "localization.document.read"])),
    currentPath: "/localization",
    content: "<main>Fixture</main>",
  });
  assert.match(visible, /href="\/localization"/u);
  assert.match(visible, />Country packs</u);
  assert.match(visible, /href="\/compliance"/u);
  assert.match(visible, />Compliance</u);

  const hidden = renderAdminShell({
    ...shellInput(new Set()),
    currentPath: "/",
    content: "<main>Fixture</main>",
  });
  assert.doesNotMatch(hidden, /href="\/localization"/u);
  assert.doesNotMatch(hidden, /href="\/compliance"/u);
});

test("localization and compliance admin pages preserve focus, permissions and escaped evidence", () => {
  const page = controlPage({
    scopeLabel: 'Bangladesh <script>alert("scope")</script>',
    packs: [activePack({ limitations: ["Provider <unsafe> is disabled."] })],
    queue: [{
      resourceId: "submission-<unsafe>",
      kind: "fiscal_submission",
      status: "unknown",
      detail: "Do not <retry> blindly.",
      observedAt: "29 Jul 2026 17:27",
      countryPackVersion: "bd-primary@1.0.0",
      actionRequired: true,
    }],
    canManagePacks: false,
    canManageCompliance: false,
  });
  const localization = renderLocalizationAdminPage(
    shellInput(new Set(["localization.pack.read"])),
    page,
  );
  assert.match(localization, /data-focus="country_packs"/u);
  assert.match(localization, /aria-current="page">Country packs/u);
  assert.match(localization, /Limited support/u);
  assert.match(localization, /Publish pack<\/button>/u);
  assert.match(localization, /Publish pack<\/button>/u);
  assert.match(localization, /button[^>]* disabled[^>]*>Review activation/u);
  assert.doesNotMatch(localization, /<script>/u);
  assert.match(localization, /Bangladesh &lt;script&gt;/u);
  assert.match(localization, /Provider &lt;unsafe&gt;/u);

  const compliance = renderComplianceAdminPage(
    shellInput(new Set(["localization.document.read"])),
    page,
  );
  assert.match(compliance, /data-focus="compliance"/u);
  assert.match(compliance, /aria-current="page">Compliance evidence/u);
  assert.match(compliance, /Unknown/u);
  assert.match(compliance, /submission-&lt;unsafe&gt;/u);
  assert.match(compliance, /Do not &lt;retry&gt; blindly/u);
  assert.match(compliance, /button[^>]* disabled[^>]*>Open evidence/u);
});

test("localization page states remain accessible and do not fabricate actions", () => {
  const loading = renderLocalizationControlPage(controlPage({ state: "loading", packs: [], queue: [] }));
  const denied = renderLocalizationControlPage(controlPage({ state: "denied", packs: [], queue: [] }));
  assert.match(loading, /role="status"/u);
  assert.match(loading, /aria-busy="true"/u);
  assert.match(denied, /role="alert"/u);
  assert.match(denied, /Localization permission required/u);
  assert.match(denied, /No published country-pack versions/u);
});

test("POS localization fails closed for unsupported offline legal checkout", () => {
  const localized = applyPosLocalization(
    registerModel(),
    localizationSnapshot({ capabilities: capabilities({ offlineLegalCapability: "unsupported" }) }),
  );
  assert.equal(localized.model.locale, "bn-BD");
  assert.equal(localized.model.currency, "BDT");
  assert.equal(localized.model.scale, 2);
  assert.equal(localized.model.canCheckout, false);
  assert.equal(localized.blockCode, "OFFLINE_LEGAL_UNSUPPORTED");
  assert.match(localized.model.checkoutBlockReason, /Restore connectivity/u);
  const status = renderPosLocalizationStatus(localized);
  assert.match(status, /role="alert"/u);
  assert.match(status, /OFFLINE_LEGAL_UNSUPPORTED/u);
  assert.match(status, /dir="ltr"/u);
});

test("cash-only capability permits cash but blocks non-cash tenders offline", () => {
  const cashOnly = applyPosLocalization(
    registerModel({
      tenders: [{ tenderId: "cash-1", kind: "cash", label: "Cash", amountMinor: 1000n, state: "accepted" }],
    }),
    localizationSnapshot(),
  );
  assert.equal(cashOnly.model.canCheckout, true);
  assert.equal(cashOnly.blockCode, undefined);

  const card = applyPosLocalization(
    registerModel({
      tenders: [{ tenderId: "card-1", kind: "external_card", label: "Card", amountMinor: 1000n, state: "authorized" }],
    }),
    localizationSnapshot(),
  );
  assert.equal(card.model.canCheckout, false);
  assert.equal(card.blockCode, "OFFLINE_CASH_ONLY");
  assert.match(card.model.checkoutBlockReason, /Remove non-cash tenders/u);
});

test("POS localization validates metadata and renders RTL status safely", () => {
  const rtl = applyPosLocalization(
    registerModel({ online: true }),
    localizationSnapshot({
      packId: 'xz-<unsafe>',
      packVersion: "2.0.0",
      countryCode: "XZ",
      locale: "ar-XZ",
      direction: "rtl",
      currency: "XZD",
      accountingScale: 3,
      supportLevel: "experimental",
      capabilities: capabilities({ offlineLegalCapability: "fully_supported" }),
      limitations: [],
    }),
  );
  assert.equal(rtl.model.canCheckout, true);
  assert.equal(rtl.model.locale, "ar-XZ");
  assert.equal(rtl.model.scale, 3);
  const status = renderPosLocalizationStatus(rtl);
  assert.match(status, /dir="rtl"/u);
  assert.match(status, /xz-&lt;unsafe&gt;/u);
  assert.doesNotMatch(status, /xz-<unsafe>/u);

  assert.throws(
    () => applyPosLocalization(registerModel(), localizationSnapshot({ currency: "bdt" })),
    /ISO 4217/u,
  );
  assert.throws(
    () => applyPosLocalization(registerModel(), localizationSnapshot({ accountingScale: 13 })),
    /integer from 0 to 12/u,
  );
});
