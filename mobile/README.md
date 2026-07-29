# Store Companion Flutter Workspace

This directory contains the native Android/iOS Store Companion client. It is intentionally outside the root npm `apps/*` and `packages/*` workspaces.

## Toolchain

The initial foundation is pinned to:

```text
Flutter 3.44.8 stable
Flutter commit 058e0af2c2b57e369d905a03ac9748b0ebf543c6
Dart 3.12.2
```

See `toolchain.yaml`. Upgrades are explicit reviewed checkpoints, not floating CI changes.

## Current checkpoint

The repository currently contains:

- Dart pub workspace;
- strict analysis policy;
- dependency-free application core package;
- versioned mobile API-contract package;
- deterministic operation sync-state package;
- dependency-free OAuth/session/workspace-isolation package;
- Operations Ledger Flutter design-system package;
- synthetic Store Companion application shell;
- OAuth redirect/state, session revocation, workspace isolation, contract, sync, unit and widget tests;
- public CI using the exact official Flutter commit.

The session package stores no access token, refresh credential, PKCE verifier, password or provider secret. It validates reviewed OAuth request/callback metadata, represents only opaque session/device/workspace references, stops sync after revocation and requires restricted-cache purge or locking before reuse.

Android and iOS generated platform directories are deliberately not claimed at this connector-created checkpoint. In an executable worktree with the pinned Flutter SDK, M1 must generate and review them with the approved identifiers, then commit the generated files and platform/flavour configuration.

Suggested reviewed command from `mobile/`:

```bash
flutter create \
  --platforms=android,ios \
  --org com.ozzyl \
  --project-name store_companion \
  apps/store_companion
```

Run this only in the assigned MOB-01 worktree. Review every generated or changed file; do not overwrite the existing `lib/`, `test/` or `pubspec.yaml` without reconciling the foundation implementation.

## Commands

From `mobile/`:

```bash
flutter pub get
dart pub workspace list
dart format --output=none --set-exit-if-changed .
flutter analyze
flutter test
```

After platform files are committed:

```bash
flutter build apk --debug --flavor development
flutter build ios --simulator --no-codesign --flavor development
```

The exact flavour/platform commands are finalised after the generated Android/iOS project checkpoint.

## Dependency policy

The first foundation intentionally uses only Flutter/Dart SDK packages and repository-owned code. Each future package or native SDK requires:

- maintenance and platform compatibility review;
- licence/provenance entry;
- privacy/security review;
- offline/migration implications;
- deterministic version pinning through `pubspec.lock`;
- CI on Android and iOS.

## Architecture

```text
Views -> ViewModels -> Repositories -> remote/local/platform adapters
```

The Flutter client never connects directly to Neon and never implements authoritative pricing, tax, stock, sales, payment or accounting rules. See `docs/mobile/` and `docs/agent-workpacks/MOB-01-STORE-COMPANION.md`.

## Synthetic data

The initial app uses a clearly labelled synthetic bootstrap fixture. It contains no production credentials or customer data and is not a claim that backend mobile contracts are already deployed.
