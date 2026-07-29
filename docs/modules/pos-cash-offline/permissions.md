# MOD-D Permissions and Approval Boundaries

## POS permissions

| Permission | Purpose | Control |
| --- | --- | --- |
| `pos.checkout.read` | Read register sessions, checkout operations and immutable receipt snapshots | Tenant/store/register scoped |
| `pos.checkout.execute` | Execute an approved online checkout | Requires active session and device scope |
| `pos.checkout.offline` | Commit an operation inside an approved offline window | Requires valid signed authorization and risk limits |
| `pos.checkout.resolve` | Resolve rejected, review-required or unknown operations | Privileged; never rewrites the original receipt |
| `pos.device.manage` | Enrol, inspect, revoke and reassign devices | Privileged; store/register consistency enforced |
| `pos.receipt.reprint` | Request rendering from an immutable receipt snapshot | Does not mutate financial content |

## Cash permissions

| Permission | Purpose | Control |
| --- | --- | --- |
| `cash.shift.read` | Read shifts, counts, variances and append-only events | Tenant/store/register scoped |
| `cash.shift.open` | Open a shift and post an opening float | One active shift per register |
| `cash.event.append` | Append sale, refund, paid-in/out, safe-drop and approved adjustment events | Idempotency key and immutable event identity required |
| `cash.shift.close` | Perform blind count and close a shift | Expected cash is reconstructed from events |
| `cash.variance.approve` | Approve a non-zero shift variance | Separate approval request required |

## Approval requirements

- Price/discount overrides consume the approved pricing contract and must not be approved by the cashier who requested them where maker/checker policy applies.
- Cash adjustments require an approved `cash.adjustment` request scoped to the shift.
- Non-zero shift variance requires an approved `cash.variance` request scoped to the shift.
- Reopening a closed shift and reversing a cash event are explicit privileged workflows; history is never edited or deleted.
- Unsupported provider or country-pack offline actions are blocked, not downgraded silently.

## Database privilege model

`store_app_runtime` has tenant-filtered read access to POS/CASH tables and execute access only to reviewed command functions. It must have zero direct `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` or `TRIGGER` grants on `pos` and `cash` tables. Reporting access remains read-only and subject to tenant RLS.

## Sensitive data boundary

Checkout and tender snapshots must reject keys representing PAN, card number, CVV/CVC, track data, payment/provider tokens, client secrets or reusable secrets. Hardware and provider integrations return opaque operation references and terminal-safe status only.
