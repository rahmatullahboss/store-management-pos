import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const runtimeDependencies = Object.entries(packageJson.dependencies ?? {}).map(([name, version]) => ({ name, version, scope: "required" }));
const developmentDependencies = Object.entries(packageJson.devDependencies ?? {}).map(([name, version]) => ({ name, version, scope: "excluded" }));
const licenseByPackage = {
  "@neondatabase/serverless": "MIT",
  typescript: "Apache-2.0",
  "puppeteer-core": "Apache-2.0",
  "axe-core": "MPL-2.0",
};
const packageComponents = [...runtimeDependencies, ...developmentDependencies].map(({ name, version, scope }) => ({
  type: "library",
  name,
  version,
  scope,
  purl: `pkg:npm/${encodeURIComponent(name)}@${version}`,
  licenses: [{ license: { id: licenseByPackage[name] ?? "NOASSERTION" } }]
}));
const components = [
  ...packageComponents,
  {
    type: "application",
    name: "Impeccable",
    version: "4.0.3",
    scope: "excluded",
    purl: "pkg:github/pbakaus/impeccable@1cf7d7ab0f1ac0bb3319fd20be389a3009f4037d",
    licenses: [{ license: { id: "Apache-2.0" } }],
    properties: [
      { name: "ozzyl:usage", value: "development-tooling" },
      { name: "ozzyl:vendored-paths", value: ".agents/skills/impeccable,.github/skills/impeccable" }
    ]
  }
];
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
