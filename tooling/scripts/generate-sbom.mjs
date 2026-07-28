import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const runtimeDependencies = Object.entries(packageJson.dependencies ?? {}).map(([name, version]) => ({ name, version, scope: "required" }));
const developmentDependencies = Object.entries(packageJson.devDependencies ?? {}).map(([name, version]) => ({ name, version, scope: "excluded" }));
const components = [...runtimeDependencies, ...developmentDependencies].map(({ name, version, scope }) => ({
  type: "library",
  name,
  version,
  scope,
  purl: `pkg:npm/${encodeURIComponent(name)}@${version}`,
  licenses: [{ license: { id: name === "@neondatabase/serverless" ? "MIT" : name === "typescript" ? "Apache-2.0" : "NOASSERTION" } }]
}));
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: "urn:uuid:00000000-0000-7000-8000-000000000001",
  version: 1,
  metadata: { component: { type: "application", name: packageJson.name, version: packageJson.version } },
  components
};
const output = path.join(root, "docs/architecture/foundation/sbom.cdx.json");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(sbom, null, 2)}\n`);
console.log(`wrote ${path.relative(root, output)}`);
