# MOD-D Hardware Support Runbook

## Supported boundary

The local hardware agent exposes provider-neutral capabilities for printers, cash drawers, barcode scanners, scales, customer displays, payment terminals and fiscal devices. Every command is scoped to tenant, store, register and device; commands are expiring and idempotent.

## Safety rules

- Checkout completion and receipt evidence are business operations; printing is a delivery operation. A printer failure must not roll back a completed checkout.
- Never log or persist PAN, CVV/CVC, PIN, track data, reusable provider tokens, client secrets or unrestricted terminal payloads.
- Do not execute a command after expiry, revocation or scope mismatch.
- Replay only the same command ID with identical content. Changed content requires a new command ID.
- Unsupported capability/action combinations must fail closed.
- A fiscal or payment-terminal command must obey the active country/provider capability contract; no generic fallback may bypass a required online fiscal step.

## Enrollment and health

1. Enroll the hardware agent against the approved store/register/device scope.
2. Record the declared capability profile and adapter version.
3. Confirm the device and register are active and the local clock is within tolerance.
4. Emit health evidence with low-cardinality status fields only.
5. Revoke the agent immediately when the workstation, certificate or operator trust is lost.

Health states:

- `healthy` — all required capabilities available;
- `degraded` — optional capability unavailable, approved fallback possible;
- `offline` — agent unreachable; local browser may continue only within its approved capability window;
- `revoked` — no new command may execute.

## Printer failure

1. Preserve the immutable semantic receipt snapshot and content hash.
2. Record the render/delivery failure without changing checkout status.
3. Verify paper, cover, connection, profile, character set and command timeout.
4. Retry with the same delivery request only when content is identical.
5. Use an approved compatible printer profile or supervised reprint.
6. Never generate a new receipt number for a reprint.

## Cash drawer failure

- Do not infer cash receipt failure from drawer failure.
- Record the drawer command outcome separately.
- Require supervised manual opening where policy permits.
- Keep the append-only cash event and shift evidence unchanged.

## Scanner and scale failure

- Scanner: allow keyboard/search fallback; validate the selected variant before adding the line.
- Scale: block weight-based quantity capture when no trusted reading is available; do not substitute a stale reading.
- Reject readings outside configured bounds or from an unexpected device scope.

## Customer display failure

A display failure may degrade to cashier-only operation when country/accessibility policy permits. Do not expose another customer's data or retain sensitive cart/payment content on reconnect.

## Payment terminal failure or unknown result

1. Stop checkout completion when the provider state is unknown.
2. Preserve terminal command ID, payment intent reference and original idempotency key.
3. Query provider status through MOD-E before any retry.
4. Never send raw card data through the hardware-agent log or POS API.
5. Resume only from an explicit accepted/captured/declined result.

## Fiscal device failure

- If the country capability requires online or fiscal-device authorization, block the unsupported offline checkout.
- Preserve the local cart and operation intent without issuing a compliant receipt number prematurely.
- Route failed fiscal operations to reconciliation with the original receipt snapshot and command evidence.

## Agent update

1. Verify the signed package and reviewed adapter provenance.
2. Check pending hardware commands and active checkout state.
3. Stop command intake, complete or explicitly expire in-flight commands, then update.
4. Re-enroll capability metadata if the adapter profile changed.
5. Run printer, drawer, scanner, scale, display, terminal and fiscal-device smoke paths that apply to the profile.
6. Roll back only to a signed compatible version; never bypass revocation or command-expiry checks.

## Evidence to capture

- exact application and hardware-agent versions;
- capability and action, not unrestricted payload;
- command ID, request ID and trace ID;
- tenant/store/register/device IDs;
- command expiry, outcome and duration;
- sanitized adapter error code;
- health, clock drift and revocation state.

Do not capture customer names, receipt body, card data, provider secrets, raw magnetic-stripe data or unrestricted device logs.
