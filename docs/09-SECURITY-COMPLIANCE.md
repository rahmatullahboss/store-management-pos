# Security, Privacy and Compliance Architecture

## 1. Security objectives

Protect tenant boundaries, financial correctness, customer data, payment workflows, credentials and operational availability without making the product unusable for store staff.

Primary security properties:

- authenticated and attributable actions;
- least-privilege access;
- strong tenant and regional isolation;
- immutable financial/stock auditability;
- confidentiality of personal and commercial data;
- payment-card scope minimization;
- secure offline devices and integrations;
- recoverable operations and tested incident response.

## 2. Threat model

High-priority threats include:

- cross-tenant data access;
- privilege escalation and support impersonation abuse;
- cashier fraud through discounts, voids, refunds or cash movements;
- duplicate/replayed payment, webhook or offline operations;
- stolen POS device or register credential;
- credential stuffing, phishing and session theft;
- API-key leakage and integration compromise;
- malicious import files and stored content;
- supply-chain dependency/build compromise;
- SQL injection, broken authorization and insecure direct object references;
- denial of service during business-critical checkout;
- audit/log tampering;
- unauthorized database/object-storage access;
- cardholder-data leakage;
- ransomware/destructive administrative action;
- data-residency or retention violations.

Maintain module-level abuse cases and update them during design review.

## 3. Identity and authentication

- Use a standards-based identity system supporting MFA.
- Require MFA for platform admins, tenant owners, finance admins and support staff.
- Prefer phishing-resistant WebAuthn/passkeys for privileged accounts.
- Short-lived access tokens; rotating/revocable refresh sessions.
- Record device, session, IP/risk context and authentication method.
- Apply rate limiting, breached-password protection and bot controls.
- Recovery workflows require strong verification and audit.
- Offline POS uses signed, expiring authorization snapshots rather than unlimited cached passwords.
- Enterprise SSO must preserve tenant and role scope; emergency local access is tightly controlled.

## 4. Authorization

Use centralized policy evaluation with:

- role/action permission;
- tenant/legal entity/store/warehouse scope;
- amount and discount thresholds;
- document state;
- actor relationship;
- device/register assignment;
- approval requirements;
- business hours or risk posture where justified.

Every endpoint and command performs server-side authorization. UI hiding is not authorization.

High-risk actions require reason, reauthentication or manager approval:

- refunds and voids;
- price override/high discount;
- cash paid-out/safe access;
- negative-stock override;
- period reopen/manual journal;
- user/role change;
- integration credential change;
- data export/deletion;
- support impersonation;
- country-pack/fiscal configuration change.

## 5. Tenant isolation

Defense in depth:

- tenant resolved from verified identity/domain and never trusted from arbitrary request body;
- mandatory tenant context for every command/query;
- tenant-leading keys and constraints;
- PostgreSQL Row Level Security where practical;
- tenant-aware repositories and architecture tests;
- separate object-storage prefixes and signed access;
- queue/event messages carry tenant ID and validated routing;
- cache keys always include tenant and relevant scope/version;
- support tooling requires explicit tenant selection and reason;
- automated cross-tenant attack tests in CI and production canaries.

Platform/global services receive only minimum customer data.

## 6. Data classification

Suggested classes:

| Class | Examples | Default handling |
|---|---|---|
| Public | Published product images | CDN/cache allowed |
| Internal | Non-sensitive catalog/configuration | Authenticated tenant access |
| Confidential | Prices, supplier terms, reports | Encryption, least privilege, audit |
| Personal | Customer/user contact and behavior | Purpose/retention controls |
| Restricted | Credentials, tax IDs, financial exports | Strong access, masking, detailed audit |
| Prohibited | CVV, raw authentication data | Never store |

Classify fields in schema metadata and apply logging/export/masking rules by class.

## 7. Encryption and secrets

- TLS for all network communication.
- Provider-managed encryption at rest plus application-level encryption for selected secrets/restricted fields.
- Secrets stored in a managed secrets system, never source control or generic settings tables.
- Separate production/non-production credentials.
- Rotate integration, database and device credentials.
- Encrypt local POS secrets using OS keystore/hardware-backed storage where available.
- Use envelope encryption and key versioning for portable encrypted fields.
- Log key access/rotation operations.
- Backups and exports are encrypted and access-controlled.

## 8. Payment security and PCI scope

Design to minimize PCI DSS scope:

- use hosted fields, redirects, certified SDKs or semi-integrated terminals;
- tokenize payment methods at the provider;
- never store CVV or sensitive authentication data;
- avoid PAN in application logs, analytics, receipts or support screenshots;
- store only provider token/reference, brand, last four digits and expiry when permitted;
- verify payment webhooks cryptographically;
- segment terminal/local-agent traffic;
- maintain an accurate cardholder-data-flow diagram and responsibility matrix;
- prefer validated point-to-point encryption solutions where applicable;
- review PCI DSS obligations with a qualified professional before launch.

The platform must not claim PCI compliance solely because it uses a payment provider.

## 9. Financial and fraud controls

- Immutable posted ledgers and reversal workflows.
- Segregation of duties for accounting configuration, posting and approval.
- Manager approvals retain approver, device, reason and original request.
- Blind cash count and variance review.
- Refund-to-original-tender policy with controlled exceptions.
- Discount/refund/void anomaly reports.
- Duplicate operation and payment protection.
- Period locks and controlled reopen.
- Number-sequence integrity alerts.
- Inventory adjustment/count approvals and shrinkage analytics.
- Support impersonation banner, limited actions and complete audit.

## 10. API and webhook security

- OAuth 2.x or scoped API keys; store only hashed API-key secrets.
- Explicit scopes, tenant binding, expiry and rotation.
- Per-client and per-tenant rate limits.
- Request size, content type and schema validation.
- Idempotency keys on mutation APIs.
- Webhook signatures include timestamp and body digest.
- Reject stale/replayed webhook signatures.
- Outbound webhooks are signed, retried and visible to tenant admins.
- SSRF protection for callback URLs; block private/link-local networks and unsafe redirects.
- Provider allowlists only where reliable and supplementary.
- Secrets are redacted from errors and tracing.

## 11. File and import security

- Direct upload to private R2 using short-lived signed URLs.
- Validate size, extension, MIME signature and tenant quota.
- Malware scan where risk requires.
- Parse imports in isolated asynchronous workers/services.
- Formula-injection protection in generated CSV/XLSX.
- Do not execute uploaded macros/scripts.
- Image processing strips unsafe metadata where configured.
- Private objects use randomized immutable keys and authorization checks.
- Legal documents use checksums and retention locks where required.

## 12. Application security engineering

- Secure coding standard mapped to OWASP ASVS/API risks.
- Threat modeling for checkout, payments, offline sync and support tools.
- Typed input validation at trust boundaries.
- Parameterized SQL and least-privilege database roles.
- Output encoding and CSP for web applications.
- CSRF protection for cookie-authenticated mutations.
- Dependency, container/build and secret scanning.
- Software Bill of Materials and signed build provenance.
- Protected branches, reviewed migrations and mandatory security tests.
- Independent penetration test before GA and after material architecture changes.
- Responsible disclosure/security contact and remediation policy.

## 13. Cloudflare edge controls

Use Cloudflare for:

- WAF and managed rules;
- DDoS protection;
- bot/rate controls;
- Turnstile on abuse-prone public flows;
- custom-domain TLS;
- API shielding and request limits;
- Access for internal administration where appropriate.

Edge controls supplement, but do not replace, application authorization and input validation.

## 14. Database security

- Neon connection credentials are stored only as Worker secrets; direct driver access is TLS-encrypted and scoped by database role and database branch.
- Separate runtime, migration, read-only/reporting and operations roles.
- Runtime role cannot alter schema or disable audit/RLS.
- Migration credentials are short-lived and CI-controlled.
- RLS tenant context set transactionally and tested under pooling.
- Database audit for privileged operations.
- Point-in-time recovery, encrypted backups and restore drills.
- Query timeout, lock monitoring and resource limits.
- Sensitive production access is just-in-time, approved and recorded.

## 15. Logging and observability privacy

Logs must never contain:

- passwords or recovery secrets;
- API keys/tokens;
- CVV or full PAN;
- full payment-provider payloads by default;
- unnecessary customer data;
- unredacted tax/national IDs;
- raw document uploads.

Use structured fields: trace ID, tenant ID, actor ID, operation type, entity reference, result and error code. Apply retention, regional routing, access controls and tamper-resistant export for security/audit streams.

## 16. Privacy program

Use privacy principles such as purpose limitation, data minimization, accuracy, storage limitation, integrity/confidentiality and accountability.

Product capabilities:

- consent/preference history;
- data inventory and processing-purpose metadata;
- retention and legal-hold policies;
- customer data access/export;
- correction and duplicate merge;
- deletion/anonymization workflow;
- tenant offboarding export/deletion;
- subprocessor and regional data information;
- breach investigation support;
- privacy-safe analytics identifiers.

Financial/legal records may require retention; deletion workflows must explain what was deleted, anonymized or retained and why.

## 17. Audit architecture

Security/financial audit events are append-only and include:

- event ID and timestamp;
- tenant/scope;
- actor, approver and impersonator;
- action and outcome;
- target entity/reference;
- reason and approval evidence;
- request/trace/device context;
- selected before/after values or hashes;
- source application/version.

Protect audit data from ordinary tenant editing. Provide export and search without exposing secrets. Periodically verify integrity and completeness against ledgers and identity events.

## 18. Availability and business continuity

- Regional architecture and documented dependency map.
- Database PITR and tested restore.
- R2 object checksums/versioning.
- Transactional outbox for queue recovery.
- Offline POS for permitted operations.
- Provider outage states and manual reconciliation.
- Runbooks for database, Cloudflare, payment, fiscal, object-storage and identity incidents.
- Disaster-recovery exercise with tenant-routing cutover.
- Define RPO/RTO by plan and region; do not promise targets before verified.

## 19. Incident response

Lifecycle:

1. detect and triage;
2. contain access/traffic/integration;
3. preserve evidence;
4. assess tenant/data/payment/financial impact;
5. eradicate and restore;
6. reconcile transactions and ledgers;
7. notify affected parties/regulators according to current obligations;
8. document timeline/root cause;
9. track corrective actions and validate them.

Maintain emergency revocation for sessions, devices, API keys, providers and support access. Incident communications must distinguish operational outage from confirmed data breach.

## 20. Compliance roadmap

Compliance depends on target customers and regions. Likely future work may include:

- PCI DSS responsibility and validation;
- GDPR and other privacy-law readiness;
- SOC 2 control program/report;
- ISO 27001 information-security management;
- country fiscal/e-invoice certification;
- local data-residency/financial-record rules;
- accessibility conformance.

Do not treat certifications as launch substitutes for secure architecture, and do not claim certification before an authorized assessment is complete.

## 21. Security acceptance criteria

- Cross-tenant access tests fail safely at API and database layers.
- Privileged accounts enforce MFA.
- Payment-card data-flow review confirms prohibited data is absent.
- Duplicate/replay tests do not duplicate financial effects.
- Support impersonation is approved, visible and audited.
- Offline authorization expires and device revocation works as designed.
- Secrets are absent from code, logs and client bundles.
- Backup restore and incident tabletop exercises pass.
- SAST/dependency/secret scans and penetration-test critical findings are resolved.
- Data export/deletion/retention workflows are tested.
- Production access follows least privilege and just-in-time approval.
