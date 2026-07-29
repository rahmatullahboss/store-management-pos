# MOD-F — Localization, Country Packs and Compliance Handoff

**Checkpoint date:** 2026-07-29  
**Repository:** `rahmatullahboss/store-management-pos`  
**Git branch:** `module/localization-compliance-v1`  
**Assigned worktree:** `.worktrees/localization-compliance`  
**Original secured Wave 1 baseline:** `6badafe06a9e0013d12ba036160c915b48fe1c13`  
**Integrated MOD-D sync commit:** `17d32e1e4d09106de896904f16d46eeebe418f73`  
**Current integration baseline:** `f6a04b7fea55e40fa9cc050759f622404ab5a195`  
**Neon project:** `twilight-boat-26805962`  
**Neon branch:** `dev/module-localization-compliance` (`br-polished-flower-ax2ph8wp`)  
**Draft pull request:** `#29`  
**Workpack state:** `active`

## Activation and sync evidence

- MOD-F was synchronized to the integrated MOD-D baseline through a two-parent merge without reset, rebase, force push or loss of prior commits.
- The programme board and shared CI/tooling are inherited from the integration tree; module work remains in MOD-F-owned paths and approved additive composition points.
- The assigned Neon branch is isolated and non-production.
- One owner retains the complete workpack; no small implementation agents were created.

## Completed: domain and country-pack foundation

- BCP 47 locale fallback, Bengali/English resolution, Unicode-script RTL detection, exact cash rounding and IANA-timezone business-day boundaries.
- Signed/versioned country-pack manifests, effective-version selection, support levels, capabilities and forward-only activation rules.
- Legal document, numbering, fiscal/e-invoice, privacy, retention and data-residency contracts.
- Bangladesh `limited` fixture with unsupported fiscal/e-invoice/offline-legal capabilities explicitly disabled and no production compliance claim.
- Synthetic `XZ` fixture proving RTL, CJK and three-decimal currency extensibility without country-specific core schema changes.

## Completed: deterministic localization database

- `LOC-0001` creates twelve tenant-scoped tables for pack versions, locale/currency/time metadata, activations, numbering, immutable legal documents, fiscal state and privacy workflows.
- `LOC-0002` provides security-definer commands for idempotent pack activation, collision-free legal-number allocation and fiscal-state transitions.
- `LOC-0003` provides controlled commands for immutable legal-document publication, fiscal submission creation and privacy workflow transitions.
- Every MOD-F table has forced tenant RLS; runtime direct table writes and `PUBLIC` function execution are revoked.
- Legal documents, number allocations, fiscal events and retention policies retain append-only evidence.
- Explicit business dates, row locks and advisory locks remove process-clock and concurrency ambiguity.

## Completed: application, API and operations checkpoint

- Permission-scoped localization service and Neon repository for country-pack activation, effective configuration reads and legal-number allocation.
- Compliance service and Neon repository for legal-document publication, fiscal submission/state and privacy requests/transitions.
- Deterministic fiscal provider abstraction and simulator covering accepted, rejected, unknown and lost-response-after-effect outcomes.
- Unknown provider results are recorded as `unknown`; blind provider retries are not issued on an idempotent database replay.
- Authenticated localization and compliance API routes are composed into the Worker API.
- Fiscal providers are injected; the default registry is empty and fails closed rather than enabling a simulator in production.
- Compliance worker-job adapters classify accepted work as complete, rejected work as failed, and unknown or replayed-pending fiscal work as explicit review instead of automatic resubmission.
- Metrics `mod_f.compliance.job` and `mod_f.compliance.job.duration_ms` contain only safe type/status attributes.
- `docs/modules/localization-compliance/README.md` documents activation, legal numbering, immutable evidence, fiscal unknown-state recovery, privacy retention, monitoring, rollback and security procedures.

## Verification evidence

- PR #29 remains open, draft and mergeable.
- Foundation CI run `30448200829`, verify job `90563643542`, passed format, lint, architecture boundaries, strict TypeScript, migration validation, build/tests, secret scan, licence register, SBOM and dependency audit.
- Foundation Design CI run `30448201861`, evidence job `90563649585`, passed Foundation context loading and browser/accessibility/design evidence.
- Dedicated MOD-F Neon rehearsal job `90563760527` passed the complete migration chain, runtime integration workflow and deterministic replay on `dev/module-localization-compliance`.
- Neon recovery job `90563760781` passed.
- Cloudflare preview/runtime/cleanup job `90563760351` passed.
- The Neon rehearsal seeds synthetic Foundation scope inside a transaction and rolls it back, so persistent branch data is not polluted.

## Remaining work

1. Admin country-pack/compliance control UI and POS locale/offline-capability integration using the existing Operations Ledger design system.
2. Audit/outbox event publication and final performance/recovery evidence.
3. Final country-pack limitation documentation, complete handoff, review-ready transition and controlled serial integration after MOD-D.
