# Synthetic Staging Outbox Publisher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the persistent staging outbox-age review warning with real, idempotent synthetic delivery evidence while preserving immutable payloads, bounded retries, privacy-safe artifacts and production isolation.

**Architecture:** A staging-only publisher claims synthetic-tenant outbox rows through a single atomic `FOR UPDATE SKIP LOCKED` lease query, computes a canonical SHA-256 envelope digest in memory, records a durable hash-only receipt in `platform.inbox_receipts`, and acknowledges the exact claimed attempt. Crash-after-receipt replay is safe because the consumer receipt is durable and payload-hash-bound. The operational staging runner drains bounded batches before deriving aggregate operability evidence. Production transport selection and production SLOs remain separate launch blockers.

**Tech Stack:** Node.js 22 ESM, `@neondatabase/serverless`, PostgreSQL CTE/row locking/RLS, Node test runner, GitHub Actions staging artifacts.

---

### Task 1: Define publisher contracts with TDD

**Files:**
- Create: `tooling/scripts/staging-outbox-publisher.mjs`
- Create: `tests/unit/staging-outbox-publisher.test.mjs`

- [x] **Step 1: Write failing tests for canonical hashing and privacy boundaries**

Cover recursively sorted payload/metadata hashing, equivalent-object stability, changed-envelope conflict, no payload/token/cookie material in receipts or summaries, and safe integer validation.

- [x] **Step 2: Run focused tests and confirm RED**

Run: `node --test tests/unit/staging-outbox-publisher.test.mjs`
Expected: module-not-found failure.

- [x] **Step 3: Implement canonical digest and bounded contracts**

Export fixed consumer identity, bounded batch/lease/retry constants, canonical digest logic and safe summary validation.

- [x] **Step 4: Write failing tests for claim, receipt, acknowledgement and retry SQL**

Assert synthetic-tenant scope, `FOR UPDATE SKIP LOCKED`, due-time and maximum-attempt filters, attempt-bound acknowledgement, fixed error categories and no payload/error text in diagnostics.

- [x] **Step 5: Implement the database publisher primitives**

Implement atomic claim, hash-only durable inbox receipt, exact-attempt publish acknowledgement and bounded retry scheduling. Reject stale claims and hash conflicts.

- [x] **Step 6: Write failing tests for bounded draining and crash replay**

Cover multiple batches, no-work completion, receipt replay, delivery failure, remaining backlog and maximum-drain refusal.

- [x] **Step 7: Implement bounded drain orchestration**

Return only aggregate counts and fixed consumer metadata. Never log or persist raw event IDs, tenant IDs, aggregate IDs, payloads, metadata, correlation IDs or error messages.

- [x] **Step 8: Verify publisher GREEN**

Run: `node --test tests/unit/staging-outbox-publisher.test.mjs`
Expected: all publisher tests pass.

### Task 2: Integrate publisher evidence into staging operability

**Files:**
- Modify: `tooling/scripts/run-operational-staging.mjs`
- Modify: `tooling/scripts/staging-operability.mjs`
- Modify: `tests/unit/staging-operability.test.mjs`
- Modify: `tests/unit/staging-operational-release.test.mjs`
- Modify: `.github/workflows/persistent-admin-pos-staging.yml`

- [x] **Step 1: Add failing operability tests**

Require `outbox_publisher_failures` as a zero-tolerance signal, schema-v7 report evidence, aggregate publisher summary and workflow path coverage.

- [x] **Step 2: Run focused integration tests and confirm RED**

Run: `npm run build && node --test tests/unit/staging-outbox-publisher.test.mjs tests/unit/staging-operability.test.mjs tests/unit/staging-operational-release.test.mjs`
Expected: failures on missing integration/schema/policy.

- [x] **Step 3: Drain before aggregate evaluation**

Within the existing Neon connection, drain synthetic events, collect post-drain database signals, add a bounded `outboxPublisher` report section, derive 12 signals and atomically persist report schema v7.

- [x] **Step 4: Keep production separation explicit**

The staging evidence consumer must not send email, webhooks, partner API calls, production messages or customer data. No new runtime permission or authoritative business route is added.

- [x] **Step 5: Verify integration GREEN**

Run the focused integration command and expect zero failures.

### Task 3: Update operability documentation and evidence contracts

**Files:**
- Modify: `docs/architecture/staging/operability-alerts-runbook.md`
- Modify: `docs/architecture/staging/production-operability-plan.md`
- Modify: `docs/architecture/staging/status.yaml`
- Modify: `docs/architecture/staging/usable-release-candidate-checkpoint.md`

- [x] **Step 1: Document publisher ownership and failure handling**

Describe claim lease, receipt replay, stale-attempt protection, hash conflict, bounded retry, evidence retention and the distinction between synthetic evidence delivery and a production transport.

- [x] **Step 2: Update status as implementation pending live evidence**

Record report schema v7, 12 signals, publisher implementation and the requirement for a new exact-head persistent staging artifact.

- [x] **Step 3: Extend documentation assertions**

Require publisher evidence while preserving all production blockers.

### Task 4: Verify, commit, push and inspect live evidence

**Files:**
- All files changed above.

- [x] **Step 1: Run focused verification**

Run: `npm run build && node --test tests/unit/staging-outbox-publisher.test.mjs tests/unit/staging-operability.test.mjs tests/unit/persistent-admin-pos-staging.test.mjs tests/unit/staging-operational-release.test.mjs tests/architecture/mod-f-migrations.test.mjs tests/architecture/mod-g-migrations.test.mjs`

- [x] **Step 2: Run full repository verification**

Run: `npm run verify`
Expected: format, lint, boundaries, TypeScript, migrations, all tests, secret scan, licenses and SBOM pass.

- [x] **Step 3: Review scope and commit**

Confirm no production resource, provider, secret, customer data, runtime permission or additional authoritative command. Commit and push to `ops/persistent-admin-pos-staging-v1`.

- [x] **Step 4: Inspect exact-head CI and artifact**

Require persistent staging deploy success, schema-v7 artifact, durable receipt evidence, zero critical publisher/integrity failures and either a clear gate or an explicitly justified bounded review warning.

- [x] **Step 5: Record live evidence**

Update tracker/checkpoint and PR #58 with exact run, job, artifact, digest, signal totals and remaining production blockers; keep the PR draft.
