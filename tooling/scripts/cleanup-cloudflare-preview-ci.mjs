import { readFile } from "node:fs/promises";
import path from "node:path";

const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID } = process.env;
if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
  throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required for Cloudflare preview cleanup");
}

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const reportPath = path.join(root, "artifacts", "foundation", "cloudflare-preview-report.json");
const report = JSON.parse(await readFile(reportPath, "utf8"));
if (!report.workerName) throw new Error("Cloudflare preview report does not contain a worker name for cleanup");

const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${encodeURIComponent(report.workerName)}`, {
  method: "DELETE",
  headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` }
});
if (response.status === 404) {
  console.log(`Cloudflare preview worker ${report.workerName} was already deleted`);
  process.exit(0);
}
const payload = await response.json().catch(() => null);
if (!response.ok || payload?.success === false) {
  const messages = payload?.errors?.map((error) => error.message).filter(Boolean).join("; ");
  throw new Error(`Cloudflare cleanup ${response.status}${messages ? `: ${messages}` : ""}`);
}
console.log(`deleted Cloudflare preview worker ${report.workerName}`);
