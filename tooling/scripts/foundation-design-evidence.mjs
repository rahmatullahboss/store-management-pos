import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderAdminFoundationPreview } from "../../build/apps/admin-web/src/app-shell/index.js";
import { renderPosFoundationPreview } from "../../build/apps/pos-web/src/app-shell/index.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(root, "artifacts", "foundation");
await mkdir(outputDir, { recursive: true });

const adminPermissions = new Set(["platform.reference.read", "platform.audit.read", "platform.access.manage"]);
const posPermissions = new Set(["platform.register.use", "platform.device.read"]);
const pages = {
  "admin-foundation.html": renderAdminFoundationPreview({
    displayName: "Synthetic Director",
    tenantName: "Synthetic Alpha Retail",
    permissions: adminPermissions,
    location: "Dhaka Central",
    businessDate: "Business date · 28 Jul 2026",
    locale: "en",
  }),
  "admin-foundation-rtl.html": renderAdminFoundationPreview({
    displayName: "Synthetic Director",
    tenantName: "Synthetic Alpha Retail",
    permissions: adminPermissions,
    direction: "rtl",
    location: "Dhaka Central",
    businessDate: "Business date · 28 Jul 2026",
    locale: "ar",
  }),
  "pos-foundation.html": renderPosFoundationPreview({
    displayName: "Synthetic Cashier",
    tenantName: "Synthetic Alpha Retail",
    permissions: posPermissions,
    offlineState: { online: true, pendingOperations: 0, lastSyncAt: "2026-07-28T05:00:00Z" },
    location: "Dhaka Central",
    businessDate: "Business date · 28 Jul 2026",
    locale: "en",
  }),
  "pos-foundation-offline.html": renderPosFoundationPreview({
    displayName: "Synthetic Cashier",
    tenantName: "Synthetic Alpha Retail",
    permissions: posPermissions,
    offlineState: { online: false, pendingOperations: 3, lastSyncAt: "2026-07-28T04:55:00Z" },
    location: "Dhaka Central",
    businessDate: "Business date · 28 Jul 2026",
    locale: "en",
  }),
};

const requiredSignals = [
  "THESIS: Operations Ledger",
  "Synthetic",
  "Skip to content",
  "prefers-reduced-motion",
  "<main class=\"shell-main\" id=\"main\" tabindex=\"-1\">",
];
const manifest = [];
for (const [fileName, html] of Object.entries(pages)) {
  for (const signal of requiredSignals) {
    if (!html.includes(signal)) throw new Error(`${fileName} is missing required design signal: ${signal}`);
  }
  if (html.includes("undefined") || html.includes("[object Object]")) throw new Error(`${fileName} contains an invalid rendered value`);
  const outputPath = path.join(outputDir, fileName);
  await writeFile(outputPath, `${html}\n`, "utf8");
  manifest.push({ fileName, bytes: Buffer.byteLength(html), direction: html.includes('dir="rtl"') ? "rtl" : "ltr", offline: html.includes("Offline operating mode") });
}

await writeFile(path.join(outputDir, "foundation-design-manifest.json"), `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), pages: manifest }, null, 2)}\n`, "utf8");
console.log(JSON.stringify(manifest, null, 2));
