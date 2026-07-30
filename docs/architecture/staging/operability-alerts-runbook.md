# Persistent staging operability alerts runbook

Status: implemented for aggregate synthetic-staging evidence
Date: 2026-07-31
Branch: `ops/persistent-admin-pos-staging-v1`

## Scope and safety boundary

This runbook governs deterministic operability evidence for the persistent Admin/POS synthetic staging environment. It does not configure a production monitoring vendor, paging channel, customer communication process or production resource. The staging workflow records only fixed low-cardinality aggregate metrics and fixed alert identifiers.

Alerts, workflow summaries and retained artifacts must never include:

- passwords, session cookies, step-up grants, recovery or verification tokens;
- TOTP secrets, encryption material, signing secrets or provider credentials;
- database URLs, query parameters, row payloads, document contents or customer email addresses;
- arbitrary tenant, user, account, product, order or journal identifiers.

Critical alerts fail the staging operability gate only after the enriched evidence report is written atomically. Synthetic outbox publisher failures are critical; post-publisher backlog alerts remain review-only until a production transport and approved service-level objective are commissioned.

## Policy matrix

| Signal | Warning | Critical | Owner | Response objective | Runbook |
|---|---:|---:|---|---:|---|
| `http_probe_failures` | none | `> 0` | platform-sre | 15 min | [Availability and HTTP probes](#availability-and-http-probes) |
| `browser_scenario_failures` | none | `> 0` | platform-sre | 30 min | [Browser and accessibility evidence](#browser-and-accessibility-evidence) |
| `axe_violations` | none | `> 0` | platform-sre | 30 min | [Browser and accessibility evidence](#browser-and-accessibility-evidence) |
| `horizontal_overflow_failures` | none | `> 0` | platform-sre | 30 min | [Browser and accessibility evidence](#browser-and-accessibility-evidence) |
| `identity_control_failures` | none | `> 0` | security-operations | 15 min | [Identity, recovery and MFA controls](#identity-recovery-and-mfa-controls) |
| `controlled_command_failures` | none | `> 0` | inventory-operations | 15 min | [Controlled reservation command](#controlled-reservation-command) |
| `artifact_secret_leaks` | none | `> 0` | security-operations | 5 min | [Artifact or secret exposure](#artifact-or-secret-exposure) |
| `outbox_publisher_failures` | none | `> 0` | platform-sre | 15 min | [Outbox publisher](#outbox-publisher) |
| `inventory_reconciliation_mismatches` | none | `> 0` | inventory-operations | 15 min | [Inventory projection reconciliation](#inventory-projection-reconciliation) |
| `journal_imbalance_count` | none | `> 0` | finance-operations | 5 min | [Journal balance integrity](#journal-balance-integrity) |
| `outbox_backlog_count` | `> 50` | not enabled in staging | platform-sre | 240 min | [Outbox backlog](#outbox-backlog) |
| `outbox_oldest_unpublished_seconds` | `> 900` | not enabled in staging | platform-sre | 240 min | [Outbox backlog](#outbox-backlog) |

## Common response lifecycle

For every alert:

1. acknowledge the fixed alert ID within the response objective;
2. stop promotion or additional command enablement when the launch gate is blocked;
3. preserve the exact Git SHA, workflow run, report schema, aggregate signals and relevant redacted logs;
4. diagnose with bounded aggregate queries only;
5. contain the affected staging capability without deleting immutable audit, outbox, inventory or journal evidence;
6. apply a reviewed forward fix or safe application rollback; never reverse an immutable migration or ledger entry;
7. rerun repository verification and the persistent staging workflow;
8. close only when the signal returns to policy and the evidence artifact is independently inspectable;
9. record follow-up work when the incident exposes a missing production control.

## Availability and HTTP probes

**Detection:** `http_probe_failures > 0`.

Immediate actions:

- block the staging launch gate;
- confirm whether the failure is Worker deployment, route registration, authentication, database connectivity or migration readiness;
- compare the deployed Git SHA and migration count with the report;
- use only route, status-code and bounded timing evidence. Do not copy response bodies containing user or business data into the incident record.

Recovery verification:

- all required anonymous, authenticated, protected-read and controlled-command probes pass;
- `/api/health` and `/staging/status` return their bounded expected contracts;
- no unexpected route or method becomes available.

## Browser and accessibility evidence

**Detection:** any browser scenario failure, Axe violation or root horizontal overflow.

Immediate actions:

- block promotion;
- identify the fixed scenario ID and viewport;
- inspect the screenshot and bounded accessibility finding artifact;
- confirm keyboard navigation, focus target, disabled checkout and authenticated identity notice remain present.

Recovery verification:

- all browser scenarios pass at their declared viewport;
- Axe violations and horizontal overflow return to zero;
- no accessibility rule is suppressed merely to clear the gate.

## Identity, recovery and MFA controls

**Detection:** `identity_control_failures > 0`.

This aggregate covers synthetic-account cleanup, session/context/login/logout evidence, legacy-auth removal, encrypted MFA evidence, replay rejection, account non-enumeration, credential rotation, session and step-up revocation, MFA revocation, recovery replay rejection and email-verification completion.

Immediate actions:

- block promotion and controlled-command use;
- preserve redacted auth event counts and the relevant fixed journey result;
- revoke the synthetic account and outstanding staging sessions when cleanup did not complete;
- treat any replay, token-hash or factor-encryption failure as a security incident.

Recovery verification:

- the complete authentication, MFA, password-recovery and email-verification journeys pass;
- synthetic users and temporary grants are cleaned;
- no raw token, password, cookie or TOTP material appears in artifacts.

Production note: factor replacement, support ownership, verified sender delivery and user notifications remain separate launch blockers.

## Controlled reservation command

**Detection:** `controlled_command_failures > 0`.

Immediate actions:

- keep reservation create/release disabled for promotion;
- verify current password plus TOTP assurance, permission, warehouse scope, single-use command token and optimistic version checks;
- inspect only aggregate audit/outbox counts and the synthetic reservation state;
- clean the synthetic reservation after preserving evidence.

Recovery verification:

- create and release each require a fresh step-up;
- consumed grant replay is rejected;
- availability decreases and then returns to its exact prior amount;
- immutable audit and outbox evidence is present;
- no payment, stock posting, journal, transfer or banking command has been enabled.

## Artifact or secret exposure

**Detection:** `artifact_secret_leaks > 0`.

Immediate actions:

- block the gate immediately;
- restrict or delete the exposed staging artifact where platform policy permits;
- rotate the affected staging secret or session material;
- verify no production secret was available to the workflow;
- preserve only hashes, fixed finding categories and timestamps for investigation.

Recovery verification:

- repository secret scan passes;
- the staging artifact contains no raw action token, password, cookie, signing secret, TOTP secret or database URL;
- replacement staging credentials are deployed and prior material is invalid.

Production-secret exposure is outside this workstream and requires the approved production incident process.

## Outbox publisher

**Detection:** `outbox_publisher_failures > 0`.

The synthetic staging publisher:

- claims only unpublished events belonging to tenants whose code starts with `synthetic-`;
- uses an atomic due-time and maximum-attempt lease with `FOR UPDATE SKIP LOCKED`;
- hashes the canonical event envelope in memory and persists only the SHA-256 digest in the fixed `staging-operability-evidence-v1` inbox receipt;
- treats an existing matching receipt as an idempotent replay and a changed-envelope digest as a conflict;
- acknowledges only the exact tenant, event and claimed attempt, so an expired or superseded worker cannot mark delivery complete;
- schedules a bounded exponential retry with a fixed error category rather than persisting provider messages;
- records only aggregate claimed, delivered, replayed, failed, remaining and exhausted counts in the staging report;
- never sends email, webhook, partner API, customer message or production event.

Immediate actions:

- block promotion when delivery fails, a hash conflict occurs, an acknowledgement is stale or unpublished work remains after the bounded drain;
- preserve the exact report, aggregate counts and fixed alert ID without copying payloads, metadata, event IDs or error text;
- inspect receipt count/status and outbox lease state using bounded synthetic-tenant queries;
- do not delete events, rewrite immutable envelopes or force `published_at` merely to clear the gate.

Recovery verification:

- every due synthetic event has a completed hash-bound inbox receipt;
- crash-after-receipt replay increments only receipt-attempt evidence and safely completes acknowledgement;
- post-drain unpublished, exhausted and publisher-failure counts return to zero;
- report fields confirm `payloadsPersistedInArtifacts: false` and `externalDelivery: false`;
- repository verification and the persistent staging workflow pass on the exact head.

Production note: this is a staging evidence consumer, not a production message transport. Production broker/provider selection, service identity, consumer contracts, SLOs, dead-letter ownership and paging remain launch blockers.

## Inventory projection reconciliation

**Detection:** `inventory_reconciliation_mismatches > 0`.

The aggregate compares synthetic-tenant immutable stock-ledger totals with stock-balance projections across warehouse, variant, bin, status, unit, scale and batch dimensions.

Immediate actions:

- block promotion and controlled reservation use;
- prevent direct balance edits or destructive correction;
- identify the affected aggregate dimension through a bounded operator query in the isolated staging database;
- preserve ledger sequence boundaries and migration/deployment identity.

Recovery verification:

- replay/rebuild the projection from immutable ledger evidence using reviewed tooling;
- reconciliation returns exactly zero mismatches;
- the synthetic seed still performs no direct balance inserts;
- focused inventory and full repository tests pass.

## Journal balance integrity

**Detection:** `journal_imbalance_count > 0`.

The aggregate checks journal header debit/credit totals and line totals in transaction and base currency for synthetic tenants.

Immediate actions:

- block promotion;
- keep all journal, close, banking, payment and refund writes disabled;
- preserve immutable journal evidence and deployment identity;
- never update or delete a posted journal to clear the alert.

Recovery verification:

- every journal remains balanced at header and line level;
- corrections, when later enabled, use approved reversal/adjustment workflows;
- finance readiness and repository verification pass.

## Outbox backlog

**Detection:** backlog count above `50` or oldest unpublished age above `900` seconds.

Current staging behaviour:

- severity is warning;
- launch gate becomes `review`, not `blocked`;
- no critical threshold is enabled because a continuous production publisher and approved delivery SLO are not yet commissioned.

Immediate actions:

- confirm whether unpublished events are expected synthetic evidence or indicate a stalled staging publisher;
- compare backlog count and age trends without reading payload or error contents;
- do not delete, mutate or mark events published merely to clear the warning.

Recovery verification:

- the active synthetic publisher demonstrates idempotent publication, bounded retry and durable downstream receipt evidence;
- approve production transport-specific warning/critical thresholds, paging ownership and maintenance-window handling before launch;
- retain immutable event payload and ordering guarantees.

## Production activation requirements

Before these policies can be called production monitoring:

- select and configure an approved observability and alert-delivery backend;
- bind production resources and service identity without exposing secrets to pull requests;
- approve signal SLOs, critical thresholds, paging rotations and escalation ownership;
- test alert delivery, acknowledgement, silence expiry and audit history;
- complete backup/restore rehearsal, transactional-email delivery, MFA support governance and controlled launch approval.
