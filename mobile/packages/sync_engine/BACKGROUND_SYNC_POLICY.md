# Store Companion bounded background synchronisation policy

This checkpoint defines the platform-neutral decision boundary consumed by foreground code and future Android WorkManager/Apple BackgroundTasks adapters.

## Invariants

- Native schedulers request work; they never assume exact execution time or business completion.
- Revoked, unauthenticated or unauthorized workspace state blocks pull and push, locks restricted cache and requires foreground reconciliation.
- Session revocation also clears opaque credential references through the owning native adapter.
- A quarantined corrupt database or incompatible local schema blocks background work; no destructive rebuild may discard drafts or pending operations.
- Unknown external state permits bounded status/projection recovery but prohibits operation push and blind retry.
- Connectivity is treated as a hint; unavailable connectivity delays rather than completes work.
- Battery/data-saver restrictions delay opportunistic platform-background work. An explicit foreground user request remains bounded but is not rejected solely by those scheduler hints.
- Platform-background and push-hint runs may submit at most 10 operations.
- Foreground/application/user runs may submit at most 25 operations.
- A stricter configured limit always wins.
- Retry-not-due operations remain untouched while an independent projection refresh may proceed.
- Low-space handling may evict only expired rebuildable projections before bounded work; it cannot remove drafts, pending operations, authoritative results or cursors.
- One active coordinator prevents duplicate upload loops.

## Current boundary

`store_companion_background_sync.dart` is pure Dart and performs no network, database, credential or platform scheduling I/O. Native WorkManager/BackgroundTasks packages remain unadopted until exact version, licence, provenance, platform configuration and build evidence are reviewed.

The next implementation step is to connect this policy to a coordinator that reads safe local counts/state, acquires a single-run lease, invokes the approved API client and commits per-operation outcomes transactionally. Native adapters will remain thin scheduling hints around that coordinator.
