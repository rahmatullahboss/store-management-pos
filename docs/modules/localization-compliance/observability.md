# MOD-F observability

MOD-F telemetry must preserve legal and privacy confidentiality. Record identifiers and state transitions; never record document payloads, identity documents, personal data, signing secrets or reusable provider credentials.

## Required structured fields

Every command, API request and worker outcome should carry:

- `requestId`, `traceId` and `tenantId`;
- `legalEntityId` and `storeId` when scoped;
- `packId`, `packVersion` and `countryCode` when applicable;
- resource type and opaque resource ID;
- prior state, resulting state and replay flag;
- provider capability ID and provider reference only when non-secret;
- duration, attempt number and outcome category;
- support level and offline legal capability for checkout decisions.

## Metrics

Suggested low-cardinality counters and histograms:

- `localization_pack_activation_total{outcome,support_level}`;
- `localization_pack_activation_duration_ms`;
- `localization_legal_number_allocation_total{outcome,mode,document_type}`;
- `localization_legal_number_remaining{scope}` using a bounded internal scope label;
- `localization_legal_document_publish_total{outcome,document_type}`;
- `localization_fiscal_submission_total{outcome,provider}`;
- `localization_fiscal_unknown_current{provider}`;
- `localization_fiscal_recovery_duration_ms{provider}`;
- `localization_privacy_operation_total{operation_type,outcome}`;
- `localization_privacy_pending_current{operation_type}`;
- `localization_offline_checkout_block_total{code}`;
- `localization_country_pack_expiry_days{pack}`;
- `localization_worker_job_total{job_type,outcome}`;
- `localization_worker_job_duration_ms{job_type}`.

Do not use document number, customer ID, subject reference, request ID or tenant name as metric labels.

## Audit and outbox events

At minimum preserve events for:

- country-pack activation/supersession;
- legal-number allocation and range exhaustion;
- legal-document publication and correction linkage;
- fiscal submission creation and every state transition;
- privacy request, approval, execution, completion/partial completion and rejection;
- support-level or capability change;
- data-residency policy/configuration change;
- operator-visible offline checkout blocks.

Audit events and outbox events are append-only evidence. Replays must not duplicate business effects; replay outcomes may be counted separately in telemetry.

## Alerts

| Condition | Initial severity | Required response |
| --- | --- | --- |
| Fiscal submission remains `unknown` beyond provider recovery objective | High | Stop blind retries, reconcile provider status and preserve evidence. |
| Legal-number range below approved threshold | Medium | Prepare and approve a successor effective scope. |
| Legal-number exhaustion or duplicate constraint failure | Critical | Block issuance and investigate scope integrity. |
| Active pack expires without reviewed successor | High | Prevent operation beyond effective date or activate approved successor. |
| Signature/manifest mismatch | Critical | Quarantine pack version and stop activation. |
| Runtime direct-write or `PUBLIC EXECUTE` grant appears | Critical | Stop deployment and restore privilege boundary. |
| Forced-RLS count differs from localization table count | Critical | Stop deployment and investigate migration drift. |
| Cross-tenant projection result | Critical | Treat as a security incident. |
| Privacy completion lacks required preserved evidence | High | Reject completion and route for compliance review. |
| Repeated unsupported offline checkout attempts | Medium | Review operator workflow, connectivity and pack limitation communication. |

## Service objectives

Provider-specific objectives must be documented per country pack. The platform-level objective is not to hide unresolved state:

- accepted/rejected/unknown outcomes are visible within the same worker cycle;
- unknown outcomes remain in the compliance queue until explicitly reconciled;
- legal-number exhaustion is detected before a number is issued;
- active pack/version and limitations are available to admin and POS projections;
- monitoring loss never changes commercial, payment, fiscal or privacy state.

## Evidence gates

Before handoff or integration, retain:

- repository verification and dependency/security gate identifiers;
- MOD-F assigned-Neon full-chain/replay report;
- forced-RLS/direct-write/function-privilege counts;
- Neon recovery evidence;
- Cloudflare preview/runtime/cleanup evidence;
- browser/accessibility/RTL/responsive evidence;
- documented country limitations and escalation ownership.
