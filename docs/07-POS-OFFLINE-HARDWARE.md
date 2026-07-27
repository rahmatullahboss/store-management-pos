# POS, Offline Operation and Hardware Architecture

## 1. Objective

The POS must remain fast, predictable and auditable during normal connectivity, degraded connectivity and full network loss. Offline operation is a controlled risk mode with explicit limits, not an invisible fallback.

The recommended baseline is an installable web POS with a local durable database and an optional desktop/native bridge for hardware that cannot be handled reliably through browser APIs.

## 2. Client deployment modes

### Mode A — Installable PWA

Use for:

- barcode scanners operating as keyboards;
- standard browser printing or network printing;
- touch checkout;
- tablets and commodity desktops;
- stores that do not require specialized fiscal devices.

Components:

- service worker for application shell and version management;
- IndexedDB or a well-tested browser database abstraction;
- local product/price/search projection;
- append-only local operation log;
- local cart and receipt snapshots;
- explicit online/offline status and synchronization control.

### Mode B — PWA plus local hardware agent

Use a signed local service when the browser needs reliable access to:

- ESC/POS receipt printers;
- cash drawers;
- scales;
- serial/USB devices;
- customer displays;
- label printers;
- fiscal devices;
- locally installed payment terminals.

The browser communicates with the local agent over an authenticated loopback channel. The agent exposes a narrow capability API and must never become a second business database.

### Mode C — Desktop shell

Use Tauri, Electron or another audited shell only when required by hardware, kiosk control, local encrypted SQLite or operating-system integration.

The application domain remains shared with the PWA. Avoid separate product behavior for desktop and browser editions.

### Mode D — Native mobile POS

Defer until payment-terminal, app-store, camera scanning and mobile-printer requirements justify the cost. Management, approvals, receiving and stock counting are better first mobile use cases.

## 3. Local data model

The local POS database contains only the data required for assigned stores/registers:

- device and register enrollment;
- user/offline permission snapshot with expiry;
- sellable catalog subset;
- barcode/SKU/search index;
- price, tax and promotion snapshots with versions;
- selected customer subset or locally created customers;
- active suspended carts;
- shift and cash events;
- pending operations and server acknowledgements;
- receipt render snapshots;
- synchronization cursors;
- hardware configuration.

Do not replicate the complete accounting or supplier database to the register.

Sensitive local data must be minimized and encrypted where the platform permits. Device logout does not silently delete unsynchronized operations.

## 4. Offline operation log

Every locally accepted command is written before the UI reports success.

Required envelope:

```text
local_operation_id: UUIDv7
local_sequence: monotonically increasing per device
operation_type
schema_version
tenant_id
store_id
register_id
device_id
actor_id
authorization_snapshot_id
business_date
created_at_utc
created_at_local_with_offset
last_server_cursor
payload
payload_hash
sync_state
retry_count
server_result_reference
```

States:

- `draft`
- `locally_committed`
- `uploading`
- `accepted`
- `accepted_with_adjustment`
- `rejected`
- `needs_review`
- `superseded`

The server inbox has a unique key on tenant, device and local operation ID. Duplicate uploads return the previously stored result.

## 5. Synchronization protocol

### Download stream

The device requests changes after its last acknowledged cursor. Change sets include:

- catalog changes;
- price/tax/promotion versions;
- user/device policy changes;
- store/register configuration;
- customer updates where permitted;
- server results for previously uploaded operations.

Large initial data sets use a versioned snapshot in R2 plus incremental changes. A snapshot includes checksum, schema version and high-water cursor.

### Upload stream

The client uploads ordered batches. The server:

1. authenticates the enrolled device and actor snapshot;
2. validates operation envelope and signature/hash;
3. deduplicates by operation ID;
4. validates prerequisites and policy;
5. executes the authoritative command;
6. persists result and audit record;
7. returns accepted/rejected/review status;
8. advances the acknowledged cursor when safe.

One invalid operation must not cause later independent operations to disappear. The protocol returns per-operation results.

### Ordering

Local sequence preserves device order, but the system must not assume global ordering among registers. Server commands use business invariants, version checks and idempotency rather than wall-clock order.

## 6. Conflict policy

Conflicts must be classified rather than handled by generic “last write wins.”

| Conflict | Default policy |
|---|---|
| Duplicate operation | Return original result |
| Product archived while offline | Reject or manager review according to policy |
| Price changed | Accept recorded offline price within tolerance; otherwise review |
| Tax rule changed | Country-pack policy; often use transaction-time cached rule if legally valid |
| Promotion expired | Accept only within configured offline grace and version |
| Stock became unavailable | Apply negative-stock policy; never rewrite completed local receipt silently |
| Customer merged | Remap to canonical customer and retain local reference |
| User permission revoked | Allow only operations created before signed authorization expiry and policy cutoff |
| Shift already closed remotely | Open reconciliation exception; do not discard cash events |
| Receipt number collision | Impossible under signed allocation; otherwise issue correction workflow |
| Gift card/store credit changed | Usually online-only redemption or tightly bounded offline authorization |
| Card payment status uncertain | Query provider/terminal; never create a second charge blindly |

All adjusted or rejected operations appear in a manager reconciliation queue.

## 7. Offline capability matrix

| Capability | Offline default | Notes |
|---|---:|---|
| Cash sale | Yes | Subject to catalog/policy snapshot |
| Cash return | Limited | Receipt/policy/manager rules |
| Card payment | Provider-dependent | Only certified store-and-forward/offline capability |
| Split tender | Limited | Cash plus supported offline tender only |
| New customer | Yes | Minimal data, duplicate merge later |
| Customer credit sale | Limited | Signed available-credit snapshot and limit |
| Gift card/store credit redemption | No by default | High double-spend risk |
| Loyalty earn | Yes | Pending ledger entry |
| Loyalty redeem | No/limited | Signed balance and risk ceiling |
| Product creation | No | Back-office only |
| Price override | Manager policy | Local approval evidence |
| Stock transfer | Draft only | Authoritative dispatch/receipt after sync unless pack permits |
| Purchase receiving | Configurable | Warehouse devices may use offline receive batch |
| Shift open/close | Yes | Reconciled after sync |
| Fiscal/e-invoice issue | Country-dependent | Pack defines legal behavior |

## 8. Offline risk controls

Per tenant/store/register configuration:

- maximum offline duration;
- maximum transaction amount;
- maximum daily/register offline amount;
- allowed tenders;
- allowed product/tax classes;
- price deviation tolerance;
- negative-stock policy;
- customer-credit ceiling;
- required manager approval actions;
- signed authorization expiry;
- forced online validation for controlled items;
- device health and clock-drift limits.

The POS displays current risk state, last successful sync and pending operation count.

## 9. Receipt and legal document numbering

International deployment requires a strategy per country pack:

1. **Preallocated signed ranges** — server assigns a register a bounded legal number range.
2. **Fiscal device authority** — local certified hardware assigns/signs the fiscal number.
3. **Cloud fiscal provider** — checkout requires provider response; offline fiscal sale may be prohibited.
4. **Provisional receipt** — local non-fiscal receipt followed by legal issuance after sync, only where law permits.
5. **Hybrid contingency mode** — regulator-defined outage procedure and later reporting.

Number allocations contain store/register scope, sequence bounds, validity, country-pack version and cryptographic evidence where required. Unused ranges are retired with an audit record, never reassigned casually.

## 10. Payment terminal integration

Use semi-integrated or provider SDK/terminal APIs so card data goes directly between customer, certified terminal and payment provider.

Internal lifecycle:

```text
created -> awaiting_terminal -> authorized -> captured -> settled
                     \-> declined/cancelled/unknown
captured -> partially_refunded/refunded
```

Rules:

- stable payment intent and provider idempotency key;
- terminal/register association;
- recovery query after timeout;
- signed webhooks normalized into internal events;
- no PAN or CVV in application logs/database;
- unknown status blocks blind retry until reconciled;
- offline card acceptance only when the provider explicitly supports it and liability is documented.

## 11. Hardware abstraction

Define capability interfaces:

```text
ReceiptPrinter.print(document)
CashDrawer.open(reason)
BarcodeScanner.onScan(handler)
Scale.readWeight()
CustomerDisplay.show(cartSnapshot)
LabelPrinter.print(template, data)
PaymentTerminal.start(paymentIntent)
FiscalDevice.issue(fiscalDocument)
```

Hardware profiles specify:

- connection type;
- vendor/model;
- supported commands;
- paper/label dimensions;
- code page/Unicode behavior;
- timeout and retry policy;
- health-check capability;
- required local agent version.

Core checkout code calls capabilities, not vendor-specific commands.

## 12. Printing architecture

Receipt rendering uses a versioned semantic receipt document, not raw HTML as the legal source.

```text
ReceiptDocument
- issuer/legal entity
- store/register/cashier
- document and fiscal references
- line, discount, tax and total components
- tender summary
- customer/tax identity when needed
- QR/barcode/fiscal signature
- localization and template version
```

Renderers:

- thermal ESC/POS;
- browser print/PDF;
- email HTML/PDF;
- label formats;
- fiscal-device payload.

The snapshot used at sale time is immutable so the receipt can be reproduced after templates change.

## 13. Shift and cash control

Offline-capable cash events are append-only:

- shift opened;
- opening float;
- cash sale/refund;
- paid in/out;
- safe drop;
- drawer transfer;
- closing count;
- variance explanation;
- manager approval.

Expected cash is derived. A blind close hides expected amount until the count is submitted. Server reconciliation can flag duplicate, missing or out-of-policy events without editing local history.

## 14. Security

- Device enrollment uses short-lived bootstrap and rotating device credentials.
- Register/device binding can be revoked centrally.
- Offline permissions are signed, scoped and expire.
- Local secrets use OS keystore where available.
- Local database contains no payment-card secrets.
- POS auto-lock and user switch preserve pending carts safely.
- Debug logs redact customer/payment data.
- Local agent accepts only authenticated origin/client requests and signed updates.
- Application updates are signed, staged and rollback-aware.
- Rooted/jailbroken device policy is configurable for high-risk deployments.

## 15. Version and update strategy

The service worker/native shell must avoid running incompatible application, local database and operation schemas.

- application manifest declares minimum server/client versions;
- local migrations are transactional and resumable;
- operation payload schemas are backward-compatible during a support window;
- forced update is allowed only after pending operations are safely synced/exported;
- server keeps compatibility handlers for supported offline versions;
- outdated devices become read-only or controlled offline according to risk policy.

## 16. Observability

Device telemetry when online:

- last sync and cursor;
- pending/rejected operation count;
- local database size and migration version;
- application and agent version;
- hardware health;
- terminal status;
- clock drift;
- offline duration;
- crash/error fingerprints;
- shift status.

Never stream sensitive cart/customer details as general telemetry.

## 17. Required test scenarios

- browser refresh/crash after local commit but before UI response;
- response loss after server acceptance;
- duplicate and out-of-order batches;
- two registers selling the final unit;
- 24-hour outage with high transaction volume;
- local clock changed or daylight-saving transition;
- expired price/tax/user snapshot;
- app update with pending operations;
- damaged local index and full rebuild;
- printer/terminal disconnect during checkout;
- payment authorized but server response lost;
- shift close while offline and remote manager action;
- receipt range exhausted;
- device revocation during outage;
- customer/gift-card double-spend attempts;
- server restore followed by sync replay.

## 18. Acceptance criteria

The offline POS design is production-ready only when:

- acknowledged local operations survive browser/device application restart;
- duplicate upload never duplicates sale, payment, stock or journal effects;
- every conflict produces a visible, auditable disposition;
- online recovery cannot double-charge a customer;
- receipt numbering is approved for the initial country pack;
- shift cash can be reconstructed solely from cash events;
- a full local projection rebuild does not lose pending operations;
- unsupported offline tender/actions are clearly blocked;
- update/rollback behavior is tested with unsynchronized data;
- operations teams can inspect device health and reconciliation exceptions.
