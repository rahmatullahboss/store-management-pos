# CCR-0002 — MOD-D Approval-Required Error

**Status:** Implemented, pending serial integration review  
**Requested by:** MOD-D — POS, Cash, Offline and Hardware  
**Date:** 2026-07-29  
**Shared owner:** Foundation / API error contract  
**Breaking change:** No

## Deficiency

MOD-D cash adjustment, cash variance and reversal workflows must fail closed when a valid approval is absent. The Foundation error taxonomy previously exposed authentication, permission, validation and generic conflict codes, but no stable code for a recoverable workflow that specifically requires an approval decision.

Using `CONFLICT` alone makes clients infer approval state from message text. That is brittle for POS retry controls, localization, audit reporting and future administrative approval surfaces.

## Requested contract

Add the additive `APPROVAL_REQUIRED` member to the shared `ErrorCode` union in `packages/foundation/src/errors.ts`.

The code means:

- the requested operation is structurally valid;
- the actor may otherwise have permission to request it;
- execution remains blocked until a valid, unexpired approval for the exact tenant, target type and target ID exists;
- clients must not silently retry or reinterpret the operation as completed.

HTTP status remains selected by the throwing workflow. MOD-D currently uses `409` because the request conflicts with the target's present approval state.

## Compatibility and risk

- Existing error codes and response fields are unchanged.
- Existing clients that treat unknown codes generically continue to receive the same response envelope and HTTP status.
- New clients may branch on `APPROVAL_REQUIRED` without parsing localized message text.
- The code does not grant permission and does not replace server-side approval validation.
- Approval IDs remain tenant- and target-scoped, and expired or mismatched approvals fail closed.

## Acceptance tests

- Strict TypeScript compilation accepts `APPROVAL_REQUIRED` only through the shared `ErrorCode` union.
- Cash adjustment and variance paths return the code when approval is absent or invalid.
- Valid approval lookup remains tenant-, target- and expiry-scoped.
- Error responses preserve request IDs and the existing response envelope.
- No existing error code or status mapping changes.

## Integration decision

Implemented additively on the MOD-D branch for serial review. Integration must verify Foundation API compatibility and retain the shared error response envelope before promotion.

Implementation evidence:

- `packages/foundation/src/errors.ts` contains the additive error code;
- `modules/cash/src/sql-repository.ts` performs approval validation against `platform.approval_requests`;
- Foundation CI typecheck and MOD-D cash/API tests provide the executable gate.
