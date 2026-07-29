# Store Companion — Offline and Synchronisation Protocol

## 1. Objective

Store Companion must remain useful during intermittent connectivity without pretending that every business action can be completed offline. Offline behaviour is explicit, bounded by feature and policy, and recoverable.

The companion app reuses the integrated MOD-D principles of durable local commit, idempotency, cursor feeds and per-operation outcomes, but it does not inherit POS authority or risk limits automatically. Each mobile workflow has its own offline classification.

## 2. Offline classifications

### `online_only`

The action requires current server validation and cannot be queued as completed.

Examples:

- refund or high-discount approval;
- period close/reopen;
- manual journal posting;
- settlement or bank reconciliation decision;
- credit-limit override;
- payment/refund execution;
- restricted export;
- legal/fiscal configuration change.

The app may preserve a form draft, but it must display that no business action has been accepted.

### `cached_read`

Previously authorised data may be shown with source version, as-of time and staleness state.

Examples:

- product/barcode details;
- bounded stock snapshot;
- assigned purchase orders/counts/transfers;
- previously opened customer/order summaries;
- notification/approval references without current decision availability.

Cached data never expands scope and is removed or invalidated after permission/workspace revocation.

### `offline_draft`

The app stores work locally but does not represent it as submitted.

Examples:

- purchase receipt draft;
- stock count draft;
- transfer discrepancy draft;
- quotation draft;
- staged attachment metadata.

### `queued_command`

A command may be durably accepted by the device and uploaded later. The UI uses language such as “Saved on this device” or “Pending submission”, never “Posted” or “Approved”.

Examples, subject to tenant/module policy:

- stock-count submission;
- receiving batch submission;
- limited transfer receipt/dispatch;
- quotation creation;
- limited customer creation.

### `online_confirmed_with_local_recovery`

The action begins online; if the response is lost, the app recovers by idempotency/status query and never blindly repeats an external or high-risk effect.

Examples:

- evidence upload confirmation;
- approval decision;
- server-side state transition where the request may have committed.

## 3. Capability matrix

| Capability | Default classification | Local success wording | Authoritative confirmation |
|---|---|---|---|
| Barcode/product lookup | cached_read | “Cached as of …” | Refresh feed/query |
| Stock balance lookup | cached_read | “Snapshot as of …” | Current server query |
| Receiving line capture | offline_draft | “Draft saved” | None |
| Receiving submission | queued_command where enabled | “Pending submission” | MOD-B receipt result |
| Stock count capture | offline_draft | “Draft saved” | None |
| Stock count submission | queued_command | “Pending submission” | MOD-B count result |
| Transfer preparation | offline_draft | “Draft saved” | None |
| Transfer dispatch/receive | online_only by default | No local completion | MOD-B transition result |
| Customer limited create | queued_command where enabled | “Pending verification” | MOD-C customer result |
| Quotation create/revise | queued_command | “Pending submission” | MOD-C quote result |
| Sales-order transition | online_only by default | No local completion | MOD-C order result |
| Approval decision | online_confirmed_with_local_recovery | “Submitting…” | Owning module decision result |
| Finance reconciliation/close | online_only | No local completion | MOD-E result |
| Report request | online_only | “Requested” after server acceptance | MOD-G report job |

Country pack, tenant policy and module capability may make a default stricter. The client never weakens a server rule.

## 4. Local operation envelope

Queued commands use a durable envelope written transactionally before the UI reports local acceptance:

```text
operation_id                 UUIDv7
local_sequence               monotonic per installation/workspace
operation_type               versioned business intent
schema_version
idempotency_key
payload_hash
identity_session_reference
workspace_context_reference
tenant_id                     opaque/local partition key
legal_entity_id               optional
store_id                      optional
warehouse_id                  optional
device_id
created_at_utc
created_at_local_with_offset
business_date
base_resource_version         optional
last_server_cursor
policy_snapshot_version
payload
attachment_dependencies
operation_dependencies
state
attempt_count
last_attempt_at
next_retry_at
server_result_reference
trace_id
```

Do not store reusable provider credentials, PAN/CVV, unrestricted policy data or full sensitive records in operation payloads.

## 5. Local states

```text
draft
locally_committed
waiting_for_connectivity
waiting_for_dependency
uploading
accepted
accepted_with_adjustment
duplicate_replay
deferred
requires_online_confirmation
requires_approval
conflict
rejected
superseded
unknown_external_state
```

Terminal results remain available for reconciliation and support according to retention policy. A user may explicitly dismiss resolved UI items, but audit/result evidence is not silently erased while required.

## 6. Pull synchronisation

### Initial snapshot

1. Authenticate and resolve workspace.
2. Request bootstrap and approved collections.
3. Download signed snapshot from R2 when the projection is large.
4. Verify tenant/workspace binding, expiry, schema, checksum and high-water cursor.
5. Import into a staging projection transaction.
6. Atomically activate the new projection.
7. Preserve pending operations and drafts in separate tables.
8. Continue with incremental changes from the high-water cursor.

### Incremental changes

- Cursor is opaque and scoped.
- Changes are applied in a transaction per bounded page/collection.
- Upserts carry source version.
- Deletions use tombstone/archive semantics and cannot reveal restricted record existence.
- Applying a newer source version is idempotent.
- A cursor gap/expiry triggers snapshot rebuild.
- If capability scope narrows, affected cached data is purged or cryptographically inaccessible before normal use resumes.

## 7. Push synchronisation

1. Select eligible operations in local sequence/dependency order.
2. Recheck local schema, session, workspace and attachment readiness.
3. Upload a bounded batch with operation and idempotency IDs.
4. Persist the raw safe result and trace reference transactionally.
5. Apply accepted server references/versions to projections.
6. Move conflicts/rejections to a visible reconciliation state.
7. Advance cursor only when the server declares it safe.
8. Retry only retryable outcomes with bounded exponential backoff and jitter.

One rejected operation must not make independent operations disappear. Dependent operations remain blocked and visible.

## 8. Conflict policy

Do not use generic last-write-wins.

| Conflict | Default behaviour |
|---|---|
| Duplicate operation | Return/persist original result |
| Resource changed since draft | Conflict with current version and reconcile UI |
| Product archived | Reject or require online review |
| Unit/conversion policy changed | Recalculate/confirm on server; never silently rewrite exact entry |
| Purchase order line changed | Conflict; show original draft and current server line |
| Receipt tolerance exceeded | Approval/online confirmation according to MOD-B |
| Count session closed | Reject/supersede; retain local evidence |
| Serial already used | Reject specific line; preserve other per-line results if contract permits |
| Transfer state advanced | Conflict/supersede according to authoritative transition |
| Customer merged | Remap to canonical reference with explicit result |
| Quote price/tax version stale | Server result according to MOD-A/MOD-C policy; never client recalculate authoritatively |
| Permission revoked | Block upload and purge restricted cache; preserve only permitted recovery metadata |
| Session/device revoked | Stop sync, clear credentials, follow unsynchronised-draft recovery policy |
| Attachment upload missing/failed | Wait for dependency or reject without losing draft |
| Unknown external state | Query status/recovery path; no blind retry |

## 9. Ordering and dependencies

Local sequence preserves device order only. The server does not assume global order between devices.

Operations declare dependencies when required, for example:

```text
upload evidence -> create receiving command
create limited customer -> create quotation referencing local customer alias
submit count -> request variance approval
```

The client maps accepted local aliases to server references. Cyclic dependencies are invalid. A failed prerequisite blocks dependents with a clear action.

## 10. Connectivity and background work

Network reachability is a hint, not proof that the API is usable.

Sync triggers:

- app start and resume;
- active workspace change;
- user pull-to-refresh/sync-now;
- immediately after a queued command when network is available;
- Android WorkManager constrained work;
- Apple BackgroundTasks opportunistic refresh/processing;
- minimal push/data notification hint where supported;
- periodic foreground timer while the app is active and work is pending.

Rules:

- one coordinator per app/workspace prevents duplicate upload loops;
- exact background timing is never assumed;
- mobile OS termination may delay work;
- critical actions remain online and server-driven;
- battery/data-saver restrictions are visible through delayed sync state where detectable;
- retries stop at a bounded threshold and require user/support attention.

## 11. Local migrations and application updates

- Local schema version and compatible API/sync ranges are declared by the app.
- Migrations are transactional and resumable.
- Pending operations are migrated before projection caches.
- A destructive migration is forbidden while unsynchronised operations are not safely migrated/exported.
- Forced update may make the app read-only, but it cannot discard pending work.
- Server retains compatibility handlers for the documented support window.
- Unsupported clients receive a stable minimum-version response and recovery path.
- Projection tables may be dropped/rebuilt after pending-operation safety is proved.

## 12. Logout, workspace switch and revocation

### User-initiated logout

- attempt foreground sync;
- show exact pending count and affected workspaces;
- allow cancellation of logout or approved local encrypted retention where policy permits;
- never imply unsynchronised work was submitted;
- clear tokens immediately after final decision;
- purge or retain local data according to classification and policy.

### Workspace switch

- isolate data by tenant/workspace;
- stop active sync before switch;
- never show previous workspace data during transition;
- load new bootstrap/capabilities before routes activate.

### Remote revocation

- access/refresh session fails closed;
- sync stops;
- restricted cached data is purged or locked;
- local drafts follow a documented recovery policy without automatic upload under revoked authority;
- a support-safe diagnostic reference may remain.

## 13. Storage pressure and corruption

- Monitor database/cache/staged-file size.
- Evict rebuildable media and old projections before drafts/operations.
- Never evict pending operations to free space.
- Reject new offline capture before storage exhaustion if durability cannot be guaranteed.
- Detect checksum/SQLite integrity failure.
- Quarantine corrupt projections and rebuild from snapshot.
- Preserve/recover pending operations through separate backup table/file with integrity checks.
- Surface a blocking recovery screen when durable local commit cannot be guaranteed.

## 14. Observability

Privacy-safe device telemetry:

- last successful pull/push and cursor age;
- pending, conflicted, rejected and unknown-state counts;
- oldest pending age;
- retry/error categories;
- local schema/projection versions;
- snapshot import/rebuild outcome;
- database and staged-file size;
- storage pressure;
- background-work scheduling/outcome;
- app version/build and OS version class;
- clock skew and timezone change;
- device revocation state.

Do not emit business payloads, customer details, supplier terms, exact financial values or unrestricted record IDs as general telemetry.

## 15. Required tests

- crash after local commit before success screen;
- app kill/restart with drafts and pending operations;
- response loss after server acceptance;
- duplicate batch and operation replay;
- out-of-order batches and dependencies;
- partial batch rejection;
- cursor expiry and full rebuild;
- projection corruption while pending operations exist;
- schema/app update with pending operations;
- storage pressure and failed durable write;
- tenant/workspace switch;
- permission/session/device revocation;
- stale purchase order/count/quote versions;
- serial duplicate and receiving tolerance conflict;
- attachment upload dependency failure;
- 24-hour intermittent-network workload for representative operational volume;
- Android/iOS background delay/termination;
- clock/timezone/business-date transition;
- server restore followed by replay;
- no duplicate stock, sales, payment, journal or approval effects.
