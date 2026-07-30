import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const deployPath = path.join(
  root,
  "tooling",
  "scripts",
  "deploy-custom-auth-staging.mjs",
);
const originalDeploy = await readFile(deployPath, "utf8");
const redactNeedle = '.replaceAll(connectionString, "[REDACTED_DATABASE_URL]")';
const mainNeedle = 'main: "apps/api/src/staging.ts"';
const baseUrlNeedle = "  const baseUrl = await resolveWorkerUrl();";
const accountNeedle = "  const account = await createAccount(baseUrl);";
const contextProbeNeedle = `  probes.push(await probe(baseUrl, "/auth/session", '"authenticated":true', 200, authenticated));`;
const scenarioNeedle = `    for (const scenario of [
      {
        id: "admin-inventory-desktop",
        pathname: "/admin/inventory",
        kind: "admin",
        viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
      },`;
const identityNeedle = '        hasIdentity: document.body.textContent?.includes("Signed in as") === true,';
const loginPageNeedle = "    const loginPage = await browser.newPage();";
const sessionPageNeedle = "    const sessionPage = await browser.newPage();";
const browserEvidenceNeedle = "  const browser = await browserEvidence(baseUrl);";
const cleanupNeedle = "  cleanupCount = await cleanupAccount(connectionString, authEmail);";
const catchNeedle = `} catch (error) {
  if (connectionString && authEmail && cleanupCount === 0) {`;
const reportNeedle = `    probes,
    browser: browser.scenarios,`;
const reportWriteNeedle = "    authoritativeBrowserWritesEnabled: false,";
const migrationMinimumNeedle = "evidence.migration_count < 57";
const declarationNeedle = "let cleanupCount = 0;";
const actualRelations = "'auth_credentials','auth_sessions','auth_rate_limits','auth_events'";

for (const [label, needle] of [
  ["redaction", redactNeedle],
  ["Worker entry", mainNeedle],
  ["secret upload", baseUrlNeedle],
  ["account journey", accountNeedle],
  ["context probe", contextProbeNeedle],
  ["browser scenarios", scenarioNeedle],
  ["browser identity", identityNeedle],
  ["login CSP bypass", loginPageNeedle],
  ["session CSP bypass", sessionPageNeedle],
  ["browser evidence gate", browserEvidenceNeedle],
  ["reservation cleanup", cleanupNeedle],
  ["failure cleanup", catchNeedle],
  ["report evidence", reportNeedle],
  ["report write boundary", reportWriteNeedle],
  ["migration minimum", migrationMinimumNeedle],
  ["evidence declaration", declarationNeedle],
  ["custom auth relations", actualRelations],
]) {
  if (!originalDeploy.includes(needle)) {
    throw new Error(`Custom staging ${label} patch target is missing`);
  }
}

const expandedScenario = `    for (const scenario of [
      {
        id: "admin-dashboard-desktop",
        pathname: "/admin",
        kind: "admin",
        viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
      },
      {
        id: "admin-catalog-mobile",
        pathname: "/admin/catalog",
        kind: "admin",
        viewport: { width: 390, height: 844, deviceScaleFactor: 1 },
      },
      {
        id: "admin-inventory-desktop",
        pathname: "/admin/inventory",
        kind: "admin",
        viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
      },
      {
        id: "reservation-workspace-mobile",
        pathname: "/admin/inventory/reservations",
        kind: "reservation",
        viewport: { width: 390, height: 844, deviceScaleFactor: 1 },
      },`;

const expandedProbes = `${contextProbeNeedle}
  probes.push(await probe(baseUrl, "/auth/context", '"database-resolved-read-only"', 200, authenticated));
  probes.push(await probe(baseUrl, "/auth/mfa/status", '"enrolled":true', 200, authenticated));
  probes.push(await probe(baseUrl, "/admin", "Run the store from evidence", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/catalog", "Database-backed catalog", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/customers", "Ayesha Rahman", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/sales", "SO-STG-0001", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/inventory/reservations", "Controlled reservations", 200, authenticated));
  probes.push(await probe(baseUrl, "/staging/status", '"controlled-reservation-release-candidate"'));
  probes.push(await probe(baseUrl, "/api/v1/inventory/availability?variantId=018f1000-0000-7000-8000-000000000201&warehouseId=018f0000-0000-7000-8000-000000000402", '"available"', 200, authenticated));
  probes.push(await probe(baseUrl, "/api/v1/inventory/movements?warehouseId=018f0000-0000-7000-8000-000000000402&limit=10", "STG-OPEN-001", 200, authenticated));
  probes.push(await probe(baseUrl, "/api/v1/procurement/suppliers?limit=10", "Northstar Distribution", 200, authenticated));
  probes.push(await probe(baseUrl, "/api/v1/procurement/purchase-orders?warehouseId=018f0000-0000-7000-8000-000000000402&limit=10", "PO-STG-0001", 200, authenticated));
  probes.push(await probe(baseUrl, "/api/v1/inventory/movements?warehouseId=018f0000-0000-7000-8000-000000000401", '"PERMISSION_DENIED"', 403, authenticated));`;

const secretUpload = [
  "  const internalTokenSecret = process.env.STAGING_INTERNAL_TOKEN_SECRET;",
  '  if (!internalTokenSecret || internalTokenSecret.length < 43) throw new Error("STAGING_INTERNAL_TOKEN_SECRET is required");',
  '  await run("npx", [',
  '    "--yes",',
  '    `wrangler@${WRANGLER_VERSION}`,',
  '    "secret",',
  '    "put",',
  '    "STAGING_INTERNAL_TOKEN_SECRET",',
  '    "--config",',
  '    configPath,',
  '    "--name",',
  '    WORKER_NAME,',
  '  ], { input: internalTokenSecret + "\\n", secret: internalTokenSecret });',
  baseUrlNeedle,
].join("\n");

const mfaJourney = `${accountNeedle}
  await probe(baseUrl, "/staging/mfa-crypto-check", '"status":"passed"', 200, authenticated);
  mfaReservationEvidence = await (await import("./staging-mfa-reservation-evidence.mjs")).runMfaReservationJourney({
    baseUrl,
    sessionCookie: account.cookie,
    password: authPassword,
    email: authEmail,
    connectionString,
    runId: GITHUB_RUN_ID || "manual",
  });`;

const browserEvidenceGate = `${browserEvidenceNeedle}
  const failedBrowserScenarios = browser.scenarios
    .filter((scenario) => scenario.passed !== true)
    .map((scenario) => scenario.id);
  if (
    browser.scenarios.length !== 6 ||
    failedBrowserScenarios.length > 0 ||
    browser.session.passed !== true ||
    browser.context.passed !== true ||
    browser.logout.passed !== true
  ) {
    throw new Error(
      \`Persistent staging browser evidence failed: \${failedBrowserScenarios.join(",") || "session/context/logout/count"}\`,
    );
  }`;

const successfulCleanup = `  const reservationEvidenceCleaned = await (await import("./staging-mfa-reservation-evidence.mjs")).cleanupMfaReservationEvidence(
    connectionString,
    mfaReservationEvidence?.reservationId,
  );
  if (!reservationEvidenceCleaned) throw new Error("Synthetic MFA reservation cleanup failed");
  ${cleanupNeedle}`;

const failureCleanup = `} catch (error) {
  if (connectionString && mfaReservationEvidence?.reservationId) {
    try {
      await (await import("./staging-mfa-reservation-evidence.mjs")).cleanupMfaReservationEvidence(
        connectionString,
        mfaReservationEvidence.reservationId,
      );
    } catch {
      // Preserve the primary failure.
    }
  }
  if (connectionString && authEmail && cleanupCount === 0) {`;

const reportEvidence = `    mfa: mfaReservationEvidence?.report ?? null,
    controlledCommand: {
      permission: "inventory.reservation.manage",
      createPassed: mfaReservationEvidence?.report?.createPassed === true,
      releasePassed: mfaReservationEvidence?.report?.releasePassed === true,
      availabilityReconciled: mfaReservationEvidence?.report?.availabilityReconciled === true,
      syntheticReservationCleaned: reservationEvidenceCleaned,
    },
    probes,
    browser: browser.scenarios,`;

const patchedDeploy = originalDeploy
  .replace(
    redactNeedle,
    '.replaceAll(connectionString || "postgresql://__never__", "[REDACTED_DATABASE_URL]")',
  )
  .replace(declarationNeedle, `${declarationNeedle}\nlet mfaReservationEvidence;`)
  .replace(migrationMinimumNeedle, "evidence.migration_count < 60")
  .replace(mainNeedle, 'main: "apps/api/src/staging-entry.ts"')
  .replace(baseUrlNeedle, secretUpload)
  .replace(accountNeedle, mfaJourney)
  .replace(contextProbeNeedle, expandedProbes)
  .replace(scenarioNeedle, expandedScenario)
  .replace(
    identityNeedle,
    '        hasIdentity: kind === "reservation" ? document.body.textContent?.includes("warehouse-scoped") === true : document.body.textContent?.includes("Signed in as") === true,',
  )
  .replace(
    loginPageNeedle,
    `${loginPageNeedle}\n    await loginPage.setBypassCSP(true);`,
  )
  .replace(
    sessionPageNeedle,
    `${sessionPageNeedle}\n    await sessionPage.setBypassCSP(true);`,
  )
  .replace(browserEvidenceNeedle, browserEvidenceGate)
  .replace(cleanupNeedle, successfulCleanup)
  .replace(catchNeedle, failureCleanup)
  .replace(reportNeedle, reportEvidence)
  .replace(
    reportWriteNeedle,
    `${reportWriteNeedle}\n    controlledAuthoritativeWritesEnabled: ["inventory.reservation.create", "inventory.reservation.release"],`,
  )
  .replaceAll("schemaVersion: 3", "schemaVersion: 4");

process.env.STAGING_INTERNAL_TOKEN_SECRET = randomBytes(48).toString("base64url");
await writeFile(deployPath, patchedDeploy, "utf8");
try {
  await import("./deploy-custom-auth-staging.mjs");
} finally {
  delete process.env.STAGING_INTERNAL_TOKEN_SECRET;
  await writeFile(deployPath, originalDeploy, "utf8");
}
