# ADR-006: Provider-Neutral OIDC/JWKS Identity Baseline

- **Status:** Accepted for Foundation baseline
- **Date:** 2026-07-28
- **Decision owners:** Product/Security/Architecture

## Context

The platform needs standards-based authentication, MFA assurance, tenant-scoped internal identities and immediate session/device revocation without coupling the core to one identity vendor. Provider subjects are not guaranteed to be PostgreSQL UUIDs and must not be confused with internal user identifiers.

## Decision

Use a provider-neutral OIDC/JWKS access-token verifier in the Cloudflare Worker API:

- asymmetric signed JWTs with an explicit algorithm allowlist;
- `RS256` as the initial v1 algorithm;
- HTTPS JWKS retrieval with bounded caching and no redirects;
- exact issuer, audience, type, lifetime and clock validation;
- separate `sub` provider subject and internal `user_id` UUID claims;
- explicit tenant and location UUID claims;
- MFA required through explicit `amr=mfa` or deployment-allowlisted `acr` values;
- authoritative membership, session and device revocation checked in Neon before request context creation;
- production fails closed when identity configuration or security state is unavailable;
- development token parsing is enabled only in local/development/preview environments.

## Database baseline

`FND-0004` adds append-only session revocations, duplicate-safe revocation, audit/outbox effects and an identity-state check covering active membership, session revocation and device status.

## Consequences

### Positive

- Identity providers can change without rewriting domain authorization.
- Provider subject and internal database identity remain distinct.
- Algorithm confusion and unsigned-token fallback are rejected.
- MFA and revocation are enforced before tenant context is trusted.
- Revocation is auditable and event-driven.

### Negative

- Deployments must map provider claims to the v1 token contract.
- JWKS and identity-provider outages fail authenticated requests closed.
- Additional algorithms require explicit implementation, tests and ADR review.
- Provider onboarding still requires operational issuer, audience, JWKS and MFA-assurance configuration.

## Validation

- valid RS256 token and permission/scope merge;
- wrong algorithm, audience, token age and missing MFA rejection;
- revoked session/device rejection;
- inactive/unknown membership rejection;
- duplicate revocation creates one revocation, one audit and one outbox event;
- JWKS outage and missing production configuration fail closed.

## References

- RFC 7517 — JSON Web Key
- RFC 7519 — JSON Web Token
- RFC 8725 — JSON Web Token Best Current Practices
- OpenID Connect Core 1.0
- Cloudflare Workers Web Crypto API
