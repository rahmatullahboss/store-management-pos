import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const entryPath = path.join(root, "apps", "api", "src", "staging.ts");
const original = await readFile(entryPath, "utf8");
const legacyMarker = '"neon-auth-required"';
const customMarker = '"custom-auth-required"';
const occurrences = original.split(legacyMarker).length - 1;
if (occurrences !== 1) {
  throw new Error(`Expected exactly one legacy staging auth marker, found ${occurrences}`);
}

await writeFile(entryPath, original.replace(legacyMarker, customMarker), "utf8");
try {
  await import("./deploy-custom-auth-staging.mjs");
} finally {
  await writeFile(entryPath, original, "utf8");
}
