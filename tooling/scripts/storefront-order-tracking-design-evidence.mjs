import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(
  root,
  "docs",
  "architecture",
  "storefront",
  "order-tracking-design-evidence",
);
const chromePath =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const axePath = path.join(root, "node_modules", "axe-core", "axe.min.js");
const origin = "http://127.0.0.1:4322";

const bounded3g = Object.freeze({
  offline: false,
  latency: 150,
  downloadThroughput: Math.floor((750 * 1024) / 8),
  uploadThroughput: Math.floor((250 * 1024) / 8),
  connectionType: "cellular3g",
});

const scenarios = [
  {
    id: "order-tracking-en-mobile",
    locale: "en-GB",
    direction: "ltr",
    width: 390,
    height: 844,
    expectedStateLabel: "Needs attention",
  },
  {
    id: "order-tracking-bn-bounded-3g",
    locale: "bn-BD",
    direction: "ltr",
    width: 360,
    height: 800,
    network: bounded3g,
    expectedStateLabel: "পর্যালোচনা প্রয়োজন",
  },
  {
    id: "order-tracking-ar-rtl",
    locale: "ar",
    direction: "rtl",
    width: 820,
    height: 1000,
    expectedStateLabel: "يتطلب مراجعة",
  },
  {
    id: "order-tracking-ja-cjk",
    locale: "ja-JP",
    direction: "ltr",
    width: 768,
    height: 900,
    expectedStateLabel: "確認が必要",
  },
];

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
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      output += chunk.toString();
    });
  }
  return { child, output: () => output };
}

function terminateProcessGroup(child, signal) {
  if (child.exitCode !== null) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function stopServer(server) {
  if (server.child.exitCode !== null) return;
  terminateProcessGroup(server.child, "SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  terminateProcessGroup(server.child, "SIGKILL");
}

async function waitForServer(server) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (server.child.exitCode !== null) {
      throw new Error(
        `Storefront order tracking evidence server exited with ${server.child.exitCode}.\n${server.output()}`,
      );
    }
    try {
      const response = await fetch(
        `${origin}/evidence/order-tracking?locale=en-GB`,
        { signal: AbortSignal.timeout(1_000) },
      );
      if (response.ok) return;
    } catch {
      // Evidence server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Storefront order tracking evidence server did not start.\n${server.output()}`);
}

function scenarioUrl(scenario) {
  const url = new URL("/evidence/order-tracking", origin);
  url.searchParams.set("locale", scenario.locale);
  return url.toString();
}

async function applyNetworkProfile(page, scenario) {
  if (!scenario.network) return null;
  const session = await page.createCDPSession();
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", scenario.network);
  return session;
}

async function collectScenario(browser, axeSource, scenario) {
  const page = await browser.newPage();
  let networkSession = null;
  try {
    page.setDefaultTimeout(20_000);
    page.setDefaultNavigationTimeout(45_000);
    await page.setViewport({
      width: scenario.width,
      height: scenario.height,
      deviceScaleFactor: 1,
    });
    await page.emulateMediaFeatures([
      { name: "prefers-reduced-motion", value: "reduce" },
    ]);
    networkSession = await applyNetworkProfile(page, scenario);
    const startedAt = Date.now();
    await page.goto(scenarioUrl(scenario), {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForSelector(".order-tracking", { timeout: 20_000 });
    const navigationDurationMs = Date.now() - startedAt;
    await page.addScriptTag({ content: axeSource });
    const accessibility = await page.evaluate(async () =>
      globalThis.axe.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21aa"],
        },
      }),
    );

    const layout = await page.evaluate(() => {
      const clipped = [...document.querySelectorAll("body *")]
        .filter((element) => {
          if (!(element instanceof HTMLElement) || element.innerText.trim().length === 0) {
            return false;
          }
          const style = getComputedStyle(element);
          const allowed =
            style.overflowX === "auto" ||
            style.overflowX === "scroll" ||
            style.textOverflow === "ellipsis";
          return element.scrollWidth > element.clientWidth + 2 && !allowed;
        })
        .slice(0, 12)
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          text: element.innerText.trim().slice(0, 100),
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
            left: rect.left,
            right: rect.right,
          };
        });
      const bodyText = document.body.innerText;
      return {
        language: document.documentElement.lang,
        direction: document.documentElement.dir,
        viewportOverflow: document.documentElement.scrollWidth > innerWidth + 2,
        clipped,
        overflowers,
        panelCount: document.querySelectorAll(".order-tracking").length,
        trackingState: document.querySelector(".order-tracking")?.getAttribute("data-tracking-state"),
        stateLabel: document.querySelector(".order-tracking__state")?.textContent?.trim() ?? "",
        totalText: document.querySelector(".order-tracking__meta strong")?.textContent?.trim() ?? "",
        itemCount: document.querySelectorAll("[data-order-line]").length,
        rawEnumLeak: /partially_fulfilled|partially_paid|partially_returned|ship_from_store/u.test(bodyText),
        internalLeak: /payment-intent|reservation-secret|warehouse-secret|r2\/private|staff-secret/iu.test(bodyText),
        upstreamBrandFound: /scalius/iu.test(bodyText),
      };
    });

    await page.keyboard.press("Tab");
    const firstFocus = await page.evaluate(() => ({
      className: document.activeElement?.className ?? "",
      outline: document.activeElement
        ? getComputedStyle(document.activeElement).outlineStyle
        : "none",
    }));
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.activeElement?.id === "order-status",
      { timeout: 5_000 },
    );
    const skipTarget = await page.evaluate(() => document.activeElement?.id ?? "");

    await page.evaluate(() => {
      document.documentElement.style.fontSize = "32px";
    });
    const scaledTextViewportOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 2,
    );
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "16px";
    });

    const screenshotPath = path.join(outputDir, `${scenario.id}.jpg`);
    await page.screenshot({
      path: screenshotPath,
      type: "jpeg",
      quality: 82,
      fullPage: true,
    });

    const violations = accessibility.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      description: violation.description,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        failureSummary: node.failureSummary,
      })),
    }));
    const passed =
      violations.length === 0 &&
      layout.language === scenario.locale &&
      layout.direction === scenario.direction &&
      layout.panelCount === 1 &&
      layout.trackingState === "attention" &&
      layout.stateLabel === scenario.expectedStateLabel &&
      layout.totalText === "BHD 123456.789" &&
      layout.itemCount === 1 &&
      !layout.rawEnumLeak &&
      !layout.internalLeak &&
      !layout.upstreamBrandFound &&
      !layout.viewportOverflow &&
      layout.clipped.length === 0 &&
      layout.overflowers.length === 0 &&
      firstFocus.className === "skip-link" &&
      firstFocus.outline !== "none" &&
      skipTarget === "order-status" &&
      !scaledTextViewportOverflow;

    return {
      ...scenario,
      network: scenario.network
        ? {
            id: "bounded-3g",
            applied: networkSession !== null,
            latencyMs: 150,
            downloadKbps: 750,
            uploadKbps: 250,
          }
        : { id: "unthrottled", applied: false },
      navigationDurationMs,
      screenshot: path.relative(root, screenshotPath),
      violations,
      layout,
      keyboard: { firstFocus, skipTarget },
      scaledTextViewportOverflow,
      passed,
    };
  } finally {
    if (networkSession) await networkSession.detach().catch(() => undefined);
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
    results.push(await collectScenario(browser, axeSource, scenario));
  }
} finally {
  await browser?.close();
  await stopServer(server);
}

const summary = {
  total: results.length,
  passed: results.filter((result) => result.passed).length,
  axeViolations: results.reduce(
    (sum, result) => sum + result.violations.length,
    0,
  ),
};
const report = {
  generatedAt: new Date().toISOString(),
  chromePath,
  scenarios: results,
  summary,
};
await writeFile(
  path.join(outputDir, "report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

if (summary.passed !== summary.total || summary.axeViolations !== 0) {
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  console.log(
    `Storefront order tracking evidence passed ${summary.passed}/${summary.total} scenarios`,
  );
}
