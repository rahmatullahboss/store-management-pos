# Asymmetric internal-token key lifecycle

Status: live synthetic staging evidence complete; production KMS/HSM governance pending
Date: 2026-07-31
Scope: dedicated synthetic persistent staging only

## Security boundary

Protected-read and controlled-reservation tokens use RS256 with a mandatory bounded `kid`. A schema-v1 keyset contains exactly one active private signing key, one matching active public verification key and at most one previous public verification key. The previous private key is never retained or published.

The public endpoint is `/internal-identity/.well-known/jwks.json`. It returns active and still-valid previous verification keys only, supports `GET` and `HEAD`, publishes a bounded cache policy and ETag, and omits `d`, `p`, `q`, `dp`, `dq`, `qi`, `oth`, database data and operational identifiers.

Read tokens remain audience-bound and valid for at most 300 seconds. Command tokens remain valid for at most 60 seconds and contain only `inventory.reservation.manage` with password-plus-TOTP assurance. Every verification still resolves the current database session, tenant, permissions and resource scope; asymmetric signing does not weaken authorization drift checks.

## Rotation and overlap

1. Generate a new 2048-bit-or-stronger RSA active pair.
2. Move the prior active public key into `previous` status; do not retain its private key.
3. Publish active and previous public keys before issuing with the new active `kid`.
4. Keep previous verification available for a bounded overlap longer than the longest internal-token lifetime.
5. Stop publishing the previous key after its verification deadline.
6. Reject unknown, revoked, expired, malformed or algorithm-confused keys and tokens fail closed.

Synthetic staging generates a fresh active/previous keyset per deployment. The existing Cloudflare binding name is retained temporarily for migration safety, but its payload is a JSON asymmetric keyset rather than an HMAC secret.

## Emergency revocation

A compromised or incorrectly issued `kid` is added to the bounded revoked-key list and is rejected before signature verification. Emergency rotation requires a new active pair, immediate removal or revocation of the affected key, redeployment, protected-route verification and incident evidence. Revocation must not silently extend a previous key's window.

## Production provider signing readiness contract

The vendor-neutral provider boundary in `tooling/scripts/internal-token-provider-signing.mjs` defines the minimum contract for a future production KMS or HSM integration. It does not provision a provider and does not replace the synthetic staging JWK signer.

The contract requires:

- a single bounded RS256/SHA-256 signing request with a maximum 30-second execution window;
- an opaque provider key reference used only in memory and bound to a SHA-256 digest;
- exact provider and response schemas that reject extra private-key, keyset or provider-secret fields;
- a 2048-bit-or-stronger RSA signature length bound;
- a successful provider receipt that attests non-exportable and hardware-protected key ownership;
- request, signing-input, key-reference, key-version, provider-audit, operation and signature digests with distinct purposes;
- provider receipt timestamps and latency within bounded limits;
- masked provider failures that do not echo provider resources or error payloads;
- an aggregate-only persistence summary containing no key reference, key version, audit identifier, signing input, signature or receipt digest.

A real production adapter must supply the provider-side authorization policy, immutable audit source, non-exportable key attestation and signature bytes. The application contract validates the returned receipt but cannot independently prove a cloud or hardware provider exists without that adapter and its deployment evidence.

## Durable provider-signing evidence

`FND-0016` adds an isolated append-only provider-signing journal for validated production-provider receipts. The recorded-signing wrapper does not return the signature until the digest-only evidence write succeeds.

The journal stores only purpose-separated SHA-256 digests, provider class, token purpose, RS256/SHA-256 identifiers, non-exportable and hardware-protected attestation booleans, receipt-validation state, signature byte length, bounded latency and timestamps. It does not store a raw key reference, key version, provider audit identifier, JWT signing input, signature or provider response payload.

Replay and mutation controls include unique request, provider-operation and signature digests, an advisory transaction lock, a five-minute recording window, append-only update/delete rejection and an isolated `store_key_governance_runtime` role. Normal application and reporting roles have no journal-write access. `test-double` receipts are intentionally ineligible for durable provider evidence.

This journal establishes an evidence-retention boundary only. It does not establish that a real provider exists, that its key is non-exportable, or that provider-side audit and authorization controls have been deployed.

## Retention, legal hold and export custody

`tooling/scripts/internal-token-provider-evidence-custody.mjs` builds deterministic sealed exports from projected FND-0016 records. An export is accepted only under an effective retention policy whose digest binds an external approval digest, policy window, retention days and maximum row count. The implementation deliberately does not select a legal or regulatory retention period.

Each exported record contains only aggregate signing metadata, a source-record digest, a previous-record digest and a record digest. Raw provider key references, key versions, provider audit identifiers, signing inputs, signatures and the seven source receipt digests are not included. The final record digest becomes the export chain root and the complete manifest is bound to an export digest.

Active legal holds apply to bounded occurrence windows. A held record cannot become disposal-eligible even after its policy retention horizon. Released holds no longer block eligibility. Eligibility is an assessment only: this checkpoint does not delete evidence or provide an automatic purge function.

`FND-0017` records the sealed export digest, policy digest, chain root, contiguous custody sequence, previous custody digest, aggregate row/hold/eligibility counts, retention horizon and privacy profile in a second isolated append-only journal. Normal application and reporting roles cannot write the custody journal. A failed database acknowledgement is masked and treated as a failed custody operation.

This provides a tamper-evident custody contract, not an external archive. Production still needs an approved organizational schedule, authorized legal-hold operators, immutable off-platform storage, restoration drills and documented disposal authorization.

## Controlled evidence disposition

Disposal eligibility is never treated as destruction authority. `tooling/scripts/internal-token-provider-evidence-disposition.mjs` accepts only a valid FND-0017 custody command whose complete sealed export is past its retention horizon, has zero active legal holds and marks every record eligible.

A disposition request is bounded to a maximum 30-minute authorization window and binds the custody, export, retention-policy, case and proposer digests. Authorization requires exactly two distinct approvers in the policy roles `security_owner` and `records_owner`; the proposer cannot approve and one actor cannot satisfy both roles.

Immediately before accepting an external destruction receipt, the workflow validates a new custody/export snapshot digest and requires the legal-hold count to remain zero. A successful receipt must bind the request, approval, recheck, custody digest and candidate count, identify an approved provider class and occur inside the authorization window. The repository contract validates receipt evidence but does not invoke a delete or purge operation.

`FND-0018` appends the digest-only outcome to an isolated disposition journal. It requires two approvals, zero legal holds, purpose-separated custody/request/approval/recheck/operation/provider-audit/disposition digests, contiguous sequence and previous-digest linkage. Normal application and reporting roles cannot write this journal, and database failures are masked.

The status `destroyed` represents a validated external receipt, not independent proof that media was destroyed. Production still requires an authorized archive/destruction provider, provider-side immutable audit, a documented chain-of-custody handoff, restoration and exception procedures, and human approval that the receipt is legally sufficient.

## Exact live evidence

The exact implementation head `dc5b1f8328ad7d7f1c472c9ed446b24145a86229` completed persistent staging workflow run `30609623111`, job `91089297482`. The uploaded evidence artifact is `8784940903` with digest `sha256:c6ed951221b83550aa05aa0836ae269d4dba28374fb914815a6775440f6dbd3f`; the report was produced from pull-request merge ref `55c5b0ed3b366d8376e3018c4a625ee51369e931`.

The report recorded:

- status `passed`, persistent synthetic-only staging and six browser scenarios;
- RS256 schema version 1;
- one active signing key, one active verification key and one previous verification key;
- two published public keys, zero revoked keys and a 600-second overlap;
- zero private JWK fields published;
- no private key or serialized keyset persisted in artifacts;
- healthy operability with a clear launch gate, zero warnings and zero critical alerts;
- synthetic outbox delivery 2/2 with zero failures or remaining messages.

Independent inspection verified the artifact ZIP digest and scanned all seven artifact files. PEM private-key material, internal-token secret names, Neon or Cloudflare credentials, database URLs, private JWK fields and generic credential-like assignments each produced zero matches.

Generic disposable Neon preview capacity was not consumed for this workstream. The dedicated staging project and full-registry recovery job remain the authoritative database evidence; active module/foundation development branches were not deleted to make preview capacity.

## Evidence and privacy

Artifacts and workflow summaries may contain only algorithm, schema version, active/previous/published/revoked counts, overlap seconds, provider class, receipt-validation booleans, durable-recording state, signature length, bounded latency and private-field leak count. Private JWKs, serialized keysets, tokens, signatures, `kid` values, provider resource names, key versions, provider audit identifiers and receipt digests are prohibited from artifacts and logs.

Controlled custody exports may additionally contain source-record, chain-root, export, policy and custody digests plus aggregate retention and legal-hold state. Controlled disposition records may contain custody, request, approval, recheck, provider-operation, provider-audit and disposition digests plus aggregate candidate/approval/hold state. Neither form may be copied into ordinary CI artifacts or application logs.

## Production blockers

This staging implementation does not approve production key ownership. Production still requires provisioned KMS/HSM-backed non-exportable private keys, named security ownership, provider-side least-privilege signing policy, immutable audited signing access, a deployed adapter for the provider receipt contract, scheduled and emergency rotation procedures, protected JWKS publication, monitoring/paging, incident response, an approved organizational retention and legal-hold process, immutable external evidence storage, an authorized evidence-disposition provider and controlled launch approval.
