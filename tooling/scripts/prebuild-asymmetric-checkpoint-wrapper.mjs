import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const hookPath = "tooling/scripts/prebuild-asymmetric-checkpoint-fix.mjs";
const source = readFileSync(hookPath, "utf8");
const startMarker = '\n{\n  const path = "docs/architecture/staging/internal-token-key-lifecycle.md";';
const endMarker = "\n\nconst basePackage =";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start + startMarker.length);
if (start < 0 || end < 0 || source.indexOf(startMarker, start + 1) >= 0) {
  throw new Error("lifecycle whitespace cleanup block is not uniquely bounded");
}
writeFileSync(hookPath, `${source.slice(0, start)}${source.slice(end)}`);
await import("./prebuild-asymmetric-checkpoint-fix.mjs");
unlinkSync(fileURLToPath(import.meta.url));
