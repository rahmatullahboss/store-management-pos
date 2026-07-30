# Full Registry Neon Preview and Recovery Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make generic Neon preview and PITR recovery CI apply and verify the complete deterministic migration registry instead of Foundation-only SQL, while producing bounded RPO/RTO, reconciliation and cleanup evidence.

**Architecture:** A shared migration executor discovers every Foundation/module manifest in deterministic order, verifies each SHA-256 before database access, applies migrations sequentially, loads the Foundation synthetic seed exactly once, and verifies the exact `platform.schema_migrations` sequence. Preview and recovery scripts consume the same executor. The recovery drill then creates immutable Foundation marker evidence, performs destructive mutation only in a disposable project, restores to the exact checkpoint, verifies the full migration registry and marker/audit/outbox/idempotency state, records bounded timing/control evidence, and deletes the project fail-closed.

**Tech Stack:** Node.js 22 ESM, `@neondatabase/serverless`, PostgreSQL/Neon PITR API, Node test runner, GitHub Actions artifacts.

---

### Task 1: Define and test the full migration registry executor

**Files:**
- Create: `tooling/scripts/apply-migration-registry.mjs`
- Create: `tests/unit/migration-registry-executor.test.mjs`

- [x] **Step 1: Write failing tests for deterministic discovery and checksum validation**

Require Foundation first, module order from manifests, 64 unique registered migrations across 17 manifests on the current tree, SHA-256 verification before the first query, and rejection of duplicate/mismatched migration evidence.

- [x] **Step 2: Run focused test and confirm RED**

Run: `node --test tests/unit/migration-registry-executor.test.mjs`
Expected: module-not-found failure.

- [x] **Step 3: Implement plan loading and sequential application**

Return frozen bounded metadata: manifest count, migration count, module IDs and migration IDs. Do not return SQL contents or database credentials.

- [x] **Step 4: Add database marker verification tests**

Require exact ordered equality with `platform.schema_migrations`, reject missing/extra/reordered IDs, and load the Foundation synthetic seed only after all migrations succeed.

- [x] **Step 5: Implement marker verification and seed loading**

The executor must never edit applied migration files or continue after a checksum/query failure.

- [x] **Step 6: Verify executor GREEN**

Run: `node --test tests/unit/migration-registry-executor.test.mjs`
Expected: all tests pass.

### Task 2: Replace Foundation-only preview and recovery execution

**Files:**
- Modify: `tooling/scripts/neon-preview-ci.mjs`
- Modify: `tooling/scripts/neon-recovery-ci.mjs`
- Create: `tests/unit/neon-full-registry-ci.test.mjs`

- [x] **Step 1: Write failing source-contract tests**

Require both scripts to import the shared registry executor, prohibit direct Foundation-manifest loops, and report manifest/migration/module counts.

- [x] **Step 2: Run focused test and confirm RED**

Run: `node --test tests/unit/neon-full-registry-ci.test.mjs`
Expected: failures on Foundation-only execution.

- [x] **Step 3: Integrate the shared executor**

Preview and recovery must use identical deterministic registry semantics. Existing integration, cold-wake, benchmark, PITR and cleanup behavior remains intact.

- [x] **Step 4: Verify focused integration GREEN**

Run: `node --test tests/unit/migration-registry-executor.test.mjs tests/unit/neon-full-registry-ci.test.mjs`
Expected: all tests pass.

### Task 3: Add bounded recovery acceptance evidence

**Files:**
- Modify: `tooling/scripts/neon-recovery-ci.mjs`
- Modify: `tests/unit/neon-full-registry-ci.test.mjs`
- Modify: `.github/workflows/foundation-ci.yml`

- [x] **Step 1: Write failing timing and evidence tests**

Require checkpoint, destructive mutation, restore request, branch-ready and reconciliation timestamps; measured restore/reconciliation durations; exact full-registry equality; marker/audit/outbox/idempotency counts; cleanup deletion; and no connection URI, API key or SQL payload in the report/summary.

- [x] **Step 2: Implement schema-v2 recovery report**

Record bounded aggregate controls and timing only. Keep disposable resource IDs only where lifecycle cleanup audit needs them; never include credentials or connection strings.

- [x] **Step 3: Extend GitHub summary safely**

Publish status, manifest/migration/module counts, marker reconciliation, RTO measurement, exact checkpoint restore and cleanup result. Do not print project/branch IDs, marker IDs, SQL rows, connection strings or failure payloads.

- [x] **Step 4: Verify recovery evidence GREEN**

Run focused tests and workflow source checks.

### Task 4: Correct recovery documentation and production boundary

**Files:**
- Modify: `docs/modules/payments-accounting-banking/migration-and-recovery-runbook.md`
- Modify: `docs/architecture/staging/production-operability-plan.md`
- Create: `docs/architecture/staging/backup-restore-acceptance.md`
- Modify: `docs/architecture/staging/status.yaml`
- Modify: `tests/unit/staging-operational-release.test.mjs`

- [x] **Step 1: Document exact current capability**

State that disposable CI now verifies the full registry and PITR mechanics, but production retention window, production resource ownership, encrypted export policy, regional recovery target and formal acceptance remain unapproved.

- [x] **Step 2: Define acceptance gates**

Specify RPO/RTO targets, restore frequency, evidence retention, responsible owner, failure escalation, quarterly rehearsal, immutable finance/inventory reconciliation and production change approval.

- [x] **Step 3: Update tracker as implementation pending live exact-head evidence**

Do not mark production backup/restore accepted until approved production policy and a production-class rehearsal exist.

- [x] **Step 4: Extend documentation tests**

Require truthful full-registry claims and retained production blockers.

### Task 5: Verify, commit, push and inspect exact-head CI

**Files:**
- All files changed above.

- [x] **Step 1: Run focused verification**

Run: `npm run build && node --test tests/unit/migration-registry-executor.test.mjs tests/unit/neon-full-registry-ci.test.mjs tests/unit/staging-operational-release.test.mjs tests/architecture/mod-d-ci-neon-gates.test.mjs tests/architecture/neon-ci-concurrency.test.mjs`

- [x] **Step 2: Run full repository verification**

Run: `npm run verify`
Expected: all gates pass.

- [x] **Step 3: Review scope, commit and push**

Confirm only disposable CI/staging resources are affected. No production project, branch, secret, retention policy or launch approval is created.

- [ ] **Step 4: Inspect exact-head Foundation CI recovery artifact**

Require 64 migrations, exact registry equality, marker/audit/outbox/idempotency reconciliation, bounded RTO evidence, cleanup deletion and privacy-safe report.

- [ ] **Step 5: Record live evidence and keep PR draft**

Update tracker/checkpoint/PR with exact run, job, artifact and digest while retaining production backup/restore acceptance as blocked.
