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
- MOD-D is now serially integrated; MOD-F was synchronized through a two-parent merge commit without reset, rebase, force push or loss of its 17 existing commits.
- The synchronized branch is ahead of and no longer behind `program/integration-v1`.
- The programme board and shared CI/tooling come from the latest integration tree; only MOD-F-owned domain, test and checkpoint files were replayed.
- The assigned Neon branch is an isolated, non-default development branch; production credentials and production data remain prohibited.
- The complete MOD-F workpack remains under one owner without subtask agents.

## Completed checkpoint: localization and compliance domain foundation

- Published BCP 47 locale, fallback, directionality, currency metadata, cash-rounding and business-day contracts.
- Implemented canonical locale fallback chains including Bengali/English behavior and Unicode-script RTL detection.
- Implemented exact cash rounding using integer minor units and effective-dated currency metadata.
- Implemented IANA-timezone local business-day boundaries without rewriting historical instants.
- Published signed/versioned country-pack manifests, support levels, capabilities, templates and activation contracts.
- Implemented manifest validation, effective-version selection and forward-only upgrade rules.
- Published legal document, fiscal/e-invoice, legal numbering, privacy, retention and data-residency contracts.
- Implemented immutable collision-free legal-number allocation with operation replay behavior and explicit offline restrictions.
- Implemented retention-safe privacy disposition where legal evidence is preserved and erasure becomes anonymization when allowed.
- Added unit coverage for Bengali/English fallback, Arabic RTL, CJK, BDT cash rounding, Dhaka business-day boundaries, effective-date overlap, primary/synthetic country packs, legal numbering and privacy retention.

## Integrated dependencies

- MOD-A catalog/pricing/tax contracts are integrated.
- MOD-C customer/sales/fulfillment contracts are integrated.
- MOD-D POS/offline/hardware/receipt contracts are integrated and may now replace frozen simulators at owned adapter boundaries.
- MOD-E payment/accounting/banking contracts are integrated.

## Current verification

- Draft PR #29 remains the active review surface.
- Branch ancestry is clean: synchronized MOD-F is ahead of and not behind `program/integration-v1`.
- A fresh full GitHub gate is triggered by the synchronization and documentation checkpoints.

## Next coherent checkpoint

1. Add deterministic `LOC-0001` migrations for pack versions, activations, locale/currency metadata, numbering scopes, immutable legal-document references, fiscal submissions, privacy operations and forced RLS.
2. Add PostgreSQL command functions for idempotent activation, legal-number allocation, document snapshot publication and fiscal-status transitions.
3. Add Bangladesh primary pack fixtures and a synthetic secondary pack with no core-schema changes.
4. Add isolated PostgreSQL/Neon tests for tenant isolation, concurrent numbering, immutable documents, effective-date transitions and replay.
5. Continue with APIs, admin/POS localization UI, fiscal provider simulation, privacy workflows, observability and runbooks.
