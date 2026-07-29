# Store Companion — Security and Privacy Architecture

## 1. Security objectives

- Preserve tenant, legal-entity, store and warehouse isolation.
- Prevent mobile UI or cached capabilities from becoming authorization.
- Protect sessions, device credentials, customer/supplier data and commercial information.
- Minimise payment-card and restricted financial-data exposure.
- Preserve idempotency, audit and immutable business evidence.
- Allow safe revocation, recovery and local-data disposal.
- Avoid surveillance or unnecessary mobile permissions.

The mobile application follows the repository security architecture and OWASP MASVS as a mobile verification baseline. A package or platform SDK does not make the app secure by itself; controls require implementation and testing evidence.

## 2. Threat model

High-priority threats:

- stolen or shared device;
- rooted/jailbroken or malware-compromised device;
- token/session theft;
- phishing and malicious deep links;
- cross-tenant cache or workspace leakage;
- stale capability use after revocation;
- insecure local database, backup, logs, screenshots or clipboard;
- replayed queued operation or approval decision;
- tampered local payload or clock;
- malicious attachment/image/file;
- man-in-the-middle or unsafe endpoint configuration;
- push notification leakage/spoofing;
- reverse engineering and embedded secrets;
- dependency/build/signing compromise;
- telemetry containing customer, supplier, payment or financial data;
- denial of service or storage exhaustion preventing durable local commit;
- unauthorised support access or device impersonation.

Each feature checkpoint adds abuse cases and negative tests.

## 3. Authentication

Use standards-based OIDC/OAuth:

- authorization-code flow;
- PKCE;
- external system browser/custom tab/authentication session;
- verified app/universal-link callback;
- strict redirect URI and state/nonce validation;
- short-lived access token;
- rotating/revocable refresh session or server-managed equivalent;
- MFA/passkey/step-up support for privileged actions;
- no embedded WebView password collection;
- no cached unlimited offline password.

Biometrics may protect local app re-entry or initiate a server-approved step-up flow. Biometric success alone is not server authorization and does not replace MFA policy.

## 4. Session and device lifecycle

- Register an app installation/device through an authenticated, audited flow.
- Bind session/device references to tenant membership and environment.
- Rotate provider push tokens and invalidate obsolete tokens.
- Propagate device, app version/build and safe risk context.
- Support self-revocation and privileged remote revocation.
- On revocation, stop sync, remove credentials and purge/lock restricted cache.
- Do not automatically submit pending work after authority is revoked.
- Record session/device changes through existing audit contracts.
- High-risk tenant policy may block rooted/jailbroken devices, but the detection result is a risk signal and must fail predictably without claiming perfect detection.

## 5. Secure local storage

### Secrets

Use iOS Keychain and Android Keystore-backed secure storage for:

- refresh/session credential or opaque session secret;
- local database encryption key/wrapping key;
- device private key where the chosen protocol uses one;
- non-exportable installation secrets.

Do not store:

- passwords;
- CVV;
- full PAN;
- payment provider reusable secrets;
- database credentials;
- API client secrets inappropriate for a public native client;
- unencrypted signing/private keys in files or preferences.

### Local database

- Encrypt sensitive local data at rest using a reviewed approach compatible with licence/provenance policy.
- Partition every business row by tenant/workspace.
- Use data-classification-driven TTL and purge rules.
- Keep pending operations separate from rebuildable caches.
- Exclude restricted files/database backups from cloud/device backup unless explicitly encrypted and approved.
- Clear temporary decrypted files and thumbnails.
- Prevent cross-user data visibility when accounts change.
- Never treat local capability snapshots as current authorization.

The exact encryption library must pass maintenance, platform, licence, performance and cryptographic review and be recorded in the reuse register.

## 6. Network security

- TLS for every endpoint.
- Production endpoint allowlist and environment separation.
- No user-configurable arbitrary API host in production.
- Validate certificates through platform trust; certificate pinning is adopted only with a rotation/recovery plan and measured benefit.
- Strict request timeout, cancellation and bounded retry.
- OAuth state/nonce/PKCE validation.
- Signed short-lived object upload/download URLs.
- Do not send secrets or sensitive payloads in query strings.
- Validate content type, size and schema.
- Redact authorization and cookies from diagnostics.
- Preserve server trace ID without logging raw response bodies by default.

## 7. Authorization and workspace isolation

Every command/query is server-authorized. Mobile enforces defence-in-depth UI behaviour:

- route composition from server capability snapshot;
- workspace context opaque and server verified;
- no arbitrary tenant/store/warehouse IDs accepted as authority;
- cache keys/partitions include tenant and scope;
- workspace switch clears presentation state before loading the new context;
- denied/masked responses do not reveal record existence;
- restricted badge counts and push payloads are prohibited;
- capability expiry/change invalidates cached routes/data;
- approval decisions require current version and assurance.

Security tests cover IDOR, cross-tenant cursor, cache partition and deep-link attacks.

## 8. Data classification and minimisation

| Class | Mobile examples | Default handling |
|---|---|---|
| Public | approved product image | CDN/cache allowed |
| Internal | non-sensitive catalog/configuration | authenticated bounded cache |
| Confidential | prices, stock, supplier/order summaries | encrypted cache, scope/TTL, no notification payload |
| Personal | customer/user contacts | purpose-limited, minimum fields, encrypted, retention/purge |
| Restricted | tax IDs, financial exports, integration/security evidence | online-first/no local cache unless explicitly approved, step-up/audit |
| Prohibited | CVV, raw authentication secrets | never store/process |

The API returns only fields required for the mobile task. Full server entities are not copied merely because they exist.

## 9. Payment and financial controls

Store Companion does not collect native POS card data.

- No PAN/CVV or sensitive authentication data.
- Payment status uses normalized MOD-E references.
- Unknown provider state blocks blind retry.
- Refund, settlement, reconciliation, close and journal actions are online and approval/assurance controlled.
- Monetary values use exact representations.
- Client totals are display only; server values are authoritative.
- Posted journal/payment/stock evidence is immutable and corrections use existing reversal/adjustment workflows.
- Screenshots, logs and push messages avoid restricted payment/financial detail.

## 10. Approvals and anti-fraud

- Approval request/version and source document are fetched from the server.
- Push notifications cannot approve.
- Decisions require reason and current policy.
- Amount/discount/quantity thresholds are server evaluated.
- High-risk decisions require step-up authentication.
- Duplicate decision retries are idempotent.
- Superseded/stale approvals fail with reconciliation UI.
- Device, actor, workspace, assurance and trace context are audited.
- Offline approval completion is prohibited.

## 11. Files, camera and scanning

Request only permissions required by the active workflow.

### Camera/barcode

- Prefer in-app camera permission only when scan/capture is initiated.
- Barcode content is untrusted input and schema/length validated.
- A scanned deep link/URL is never opened without allowlist and confirmation.
- Product/serial identifiers are resolved through authorised API/local projections.

### Attachments

- Compress/transform only through audited libraries.
- Strip unnecessary metadata where policy requires.
- Validate MIME signature, extension, size, dimensions and count.
- Upload through short-lived signed intents to private object storage.
- Malware/processing status is checked before domain attachment.
- Temporary local files have explicit retention/deletion.
- Do not expose unrestricted file paths or content URIs.

## 12. Notifications and deep links

- Push payloads contain minimal type/reference only.
- No customer name, supplier term, balance, tax ID, order detail or approval amount by default.
- Verify authentication and server authorization after opening.
- Allow only registered HTTPS app/universal-link domains and approved custom schemes where unavoidable.
- Validate path and parameters; ignore unknown commands.
- Protect against open redirect and nested URL attacks.
- Notification actions do not execute privileged business commands.
- Lock-screen presentation is privacy-safe and tenant configurable.
- Push token is environment/app/device bound and rotated/revoked.

## 13. UI leakage controls

- Mark restricted routes as non-cacheable at the server.
- Consider secure-screen/screenshot blocking for narrowly defined restricted workflows, with accessibility/support implications documented.
- Mask sensitive values by default where role/policy requires.
- Do not place secrets or sensitive data on clipboard.
- Clear clipboard after a bounded interval only where platform policy permits and the user initiated copying.
- Remove sensitive data from app switcher snapshots for protected screens.
- Do not include business data in crash breadcrumbs or analytics screen names.
- Avoid showing data from the previous workspace during loading transitions.

## 14. Logging and telemetry

Allowed examples:

- operation type;
- module;
- app version/build;
- safe error category/code;
- latency, retry count and outcome;
- cursor age and pending count;
- local schema/projection version;
- coarse device/OS class;
- trace/request reference.

Forbidden by default:

- access/refresh tokens;
- passwords, recovery codes or PKCE verifier;
- full request/response bodies;
- customer names/contacts;
- supplier prices/terms;
- exact financial values;
- PAN/CVV/provider raw payload;
- tax/national IDs;
- file contents;
- unrestricted entity IDs or deep-link parameters.

Telemetry vendors/dependencies require subprocessor, region, retention, consent/lawful-basis and licence review. Production must fail safely if telemetry is unavailable.

## 15. Build and supply-chain security

- Pin Flutter/Dart and CI action/tool versions through reviewed configuration.
- Verify checksums/signatures where supported.
- Lock dependencies and commit the workspace lockfile according to application policy.
- Review licences and provenance before adding packages/native SDKs.
- Run dependency, secret and licence scans.
- Generate SBOM/provenance for release artefacts.
- Use protected signing credentials outside source control.
- Separate development/staging/production signing and service configuration.
- Use Play App Signing and managed Apple signing practices where approved.
- Restrict CI permissions and secret-backed jobs to trusted refs.
- Verify generated API code has no unexpected network host or secret.

## 16. Privacy lifecycle

- Purpose-limit local copies to active workflows.
- Show notification and communication preferences where the server contract permits.
- Honour correction/merge/anonymisation and retention results through change feeds.
- Purge deleted/out-of-scope cached personal data.
- Financial/legal records may remain server-side under retention law; mobile cache does not become an archive.
- Tenant offboarding/suspension removes access and purges local data according to policy.
- Support diagnostics are reference-based and do not export raw mobile databases without explicit secure procedure and authorization.
- No advertising SDK or commercial reuse of customer/business behaviour.
- No background location, contact-book scraping or unrelated device identifiers.

## 17. Incident and recovery

Runbooks cover:

- stolen device;
- leaked signing or push credential;
- malicious/compromised release;
- cross-tenant cache defect;
- token/session compromise;
- sensitive telemetry/log leak;
- attachment malware/content flaw;
- API/deep-link abuse;
- local database corruption;
- mass client incompatibility;
- dependency vulnerability.

Capabilities include remote session/device revocation, minimum-version enforcement, feature kill switch, server-side command blocking, push-token revocation, key rotation, scoped data purge and auditable investigation.

## 18. Required security tests

- OAuth state/nonce/PKCE and redirect validation;
- token rotation, expiry and revocation;
- rooted/jailbroken policy behaviour without relying on bypass-proof detection;
- keychain/keystore and backup exclusion;
- local database encryption/partition/purge;
- tenant/workspace cache leakage;
- IDOR and unauthorized deep links;
- notification spoof/minimal payload;
- replayed operation and approval decision;
- payload tamper/hash mismatch;
- clock skew/business-date manipulation;
- secure upload/MIME/size and malicious file cases;
- log/telemetry sensitive-data scanning;
- screenshot/app-switcher/clipboard review for restricted screens;
- dependency/licence/SBOM checks;
- release signing/environment separation;
- device/session remote revocation with offline drafts;
- penetration testing before general availability.
