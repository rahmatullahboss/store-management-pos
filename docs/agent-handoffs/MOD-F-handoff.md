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
**Neon parent:** `br-spring-grass-ax3ptydv`  
**Draft pull request:** `#29`  
**Workpack state:** `active`

## Activation and sync evidence

- The original empty remote branch was fast-forwarded without force to the secured Wave 1 baseline.
- MOD-D is serially integrated; MOD-F was synchronized through a two-parent merge commit without reset, rebase, force push or loss of its existing commits.
- The synchronized branch is ahead of and no longer behind `program/integration-v1`.
- The programme board and shared CI/tooling come from the latest integration tree; only MOD-F-owned source, tests and checkpoint documents were replayed.
- The assigned Neon branch is isolated and non-production; production credentials and production data remain prohibited.
- The complete MOD-F workpack remains under one owner without subtask agents.

## Completed checkpoint: localization and compliance domain foundation

- Published BCP 47 locale, fallback, directionality, currency metadata, cash-rounding and business-day contracts.
- Implemented canonical Bengali/English fallback chains and Unicode-script RTL detection.
- Implemented exact cash rounding using integer minor units and effective-dated currency metadata.
- Implemented IANA-timezone business-day boundaries without rewriting historical instants.
- Published signed/versioned country-pack manifests, support levels, capabilities, templates and activation contracts.
- Implemented manifest validation, effective-version selection and forward-only upgrade rules.
- Published legal document, fiscal/e-invoice, legal numbering, privacy, retention and data-residency contracts.
- Implemented collision-free idempotent legal-number allocation with explicit offline restrictions.
- Implemented retention-safe privacy disposition that preserves immutable legal evidence.

## Completed checkpoint: deterministic localization database

- Added `LOC-0001` with twelve tenant-scoped localization/compliance tables for pack versions, locale/currency/time metadata, activations, numbering, immutable legal documents, fiscal state and privacy workflows.
- Added `LOC-0002` security-definer commands for idempotent pack activation, legal-number allocation and fiscal-state transitions.
- Enforced forced RLS on every MOD-F table and revoked direct runtime table writes.
- Preserved legal-document, legal-number allocation, fiscal-event and retention-policy evidence through append-only triggers.
- Used explicit business-date inputs and row/advisory locking for deterministic activation and numbering behavior.
- Registered deterministic migration order `50`, after integrated MOD-D.
- Added a Bangladesh `limited` pack fixture with explicit no-production-compliance claim and disabled unsupported fiscal/offline-legal behavior.
- Added a synthetic `XZ` pack proving RTL/CJK and three-decimal currency extensibility without core-schema changes.

## Integrated dependencies

- MOD-A catalog/pricing/tax contracts are integrated.
- MOD-C customer/sales/fulfillment contracts are integrated.
- MOD-D POS/offline/hardware/receipt contracts are integrated and available to owned adapters.
- MOD-E payment/accounting/banking contracts are integrated.

## Verification evidence

- Draft PR #29 remains the active review surface and is mergeable.
- Foundation CI run `30446259720` passed format, lint, boundaries, strict TypeScript, migration validation, build/tests, secret scan, licence register, SBOM and dependency audit.
- Foundation Design CI run `30446259711` passed.
- Neon preview job `90557509368` passed the complete Foundation → Wave 1 → MOD-D → MOD-F migration/integration/cold-wake chain and cleanup.
- Neon recovery job `90557379985` passed.
- Cloudflare preview/runtime/cleanup job `90557379753` passed.

## Next coherent checkpoint

1. Add application repositories and services for pack activation, effective configuration reads, legal numbering, immutable document publication, fiscal transitions and privacy requests.
2. Add authenticated MOD-F API handlers and worker-job adapters with idempotency and observability.
3. Add admin localization/country-pack/compliance UI and POS locale/offline-capability integration using the shared Operations Ledger design system.
4. Add fiscal provider simulation, privacy workflow orchestration, audit/events, performance/recovery evidence and runbooks.
5. Complete final validation, legal/accounting limitation documentation and integration handoff.
