import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectEvictableRepositoryPreviewBranches } from "./neon-preview-branch-policy.mjs";

const {
  NEON_API_KEY,
  NEON_PROJECT_ID,
  NEON_PARENT_BRANCH_ID,
  GITHUB_HEAD_REF,
  GITHUB_RUN_ID,
} = process.env;
if (!NEON_API_KEY || !NEON_PROJECT_ID || !NEON_PARENT_BRANCH_ID) {
  throw new Error(
    "NEON_API_KEY, NEON_PROJECT_ID and NEON_PARENT_BRANCH_ID are required for Foundation preview CI",
  );
}

const root = fileURLToPath(new URL("../..", import.meta.url));
const lifecycleReportPath = path.join(
  root,
  "artifacts",
  "foundation",
  "neon-preview-lifecycle.json",
);
const safeRef = (GITHUB_HEAD_REF || "manual")
  .toLowerCase()
  .replace(/[^a-z0-9-]+/gu, "-")
  .slice(0, 36);
const currentBranchName = `preview/pr-${safeRef}-${GITHUB_RUN_ID || "manual"}`;
const apiBase = `https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}`;
const headers = {
  Authorization: `Bearer ${NEON_API_KEY}`,
  "Content-Type": "application/json",
};

async function neonApi(pathname, init = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  if (!response.ok) {
    throw new Error(`Neon API ${response.status}: ${text}`);
  }
  return payload;
}

async function evictBoundedStaleRepositoryPreviews() {
  const response = await neonApi("/branches");
  const branches = Array.isArray(response?.branches) ? response.branches : [];
  const stale = selectEvictableRepositoryPreviewBranches(branches, {
    parentBranchId: NEON_PARENT_BRANCH_ID,
    currentBranchName,
  });
  for (const branch of stale) {
    await neonApi(`/branches/${encodeURIComponent(branch.id)}`, {
      method: "DELETE",
    });
    console.log(`deleted repository-owned stale Neon preview branch ${branch.name}`);
  }
  return stale.length;
}

const repositoryStaleBranchesDeleted =
  await evictBoundedStaleRepositoryPreviews();
let executionError = null;
try {
  await import("./neon-preview-policy.mjs");
} catch (error) {
  executionError = error;
} finally {
  try {
    const lifecycle = JSON.parse(await readFile(lifecycleReportPath, "utf8"));
    await writeFile(
      lifecycleReportPath,
      `${JSON.stringify(
        {
          ...lifecycle,
          schemaVersion: Math.max(Number(lifecycle.schemaVersion || 0), 3),
          repositoryStaleBranchesDeleted,
          repositoryStaleBranchEvictionBound: 3,
          repositoryStaleBranchMinimumAgeSeconds: 3600,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } catch (evidenceError) {
    if (!executionError) executionError = evidenceError;
    else {
      console.error(
        `Neon preview lifecycle evidence augmentation failed: ${
          evidenceError instanceof Error ? evidenceError.message : String(evidenceError)
        }`,
      );
    }
  }
}

if (executionError) throw executionError;
