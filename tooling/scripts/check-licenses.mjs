import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const register = await readFile(path.join(root, "docs/open-source/reuse-register.yaml"), "utf8");
const failures = [];
const approvedPackages = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) };
for (const [name, version] of Object.entries(approvedPackages)) {
  if (!register.includes(`project: "${name}"`) || !register.includes(`exact_commit_or_tag: "${version}"`)) {
    failures.push(`${name}@${version} is missing an exact approved reuse-register entry`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("license register check passed");
