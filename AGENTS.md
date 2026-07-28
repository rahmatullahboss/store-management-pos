# Agent Instructions

## Program model

This repository uses documentation-first, module-owned development.

- Complete the Foundation workpack first with one agent.
- Do not start MOD-A through MOD-G until the Foundation Gate passes.
- After foundation, one agent owns one complete large module workpack.
- Do not create separate agents for endpoints, tables, screens, migrations or tests inside a workpack.
- Module agents may develop concurrently only in separate Git worktrees, Git branches and Neon database branches.
- Integration and merge remain controlled and serial.

## Required reading

Before implementation, read:

1. `README.md`
2. `docs/00-EXECUTIVE-SUMMARY.md`
3. `docs/02-PRODUCT-REQUIREMENTS.md`
4. `docs/04-DOMAIN-AND-DATA-MODEL.md`
5. `docs/05-SYSTEM-ARCHITECTURE.md`
6. `docs/06-CLOUDFLARE-DECISION.md`
7. `docs/09-SECURITY-COMPLIANCE.md`
8. `docs/10-OPEN-SOURCE-REUSE.md`
9. `docs/12-DELIVERY-ROADMAP.md`
10. `docs/13-TESTING-OBSERVABILITY-SRE.md`
11. `docs/15-IMPLEMENTATION-BACKLOG.md`
12. `docs/17-PARALLEL-AGENT-EXECUTION.md`
13. The assigned file under `docs/agent-workpacks/`
14. Relevant ADRs under `docs/adr/`
15. `docs/agent-workpacks/program-board.yaml`
16. `docs/open-source/reuse-register.yaml`
17. `PRODUCT.md`
18. `docs/18-IMPECCABLE-DESIGN-WORKFLOW.md`

## Architecture constraints

- Cloudflare Workers and direct Neon Serverless PostgreSQL are the baseline.
- Use `@neondatabase/serverless`; Hyperdrive is optional benchmark-only.
- PostgreSQL is the canonical source of truth.
- Financial, stock, cash/payment and stored-value balances use immutable ledgers.
- Posted records are corrected by reversal or adjustment, not silent mutation.
- Use a modular monolith with machine-enforced module boundaries.
- Use exact money and quantity types; never binary floating point for financial values.
- Tenant, legal entity, store, warehouse, register, timezone and business date are first-class dimensions.
- Offline POS uses a durable local operation log and idempotent synchronization.
- D1, KV, Durable Objects and client storage are never fallback canonical databases.

## Open-source policy

- MIT, BSD, ISC and Apache-2.0 components may be used only after file/revision provenance and notice review.
- ERPNext, Odoo/OCA, Dolibarr and other GPL/AGPL implementations are reference-only by default.
- Do not copy GPL, AGPL, unknown or custom-license code into the proprietary core.
- Record every approved dependency or adapted file in `docs/open-source/reuse-register.yaml`.

## UI and design workflow

- Impeccable is the mandatory project-local design skill for substantial frontend work.
- Before editing UI, run `node .agents/skills/impeccable/scripts/context.mjs --target <primary-file-or-route>` once in the session.
- Read the owning Impeccable command reference and `reference/craft-floor.md` before UI implementation.
- New substantial screens/flows require shaping; completed UI requires hardening, deterministic detection, accessibility/responsive verification and a final polish/finish review.
- Inherit the approved shared visual system. Do not create a parallel component library or module-specific visual language.
- `PRODUCT.md` owns product truth. `DESIGN.md`, after it exists, owns durable implemented visual decisions.
- Do not create speculative `DESIGN.md`; the Foundation Agent writes it only after the first real application shell is implemented and reviewed.
- Record Impeccable commands, detector results, visual evidence and unresolved findings in every UI-bearing workpack handoff.

## Git and safety

- Preserve existing work; never discard or overwrite unrelated changes.
- Do not use destructive reset, force checkout or force push.
- Work only in the assigned branch and worktree.
- Do not edit another module's owned paths or PostgreSQL schema.
- Shared contract changes require the documented contract-change process.
- Do not use production credentials, production data or production database branches.
- Use coherent checkpoint commits with clear verification evidence.
- Continue through the entire assigned workpack; do not stop after a small task.
- Near an execution/context limit, create a clean checkpoint commit and exact continuation handoff.

## Completion standard

A workpack is incomplete without its owned migrations, domain logic, API, UI, permissions, audit, events, tests, performance evidence, observability, runbook, documentation and final handoff.
