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
let repaired = `${source.slice(0, start)}${source.slice(end)}`;
const oldTail = `writeFileSync("package.json", basePackage);
unlinkSync(fileURLToPath(import.meta.url));`;
const newTail = `const packageJson = JSON.parse(basePackage);
packageJson.scripts.preverify =
  "node tooling/scripts/preverify-asymmetric-checkpoint-cleanup.mjs";
packageJson.scripts.postverify =
  "node tooling/scripts/postverify-asymmetric-checkpoint-cleanup.mjs";
writeFileSync("package.json", \`${"${JSON.stringify(packageJson, null, 2)}\\n"}\`);
unlinkSync(fileURLToPath(import.meta.url));`;
if (repaired.split(oldTail).length - 1 !== 1) {
  throw new Error("temporary verification package lifecycle target mismatch");
}
repaired = repaired.replace(oldTail, newTail);
writeFileSync(hookPath, repaired);
await import("./prebuild-asymmetric-checkpoint-fix.mjs");
unlinkSync(fileURLToPath(import.meta.url));
