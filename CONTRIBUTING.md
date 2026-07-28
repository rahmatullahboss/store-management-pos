# Contributing

- Work only in the assigned branch and worktree.
- Do not reset, discard, overwrite or force-push unrelated work.
- Foundation migrations use `FND-####`; module migrations use their documented prefix.
- Shared contracts are additive within a major version. Breaking changes require a contract change request.
- Runtime code never receives migration credentials.
- Every mutation requires tenant context, permission evaluation, idempotency, audit metadata and an explicit transaction boundary.
- Posted or append-only records are corrected with new records, never silent mutation.

Run `npm run verify` before publishing a checkpoint. Database changes also require fresh-branch migration, RLS isolation and retry/duplicate tests against the assigned Neon branch.
