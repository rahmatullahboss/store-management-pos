# Store Companion Parallel Execution Addendum

This addendum extends `17-PARALLEL-AGENT-EXECUTION.md` for MOB-01 without changing the ownership or integration order of MOD-A through MOD-G.

## 1. New large bounded workpack

| ID | Workpack | Git branch | Worktree | Neon branch | Owned document |
|---|---|---|---|---|---|
| MOB-01 | Store Companion Mobile | `module/store-companion-mobile-v1` | `.worktrees/store-companion-mobile` | `dev/module-store-companion-mobile` | `agent-workpacks/MOB-01-STORE-COMPANION.md` |

MOB-01 is one indivisible client workpack. One owner completes Android, iOS, Flutter architecture, local data, sync, design, features, tests, CI, release operations and documentation. Do not create separate Android, iOS, authentication, database, sync or feature agents.

## 2. Activation point

MOB-01 may start controlled parallel development after MOD-D is integrated because the following reviewed contracts are available:

- Foundation identity, tenant, permissions, session/device revocation, audit, idempotency, errors and localization primitives;
- MOD-A catalog/pricing/tax;
- MOD-B inventory/procurement;
- MOD-C customer/sales/fulfilment;
- MOD-D compatible device/offline/idempotency concepts;
- MOD-E payment/accounting/banking;
- Operations Ledger design authority.

MOB-01 starts from reviewed integration SHA `47129e25191d1b1c8a8523dcd8f83c2a0b0edf55` and has been non-destructively synchronised with the later reviewed integration state through merge `d3d75da3324fd9ad6015b707d27d1806bdaf8242`.

## 3. Dependency gates

MOB-01 development is parallel, but final features remain gated:

- MOD-F owns effective locale, currency, business date, country capability, privacy/retention and legal/fiscal behaviour.
- MOD-G owns governed dashboards/metrics, reports, notifications/integrations, plans/entitlements and canonical OpenAPI/public contracts.

MOB-01 uses frozen deterministic fixtures for unfinished dependencies and must not copy unreviewed implementation internals.

## 4. Final integration order

The programme integration order is extended additively:

```text
MOD-A -> MOD-B -> MOD-C -> MOD-E -> MOD-D -> MOD-F -> MOD-G -> MOB-01
```

MOB-01 final integration follows MOD-G by default. An earlier additive mobile-foundation checkpoint may be accepted only by the programme integrator when it:

- contains no speculative domain contract;
- does not alter another module's schema or private paths;
- does not block MOD-F/MOD-G;
- passes complete repository/mobile verification;
- records exact compatibility and rollback evidence.

## 5. Repository ownership

MOB-01 owns:

```text
mobile/**
docs/mobile/**
docs/architecture/mobile/**
docs/agent-handoffs/MOB-01-*.md
docs/agent-workpacks/MOB-01-STORE-COMPANION.md
tests/mobile/**
.github/workflows/mobile-*.yml
tooling/mobile/**
```

Additive shared documentation/contract edits require review. MOB-01 owns no server module schema or canonical business table.

## 6. Database and Neon rule

- Neon PostgreSQL remains canonical.
- The Flutter app never connects directly to Neon.
- Device SQLite is bounded, non-authoritative and rebuildable while preserving pending operations.
- `dev/module-store-companion-mobile` is used only for synthetic contract/E2E evidence against the reviewed integration database state.
- MOB-01 does not create a `mobile` PostgreSQL business schema merely to satisfy the one-branch-per-workpack convention.

## 7. Contract change process

CCR-0003 proposes additive first-party contracts for:

- mobile bootstrap;
- workspace context;
- non-POS device/push-token lifecycle;
- permission-scoped change feed;
- generic operation batch/result;
- approval reference;
- notification reference.

MOB-01 may implement client interfaces and fixtures while the request is reviewed, but shared server implementation lands through the Foundation/module/programme owner path.

## 8. Safe synchronisation with programme integration

A module client branch may merge newer reviewed `program/integration-v1` checkpoints non-destructively at declared milestones. It must not:

- reset or force-update history;
- import unreviewed active module internals;
- merge incomplete MOB-01 work into the programme branch out of order;
- modify another agent's worktree;
- hide conflicts by replacing tracker/shared files with stale versions.

Programme-board and activation-policy state must be reconciled after every such sync.

## 9. Verification and evidence

MOB-01 checkpoints record:

- exact base and sync merge SHAs;
- worktree and synthetic Neon branch verification;
- Flutter/Dart version and lockfile;
- dependency provenance and SBOM;
- format/analyze/test/build results;
- Android/iOS artifacts where executed;
- API compatibility tests;
- local migration/offline/replay/recovery tests;
- tenant/workspace security negatives;
- Operations Ledger/Impeccable/accessibility/RTL evidence;
- performance/device matrix;
- no unauthorized production mutation/deployment.

No evidence is claimed unless executed in CI or a recorded worktree/device environment.
