import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const ignored = new Set([".git", "build", "node_modules", ".worktrees"]);
const patterns = [
  /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bnpg_[A-Za-z0-9]{12,}\b/,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{12,}\b/
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

const failures = [];
for (const file of await walk(root)) {
  let content;
  try { content = await readFile(file, "utf8"); } catch { continue; }
  for (const pattern of patterns) if (pattern.test(content)) failures.push(path.relative(root, file));
}
if (failures.length) {
  console.error(`possible secrets detected:\n${[...new Set(failures)].join("\n")}`);
  process.exit(1);
}
console.log("secret scan passed");
