import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const config = JSON.parse(await readFile(path.join(root, "tooling/module-boundaries.json"), "utf8"));
const workpacks = config.workpacks;
const pathOwners = new Map();
const schemaOwners = new Map();

for (const [id, definition] of Object.entries(workpacks)) {
  for (const ownedPath of definition.paths) {
    if (pathOwners.has(ownedPath)) throw new Error(`${ownedPath} owned by two workpacks`);
    pathOwners.set(ownedPath, id);
  }
  for (const schema of definition.schemas) {
    if (schemaOwners.has(schema)) throw new Error(`${schema} owned by two workpacks`);
    schemaOwners.set(schema, id);
  }
}

const visiting = new Set();
const visited = new Set();
function visit(id, chain) {
  if (visiting.has(id)) throw new Error(`workpack dependency cycle: ${[...chain, id].join(" -> ")}`);
  if (visited.has(id)) return;
  visiting.add(id);
  for (const dependency of workpacks[id].dependsOn) visit(dependency, [...chain, id]);
  visiting.delete(id);
  visited.add(id);
}
for (const id of Object.keys(workpacks)) visit(id, []);

async function walk(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...await walk(full));
      else if (entry.name.endsWith(".ts")) files.push(full);
    }
    return files;
  } catch {
    return [];
  }
}

const failures = [];
for (const file of await walk(path.join(root, "modules"))) {
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  const owner = [...pathOwners.entries()].find(([ownedPath]) => relative.startsWith(`${ownedPath}/`))?.[1];
  const content = await readFile(file, "utf8");
  for (const match of content.matchAll(/from\s+["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (!specifier) continue;
    if (specifier.includes(config.rules.privateImportSegment)) failures.push(`${relative}: private cross-module import ${specifier}`);
    const target = [...pathOwners.entries()].find(([ownedPath]) => specifier.includes(ownedPath))?.[1];
    if (owner && target && owner !== target && specifier.includes("/persistence/")) {
      failures.push(`${relative}: cross-module persistence import from ${target}`);
    }
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`boundary check passed for ${Object.keys(workpacks).length} workpacks and ${schemaOwners.size} schemas`);
