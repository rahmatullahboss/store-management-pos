# MOD-F — Localization, Country Packs and Compliance Handoff

**Checkpoint date:** 2026-07-29  
**Repository:** `rahmatullahboss/store-management-pos`  
**Git branch:** `module/localization-compliance-v1`  
**Assigned worktree:** `.worktrees/localization-compliance`  
**Original secured Wave 1 baseline:** `6badafe06a9e0013d12ba036160c915b48fe1c13`  
**Integrated MOD-D sync commit:** `17d32e1e4d09106de896904f16d46eeebe418f73`  
**Latest integration ancestry sync:** `9de20b36bdbf1cab1478da8d4c871b4ec94b230a`  
**Neon project:** `twilight-boat-26805962`  
**Neon branch:** `dev/module-localization-compliance` (`br-polished-flower-ax2ph8wp`)  
**Pull request:** `#29`  
**Engineering workpack state:** `handoff_ready`

## Safety and ownership

- MOD-F remains one complete-workpack assignment; no small implementation agents were created.
- The branch was synchronized to MOD-D and the latest integration ancestry through non-destructive two-parent merges. No reset, rebase, force push or unrelated overwrite was used.
- The assigned Neon branch is isolated, non-default and non-production.
- Module implementation stays in MOD-F-owned paths and approved additive composition points.

## Completed domain and country-pack platform

- BCP 47 fallback, Bengali/English resolution, Unicode-script RTL detection, mixed-script handling, exact currency/cash rounding and IANA-timezone business-day boundaries.
- Signed/versioned country-pack manifests, effective-version selection, support levels, capabilities, deprecation and forward-only activation rules.
- Flexible country-pack contracts for locale, currency, time, tax/document configuration, accounting mappings, offline capability, privacy, retention and data residency.
- Bangladesh `bd-primary@1.0.0` fixture with explicit `limited` support and unsupported fiscal, e-invoice and offline-legal paths disabled/fail-closed.
- Synthetic `xz-synthetic` fixture proving RTL, CJK, three-decimal currency and second-pack extensibility without country-specific core-schema changes.

## Completed database and command platform

- `LOC-0001` creates tenant-scoped localization, pack activation, numbering, immutable legal-document, fiscal-state, retention and privacy tables.
- `LOC-0002` provides idempotent pack activation, collision-free legal-number allocation and fiscal-state transitions with advisory/row locks.
- `LOC-0003` provides immutable legal-document publication, fiscal-submission creation and retention-aware privacy transitions.
- `LOC-0004` separates narrow read permissions from privileged command permissions.
- `LOC-0005` publishes safe transactional `platform.audit_events` and `platform.outbox_events` for pack publication/activation, numbering, legal documents, fiscal lifecycle, retention policies and privacy lifecycle.
- Every MOD-F table has forced tenant RLS; direct runtime writes and `PUBLIC` command-function execution are revoked.
- Legal documents, number allocations, fiscal events and evidence records remain append-only; unknown fiscal status blocks blind provider retry.

## Completed application surfaces and operations

- Permission-scoped localization and compliance services with Neon repositories.
- Authenticated Worker API routes for activation, effective configuration, legal-number allocation, legal documents, fiscal submissions and privacy workflows.
- Injected provider registry with deterministic accepted/rejected/unknown/lost-response simulator; production default registry is empty and fails closed.
- Compliance worker jobs with explicit complete, failed and review outcomes; ambiguous provider state is never silently retried.
- Admin country-pack/compliance control surfaces with Operations Ledger design, permission states, exception queues and capability limitations.
- POS localization adapter for locale, currency, business-date and offline legal capability.
- Responsive Bengali/English, Arabic RTL tablet and CJK evidence; the RTL active-pack grid no longer overflows inside the admin rail.
- Safe observability metrics, monitoring guidance, recovery procedures, rollback/forward-fix process, permissions guide and operational runbook.

## Verification evidence

- Core verification passes format, lint, architecture boundaries, strict TypeScript, deterministic migration/checksum validation, build/tests, secret scan, licence register, SBOM and dependency audit.
- Design verification passes deterministic detector, browser scenarios and Axe accessibility checks, including Arabic RTL tablet after the responsive fix.
- Dedicated MOD-F Neon rehearsal applies the complete chain through `LOC-0005`, verifies deterministic replay, tenant isolation, command permissions, fiscal-state controls and transactional audit/outbox event counts.
- Neon recovery and Cloudflare preview/runtime/cleanup gates pass on reviewed checkpoints.
- Synthetic Foundation scope is created inside rehearsal transactions and rolled back; persistent branch data is not polluted.

## Country-pack validation boundary

The MOD-F engineering platform is ready for serial integration, but `bd-primary@1.0.0` must remain `limited` and must not be marketed or activated as production-validated compliance until all external evidence is attached:

1. named local legal, tax and accounting review with version/date;
2. reviewed golden receipt, invoice, credit/debit correction and return examples;
3. approved MOD-A tax and MOD-E accounting mappings;
4. fiscal/e-invoice certification or explicit not-required evidence;
5. MOD-D offline/contingency legal review;
6. complete privacy, retention and provider data-residency matrix.

These are country-pack promotion controls, not permission to weaken fail-closed behavior or fabricate compliance claims.

## Integration handoff

- Review PR `#29` against this handoff and the exact CI head.
- Preserve Bangladesh support level `limited` during integration.
- Integrate serially after MOD-D; do not merge in parallel with another module.
- After integration, update the programme board with the integration SHA and keep MOD-G blocked until MOD-F contracts are stable.
