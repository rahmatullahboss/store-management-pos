# MOD-A Fresh Local PostgreSQL Rebuild

**Generated:** 2026-07-28T19:06:45.966Z
**Status:** passed
**PostgreSQL:** 18.3 (Homebrew)

A disposable empty database applied Foundation FND-0001..FND-0005, the synthetic Foundation seed and every MOD-A migration in dependency order. The database is removed after evidence capture.

## Applied files

- `database/foundation/migrations/FND-0001-platform.sql`
- `database/foundation/migrations/FND-0002-rls.sql`
- `database/foundation/migrations/FND-0003-reference-slice.sql`
- `database/foundation/migrations/FND-0004-identity-revocation.sql`
- `database/foundation/migrations/FND-0005-session-revocation-privilege-hardening.sql`
- `database/foundation/seeds/dev.sql`
- `database/migrations/catalog/CAT-0001-core.sql`
- `database/migrations/catalog/CAT-0002-search-performance.sql`
- `database/migrations/catalog/CAT-0003-pos-feed.sql`
- `database/migrations/pricing/PRC-0001-core.sql`
- `database/migrations/tax/TAX-0001-core.sql`
- `database/migrations/pricing/PRC-0002-price-tax-snapshot.sql`
- `database/migrations/pricing/PRC-0003-publishing.sql`
- `database/migrations/tax/TAX-0002-publishing.sql`

## Inspection

- Schema migrations recorded: 13
- Forced-RLS MOD-A tables: 40
- Tenant-isolation policies: 40
- Append-only triggers: 14
- Catalog/pricing/tax permissions: 18

## Checks

| Check | Result |
|---|---|
| allExpectedMigrations | Pass |
| noUnexpectedMissingSchema | Pass |
| requiredFunctions | Pass |
| forcedRlsCoverage | Pass |
| tenantPolicyCoverage | Pass |
| appendOnlyCoverage | Pass |
| permissionCoverage | Pass |

Machine-readable details are in [fresh-rebuild-report.json](fresh-rebuild-report.json).
