# MOB-01 — Store Companion Mobile Activation and Foundation Checkpoint

- **Checkpoint date:** 2026-07-29
- **Repository:** `rahmatullahboss/store-management-pos`
- **Workpack:** `MOB-01 — Store Companion Mobile`
- **Git branch:** `module/store-companion-mobile-v1`
- **Draft pull request:** `#40` into `program/integration-v1`
- **Assigned worktree:** `.worktrees/store-companion-mobile`
- **Neon branch:** `dev/module-store-companion-mobile` (`br-cool-mode-axxzm8to`)
- **Neon parent:** `dev/module-pos-cash-offline` (`br-rapid-river-axoz0rfs`)
- **Starting reviewed base:** `47129e25191d1b1c8a8523dcd8f83c2a0b0edf55`
- **Non-destructive integration sync:** `d3d75da3324fd9ad6015b707d27d1806bdaf8242` through PR `#39`
- **Status:** M0 complete; M1 Flutter foundation code/CI complete; platform-generation gate remains

## Base decision

The branch starts from the validated post-MOD-D integration head and was then non-destructively synchronized with the newer reviewed `program/integration-v1` state. The baseline includes Foundation and integrated MOD-A, MOD-B, MOD-C, MOD-D and MOD-E contracts. MOD-F remains active and MOD-G remains dependency-gated.

MOB-01 proceeds in parallel for Flutter foundation and reviewed integrated-contract workflows. Final MOD-F and MOD-G dependent behaviour remains gated, and final programme integration remains serial after MOD-G by default.

## Safety evidence

- The mobile branch was created from the exact reviewed commit recorded above.
- PR `#39` merged the newer reviewed integration state into MOB-01 without reset, destructive rebase or force update.
- No production database, production data, app-store publication or production feature activation is authorised or used.
- No existing module branch, dirty worktree or module-owned path was reset, overwritten or force-updated.
- Mobile owns no PostgreSQL business schema and does not connect directly to Neon.
- The dedicated Neon branch is retained only for synthetic contract/E2E evidence.
- Native POS/cash/hardware remains owned by MOD-D and is excluded.
- The Flutter shell is explicitly labelled synthetic and does not claim deployed mobile backend contracts.

## Documentation and governance checkpoint

Completed authorities:

- `docs/adr/ADR-007-STORE-COMPANION-MOBILE.md`;
- `docs/mobile/README.md` and `00` through `08` product/architecture/API/offline/security/design/testing documents;
- `docs/agent-workpacks/MOB-01-STORE-COMPANION.md`;
- `docs/contracts/change-requests/CCR-0003-MOBILE-FIRST-PARTY-CONTRACTS.md`;
- `docs/17A-STORE-COMPANION-PARALLEL-EXECUTION.md`;
- `docs/open-source/mobile-reuse-register.yaml`;
- programme board, activation policy, workpack index and repository README registration.

CCR-0003 is accepted as a non-breaking additive client contract family. Foundation and each domain module retain ownership of shared persistence, authorization and module adapters; MOB-01 owns client contracts, local sync and native UI only.

## Flutter foundation implemented

### Toolchain and workspace

- Flutter `3.44.8` stable pinned to exact commit `058e0af2c2b57e369d905a03ac9748b0ebf543c6`;
- Dart `3.12.2`;
- Dart pub workspace under `mobile/`;
- CI-generated and committed `mobile/pubspec.lock`;
- strict Dart analysis policy;
- SDK provenance manifest and exact-version CI checks.

### Packages

- `store_companion_app_core` — workspace/capability/sync state and exact integer-minor-unit money;
- `store_companion_design_system` — Operations Ledger Flutter tokens/theme;
- `store_companion_api_client` — strict versioned bootstrap/workspace/localisation/compatibility/operation/result/error contracts;
- `store_companion_sync_engine` — pure local operation transitions, authoritative result reduction and bounded transport retry separation.

### Application shell

- synthetic bootstrap fixture;
- active workspace switcher;
- capability-driven phone NavigationBar and adaptive tablet NavigationRail;
- Operations Ledger context band and explicit current/stale/offline/blocked state vocabulary;
- synthetic/production-boundary warning;
- Home, Work, Approvals and Finance foundation surfaces;
- English/Bengali/Arabic/Japanese locale registration;
- accessibility semantics and 44px minimum control foundation.

### Contract and sync invariants

- unknown additive operation statuses are preserved instead of crashing the client;
- unknown external state blocks blind retry;
- authoritative server outcomes are never converted into transport retry;
- only no-result transport failures receive bounded retry/backoff;
- terminal operations cannot transition back to upload;
- exact money uses `BigInt` minor units and rejects cross-currency arithmetic.

## CI and verification evidence

### Mobile Foundation CI

Successful run `30456836145`, job `90587551754`:

- checked out exact official Flutter commit;
- verified Flutter `3.44.8` and Dart `3.12.2` machine output;
- resolved all pub workspace packages;
- generated dependency lock evidence;
- applied and verified Dart formatting;
- `flutter analyze` passed;
- unit, widget, API contract and sync invariant tests passed;
- tracked mobile source had no formatter diff;
- coverage, formatted-source and lockfile artifacts uploaded.

### Root platform verification

Foundation CI run `30456351739`, job `90586525245` passed after the mobile sync/tooling checkpoint, including repository formatting, lint, architecture boundaries, strict TypeScript, existing tests, secret/licence/SBOM gates and trusted Cloudflare/Neon gates.

### Neon branch evidence

Mobile Neon Evidence run `30455964989`, job `90584675541` passed.

The dedicated branch and reviewed MOD-D parent have matching metadata fingerprints:

- schema match: true;
- relation match: true;
- forced-RLS match: true;
- migration-table match: true;
- schemas: `19`;
- relation groups: `21`;
- forced-RLS tables: `184`;
- migration table: `platform.schema_migrations`.

Committed evidence: `docs/architecture/mobile/neon-branch-evidence.json`.

The evidence explicitly records:

- production data used: false;
- business schema owned by mobile: false;
- direct mobile database access allowed: false;
- branch retained for synthetic evidence: true.

## Dependency status

### Ready for implementation

- identity/session/tenant/permission primitives;
- catalog/barcode/price-tax snapshot references;
- inventory/procurement/receiving/count/transfer contracts;
- customer/sales/fulfilment/return contracts;
- MOD-D compatible sync/device/idempotency principles without POS authority;
- payment/accounting/banking operational contracts;
- Operations Ledger design system;
- accepted first-party mobile contract family and deterministic client models.

### Gated

- MOD-F effective localisation, country capability, business date, privacy/retention and legal/fiscal presentation;
- MOD-G governed dashboards, reports, notifications, entitlements and canonical public OpenAPI;
- shared Worker/mobile BFF adapters under their Foundation/module ownership.

## Remaining execution gates

1. Verify/create the assigned local Git worktree in an executable repository environment.
2. Generate and review Android/iOS platform projects using the pinned Flutter SDK.
3. Add development/staging/production bundle IDs, flavours/schemes and platform configuration.
4. Add Android debug and iOS simulator compile evidence after platform generation.
5. Select local SQL, secure storage, OAuth/routing/state-management and push packages only after provenance/security review.
6. Implement Foundation/module-owned server adapters for the accepted CCR-0003 contracts.
7. Consume final MOD-F and MOD-G contracts at their dependency checkpoints.

## Next implementation checkpoint

Continue M1/M2 with platform project generation, environment configuration, generated localization resources, view-model/repository boundaries and authentication/workspace interfaces. No backend business migration or production deployment is part of this checkpoint.
