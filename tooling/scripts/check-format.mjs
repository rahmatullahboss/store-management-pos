import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const ignored = new Set([".git", "build", "node_modules", ".worktrees"]);
const textExtensions = new Set([".ts", ".mjs", ".json", ".md", ".sql", ".toml", ".yaml", ".yml"]);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
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
    const markdownHardBreak = extension === ".md" && /[^ ] {2}$/.test(line);
    if (/[ \t]+$/.test(line) && !markdownHardBreak) failures.push(`${relative}:${index + 1}: trailing whitespace`);
    if (line.includes("\t")) failures.push(`${relative}:${index + 1}: tab character`);
  });
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("format check passed");
