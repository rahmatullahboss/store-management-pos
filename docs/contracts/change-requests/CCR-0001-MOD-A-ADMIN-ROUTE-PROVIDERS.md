# CCR-0001 — MOD-A Admin Route Providers

**Status:** Integrated
**Requested by:** MOD-A — Catalog, Pricing and Tax  
**Date:** 2026-07-28  
**Shared owner:** Foundation / admin app shell  
**Breaking change:** No

## Deficiency

The Foundation admin shell currently owns a static `adminRoutes` array in `apps/admin-web/src/app-shell/routes.ts`. Module workpacks own their screens and permissions, but there is no shared, non-breaking route-provider contract through which a module can register its route descriptors.

Directly appending MOD-A routes to the shared file would violate parallel ownership and make later module integration order-dependent.

## Requested contract

Add a small shared composition boundary that accepts module-owned route descriptors and produces the existing `AppRoute[]` consumed by `renderAppShell`.

Required descriptor fields:

- stable route ID;
- path and navigation label;
- permission code;
- module ID;
- deterministic order;
- optional exact-match flag.

The composer should:

1. preserve all current Foundation routes unchanged;
2. combine zero or more module route-provider arrays;
3. reject duplicate route IDs or paths;
4. sort deterministically by `order`, then stable ID;
5. map descriptors to the existing `AppRoute` shape;
6. retain existing permission filtering in the shared shell.

## MOD-A provider exports

- `CATALOG_ADMIN_ROUTES` from `apps/admin-web/src/modules/catalog/routes.ts`;
- `PRICING_TAX_ADMIN_ROUTES` from `apps/admin-web/src/modules/pricing/routes.ts`.

MOD-A does not edit the shared registry while this request is pending. Its renderers and route descriptors are independently testable and ready for serial integration.

## Compatibility and risk

- Existing callers that provide no module routes must render exactly the current navigation.
- No existing route field or permission meaning changes.
- Duplicate detection should fail during composition/tests, not silently shadow a route.
- Route order numbers are presentation metadata only and must not create an authorization path.

## Acceptance tests

- Foundation routes remain byte-for-byte equivalent after composition with an empty provider list.
- MOD-A contributes nine unique descriptors with permission-scoped visibility.
- Duplicate ID and duplicate path fixtures fail closed.
- Navigation order is stable across repeated builds.
- Mobile/RTL shell behavior remains covered by the existing design evidence suite.

## Integration decision

Integrated serially in the Foundation/shared-shell ownership window before mounting MOD-A in the shared admin shell. No major contract version is required because this is an additive provider boundary.

Implementation evidence:

- `apps/admin-web/src/app-shell/routes.ts` exports `composeAdminRoutes` while preserving the original Foundation route array when no providers are supplied;
- duplicate module route IDs and duplicate module/Foundation paths fail closed;
- module routes sort deterministically by `order`, then stable ID;
- `apps/admin-web/src/app-shell/index.ts` composes `CATALOG_ADMIN_ROUTES` and `PRICING_TAX_ADMIN_ROUTES`;
- nine MOD-A descriptors are mounted and remain permission-filtered by the existing shell;
- `tests/unit/admin-route-composer.test.mjs` and the integration architecture checks cover the acceptance criteria.
