# Asymmetric internal-token and JWKS lifecycle plan

> **For agentic workers:** REQUIRED SUB-SKILL: use Superpowers planning, TDD, systematic debugging and verification-before-completion workflows for every task in this plan.

**Goal:** Replace the persistent staging protected-read and controlled-command HS256 shared secret with a bounded RS256 keyset, mandatory `kid`, public JWKS, active/previous overlap, explicit revocation and fail-closed lifecycle evidence without enabling any additional business command or production credential.

**Architecture:** One shared staging token-keyset module validates a schema-v1 JSON secret, imports one active RSA private signing key and at most two public verification keys, signs only with the active `kid`, verifies active or unexpired previous keys, rejects unknown/revoked/expired keys and publishes a private-field-free JWKS. Read and command token modules retain their distinct types, lifetimes, claims and fresh database authorization checks. The staging entry exposes a bounded public JWKS endpoint, while deployment generates an ephemeral active/previous synthetic keyset and records aggregate evidence only.

**Tech stack:** TypeScript 7, Web Crypto RSASSA-PKCS1-v1_5/SHA-256, Cloudflare Workers, Node.js 22 tests, GitHub Actions persistent staging evidence.

---

### Task 1: Define and test the asymmetric keyset contract

- [x] Runtime-generated RSA test fixtures; no committed private key material.
- [x] Schema version 1, one active key, at most one previous key, unique bounded `kid` values, RS256 signing use and matching active private/public material.
- [x] Active signing, active verification, previous overlap verification, expiry rejection, revoked/unknown-key rejection and algorithm/type confusion rejection.
- [x] Public JWKS contains no private RSA fields and supports GET/HEAD only.

### Task 2: Implement the shared keyset and migrate both token types

- [x] Create `apps/api/src/staging-asymmetric-token.ts` with bounded parsing, signing, verification, public JWKS and lifecycle metadata.
- [x] Replace HS256 in `staging-internal-token.ts` while retaining read-only permission filtering, 300-second lifetime and fresh context drift checks.
- [x] Replace HS256 in `staging-command-token.ts` while retaining the single reservation permission, pwd+otp assurance, 60-second lifetime and resource drift checks.
- [x] Preserve the existing secret-binding name temporarily while changing its payload contract to an asymmetric keyset.

### Task 3: Add public JWKS and deployment evidence

- [x] Expose `/internal-identity/.well-known/jwks.json` with bounded caching, CORS, no-sniff and no private fields.
- [x] Generate an ephemeral active/previous RS256 keyset in the staging runner and upload it only as a Cloudflare secret.
- [x] Probe JWKS, status and protected routes; record algorithm, active/previous/public counts and private-field leak count only.
- [x] Keep external token issuance, production key ownership and additional authoritative commands disabled.

### Task 4: Documentation, status and verification

- [x] Document rotation, overlap, revocation, emergency rollover and production KMS/HSM ownership blockers.
- [x] Update staging status/checkpoint truthfully as implementation pending exact-head live evidence.
- [ ] Run full repository verification on the assembled branch.
- [ ] Push the verified implementation, inspect exact-head CI and persistent staging artifact, then record evidence while keeping PR #58 draft.
