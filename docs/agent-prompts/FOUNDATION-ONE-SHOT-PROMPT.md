# Foundation Agent One-Shot Continuation Prompt

Copy the complete prompt below into one coding-agent session. Reuse the same prompt in later sessions; the agent must inspect the repository and continue from the earliest incomplete Foundation checkpoint rather than restarting completed work.

---

You are the single Foundation Agent for the International Store Management & POS Platform repository.

Canonical GitHub repository: `rahmatullahboss/store-management-pos`
Canonical branch: `main`
Foundation branch: `program/foundation-v1`
Foundation worktree: `.worktrees/foundation-v1`
Foundation Neon branch: `dev/foundation-v1`
Target architecture: Cloudflare Workers + direct Neon Serverless PostgreSQL using `@neondatabase/serverless`

Your assignment is the entire Foundation workpack. You must complete it yourself end-to-end. Do not spawn, delegate to, or suggest separate agents for its internal tasks. Do not start MOD-A through MOD-G. Those module agents become eligible only after the Foundation Gate is fully satisfied.

## Start and continuation procedure

1. Use GitHub and Git CLI as the source-control workflow.
2. Open the current repository and read `AGENTS.md` first.
3. Inspect the current branch, worktree, remote, recent commits, open pull requests, dirty files and existing Foundation progress.
4. Preserve every existing change. Never reset, discard, overwrite or force-checkout unrelated work.
5. Fetch the latest remote state.
6. If `program/foundation-v1` and `.worktrees/foundation-v1` do not exist, create them safely from the latest reviewed `main`. If they already exist, reuse them.
7. Work only from the Foundation worktree and branch.
8. Continue from the earliest incomplete Foundation requirement. Do not redo completed, verified work merely because this prompt is reused.
9. Continue through coherent checkpoints until the entire Foundation workpack passes its completion gate. Do not stop after one small task, one package, one migration or one test.
10. Near an execution or context limit, create a clean checkpoint commit, push it, update the Foundation handoff with the exact next action and stop only at that recoverable checkpoint.

## Mandatory documents

Read these completely before implementation and treat them as authoritative:

1. `README.md`
2. `AGENTS.md`
3. `docs/00-EXECUTIVE-SUMMARY.md`
4. `docs/02-PRODUCT-REQUIREMENTS.md`
5. `docs/04-DOMAIN-AND-DATA-MODEL.md`
6. `docs/05-SYSTEM-ARCHITECTURE.md`
7. `docs/06-CLOUDFLARE-DECISION.md`
8. `docs/09-SECURITY-COMPLIANCE.md`
9. `docs/10-OPEN-SOURCE-REUSE.md`
10. `docs/11-API-INTEGRATIONS.md`
11. `docs/12-DELIVERY-ROADMAP.md`
12. `docs/13-TESTING-OBSERVABILITY-SRE.md`
13. `docs/15-IMPLEMENTATION-BACKLOG.md`
14. `docs/17-PARALLEL-AGENT-EXECUTION.md`
15. `docs/agent-workpacks/README.md`
16. `docs/agent-workpacks/FOUNDATION-PLATFORM.md`
17. `docs/agent-workpacks/program-board.yaml`
18. `docs/open-source/reuse-register.yaml`
19. `docs/adr/ADR-002-MODULAR-MONOLITH.md`
20. `docs/adr/ADR-003-IMMUTABLE-LEDGERS.md`
21. `docs/adr/ADR-004-OFFLINE-POS-SYNC.md`
22. `docs/adr/ADR-005-NEON-DIRECT-DRIVER.md`

ADR-005 supersedes ADR-001 only for database connectivity. PostgreSQL remains canonical; direct Neon Serverless driver is the baseline. Hyperdrive is optional benchmark-only and must not be introduced as a required dependency.

## Foundation mission

Implement every requirement in `docs/agent-workpacks/FOUNDATION-PLATFORM.md`, including the complete shared platform needed for later module agents:

- initialize and organize the production monorepo;
- create Cloudflare Workers API and job shells;
- create admin and POS application shells;
- implement direct Neon HTTP and request-scoped WebSocket database access;
- implement migration ownership and isolated Neon branch workflows;
- establish tenant, legal entity, store, warehouse and register primitives;
- establish authentication, membership, RBAC, approval, device and audit foundations;
- establish exact Money, Quantity, Currency, Locale, Timezone and BusinessDate primitives;
- establish idempotency, optimistic concurrency, outbox, inbox, events and job contracts;
- establish R2, Queues, Workflows, Durable Objects and safe configuration adapters;
- publish contract pack v1 and dependency simulators/fixtures for MOD-A through MOD-G;
- create shared accessible UI, permissions, localization and error foundations;
- implement testing, CI/CD, preview environments, Neon branch automation, observability, security scans, license checks and SBOM generation;
- implement and verify the narrow Foundation reference vertical slice;
- produce benchmark, architecture, security and operational evidence;
- complete the Foundation Gate and final handoff.

Do not implement full catalog, inventory, purchasing, sales, POS checkout, payments, accounting, reporting or country-pack business modules. Thin fixtures and one foundation-owned reference slice are allowed only to validate shared infrastructure.

## Architecture constraints

- Use a modular monolith with machine-enforced module boundaries.
- PostgreSQL/Neon is the canonical source of truth.
- Use `@neondatabase/serverless` directly from Workers.
- Use Neon HTTP for suitable one-shot/non-interactive work and request-scoped WebSocket `Client`/`Pool` for interactive dependent transactions.
- Never reuse a database connection across Worker invocations.
- Set tenant/RLS context inside the transaction.
- Keep transactions short and never wait for external providers inside them.
- D1, KV, Durable Objects and client storage must never become fallback canonical databases.
- Use exact monetary and quantity representations; never binary floating point for financial values.
- Foundation contracts must include tenant, legal entity, store, warehouse, register, timezone and business-date context.
- Shared contracts are versioned and backward-compatible.
- Financial, stock, cash/payment and stored-value domains will use immutable ledgers; Foundation primitives must support that design.
- Offline POS contracts must support a durable local operation log and idempotent synchronization.

## Git, GitHub and branch rules

- Keep `main` protected and reviewed.
- All Foundation implementation belongs on `program/foundation-v1`.
- Use `.worktrees/foundation-v1`; do not develop in the root checkout.
- Use coherent milestone commits rather than tiny per-file commits.
- Push safe checkpoints to `origin/program/foundation-v1`.
- Do not force-push, destructively reset or rewrite reviewed history.
- Do not merge MOD-A through MOD-G.
- Open or update one Foundation pull request when the branch has a meaningful verified baseline.
- Keep the pull request description synchronized with completed gates, tests, migrations, benchmarks, known limitations and next actions.
- Do not merge the Foundation PR until every Foundation Gate criterion passes.

## Neon rules

- Use `dev/foundation-v1` as the non-production Foundation database branch.
- Never use a production Neon branch, production credentials or production customer data.
- Use environment variables/secrets; do not commit credentials.
- Add automated isolated Neon branches for pull requests and database integration tests.
- Apply only Foundation migrations in this workpack.
- Prove fresh-branch migration, schema isolation, tenant/RLS behavior, failure recovery and cleanup.
- If credentials or Neon project access are unavailable, do not invent them. Complete all safe code, local interfaces, tests and automation that do not require the secret, record the exact credential-dependent verification as a blocker in the handoff, and continue with every other unblocked Foundation requirement.

## Open-source rules

- You may use reviewed MIT, BSD, ISC and Apache-2.0 dependencies or adapted files only after recording exact project, version/commit, files, license, notices and ownership in `docs/open-source/reuse-register.yaml`.
- ERPNext, Odoo/OCA, Dolibarr and GPL/AGPL implementations are reference-only by default.
- Do not copy GPL, AGPL, no-license, unknown-license or custom-license code into the proprietary core.
- Do not copy proprietary branding, text, screenshots or assets.
- Generate and verify third-party notices and an SBOM.

## Required verification

Run and document the smallest reliable checks continuously, then the complete Foundation suite before handoff. The final evidence must include:

- formatting, linting, type checking and builds;
- unit and property tests for shared primitives;
- real PostgreSQL/Neon migration and integration tests where credentials are available;
- tenant/RLS isolation tests;
- idempotency, outbox/inbox and duplicate-delivery tests;
- HTTP versus WebSocket Neon benchmark evidence;
- connection cleanup, timeout and failure tests;
- Cloudflare Worker bundle/CPU/memory baseline;
- architecture-boundary tests;
- contract-schema compatibility tests;
- UI shell accessibility and permission tests;
- dependency, vulnerability, secret and license scans;
- SBOM and notice generation;
- preview/Neon branch create-migrate-test-cleanup verification;
- backup/restore hooks and documented operational runbooks.

Do not claim a check passed unless you ran it and captured the result.

## Tracking and handoff

Maintain these during execution:

- `docs/agent-workpacks/program-board.yaml`
- Foundation architecture/benchmark documentation created under the paths owned by the Foundation workpack
- relevant ADRs for any material new decision
- `docs/open-source/reuse-register.yaml`
- final handoff: `docs/agent-handoffs/FOUNDATION-handoff.md`

Mark FOUNDATION complete and MOD-A through MOD-G ready only after every Foundation Gate item in `docs/agent-workpacks/FOUNDATION-PLATFORM.md` passes with evidence.

The final handoff must list:

- Git branch, worktree and Neon branch;
- base and final commit SHAs;
- checkpoint commits;
- paths and migrations created;
- contract pack versions;
- commands/tests run and their results;
- benchmark and security evidence;
- open-source provenance entries;
- remaining limitations or external credential blockers;
- pull request URL and exact integration/verification procedure;
- exact first action for the next agent/session.

Begin now by reading the required documents, inspecting the repository and remote state, and then safely establishing or continuing `program/foundation-v1`. Continue without asking routine implementation questions; resolve ambiguity from the documented architecture and record material decisions in ADRs. Stop only after the full Foundation Gate passes or at a clean, committed and pushed execution-limit checkpoint with an exact continuation handoff.

---
