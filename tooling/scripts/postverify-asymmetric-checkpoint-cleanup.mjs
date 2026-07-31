import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lifecyclePath = "docs/architecture/staging/internal-token-key-lifecycle.md";
if (!existsSync(lifecyclePath)) {
  throw new Error("asymmetric key lifecycle document was not generated");
}
const source = readFileSync(lifecyclePath, "utf8");
const lines = source.split("\n");
const trailingWhitespaceCount = lines.filter((line) => /[ \t]+$/u.test(line)).length;
if (trailingWhitespaceCount !== 1) {
  throw new Error(
    `expected one lifecycle trailing-whitespace line, found ${trailingWhitespaceCount}`,
  );
}
writeFileSync(
  lifecyclePath,
  lines.map((line) => line.replace(/[ \t]+$/u, "")).join("\n"),
);
const basePackage = execFileSync(
  "git",
  ["show", "6be2f1fdde595c2f4fa8080cac68b7932d042ada:package.json"],
  { encoding: "utf8" },
);
writeFileSync("package.json", basePackage);
unlinkSync(fileURLToPath(import.meta.url));
