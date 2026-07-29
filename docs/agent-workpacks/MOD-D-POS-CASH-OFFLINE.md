# MOD-D: POS, Cash, Offline and Hardware

## Assignment

One agent owns the entire store-edge workpack: checkout UX, cash shifts, local database, synchronization and hardware. Do not assign separate agents to POS UI, offline sync, printing or cash management.

```text
Git branch:   module/pos-cash-offline-v1
Worktree:     .worktrees/pos-cash-offline
Neon branch:  dev/module-pos-cash-offline
Base SHA:     6badafe06a9e0013d12ba036160c915b48fe1c13
```

The base SHA is the secured Wave 1 `main` baseline after MOD-A, MOD-B, MOD-C and MOD-E integration and GitHub Actions/Neon cold-wake hardening. Do not rebase this workpack onto the earlier Foundation-only branch.

## Mission

Deliver a fast, auditable POS that operates online and through an approved offline window, survives restart, synchronizes idempotently and works through a stable hardware abstraction.

## Owned paths and schemas

```text
modules/pos/**
modules/cash/**
modules/offline/**
apps/pos-web/src/modules/**
apps/hardware-agent/**
database/modules/pos/**
database/modules/cash/**
docs/modules/pos-cash-offline/**
PostgreSQL schemas: pos, cash
Client local database schemas: pos_local, operation_log
```

## Complete scope

- register/session/cart and barcode/touch checkout UX;
- local catalog, barcode, price, tax and permission projections;
- customer lookup/quick create through MOD-C contract;
- discount/price override and manager approval;
- cash, external card, split-tender and supported stored-value interfaces;
- suspend/resume cart, receipt lookup, return/refund/exchange UX;
- semantic receipt snapshot and print/email/SMS requests;
- shift open/close, opening float, cash sale/refund, paid-in/out and safe drop;
- blind cash count, expected cash, variance and approval;
- append-only local operation log committed before local success;
- upload/download cursor protocol and per-operation outcomes;
- duplicate, out-of-order, rejected and review conflict handling;
- signed expiring offline authorization and risk limits;
- offline cash sale/shift behavior and provider/country capability restrictions;
- local database migration, rebuild and application-update safety;
- device/register enrollment, health, clock drift and remote revoke;
- printer, drawer, scanner, scale, customer-display, terminal and fiscal-device capability interfaces;
- PWA baseline plus signed local hardware agent/desktop shell only where needed;
- POS APIs, events, UI, telemetry, reconciliation console and runbooks.

## Contract responsibilities

Produce:

- POS checkout request/result;
- cash shift and cash-event contracts;
- offline operation envelope and synchronization result;
- receipt rendering request and immutable receipt snapshot;
- register/device health events.

Consume:

- catalog/price/tax snapshot and incremental feed;
- stock reservation/posting result;
- customer/sales/order/return contracts;
- payment intent/status/refund contracts;
- accounting posting result;
- country-pack receipt/fiscal/offline capability.

## Required invariants

- a locally accepted operation is durable before success is shown;
- same device/operation ID never creates duplicate business effects;
- expected cash equals append-only cash events;
- payment unknown state blocks blind retry;
- offline conflict never silently rewrites or discards a completed local receipt;
- client projections are rebuildable without deleting pending operations;
- app update cannot strand incompatible unsynchronized operations;
- card PAN/CVV and reusable provider secrets are never stored locally;
- offline permissions and receipt number allocations expire and are scoped.

## Required tests

- crash/refresh after local commit;
- lost server response and duplicate replay;
- out-of-order operation batches;
- 24-hour outage with representative volume;
- final-unit stock conflict across registers;
- stale price/tax/promotion/permission;
- payment authorization with unknown response;
- shift close and cash reconciliation while offline;
- receipt range exhaustion and country restriction;
- local schema/app update with pending operations;
- device revocation, clock drift and local storage pressure;
- printer/terminal/agent failure;
- projection corruption and rebuild;
- accessibility, keyboard speed and low-end device performance.

## Open-source reuse guidance

Open Source POS is workflow reference only because its custom terms require a visible footer across pages. Permissive ESC/POS, barcode, QR and offline-storage libraries may be used after provenance and Workers/browser compatibility review.

## Completion gate

- cashier can complete approved online and offline journeys;
- restart and replay never duplicate sale, payment, stock, cash or journal effects;
- shift cash reconstructs entirely from cash events;
- reconciliation console exposes every rejected/adjusted operation;
- supported hardware profiles pass lab tests;
- country/provider unsupported offline actions are clearly blocked;
- migrations and local schema upgrades pass from clean and pending states;
- security, performance, accessibility and device-health tests pass;
- operational runbooks and handoff are complete;
- handoff path: `docs/agent-handoffs/MOD-D-handoff.md`.
