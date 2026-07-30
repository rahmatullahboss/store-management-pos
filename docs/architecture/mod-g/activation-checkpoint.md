# MOD-G — Wave 3 Activation Checkpoint

**Activation date:** 2026-07-29  
**Repository:** `rahmatullahboss/store-management-pos`  
**Git branch:** `module/reporting-integrations-saas-v1`  
**Assigned worktree:** `.worktrees/reporting-integrations-saas`  
**Approved Wave 2 release baseline:** `93f8d98164dc105141a71b85dd2af5a98e9e31e9`  
**Latest integration tracker baseline:** `7c552a6c55844c6437ed4cc60ab85db3d8f8bb76`  
**Neon project:** `twilight-boat-26805962`  
**Neon branch:** `dev/module-reporting-integrations` (`br-mute-band-axbhmsky`)  
**Neon parent:** `br-spring-grass-ax3ptydv`

## Activation evidence

- Wave 1 modules MOD-A, MOD-B, MOD-C and MOD-E are integrated.
- MOD-D and MOD-F are serially integrated and released to `main`.
- MOD-F country-pack, locale, currency, timezone, privacy and retention contracts are available; the Bangladesh pack remains explicitly `limited`.
- The MOD-G Git branch was created from exact released Wave 2 SHA `93f8d98164dc105141a71b85dd2af5a98e9e31e9` and contained no implementation commits.
- The branch was then fast-forwarded to the latest integration tracker commit without reset, rebase or force push.
- The dedicated Neon branch is non-default, non-protected, zero-write and an isolated child of the approved non-production parent.
- Existing unrelated work was not reset, discarded or overwritten.
- MOD-G remains one whole-workpack assignment; no small implementation agents are permitted.

## Workpack boundaries

Owned paths:

- `modules/reporting/**`
- `modules/integrations/**`
- `modules/saas-admin/**`
- `database/modules/reporting/**`
- `database/modules/integrations/**`
- `apps/admin-web/src/modules/reporting/**`
- `apps/admin-web/src/modules/integrations/**`
- `apps/admin-web/src/modules/saas-admin/**`
- `docs/modules/reporting-integrations-saas/**`

Shared/platform changes require the documented contract-change process. Production credentials, production data and production database branches are prohibited.

## First coherent checkpoint

1. Publish versioned metric definitions, projection freshness/reconciliation and drill-through contracts.
2. Publish public API, webhook, connector and SaaS entitlement contracts using integrated module events and immutable source references.
3. Add deterministic reporting/integration migration manifests after the integrated MOD-F order.
4. Implement rebuildable projection cursor/idempotency foundations and webhook replay/DLQ foundations.
5. Verify tenant isolation, delayed/duplicate/out-of-order event behavior and formula-injection-safe export primitives before substantial UI work.

## Required invariants

- Reporting projections are rebuildable and never authoritative writes.
- Every KPI exposes period, timezone, currency, metric version, freshness and control-total provenance.
- Replayed domain events/webhooks cannot duplicate business or connector effects.
- Connector ownership prevents synchronization loops.
- Credentials remain encrypted/redacted and are never placed in logs or exports.
- One tenant cannot read another tenant's report, export, webhook or connector data.
- SaaS suspension does not corrupt or delete business records.
- Large reports and exports do not degrade checkout workloads.
