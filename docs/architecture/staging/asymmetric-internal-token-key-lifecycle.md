# Asymmetric internal-token key lifecycle

Status: implementation complete; exact-head staging evidence pending
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

## Evidence and privacy

Artifacts and workflow summaries may contain only algorithm, schema version, active/previous/published/revoked counts, overlap seconds and private-field leak count. Private JWKs, serialized keysets, tokens, signatures and `kid` values are prohibited from artifacts and logs.

## Production blockers

This staging implementation does not approve production key ownership. Production requires KMS/HSM-backed non-exportable private keys, named security ownership, scheduled and emergency rotation procedures, audited signing access, protected JWKS publication, monitoring/paging, incident response, evidence retention and controlled launch approval.
