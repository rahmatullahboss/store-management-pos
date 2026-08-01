import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCustomAuthStagingDeploy } from "./staging-custom-auth-patch.mjs";
import {
  finalizeCustomAuthRelationEvidenceSource,
  normalizeCustomAuthRelationEvidenceSource,
} from "./staging-custom-auth-source-contract.mjs";
import { addMainWebProbeCoverage } from "./staging-main-web-probe-patch.mjs";
import { generateStagingTokenKeyset } from "./staging-token-keyset.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const deployPath = path.join(root, "tooling", "scripts", "deploy-custom-auth-staging.mjs");
const originalDeploy = await readFile(deployPath, "utf8");
const normalizedDeploy = normalizeCustomAuthRelationEvidenceSource(originalDeploy);
const patchedDeploy = addMainWebProbeCoverage(finalizeCustomAuthRelationEvidenceSource(
  buildCustomAuthStagingDeploy(normalizedDeploy),
));
const generatedInternalTokenKeyset = await generateStagingTokenKeyset();

process.env.STAGING_INTERNAL_TOKEN_SECRET = generatedInternalTokenKeyset.serialized;
process.env.STAGING_INTERNAL_TOKEN_KEYSET_EVIDENCE = JSON.stringify(
  generatedInternalTokenKeyset.evidence,
);
await writeFile(deployPath, patchedDeploy, "utf8");
try {
  await import("./deploy-custom-auth-staging.mjs");
} finally {
  delete process.env.STAGING_INTERNAL_TOKEN_SECRET;
  delete process.env.STAGING_INTERNAL_TOKEN_KEYSET_EVIDENCE;
  await writeFile(deployPath, originalDeploy, "utf8");
}
