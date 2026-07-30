import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const branch = (
  process.env.GITHUB_HEAD_REF ||
  process.env.GITHUB_REF_NAME ||
  ""
).trim();
const dedicatedStagingBranches = new Set([
  "ops/persistent-admin-pos-staging-v1",
]);

if (dedicatedStagingBranches.has(branch)) {
  const artifactsDir = path.join(root, "artifacts", "foundation");
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(
    path.join(artifactsDir, "neon-preview-lifecycle.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        status: "skipped",
        reason: "dedicated-persistent-staging-neon",
        branch,
        genericProjectId: "twilight-boat-26805962",
        dedicatedProjectId: "morning-flower-46531465",
        dedicatedBranchId: "br-empty-sound-afkx5vkj",
        destructiveCleanupPerformed: false,
        evidence:
          "Persistent staging workflow applies and verifies the full migration chain on the dedicated project.",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(
    `Skipped generic disposable Neon preview for ${branch}; dedicated persistent staging Neon evidence remains mandatory.`,
  );
} else {
  await import("./neon-preview-ci.mjs");
}
