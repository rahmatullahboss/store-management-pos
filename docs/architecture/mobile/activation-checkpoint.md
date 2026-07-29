# MOB-01 — Store Companion Mobile Activation Checkpoint

- **Checkpoint date:** 2026-07-29
- **Repository:** `rahmatullahboss/store-management-pos`
- **Workpack:** `MOB-01 — Store Companion Mobile`
- **Git branch:** `module/store-companion-mobile-v1`
- **Planned worktree:** `.worktrees/store-companion-mobile`
- **Planned Neon branch:** `dev/module-store-companion-mobile`
- **Starting reviewed base:** `47129e25191d1b1c8a8523dcd8f83c2a0b0edf55`
- **Status:** documentation/activation checkpoint in progress

## Base decision

The branch starts from the validated post-MOD-D integration head. That baseline includes Foundation and integrated MOD-A, MOD-B, MOD-C, MOD-D and MOD-E contracts. MOD-F remains active and MOD-G remains dependency-gated.

MOB-01 can proceed in parallel for documentation, Flutter foundation and reviewed integrated-contract workflows. Final MOD-F and MOD-G dependent behaviour remains gated.

## Safety evidence

- The mobile branch was created from the exact reviewed commit recorded above.
- No production database, production data, app-store publication or production feature activation is authorised.
- No existing module branch, dirty worktree or module-owned path is reset, overwritten or force-updated.
- Mobile owns no PostgreSQL business schema and will not connect directly to Neon.
- A dedicated Neon branch is planned only for synthetic contract/E2E evidence; creation must be verified from the current reviewed database parent before connected testing.
- Native POS/cash/hardware remains owned by MOD-D and is excluded.

## Documentation checkpoint

Created/planned authorities:

- `docs/adr/ADR-007-STORE-COMPANION-MOBILE.md`;
- `docs/mobile/README.md`;
- `docs/mobile/00-STORE-COMPANION-DECISION.md`;
- `docs/mobile/01-PERSONAS-CAPABILITIES.md`;
- `docs/mobile/02-FEATURE-CATALOGUE.md`;
- `docs/mobile/03-SYSTEM-ARCHITECTURE.md`;
- `docs/mobile/04-API-CONTRACTS.md`;
- `docs/mobile/05-OFFLINE-SYNC.md`;
- `docs/mobile/06-SECURITY-PRIVACY.md`;
- `docs/mobile/07-DESIGN-SYSTEM.md`;
- `docs/mobile/08-TESTING-RELEASE.md`;
- `docs/agent-workpacks/MOB-01-STORE-COMPANION.md`;
- `docs/contracts/change-requests/CCR-0003-MOBILE-FIRST-PARTY-CONTRACTS.md`.

## Dependency status

### Ready for client work

- identity/session/tenant/permission primitives;
- catalog/barcode/price-tax snapshot references;
- inventory/procurement/receiving/count/transfer contracts;
- customer/sales/fulfilment/return contracts;
- MOD-D compatible sync/device/idempotency principles;
- payment/accounting/banking operational contracts;
- Operations Ledger design system.

### Gated

- MOD-F effective localisation, country capability, business date, privacy/retention and legal/fiscal presentation;
- MOD-G governed dashboards, reports, notifications, entitlements and canonical public OpenAPI.

## Shared-contract boundary

CCR-0003 requests additive first-party contracts for bootstrap, workspace context, non-POS mobile device registration, permission-scoped change feeds, generic operation batches/results, approval references and notification references.

MOB-01 may implement client interfaces, fixtures and local behaviour while review is pending. It may not silently add shared server state or query module-private tables.

## Planned first implementation checkpoint

M1 will create:

- `mobile/` Dart pub workspace;
- pinned Flutter toolchain policy;
- Android/iOS app shell and environment flavours;
- architecture boundaries and base configuration;
- synthetic bootstrap fixture;
- public mobile CI for format/analyze/test/build;
- dependency/reuse register updates.

No backend or database business migration is part of M1.

## Verification gap

This checkpoint was created through the connected GitHub repository interface. An executable local Git worktree, Flutter SDK, platform toolchains and Neon branch were not available in this connector session. Therefore:

- the remote branch creation is recorded;
- worktree/Neon creation remains an explicit M0 action for an execution environment with those tools;
- Flutter commands and builds must not be claimed until CI or an executable worktree produces evidence.

## Next action

Complete programme-board/activation-policy registration, create the initial Flutter workspace and CI files, open a draft PR against `program/integration-v1`, then use its public CI as the first executable evidence. Final integration remains dependency-gated and serial.
