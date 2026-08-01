const repositoryPreviewPrefix = "preview/pr-";

function branchTimestamp(branch) {
  for (const value of [branch?.updated_at, branch?.created_at]) {
    if (typeof value !== "string") continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return null;
}

export function selectCurrentPreviewBranches(
  branches,
  { previewBranchPrefix, parentBranchId },
) {
  if (!Array.isArray(branches)) return [];
  return branches.filter(
    (branch) =>
      typeof branch?.id === "string" &&
      typeof branch?.name === "string" &&
      branch.id !== parentBranchId &&
      branch.name.startsWith(previewBranchPrefix),
  );
}

export function selectEvictableRepositoryPreviewBranches(
  branches,
  {
    parentBranchId,
    currentBranchName,
    now = Date.now(),
    minimumAgeMs = 60 * 60 * 1_000,
    maximumBranches = 3,
  },
) {
  if (!Array.isArray(branches)) return [];
  if (!Number.isFinite(now)) throw new TypeError("Neon preview eviction time is required");
  if (!Number.isInteger(maximumBranches) || maximumBranches < 0) {
    throw new TypeError("Neon preview eviction bound must be a non-negative integer");
  }
  if (!Number.isFinite(minimumAgeMs) || minimumAgeMs < 0) {
    throw new TypeError("Neon preview minimum age must be non-negative");
  }

  return branches
    .map((branch) => ({ branch, timestamp: branchTimestamp(branch) }))
    .filter(
      ({ branch, timestamp }) =>
        typeof branch?.id === "string" &&
        typeof branch?.name === "string" &&
        branch.id !== parentBranchId &&
        branch.name !== currentBranchName &&
        branch.name.startsWith(repositoryPreviewPrefix) &&
        timestamp !== null &&
        now - timestamp >= minimumAgeMs,
    )
    .sort((left, right) => {
      if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
      return left.branch.name.localeCompare(right.branch.name);
    })
    .slice(0, maximumBranches)
    .map(({ branch }) => branch);
}
