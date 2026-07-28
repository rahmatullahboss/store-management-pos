import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const sourceRoots = ["apps", "packages"].map((name) => path.join(root, name));
const banned = [
  { pattern: /\bMath\.random\s*\(/, message: "Math.random is not allowed for identifiers or security-sensitive values" },
  { pattern: /\bparseFloat\s*\(/, message: "parseFloat is not allowed for exact money or quantity handling" },
  { pattern: /\bTODO\b|\bFIXME\b/, message: "unresolved TODO/FIXME marker" },
  { pattern: /DATABASE_URL\s*=\s*["'][^"']+/, message: "hard-coded database URL" }
];

async function walk(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (["build", "node_modules"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...await walk(full));
      else if ([".ts", ".mjs"].includes(path.extname(entry.name))) files.push(full);
    }
    return files;
  } catch {
    return [];
  }
}

const failures = [];
for (const sourceRoot of sourceRoots) {
  for (const file of await walk(sourceRoot)) {
    const content = await readFile(file, "utf8");
    for (const rule of banned) {
      if (rule.pattern.test(content)) failures.push(`${path.relative(root, file)}: ${rule.message}`);
    }
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("lint passed");
