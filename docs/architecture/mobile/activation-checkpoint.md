# MOB-01 — Store Companion Mobile Activation and Engineering Checkpoint

- **Checkpoint date:** 2026-07-29
- **Repository:** `rahmatullahboss/store-management-pos`
- **Workpack:** `MOB-01 — Store Companion Mobile`
- **Git branch:** `module/store-companion-mobile-v1`
- **Current verified source head:** `966315f37398307a743a3e2007521e60e4aa1cc9`
- **Draft pull request:** `#40` into `program/integration-v1`
- **Assigned worktree:** `.worktrees/store-companion-mobile`
- **Neon branch:** `dev/module-store-companion-mobile` (`br-cool-mode-axxzm8to`)
- **Neon parent:** `dev/module-pos-cash-offline` (`br-rapid-river-axoz0rfs`)
- **Starting reviewed base:** `47129e25191d1b1c8a8523dcd8f83c2a0b0edf55`
- **Status:** M0 complete; M1 Android/Flutter foundation complete; M2 platform-neutral identity/workspace security complete; MOD-F effective-localisation integration complete; M3 dependency review and encrypted persistence/sync core complete; iOS compile, native adapters and M3 background/corruption/update recovery remain open.

## Baseline and safety

The branch retains reviewed integration ancestry without reset, destructive rebase, force update or replacement of module-owned implementation. It consumes integrated Foundation through MOD-F contracts while MOD-G remains dependency-gated.

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

Generated Android source is reviewed and reproducible from the pinned Flutter template. The build uses AGP 9-compatible Kotlin DSL, Java/Kotlin 17, native-assets SQLite3MultipleCiphers and explicit resource-value support.

Application identities:

- development: `com.ozzyl.storecompanion.dev`;
- staging: `com.ozzyl.storecompanion.staging`;
- production identity: `com.ozzyl.storecompanion`.

Android application backup is disabled so secure-storage encrypted preferences cannot be restored into a different keystore. No release signing material is committed. Generated launcher artwork remains placeholder-only and blocks signed pilot/production release.

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

The mobile client strictly consumes the integrated `GET /v1/localization/effective-configuration` contract:

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

## M3 dependency and encrypted persistence checkpoint

### Reviewed dependencies

The module-local reuse manifest records exact versions, licences, provenance and review status for:

- Drift `2.34.3`;
- sqlite3 `3.5.0`;
- SQLite3MultipleCiphers `2.3.6` selected by the sqlite3 build hook;
- flutter_secure_storage `10.3.1`;
- path_provider `2.1.6` and path `1.9.1`.

Deprecated `sqlite3_flutter_libs`, `sqlcipher_flutter_libs` and `sqlite3_native_assets` dependencies are prohibited. The committed lockfile, runtime cipher assertion and Android native-assets builds are green.

### Security and schema

- encryption key material is obtained through a secure-storage seam and is not exposed by public getters, logs, diagnostics or `toString()`;
- database opening fails closed when `PRAGMA cipher` does not prove SQLite3MultipleCiphers availability;
- encrypted file reopen succeeds only with the correct key and wrong-key access fails;
- rebuildable projections, drafts, pending operations, authoritative results and cursors are physically separated;
- projection purge cannot remove drafts, pending operations, results or cursor evidence;
- authoritative result replay is immutable and mismatched replay is rejected;
- tenant/user/workspace partition keys prevent cross-context reads.

### Synchronisation persistence

- pending operations receive a monotonic local sequence per partition;
- legacy or late-created unsequenced operations are deterministically and idempotently backfilled on reopen;
- dispatch batches are bounded and returned in local-sequence order;
- retry scheduling excludes operations until their retry time and excludes terminal/unknown external states;
- projection pages and opaque cursors commit atomically;
- duplicate page replay is idempotent;
- cursor gaps and cross-scope replay fail closed;
- expired projection eviction preserves cursor and pending operation state.

Tests cover encrypted restart, wrong key, partition isolation, projection-only purge, draft/pending/result/cursor survival, duplicate idempotency, transition safety, authoritative replay mismatch, sequence continuity, late sequence backfill, retry timing, bounded pages, cursor replay/gaps and storage-pressure projection eviction.

## Current CI evidence

### Mobile Foundation CI

Run `30474949102`, job `90654219540`, source head `966315f37398307a743a3e2007521e60e4aa1cc9`: passed.

Evidence:

- exact Flutter/Dart toolchain verified;
- pub workspace and committed lockfile resolved;
- canonical Dart formatting passed with zero committed-source diff;
- `flutter analyze` passed;
- unit, widget, contract, security, localisation, encrypted database and sync persistence tests passed;
- lockfile, formatted-source and coverage artifacts uploaded.

### Android platform verification

Run `30474949141`, job `90654220082`, source head `966315f37398307a743a3e2007521e60e4aa1cc9`: passed platform generation and all three native-assets debug flavour builds.

| Evidence | Artifact ID | SHA-256 digest |
|---|---:|---|
| Generated platform source | `8733387282` | `d4c88e218fe6ae4cd402978fab2a7c5ba62c0192d38ad911bb13c03d63567e68` |
| Development debug APK | `8733390555` | `6c3ebbda547596ca8eea85bdd3487717cb573b8dedd2ae6c380da297a4a0ad97` |
| Staging debug APK | `8733393557` | `17bd29a9a4bb8baed5660e1e8754fd550858e05214c86cdf96f0c7baaecb0950` |
| Production-identity debug APK | `8733396741` | `aa9775b79ad4b891468727d5d21246685b2e0ca91fe452f63334259626e21e37` |

The production-identity artifact is an unsigned debug build and is not a production release.

### Root Foundation CI

Run `30474949300`: passed.

- verify job `90654220286`: format, lint, architecture, typecheck, build/tests, secret scan, licence register, SBOM and dependency audit passed;
- Cloudflare preview job `90654344563`: passed and cleaned up;
- Neon recovery job `90654344743`: passed;
- Neon preview job `90654464554`: passed.

### Dedicated Mobile Neon evidence

Run `30474949021`, job `90654219322`: passed. The assigned mobile evidence branch exists under the reviewed MOD-D parent and remains synthetic only.

### Neon quota-safe fallback

The project branch quota is occupied by legitimate persistent programme/module branches. Foundation preview CI therefore uses a run-scoped disposable database on `dev/foundation-v1` instead of deleting a module branch.

Verified run `30465971303`, artifact `8729594013` recorded:

- `isolationMode=database`;
- disposable database `ci_preview_30465971303`;
- Foundation migrations, integration tests and benchmark passed;
- shared compute was not suspended;
- `databaseCleanupDeleted=true`;
- post-run inventory confirmed only persistent `postgres` and `neondb` databases remained.

## Remaining gates

1. Add iOS development/staging schemes and bundle suffixes.
2. Obtain macOS-runner iOS simulator compile and test evidence.
3. Connect the reviewed session seams to external-browser OAuth, secure storage and deep-link adapters.
4. Add Android WorkManager and Apple BackgroundTasks adapters behind a platform-neutral coordinator; background timing must remain opportunistic.
5. Add corruption quarantine, bounded recovery/export and supported-update migration evidence without losing unsynchronised work.
6. Add explicit revocation recovery behavior for unsynchronised drafts and restricted cache.
7. Add generated localisation resources and Bengali/English/RTL/CJK visual/accessibility evidence.
8. Consume MOD-G governed metrics, reporting, communication, entitlement and approved OpenAPI contracts when integrated.
9. Produce signed internal/pilot artifacts only after separate signing, artwork, security and release authorization.

## Next checkpoint

Proceed with the M3 recovery and background-work boundary. Native schedulers may only request bounded synchronisation; they cannot assume exact execution time, bypass session/workspace authorization, retry unknown external state or delete unsynchronised work. Corrupt or incompatible local storage must be quarantined and recovered without silently treating local state as authoritative server completion.
