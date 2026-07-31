import { existsSync, readFileSync, writeFileSync } from "node:fs";

const lifecyclePath = "docs/architecture/staging/internal-token-key-lifecycle.md";
if (existsSync(lifecyclePath)) {
  const source = readFileSync(lifecyclePath, "utf8");
  const lines = source.split("\n");
  const indexes = lines
    .map((line, index) => /[ \t]+$/u.test(line) ? index : -1)
    .filter((index) => index >= 0);
  if (indexes.length > 1) {
    throw new Error(`expected at most one lifecycle whitespace line, found ${indexes.length}`);
  }
  if (indexes.length === 1) {
    lines[indexes[0]] = lines[indexes[0]].replace(/[ \t]+$/u, "");
    writeFileSync(lifecyclePath, lines.join("\n"));
  }
}
