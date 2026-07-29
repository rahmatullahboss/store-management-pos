import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import puppeteer from "puppeteer-core";

import {
  renderComplianceAdminPage,
  renderLocalizationAdminPage,
} from "../../build/apps/admin-web/src/app-shell/index.js";
import {
  applyPosLocalization,
  MOD_F_POS_LOCALIZATION_STYLES,
  renderPosLocalizationStatus,
} from "../../build/apps/pos-web/src/localization/register-adapter.js";
import { renderAppShell } from "../../build/packages/ui/src/app-shell.js";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(root, "docs", "architecture", "mod-f", "design-evidence");
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const axePath = path.join(root, "node_modules", "axe-core", "axe.min.js");
const adminPermissions = new Set([
  "localization.pack.read",
  "localization.pack.activate",
  "localization.document.read",
  "localization.document.publish",
  "localization.fiscal.read",
  "localization.fiscal.submit",
  "localization.privacy.read",
  "localization.privacy.execute",
]);

const activePack = {
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
  limitations: [
    "Fiscal submission requires an approved provider.",
    "Local legal and accounting review is required before production activation.",
  ],
};

function controlPage(state = "ready") {
  return {
    state,
    scopeLabel: "Bangladesh legal entity · Dhanmondi store",
    refreshedAt: "29 Jul 2026 18:00",
    activePack: state === "empty" ? undefined : activePack,
    packs: state === "empty" ? [] : [activePack, {
      ...activePack,
      packId: "bd-primary-next",
      version: "1.1.0",
      lifecycleStatus: "scheduled",
      effectiveFrom: "2026-10-01",
      supportLevel: "experimental",
      offlineLegalCapability: "unsupported",
    }],
    queue: state === "empty" ? [] : [{
      resourceId: "submission-20260729-001",
      kind: "fiscal_submission",
      status: "unknown",
      detail: "Provider effect may have completed; blind retry is blocked.",
      observedAt: "29 Jul 2026 17:57",
      countryPackVersion: "bd-primary@1.0.0",
      actionRequired: true,
    }, {
      resourceId: "privacy-20260729-002",
      kind: "privacy_operation",
      status: "review",
      detail: "Completion evidence requires an immutable invoice reference.",
      observedAt: "29 Jul 2026 17:42",
      countryPackVersion: "bd-primary@1.0.0",
      actionRequired: true,
    }],
    legalNumbersRemaining: "998,421",
    unknownFiscalCount: state === "empty" ? 0 : 1,
    pendingPrivacyCount: state === "empty" ? 0 : 2,
    immutableDocumentCount: 1432,
    dataResidencySummary: "Primary and backup storage remain in approved Singapore regions.",
    canManagePacks: state !== "denied",
    canManageCompliance: state !== "denied",
  };
}

function registerModel() {
  return {
    state: "ready",
    locale: "en-GB",
    currency: "GBP",
    scale: 2,
    online: false,
    pendingOperations: 3,
    registerLabel: "DHK-01 / Register 2",
    shiftStatus: "open",
    cashierName: "Synthetic Cashier",
    cartReference: "CART-20260729-001",
    lines: [],
    subtotalMinor: 125000n,
    discountMinor: 0n,
    taxMinor: 0n,
    payableMinor: 125000n,
    tenders: [{ tenderId: "card-1", kind: "external_card", label: "Card", amountMinor: 125000n, state: "authorized" }],
    canCheckout: true,
  };
}

function posSnapshot() {
  return {
    packId: "bd-primary",
    packVersion: "1.0.0",
    countryCode: "BD",
    locale: "bn-BD",
    direction: "ltr",
    currency: "BDT",
    accountingScale: 2,
    supportLevel: "limited",
    capabilities: {
      taxConfiguration: true,
      accountingMapping: true,
      legalReceipts: true,
      legalInvoices: true,
      creditDebitDocuments: true,
      fiscalSubmission: false,
      electronicInvoicing: false,
      privacyWorkflow: true,
      offlineLegalCapability: "cash_only",
    },
    limitations: ["Offline legal checkout is cash-only."],
  };
}

const scenarios = [
  { id: "country-pack-en-ready-desktop", surface: "localization", locale: "en-GB", direction: "ltr", state: "ready", width: 1440, height: 1000 },
  { id: "compliance-ar-rtl-tablet", surface: "compliance", locale: "ar", direction: "rtl", state: "ready", width: 1024, height: 900 },
  { id: "country-pack-bn-denied-mobile", surface: "localization", locale: "bn-BD", direction: "ltr", state: "denied", width: 390, height: 844 },
  { id: "pos-bn-offline-card-block-mobile", surface: "pos", locale: "bn-BD", direction: "ltr", state: "blocked", width: 390, height: 844 },
];

function renderPosScenario() {
  const localized = applyPosLocalization(registerModel(), posSnapshot());
  const content = `<style>${MOD_F_POS_LOCALIZATION_STYLES}</style>
    <section class="modf-pos-evidence" aria-labelledby="modf-pos-evidence-title">
      <header><p>Country capability evidence</p><h1 id="modf-pos-evidence-title">Offline checkout review</h1><span>DHK-01 · Business date 29 Jul 2026</span></header>
      ${renderPosLocalizationStatus(localized)}
      <section class="modf-pos-command" aria-labelledby="modf-pos-command-title">
        <h2 id="modf-pos-command-title">Checkout remains blocked</h2>
        <dl><div><dt>Payable</dt><dd>BDT 1,250.00</dd></div><div><dt>Tender</dt><dd>External card</dd></div><div><dt>Pending sync</dt><dd>3 operations</dd></div></dl>
        <p role="alert">${localized.model.checkoutBlockReason}</p>
        <button type="button" disabled>Complete checkout</button>
      </section>
    </section>
    <style>.modf-pos-evidence{display:grid;gap:14px}.modf-pos-evidence>header{display:grid;gap:3px}.modf-pos-evidence h1{margin:0;font-size:clamp(2rem,5vw,3.2rem)}.modf-pos-evidence header p,.modf-pos-evidence header span{margin:0;color:#59675f}.modf-pos-command{background:#fffefa;border:1px solid #d7ddd8;padding:16px}.modf-pos-command h2{margin:0 0 12px}.modf-pos-command dl{display:grid;gap:8px;margin:0}.modf-pos-command dl div{display:flex;justify-content:space-between;gap:14px;border-bottom:1px solid #d7ddd8;padding-bottom:7px}.modf-pos-command dt,.modf-pos-command dd{margin:0}.modf-pos-command dd{font-weight:800}.modf-pos-command p{border:1px solid #9b2c2c;background:#fff2f0;color:#6a2525;padding:11px}.modf-pos-command button{width:100%;min-height:48px;border:0;background:#14251e;color:white;font-weight:850}.modf-pos-command button:disabled{opacity:.5}@media(max-width:620px){.modf-pos-evidence h1{font-size:2rem}}</style>`;
  return renderAppShell({
    title: "Store Management POS",
    identity: { displayName: "Synthetic Cashier", tenantName: "কৃত্রিম রিটেইল", permissions: new Set(["pos.checkout.execute"]) },
    routes: [{ path: "/", label: "Register", permission: "pos.checkout.execute", offlineAvailable: true }],
    currentPath: "/",
    content,
    direction: "ltr",
    offline: true,
    variant: "pos",
    context: { workspace: "Point of sale", location: "ঢাকা", businessDate: "Business date · 29 Jul 2026", locale: "bn-BD" },
  });
}

function renderScenario(scenario) {
  if (scenario.surface === "pos") return renderPosScenario();
  const base = {
    displayName: "Synthetic Compliance Manager",
    tenantName: scenario.direction === "rtl" ? "متجر اصطناعي" : scenario.locale.startsWith("bn") ? "কৃত্রিম রিটেইল" : "Synthetic Retail",
    permissions: scenario.state === "denied" ? new Set([scenario.surface === "localization" ? "localization.pack.read" : "localization.document.read"]) : adminPermissions,
    direction: scenario.direction,
    location: scenario.direction === "rtl" ? "فرع دكا" : scenario.locale.startsWith("bn") ? "ঢাকা শাখা" : "Dhaka branch",
    businessDate: "Business date · 29 Jul 2026",
    locale: scenario.locale,
  };
  return scenario.surface === "localization"
    ? renderLocalizationAdminPage(base, controlPage(scenario.state))
    : renderComplianceAdminPage(base, controlPage(scenario.state));
}

async function runDetector() {
  const { stdout } = await execFileAsync(process.execPath, [path.join(root, ".agents", "skills", "impeccable", "scripts", "detect.mjs"), "--json", "apps/admin-web/src/modules/localization", "apps/pos-web/src/localization"], { cwd: root });
  return JSON.parse(stdout || "[]");
}

await mkdir(outputDir, { recursive: true });
const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"] });
const axeSource = await readFile(axePath, "utf8");
const results = [];

try {
  for (const scenario of scenarios) {
    const page = await browser.newPage();
    await page.setViewport({ width: scenario.width, height: scenario.height, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.setContent(renderScenario(scenario), { waitUntil: "load" });
    await page.addScriptTag({ content: axeSource });

    const accessibility = await page.evaluate(async () => globalThis.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }));
    const layout = await page.evaluate(() => {
      const allowedSelector = ".modf-table-wrap,.primary-nav";
      const clipped = [...document.querySelectorAll("body *")].filter((element) => {
        if (!(element instanceof HTMLElement) || element.innerText.trim().length === 0) return false;
        const style = getComputedStyle(element);
        const allowed = style.overflowX === "auto" || style.overflowX === "scroll" || style.textOverflow === "ellipsis" || element.matches(allowedSelector) || element.closest(allowedSelector);
        return element.scrollWidth > element.clientWidth + 2 && !allowed;
      }).slice(0, 12).map((element) => ({ tag: element.tagName, className: element.className, text: element.innerText.trim().slice(0, 80), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
      const overflowers = [...document.querySelectorAll("body *")].filter((element) => {
        if (!(element instanceof HTMLElement) || element.matches(allowedSelector) || element.closest(allowedSelector)) return false;
        const rect = element.getBoundingClientRect();
        return rect.right > innerWidth + 2 || rect.left < -2;
      }).slice(0, 12).map((element) => { const rect = element.getBoundingClientRect(); return { tag: element.tagName, className: element.className, text: element.innerText.trim().slice(0, 80), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) }; });
      scrollTo(10000, 0);
      const rootScrollX = scrollX;
      scrollTo(0, 0);
      return {
        viewportOverflow: rootScrollX > 2,
        clipped,
        overflowers,
        landmarks: { main: document.querySelectorAll("main").length, nav: document.querySelectorAll("nav").length, header: document.querySelectorAll("header").length },
        language: document.documentElement.lang,
        direction: document.documentElement.dir,
      };
    });

    await page.keyboard.press("Tab");
    const firstFocus = await page.evaluate(() => ({ className: document.activeElement?.className, outline: document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : "none" }));
    await page.keyboard.press("Enter");
    const skipTarget = await page.evaluate(() => document.activeElement?.id ?? "");

    if (scenario.width >= 1200) {
      await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
      layout.scaledTextViewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
      await page.evaluate(() => { document.documentElement.style.fontSize = "16px"; });
    }

    const screenshotPath = path.join(outputDir, `${scenario.id}.jpg`);
    await page.screenshot({ path: screenshotPath, type: "jpeg", quality: 82, fullPage: true });
    const violations = accessibility.violations.map((violation) => ({ id: violation.id, impact: violation.impact, description: violation.description, nodes: violation.nodes.map((node) => ({ target: node.target, html: node.html, failureSummary: node.failureSummary })) }));
    const passed = violations.length === 0
      && !layout.viewportOverflow
      && layout.clipped.length === 0
      && layout.overflowers.length === 0
      && layout.landmarks.main === 1
      && firstFocus.className === "skip-link"
      && firstFocus.outline !== "none"
      && skipTarget === "main"
      && layout.language === scenario.locale
      && layout.direction === scenario.direction
      && layout.scaledTextViewportOverflow !== true;
    results.push({ ...scenario, screenshot: path.relative(root, screenshotPath), violations, layout, keyboard: { firstFocus, skipTarget }, passed });
    await page.close();
  }
} finally {
  await browser.close();
}

const detectorFindings = await runDetector();
const report = {
  generatedAt: new Date().toISOString(),
  chromePath,
  commands: ["npm run build", "node tooling/scripts/mod-f-design-evidence.mjs"],
  detectorFindings,
  scenarios: results,
  summary: {
    passed: results.filter((result) => result.passed).length,
    total: results.length,
    axeViolations: results.reduce((count, result) => count + result.violations.length, 0),
    detectorFindings: detectorFindings.length,
  },
};

await writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const rows = results.map((result) => `| ${result.id} | ${result.width}×${result.height} | ${result.locale}/${result.direction} | ${result.state} | ${result.violations.length} | ${result.layout.viewportOverflow ? "yes" : "no"} | ${result.layout.clipped.length} | ${result.layout.overflowers.length} | ${result.passed ? "Pass" : "Fail"} |`).join("\n");
const screenshots = results.map((result) => `- [${result.id}](${path.basename(result.screenshot)})`).join("\n");
const markdown = `# MOD-F Design Evidence\n\n**Generated:** ${report.generatedAt}\n\nSynthetic fixtures only. No production credentials, legal documents or personal data were used.\n\n| Scenario | Viewport | Locale | State | Axe violations | Viewport overflow | Unexpected clipping | Off-viewport elements | Result |\n|---|---:|---|---|---:|---|---:|---:|---|\n${rows}\n\n## Summary\n\n- Browser scenarios passed: ${report.summary.passed}/${report.summary.total}\n- WCAG 2 A/AA and WCAG 2.1 AA axe violations: ${report.summary.axeViolations}\n- Impeccable deterministic findings: ${report.summary.detectorFindings}\n- Keyboard contract: first Tab focuses the visible skip link; Enter moves focus to the single main landmark.\n- Reduced-motion mode is enabled for every scenario.\n- The English desktop scenario is rechecked at 200% root text size.\n- Bengali mobile, Arabic RTL tablet and offline POS fail-closed evidence are included.\n\n## Screenshot evidence\n\n${screenshots}\n\nExact machine-readable results are in [report.json](report.json).\n`;
await writeFile(path.join(outputDir, "README.md"), markdown);

if (report.summary.passed !== report.summary.total || report.summary.axeViolations > 0 || report.summary.detectorFindings > 0) {
  console.error(JSON.stringify(report.summary));
  process.exit(1);
}

console.log(`MOD-F design evidence passed ${report.summary.passed}/${report.summary.total} browser scenarios`);
