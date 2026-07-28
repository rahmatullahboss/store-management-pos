import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const ignoredDirectoryNames = new Set([".git", ".agents", "build", "node_modules", "third_party", ".worktrees"]);
const ignoredDirectoryPrefixes = [path.join(".github", "skills", "impeccable")];
const textExtensions = new Set([".ts", ".mjs", ".json", ".md", ".sql", ".toml", ".yaml", ".yml"]);

function isIgnoredDirectory(fullPath, name) {
  if (ignoredDirectoryNames.has(name)) return true;
  const relative = path.relative(root, fullPath);
  return ignoredDirectoryPrefixes.some((prefix) => relative === prefix || relative.startsWith(`${prefix}${path.sep}`));
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && isIgnoredDirectory(full, entry.name)) continue;
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (textExtensions.has(path.extname(entry.name)) || entry.name.startsWith(".")) files.push(full);
  }
  return files;
}

const failures = [];
for (const file of await walk(root)) {
  const content = await readFile(file, "utf8");
  const relative = path.relative(root, file);
  if (!content.endsWith("\n")) failures.push(`${relative}: missing final newline`);
  const extension = path.extname(file);
  content.split("\n").forEach((line, index) => {
    const markdownHardBreak = extension === ".md" && /[^ ] {2}$/u.test(line);
    if (/[ \t]+$/u.test(line) && !markdownHardBreak) failures.push(`${relative}:${index + 1}: trailing whitespace`);
    if (line.includes("\t")) failures.push(`${relative}:${index + 1}: tab character`);
  });
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("format check passed");
