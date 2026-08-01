# Persistent Staging Operability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add deterministic, privacy-safe staging observability evidence and alert gates to the persistent Admin/POS release-candidate workflow without enabling production infrastructure or additional authoritative commands.

**Architecture:** A standalone tooling module owns the signal schema, database aggregate query, validation, policy evaluation and report derivation. The operational staging orchestrator invokes it after the existing MFA, recovery, browser and controlled-reservation journeys, writes the result into the existing evidence artifact, and fails closed only for critical integrity/control alerts. Documentation and status evidence describe thresholds, owners, runbooks and the remaining external production blockers.

**Tech Stack:** Node.js 22 ESM, `@neondatabase/serverless`, PostgreSQL aggregate queries, Node test runner, GitHub Actions staging evidence.

---

### Task 1: Restore cross-platform baseline verification

**Files:**
- Modify: `tests/architecture/mod-f-migrations.test.mjs`
- Modify: `tests/architecture/mod-g-migrations.test.mjs`

- [x] **Step 1: Reproduce the encoded-path failure in a worktree whose root contains spaces**

Run: `npm run verify`
Expected: two architecture failures where `%20` is passed to `readFile` as a literal filesystem path.

- [x] **Step 2: Convert repository URLs with the Node URL API**

Use `fileURLToPath(new URL("../..", import.meta.url))` rather than `.pathname` in both architecture tests.

- [x] **Step 3: Verify the focused regression**

Run: `node --test tests/architecture/mod-f-migrations.test.mjs tests/architecture/mod-g-migrations.test.mjs`
Expected: 10 tests pass, 0 fail.

### Task 2: Define staging operability contracts with TDD

**Files:**
- Create: `tooling/scripts/staging-operability.mjs`
- Create: `tests/unit/staging-operability.test.mjs`

- [x] **Step 1: Write failing tests for signal validation and policy evaluation**

Cover non-negative bounded values, unknown/missing metrics, warning and critical thresholds, deterministic ordering, immutable policy metadata, redaction-safe alerts, and overall `healthy`, `degraded`, and `blocked` states.

- [x] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/unit/staging-operability.test.mjs`
Expected: FAIL because the operability module does not exist.

- [x] **Step 3: Implement the minimal policy evaluator**

Provide fixed low-cardinality metric IDs, warning/critical thresholds, owner, response-time and runbook metadata. Do not accept arbitrary labels, tenant identifiers, emails, tokens, URLs or payload fragments.

- [x] **Step 4: Verify evaluator GREEN**

Run: `node --test tests/unit/staging-operability.test.mjs`
Expected: all evaluator tests pass.

- [x] **Step 5: Add failing tests for database aggregate collection and report derivation**

Use a real query-shaped client stub and assert that only aggregate counts/ages are returned. Cover outbox backlog/age, inventory projection mismatch, journal imbalance, probe/browser/accessibility/control failures and secret-artifact leaks.

- [x] **Step 6: Implement aggregate collection and report derivation**

Query only synthetic-tenant aggregate controls. Convert PostgreSQL numeric values safely, derive evidence from the existing staging report, and produce a versioned operability section with no row values or credentials.

- [x] **Step 7: Verify the complete focused unit suite**

Run: `node --test tests/unit/staging-operability.test.mjs`
Expected: all tests pass.

### Task 3: Integrate operability evidence into persistent staging

**Files:**
- Modify: `tooling/scripts/run-operational-staging.mjs`
- Modify: `.github/workflows/persistent-admin-pos-staging.yml`
- Modify: `tests/unit/persistent-admin-pos-staging.test.mjs`
- Modify: `tests/unit/staging-operational-release.test.mjs`

- [x] **Step 1: Write failing architecture/unit assertions**

Require the orchestrator to enrich `persistent-staging-report.json`, preserve failed deployment evidence, and fail the run for critical alerts after writing the artifact. Require the workflow summary to publish operability status and alert counts without exposing metric payloads.

- [x] **Step 2: Run focused tests and confirm RED**

Run: `npm run build && node --test tests/unit/persistent-admin-pos-staging.test.mjs tests/unit/staging-operational-release.test.mjs tests/unit/staging-operability.test.mjs`
Expected: FAIL on missing operability integration.

- [x] **Step 3: Integrate collection, evaluation and artifact persistence**

After the existing deployment journey succeeds, read the report, collect database aggregates through the existing connection, derive signals, evaluate policies, update the report schema, and write it atomically. Throw only after persistence when `launchGate` is `blocked`.

- [x] **Step 4: Extend workflow summary safely**

Publish overall status, gate, warning count, critical count and runbook-linked alert IDs. Do not print database rows, tokens, emails, cookies, connection strings or arbitrary exception payloads.

- [x] **Step 5: Verify integration GREEN**

Run the same focused command and confirm all tests pass.

### Task 4: Document monitoring and incident ownership

**Files:**
- Create: `docs/architecture/staging/operability-alerts-runbook.md`
- Modify: `docs/architecture/staging/production-operability-plan.md`
- Modify: `docs/architecture/staging/status.yaml`
- Modify: `docs/architecture/staging/usable-release-candidate-checkpoint.md`

- [x] **Step 1: Document every signal and response path**

Record thresholds, severity, owner, response-time objective, diagnostic boundaries, containment, evidence preservation and recovery verification for availability, outbox, inventory, journal, identity/recovery, browser/accessibility and artifact-leak alerts.

- [x] **Step 2: Update status without overstating production readiness**

Mark aggregate staging observability and deterministic alert policy implementation complete. Keep production alert delivery, production domain/resources, restore acceptance, transactional email, MFA support governance and launch approval blocked.

- [x] **Step 3: Add documentation assertions where existing tests enforce status evidence**

Ensure the status schema and checkpoint mention exact implementation evidence and limitations.

### Task 5: Verify, review, commit and publish

**Files:**
- All files changed by Tasks 1–4.

- [x] **Step 1: Run focused tests**

Run: `npm run build && node --test tests/unit/staging-operability.test.mjs tests/unit/persistent-admin-pos-staging.test.mjs tests/unit/staging-operational-release.test.mjs tests/architecture/mod-f-migrations.test.mjs tests/architecture/mod-g-migrations.test.mjs`
Expected: 0 failures.

- [x] **Step 2: Run full repository verification**

Run: `npm run verify`
Expected: formatting, lint, boundaries, TypeScript, migrations, unit/architecture tests, secret scan, license scan and SBOM all pass.

- [x] **Step 3: Review the complete diff**

Confirm no production resource creation, no new authoritative commands, no secret values, no customer data and no broad permission changes.

- [x] **Step 4: Commit and push**

Commit coherent changes on `ops/persistent-admin-pos-staging-v1`, push to origin, and update draft PR #58 with exact test evidence and remaining blockers.
