# Staging account recovery and email-verification plan

Status: approved implementation plan  
Date: 2026-07-30  
Branch: `ops/persistent-admin-pos-staging-v1`

## Goal

Add production-shaped account recovery primitives without weakening the custom PostgreSQL authentication boundary or claiming that production transactional email is configured.

The checkpoint will provide secure token lifecycle, browser flows, revocation, rate limits, audit evidence and deterministic staging delivery. A real production mail provider remains a launch gate.

## Scope

### Password recovery

- `GET /forgot-password` renders the request form.
- `POST /auth/password-recovery/request` always returns the same user-visible result, whether or not the account exists.
- `GET /reset-password?token=...` renders a reset form only after bounded token-shape validation; database validity is checked during submission.
- `POST /auth/password-recovery/complete` consumes the token and changes the password atomically.

### Email verification

- verification token storage and consumption primitives are added now;
- staging signup may continue to issue a session while production mail delivery is absent;
- the UI must clearly mark verification delivery as a staging capability, not production email readiness;
- future production policy can require verification before session issuance without rewriting token storage.

## Security invariants

- opaque token: 32 random bytes;
- database stores only SHA-256 token hash;
- password-recovery expiry: at most 15 minutes;
- email-verification expiry: at most 24 hours;
- token is single-use and purpose-bound;
- account lookup response is non-enumerating;
- request throttling is keyed by email and client IP fingerprints;
- only the most recent active token per user and purpose remains usable;
- reset completion requires a new password of 10–128 characters;
- reset completion revokes every active login session for the user;
- reset completion consumes all active step-up grants;
- reset completion revokes active and pending TOTP factors because their encryption key is password-derived;
- password credential lockout counters are cleared after a valid reset;
- token plaintext, password and database URL never enter logs, screenshots, reports or artifacts;
- all pages and responses are `no-store`, framed denied and robot indexing disabled;
- cross-site action requests fail closed.

## Persistence

Additive Foundation migration:

- `platform.auth_action_tokens`:
  - `id`, `user_id`, `tenant_id`, `purpose`;
  - `token_hash`, `expires_at`, `used_at`, `revoked_at`;
  - request/IP/user-agent hashes;
  - creation and update timestamps;
- indexes for token lookup, user-purpose lifecycle and expiry cleanup;
- constraints for supported purpose, token shape and terminal-state consistency.

Database functions:

- request password-recovery token;
- request email-verification token;
- consume password-recovery token and rotate credential;
- consume email-verification token;
- bounded token cleanup.

Every function is `SECURITY DEFINER`, uses a fixed search path, has public execution revoked and grants only the staging runtime role.

## Delivery boundary

The application exposes a `StagingAuthDelivery` interface.

Staging CI uses an injected capture delivery that receives the raw token in memory and proves the browser journey. The persistent Worker may render a generic success page but must not expose the token to the requester.

A production mail adapter, sender domain, templates, bounce handling and delivery monitoring are explicitly out of scope for this checkpoint and remain production blockers.

## Evidence

Deterministic live evidence will prove:

1. unknown and known email requests have indistinguishable browser responses;
2. only the known account creates a hashed database token;
3. token plaintext is absent from the database;
4. expired, malformed, wrong-purpose and replayed tokens fail;
5. valid reset changes the password;
6. old password login fails and new password login succeeds;
7. all prior sessions are revoked;
8. active step-up grants and TOTP factors are revoked;
9. reset audit events are emitted;
10. synthetic tokens/accounts are cleaned;
11. mobile browser pages have zero Axe violations and no root overflow.

## Non-goals

- no production SMTP/API credentials;
- no claim of production email deliverability;
- no password reset by administrators;
- no bypass for MFA-protected business commands;
- no payment, journal, banking, fiscal or destructive business command enablement.

## Rollback

Routes can be disabled while leaving the additive token table and audit history intact. No migration, credential history, audit event or token lifecycle row will be rewritten or deleted as rollback behaviour.
