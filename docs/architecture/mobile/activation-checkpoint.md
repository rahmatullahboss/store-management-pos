# MOB-01 — Store Companion Mobile Activation and Engineering Checkpoint

- **Checkpoint date:** 2026-07-29
- **Repository:** `rahmatullahboss/store-management-pos`
- **Workpack:** `MOB-01 — Store Companion Mobile`
- **Git branch:** `module/store-companion-mobile-v1`
- **Current verified source head:** `0303cb88b27b8bdc96497808d12b883ede74b123`
- **Draft pull request:** `#40` into `program/integration-v1`
- **Assigned worktree:** `.worktrees/store-companion-mobile`
- **Neon branch:** `dev/module-store-companion-mobile` (`br-cool-mode-axxzm8to`)
- **Neon parent:** `dev/module-pos-cash-offline` (`br-rapid-river-axoz0rfs`)
- **Starting reviewed base:** `47129e25191d1b1c8a8523dcd8f83c2a0b0edf55`
- **Status:** M0 complete; M1 Android/Flutter foundation complete; M2 platform-neutral identity/workspace security foundation complete; MOD-F effective-localisation client checkpoint complete; iOS compile, native identity adapters and M3 local data remain open.

## Baseline and safety

The branch retains the reviewed integration ancestry without reset, destructive rebase, force update or replacement of module-owned implementation. It consumes integrated Foundation through MOD-F contracts while MOD-G remains dependency-gated.

Safety boundaries remain unchanged:

- no production data, credentials, database or deployment;
- no app-store publication or release signing authority;
- no direct mobile connection to Neon or canonical module tables;
- no native POS, cash-shift, card-terminal or hardware authority;
- no client-authoritative price, tax, stock, payment or accounting result;
- no existing module branch or persistent Neon module branch deleted for CI capacity.

## Implemented foundation

### Toolchain and workspace

- Flutter `3.44.8` pinned to commit `058e0af2c2b57e369d905a03ac9748b0ebf543c6`;
- Dart `3.12.2`;
- pub workspace under `mobile/` with committed lockfile;
- strict analysis, canonical formatting and exact official Flutter checkout in CI;
- Operations Ledger design tokens and adaptive phone/tablet shell;
- synthetic bootstrap and explicit non-production boundary.

### Android platform

Generated Android source is reviewed and reproducible from the pinned Flutter template. The build uses AGP 9-compatible Kotlin DSL, Java/Kotlin 17 and explicit resource-value support.

Application identities:

- development: `com.ozzyl.storecompanion.dev`;
- staging: `com.ozzyl.storecompanion.staging`;
- production identity: `com.ozzyl.storecompanion`.

No release signing material is committed. Generated launcher artwork remains placeholder-only and blocks signed pilot/production release.

### iOS platform

The generated base project uses bundle identifier `com.ozzyl.storecompanion`. Development/staging schemes, bundle suffixes, signing configuration and macOS simulator compile evidence remain open checkpoints.

### Identity, session and workspace

- dependency-free OAuth authorization-request and callback validation;
- exact redirect matching, state/nonce checks and S256 PKCE challenge validation;
- credential-free session model using opaque references only;
- step-up/reauthentication metadata and fail-closed privileged-action checks;
- remote/self revocation stops synchronisation and requires restricted-cache purge or lock;
- user/tenant/workspace partition keys prevent cross-context cache reuse;
- workspace changes require sync stop, presentation clear and fresh server bootstrap.

### Runtime environments

Development, staging and production identities have explicit API/OIDC/redirect configuration. Production startup fails before the application shell if endpoints are missing, non-HTTPS, localhost or placeholder values.

### MOD-F effective localisation

The mobile client now strictly consumes the integrated `GET /v1/localization/effective-configuration` contract:

- country-pack activation/version/support metadata;
- effective date window and default locale;
- exact currency metadata using `BigInt` cash increments;
- accounting scale and nearest/up/down cash-rounding metadata;
- exact timezone/business-day boundary and metadata version;
- signed country capability map;
- duplicate currency/timezone rejection;
- bootstrap currency-version, timezone and business-date consistency checks;
- unknown future support levels preserved but regulated presentation remains fail-closed;
- only explicit `validated` support permits client-side regulated presentation, while server authorization remains authoritative.

Coverage includes limited/unknown support, duplicate metadata, stale version, missing boundary, invalid effective window and integers beyond JavaScript's safe range.

## Current CI evidence

### Mobile Foundation CI

Run `30467808600`, job `90630066692`, source head `0303cb88b27b8bdc96497808d12b883ede74b123`: passed.

Evidence:

- exact Flutter/Dart toolchain verified;
- pub workspace resolved;
- canonical Dart formatting passed;
- `flutter analyze` passed;
- unit, widget, sync, session, runtime, contract and MOD-F localisation tests passed;
- committed source matched formatter output;
- lockfile, formatted-source and coverage artifacts uploaded.

### Android platform verification

Run `30467812100`, job `90630079997`, source head `0303cb88b27b8bdc96497808d12b883ede74b123`: passed.

Artifacts:

| Evidence | Artifact ID | SHA-256 digest |
|---|---:|---|
| Generated platform source | `8730481454` | `59e514f87c982d0e13bdcbcbc85c4c92198dc5187feb58c80469906d560f4cce` |
| Development debug APK | `8730484712` | `a03607b851deda3947af59e66d6c2be8cd3615d0ccb9a60dab16ecf9c620e461` |
| Staging debug APK | `8730487839` | `ce06c07b29b66221db28bb195f0d657151fdc4cea8e07cbbe5a55acbdbf46305` |
| Production-identity debug APK | `8730490989` | `94a485b46203e02e698fdfa68175e933bffb14040850374ef59d44873193b423` |

The production-identity artifact is an unsigned debug build and is not a production release.

### Root Foundation CI

Run `30467810717`: passed.

- verify job `90630076336`: format, lint, architecture, typecheck, build/tests, secret scan, licence register, SBOM and dependency audit passed;
- Cloudflare preview job `90630201820`: passed and cleaned up;
- Neon recovery job `90630201995`: passed;
- Neon preview job `90630373709`: passed.

### Dedicated Mobile Neon evidence

Run `30467809644`, job `90630040160`: passed. The assigned mobile evidence branch exists under the reviewed MOD-D parent and remains synthetic only.

### Neon quota-safe fallback

The project branch quota is occupied by legitimate persistent programme/module branches. Foundation preview CI therefore falls back to a run-scoped disposable database on `dev/foundation-v1` instead of deleting a module branch.

Verified run `30465971303`, artifact `8729594013` recorded:

- `isolationMode=database`;
- disposable database `ci_preview_30465971303`;
- Foundation migrations, integration tests and benchmark passed;
- shared compute was not suspended;
- `databaseCleanupDeleted=true`;
- post-run inventory confirmed only persistent `postgres` and `neondb` databases remained.

## Dependency review status for M3

The next local-data checkpoint will use a separately reviewed dependency/provenance commit. Current preferred direction is Drift over `sqlite3` 3.x with SQLite3MultipleCiphers selected through workspace build hooks, and platform secure storage used only for key material. No deprecated `sqlite3_flutter_libs` or `sqlcipher_flutter_libs` dependency is permitted.

No M3 dependency is considered adopted until its exact version, transitive lockfile, licence/provenance record, encrypted-database runtime assertion and Android/iOS build evidence are committed and green.

## Remaining gates

1. Add iOS development/staging schemes and bundle suffixes.
2. Obtain macOS-runner iOS simulator compile and test evidence.
3. Complete provenance and lockfile review for local SQL, encrypted SQLite build, secure storage, native OAuth and background work.
4. Implement bounded local SQL migrations, projection cache, drafts, pending operations, results and cursor storage.
5. Prove cipher availability at runtime and keep encryption keys outside the database and diagnostics.
6. Add crash/restart/replay/migration/revocation/storage-pressure tests without losing pending work.
7. Connect the reviewed session seams to external-browser OAuth, secure storage and deep-link adapters.
8. Add generated localisation resources and Bengali/English/RTL/CJK visual/accessibility evidence.
9. Consume MOD-G governed metrics, reporting, communication, entitlement and approved OpenAPI contracts when integrated.
10. Produce signed internal/pilot artifacts only after separate signing, artwork, security and release authorization.

## Next checkpoint

Proceed with M3 dependency/provenance freeze and the encrypted local persistence boundary. Pending operations and drafts must be physically separated from rebuildable projections, exact values must remain integer/string based, and no local state may be presented as authoritative server completion.
