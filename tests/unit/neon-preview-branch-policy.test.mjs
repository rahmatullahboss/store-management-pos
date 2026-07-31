import assert from "node:assert/strict";
import test from "node:test";
import {
  selectCurrentPreviewBranches,
  selectEvictableRepositoryPreviewBranches,
} from "../../tooling/scripts/neon-preview-branch-policy.mjs";

const now = Date.parse("2026-07-31T06:00:00.000Z");

function branch(id, name, updatedAt) {
  return { id, name, updated_at: updatedAt };
}

test("current preview cleanup is limited to its exact prefix and excludes the parent", () => {
  const selected = selectCurrentPreviewBranches(
    [
      branch("current-old", "preview/pr-feature-a-10", "2026-07-31T03:00:00Z"),
      branch("current-new", "preview/pr-feature-a-11", "2026-07-31T05:59:00Z"),
      branch("other", "preview/pr-feature-b-7", "2026-07-30T03:00:00Z"),
      branch("parent", "preview/pr-feature-a-parent", "2026-07-20T03:00:00Z"),
    ],
    { previewBranchPrefix: "preview/pr-feature-a-", parentBranchId: "parent" },
  );

  assert.deepEqual(
    selected.map((item) => item.id),
    ["current-old", "current-new"],
  );
});

test("repository preview eviction selects oldest bounded inactive previews only", () => {
  const selected = selectEvictableRepositoryPreviewBranches(
    [
      branch("parent", "main", "2025-01-01T00:00:00Z"),
      branch("persistent", "staging/persistent", "2025-01-01T00:00:00Z"),
      branch("current", "preview/pr-feature-a-99", "2026-07-30T00:00:00Z"),
      branch("old-c", "preview/pr-c-1", "2026-07-25T00:00:00Z"),
      branch("old-a", "preview/pr-a-1", "2026-07-20T00:00:00Z"),
      branch("old-b", "preview/pr-b-1", "2026-07-22T00:00:00Z"),
      branch("old-d", "preview/pr-d-1", "2026-07-26T00:00:00Z"),
      branch("recent", "preview/pr-recent-1", "2026-07-31T05:30:01Z"),
      { id: "missing-time", name: "preview/pr-unknown-1" },
    ],
    {
      parentBranchId: "parent",
      currentBranchName: "preview/pr-feature-a-99",
      now,
      minimumAgeMs: 60 * 60 * 1_000,
      maximumBranches: 3,
    },
  );

  assert.deepEqual(
    selected.map((item) => item.id),
    ["old-a", "old-b", "old-c"],
  );
});

test("repository preview eviction rejects invalid policy bounds", () => {
  assert.throws(
    () =>
      selectEvictableRepositoryPreviewBranches([], {
        parentBranchId: "parent",
        currentBranchName: "preview/pr-current-1",
        now,
        maximumBranches: -1,
      }),
    /bound must be a non-negative integer/u,
  );
  assert.throws(
    () =>
      selectEvictableRepositoryPreviewBranches([], {
        parentBranchId: "parent",
        currentBranchName: "preview/pr-current-1",
        now,
        minimumAgeMs: -1,
      }),
    /minimum age must be non-negative/u,
  );
});
