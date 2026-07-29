# MOD-F Activation Checkpoint

## Status

MOD-F Localization, Country Packs and Compliance is active as a complete Wave 2 workpack.

## Assigned execution state

- Git branch: `module/localization-compliance-v1`
- Worktree: `.worktrees/localization-compliance`
- Secured Wave 1 base SHA: `6badafe06a9e0013d12ba036160c915b48fe1c13`
- Neon project: `twilight-boat-26805962`
- Neon branch: `dev/module-localization-compliance`
- Neon branch ID: `br-polished-flower-ax2ph8wp`
- Neon parent branch: `br-spring-grass-ax3ptydv`
- Database: `neondb`

## Activation verification

- Wave 1 is integrated on `main` and MOD-F is marked ready by the programme board.
- The remote MOD-F branch had no implementation commits and was fast-forwarded without force to the secured Wave 1 baseline.
- The assigned Neon branch is a non-default, unprotected development child of the approved parent and contains no module-owned schema changes yet.
- Existing unrelated work was not reset, discarded or overwritten.
- This assignment owns the complete MOD-F workpack and does not delegate translation, country-pack, legal-document, fiscalization or privacy subtasks.

## Dependency strategy

MOD-F consumes the integrated MOD-A, MOD-C and MOD-E contracts from the secured Wave 1 baseline. Until MOD-D is serially integrated, POS offline, hardware and receipt/fiscal dependencies are represented through frozen contract fixtures and approved simulators. MOD-F does not import unmerged MOD-D implementation code.

## First coherent implementation checkpoint

1. Publish country-pack manifest, capability, rounding, legal-document, numbering, fiscal/e-invoice and privacy-policy contracts.
2. Implement BCP 47 locale normalization, fallback chains, directionality, exact currency metadata and cash-rounding primitives.
3. Define an initial Bangladesh country pack plus a synthetic secondary pack proving that a second pack requires no core schema changes.
4. Add deterministic `LOC-0001` migration ownership for effective-dated pack versions, activations, legal numbering scopes and immutable document references with forced RLS.
5. Add unit/property tests for Bengali/English fallback, Arabic RTL, CJK/mixed script, rounding, business-day boundaries, pack effective dates and numbering collision prevention.

## Safety invariants

- Country behavior is effective-dated and versioned.
- Historical legal documents preserve exact pack, template and rule versions.
- Translation strings cannot determine tax, legal-numbering or accounting behavior.
- Legal numbering cannot collide within its declared scope.
- Fiscal/e-invoice state remains separate from commercial and payment state.
- Unsupported offline legal behavior is explicitly blocked.
- Privacy operations preserve legally required immutable ledger and document evidence.
- Data-residency claims must reflect all providers involved in storage and processing.
