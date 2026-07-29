# MOD-A Pricing and Promotions Checkpoint

**Date:** 2026-07-28  
**Migration:** `PRC-0001`  
**SHA-256:** `6de6d513d4af27fa81300baab2b5ea0f2ada31cf2191f78207c9038290906288`

## Delivered

- Exact BigInt rational arithmetic with half-up, half-even, floor, ceiling and toward-zero rounding.
- Deterministic largest-remainder allocation that always reconciles to the original amount.
- Effective-dated, versioned price lists and quantity-tier rules with legal entity, store, channel and customer-group scope precedence.
- Cost-based minimum margin guard.
- Percentage, fixed and buy-X-get-Y promotions; product/variant/category/tag targeting; coupon conditions; effective windows; redemption limits; exclusivity and stacking groups.
- Controlled manual discounts with automatic threshold, minimum-price guard, reason and approval requirements.
- Immutable price-list/rule/promotion versions, coupon redemptions, quote snapshots and discount request/action history.
- Request-scoped quote snapshot persistence with idempotency, audit and outbox events.
- Permissions for read/manage/publish/promotion/discount apply/discount approve.

## Verification

`npm run test:unit` passed 22/22 tests. Pricing tests cover rounding/allocation, scope and quantity precedence, margin floor, coupon/stacking behaviour and manual approval controls.

Live Neon verification on `dev/module-catalog-pricing-tax`:

- first quote snapshot: `replayed=false`, total minor `1800` GBP;
- same idempotency key/hash: `replayed=true`, same snapshot;
- manual discount request created both module history and Foundation approval request;
- `store_app_runtime` Alpha context saw one quote and one discount request;
- `store_app_runtime` Beta context saw zero quotes and zero discount requests.
