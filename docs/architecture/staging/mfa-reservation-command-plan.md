# MFA and controlled reservation command plan

## Objective

Add first-party TOTP MFA and prove one sensitive but reversible inventory command without weakening the production OIDC verifier or the existing read-only staging token.

## Boundaries

- The normal custom-auth session remains password-authenticated and read-only.
- TOTP secrets are never stored in plaintext. They are encrypted in the browser-facing Worker with AES-GCM using a key derived from the user's current password with PBKDF2-SHA-256.
- Database records contain only ciphertext, IV, salt, KDF parameters and bounded factor metadata.
- Step-up requires the active custom-auth session, current password and a valid non-replayed TOTP code.
- A successful challenge issues a random opaque grant. The database stores only its SHA-256 hash.
- Grants are session-bound, permission-bound, single-use and expire within five minutes.
- The only enabled sensitive permission is `inventory.reservation.manage`, granted through a separate staging step-up role.
- Read tokens cannot contain manage/write/approve/post/execute permissions.
- The command token is internal-only, includes `pwd` and `otp` authentication methods, and is never returned to browser JavaScript, HTML or artifacts.
- Payments, refunds, stock postings, transfers, accounting, banking, period close and fiscal commands remain disabled.

## User journey

1. Sign in with the custom staging account.
2. Open MFA settings and start TOTP enrollment.
3. Enter the current password to protect the generated TOTP secret.
4. Add the displayed secret or `otpauth` URI to an authenticator and confirm a code.
5. Open the controlled reservation page.
6. Complete password + TOTP step-up for `inventory.reservation.manage`.
7. Create one scoped reservation using a single-use grant.
8. Complete a second step-up and release the reservation using optimistic version checking.

## Acceptance evidence

- enrollment, confirmation and active-factor status;
- encrypted-at-rest factor record with no plaintext secret;
- invalid password and invalid/replayed TOTP rejection;
- five-minute maximum, single-use, session-bound and permission-bound grant;
- reservation create idempotent replay;
- release version conflict and successful release;
- immutable audit and outbox events for create and release;
- availability before, during and after reservation reconciles;
- cross-warehouse and command-without-step-up rejection;
- browser accessibility, mobile overflow and credential/secret redaction checks;
- exact-head migrations, tests, persistent deployment and recovery evidence.
