import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import puppeteer from "puppeteer-core";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(
  root,
  "docs",
  "architecture",
  "storefront",
  "design-evidence",
);
const chromePath =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const axePath = path.join(root, "node_modules", "axe-core", "axe.min.js");
const origin = "http://127.0.0.1:4322";

const lowBandwidth3g = Object.freeze({
  id: "bounded-3g",
  offline: false,
  latency: 150,
  downloadThroughput: Math.floor((750 * 1024) / 8),
  uploadThroughput: Math.floor((250 * 1024) / 8),
  connectionType: "cellular3g",
});

const scenarios = [
  {
    id: "storefront-en-desktop",
    locale: "en-GB",
    direction: "ltr",
    width: 1440,
    height: 1000,
  },
  {
    id: "storefront-en-mobile",
    locale: "en-GB",
    direction: "ltr",
    width: 390,
    height: 844,
  },
  {
    id: "storefront-ar-tablet",
    locale: "ar",
    direction: "rtl",
    width: 820,
    height: 1000,
  },
  {
    id: "storefront-bn-low-bandwidth-mobile",
    locale: "bn-BD",
    direction: "ltr",
    width: 360,
    height: 800,
    network: lowBandwidth3g,
  },
  {
    id: "storefront-ja-cjk-tablet",
    locale: "ja-JP",
    direction: "ltr",
    width: 768,
    height: 900,
  },
];

function withTimeout(promise, milliseconds, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} exceeded ${milliseconds}ms`)),
      milliseconds,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function startStorefront() {
  const child = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["--workspace", "@ozzyl/storefront-web", "run", "dev"],
    {
      cwd: root,
      env: {
        ...process.env,
        STOREFRONT_EVIDENCE_MODE: "1",
        ASTRO_TELEMETRY_DISABLED: "1",
        NO_UPDATE_NOTIFIER: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  return { child, output: () => output };
}

async function waitForServer(server) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (server.child.exitCode !== null) {
      throw new Error(
        `Storefront dev server exited with ${server.child.exitCode}.\n${server.output()}`,
      );
    }
    try {
      const response = await fetch(
        `${origin}/evidence/storefront?locale=en-GB`,
        { signal: AbortSignal.timeout(1_000) },
      );
      if (response.ok) return;
    } catch {
      // The local server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Storefront dev server did not start.\n${server.output()}`);
}

async function stopServer(server) {
  if (server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (server.child.exitCode === null) server.child.kill("SIGKILL");
}

async function runDetector() {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      path.join(
        root,
        ".agents",
        "skills",
        "impeccable",
        "scripts",
        "detect.mjs",
      ),
      "--json",
      "apps/storefront-web",
    ],
    { cwd: root, timeout: 30_000 },
  );
  return JSON.parse(stdout || "[]");
}

function scenarioUrl(scenario) {
  const url = new URL("/evidence/storefront", origin);
  if (scenario.locale !== "en-GB") {
    url.searchParams.set("locale", scenario.locale);
  }
  return url.toString();
}

async function applyNetworkProfile(page, scenario) {
  if (!scenario.network) return null;
  const session = await page.createCDPSession();
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: scenario.network.offline,
    latency: scenario.network.latency,
    downloadThroughput: scenario.network.downloadThroughput,
    uploadThroughput: scenario.network.uploadThroughput,
    connectionType: scenario.network.connectionType,
  });
  return session;
}

async function collectScenario(browser, axeSource, scenario) {
  const page = await browser.newPage();
  let networkSession = null;
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(45_000);
  try {
    await page.setViewport({
      width: scenario.width,
      height: scenario.height,
      deviceScaleFactor: 1,
    });
    await page.emulateMediaFeatures([
      { name: "prefers-reduced-motion", value: "reduce" },
    ]);
    networkSession = await applyNetworkProfile(page, scenario);
    const navigationStartedAt = Date.now();
    await page.goto(scenarioUrl(scenario), {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForFunction(
      () => document.querySelectorAll("article.product-card").length === 4,
      { timeout: 20_000 },
    );
    const navigationDurationMs = Date.now() - navigationStartedAt;
    await page.addScriptTag({ content: axeSource });

    const accessibility = await withTimeout(
      page.evaluate(async () =>
        globalThis.axe.run(document, {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21aa"],
          },
        }),
      ),
      30_000,
      `${scenario.id} axe evaluation`,
    );

    const layout = await page.evaluate(() => {
      const rootElement = document.documentElement;
      const clipped = [...document.querySelectorAll("body *")]
        .filter((element) => {
          if (
            !(element instanceof HTMLElement) ||
            element.innerText.trim().length === 0
          ) {
            return false;
          }
          const style = getComputedStyle(element);
          const lineClamp = style.getPropertyValue("-webkit-line-clamp");
          const allowed =
            style.overflowX === "auto" ||
            style.overflowX === "scroll" ||
            style.textOverflow === "ellipsis" ||
            (lineClamp !== "" && lineClamp !== "none");
          return element.scrollWidth > element.clientWidth + 2 && !allowed;
        })
        .slice(0, 12)
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          text: element.innerText.trim().slice(0, 80),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }));
      const overflowers = [...document.querySelectorAll("body *")]
        .filter((element) => {
          if (!(element instanceof HTMLElement)) return false;
          const rect = element.getBoundingClientRect();
          return rect.right > innerWidth + 2 || rect.left < -2;
        })
        .slice(0, 12)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            className: element.className,
            text: element.innerText.trim().slice(0, 80),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
          };
        });
      scrollTo(10000, 0);
      const rootScrollX = scrollX;
      scrollTo(0, 0);
      const resources = performance.getEntriesByType("resource");
      return {
        viewportOverflow: rootScrollX > 2,
        rootScrollX,
        intrinsicScrollWidth: rootElement.scrollWidth,
        viewportWidth: innerWidth,
        clipped,
        overflowers,
        landmarks: {
          main: document.querySelectorAll("main").length,
          nav: document.querySelectorAll("nav").length,
          header: document.querySelectorAll("header").length,
          footer: document.querySelectorAll("footer").length,
        },
        articleCount: document.querySelectorAll("article.product-card").length,
        language: rootElement.lang,
        direction: rootElement.dir,
        upstreamBrandFound: /scalius/i.test(document.body.innerText),
        resourceCount: resources.length,
      };
    });

    await page.keyboard.press("Tab");
    const firstFocus = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      className: document.activeElement?.className,
      outline: document.activeElement
        ? getComputedStyle(document.activeElement).outlineStyle
        : "none",
    }));
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.activeElement?.id === "main-content",
      { timeout: 5_000 },
    );
    const skipTarget = await page.evaluate(
      () => document.activeElement?.id ?? "",
    );

    await page.evaluate(() => {
      document.documentElement.style.fontSize = "32px";
    });
    layout.scaledTextViewportOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 2,
    );
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "16px";
    });

    const screenshotPath = path.join(outputDir, `${scenario.id}.jpg`);
    await withTimeout(
      page.screenshot({
        path: screenshotPath,
        type: "jpeg",
        quality: 82,
        fullPage: true,
      }),
      30_000,
      `${scenario.id} screenshot`,
    );

    const violations = accessibility.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      description: violation.description,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        html: node.html,
        failureSummary: node.failureSummary,
      })),
    }));
    const passed =
      violations.length === 0 &&
      !layout.viewportOverflow &&
      layout.clipped.length === 0 &&
      layout.overflowers.length === 0 &&
      layout.articleCount === 4 &&
      layout.landmarks.main === 1 &&
      layout.landmarks.nav === 1 &&
      layout.landmarks.header === 1 &&
      layout.landmarks.footer === 1 &&
      layout.language === scenario.locale &&
      layout.direction === scenario.direction &&
      !layout.upstreamBrandFound &&
      firstFocus.className === "skip-link" &&
      firstFocus.outline !== "none" &&
      skipTarget === "main-content" &&
      layout.scaledTextViewportOverflow !== true;

    return {
      ...scenario,
      network: scenario.network
        ? {
            id: scenario.network.id,
            latencyMs: scenario.network.latency,
            downloadKbps: 750,
            uploadKbps: 250,
            applied: networkSession !== null,
          }
        : { id: "unthrottled", applied: false },
      navigationDurationMs,
      screenshot: path.relative(root, screenshotPath),
      violations,
      layout,
      keyboard: { firstFocus, skipTarget },
      passed,
    };
  } finally {
    if (networkSession) {
      await networkSession.detach().catch(() => undefined);
    }
    await page.close();
  }
}

await mkdir(outputDir, { recursive: true });
const server = startStorefront();
let browser;
const results = [];

try {
  await waitForServer(server);
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=none",
    ],
  });
  const axeSource = await readFile(axePath, "utf8");
  for (const scenario of scenarios) {
    results.push(
      await withTimeout(
        collectScenario(browser, axeSource, scenario),
        120_000,
        `${scenario.id} complete evidence`,
      ),
    );
  }
} finally {
  await browser?.close();
  await stopServer(server);
}

const detectorFindings = await runDetector();
const report = {
  generatedAt: new Date().toISOString(),
  chromePath,
  commands: [
    "npm ci",
    "npm --workspace @ozzyl/storefront-web run build",
    "node tooling/scripts/storefront-design-evidence.mjs",
    "node .agents/skills/impeccable/scripts/detect.mjs --json apps/storefront-web",
  ],
  syntheticOnly: true,
  detectorFindings,
  scenarios: results,
  summary: {
    passed: results.filter((result) => result.passed).length,
    total: results.length,
    axeViolations: results.reduce(
      (count, result) => count + result.violations.length,
      0,
    ),
    detectorFindings: detectorFindings.length,
    lowBandwidthScenarios: results.filter(
      (result) => result.network.id !== "unthrottled" && result.network.applied,
    ).length,
    locales: [...new Set(results.map((result) => result.locale))],
  },
};

await writeFile(
  path.join(outputDir, "report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
const rows = results
  .map(
    (result) =>
      `| ${result.id} | ${result.width}×${result.height} | ${result.locale}/${result.direction} | ${result.network.id} | ${result.violations.length} | ${result.layout.viewportOverflow ? "yes" : "no"} | ${result.layout.clipped.length} | ${result.passed ? "Pass" : "Fail"} |`,
  )
  .join("\n");
const screenshots = results
  .map(
    (result) =>
      `- [${result.id}](${path.basename(result.screenshot)})`,
  )
  .join("\n");
const markdown = `# Storefront Design Evidence\n\n**Generated:** ${report.generatedAt}\n\nSynthetic fixtures only. The evidence route returns 404 unless \`STOREFRONT_EVIDENCE_MODE=1\`. No production credentials or customer data were used.\n\n| Scenario | Viewport | Locale | Network | Axe violations | Viewport overflow | Unexpected clipping | Result |\n|---|---:|---|---|---:|---|---:|---|\n${rows}\n\n## Summary\n\n- Browser scenarios passed: ${report.summary.passed}/${report.summary.total}\n- WCAG axe violations: ${report.summary.axeViolations}\n- Impeccable deterministic findings: ${report.summary.detectorFindings}\n- Low-bandwidth browser scenarios: ${report.summary.lowBandwidthScenarios}\n- Locales exercised: ${report.summary.locales.join(", ")}\n- Four published product cards render in every scenario.\n- First Tab focuses the visible skip link; Enter moves focus to the main landmark.\n- English desktop/mobile, Bengali low-bandwidth mobile, Arabic RTL tablet and Japanese/CJK tablet layouts are checked.\n- Bengali mobile evidence runs under bounded 3G emulation at 750 Kbps down, 250 Kbps up and 150 ms latency.\n- Every scenario is rechecked at 200% root text size and reduced-motion mode.\n- Upstream product branding is absent from rendered content.\n\n## Screenshot evidence\n\n${screenshots}\n\nExact machine-readable results are in [report.json](report.json).\n`;
await writeFile(path.join(outputDir, "README.md"), markdown);

if (
  report.summary.passed !== report.summary.total ||
  report.summary.axeViolations > 0 ||
  report.summary.detectorFindings > 0 ||
  report.summary.lowBandwidthScenarios < 1 ||
  !report.summary.locales.includes("bn-BD") ||
  !report.summary.locales.includes("ja-JP")
) {
  console.error(JSON.stringify(report.summary));
  process.exit(1);
}

console.log(
  `Storefront design evidence passed ${report.summary.passed}/${report.summary.total} browser scenarios across ${report.summary.locales.length} locales with ${report.summary.lowBandwidthScenarios} low-bandwidth scenario`,
);
