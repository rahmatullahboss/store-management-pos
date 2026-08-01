# Persistent Admin and POS staging plan

Status: active
Owner: platform operations
Branch: `ops/persistent-admin-pos-staging-v1`
Base: `main` at `3a414363a40f48bd6e526418d9e82679501b170e`

## Goal

Provide one stable, non-production URL where the current Admin and POS browser surfaces can be opened repeatedly for manual testing. The staging deployment must survive CI completion and must not be deleted by preview cleanup jobs.

## Dedicated resources

- Cloudflare Worker name: `store-pos-staging`
- Neon project: `store-management-pos-staging`
- Neon project ID: `morning-flower-46531465`
- Neon branch: `main`
- Neon branch ID: `br-empty-sound-afkx5vkj`
- Database: `neondb`

No connection string, role password, Cloudflare account identifier, token, OIDC secret or customer data may be committed. GitHub Actions resolves the Neon connection URI at runtime through `NEON_API_KEY` and sends it directly to the Worker as the `DATABASE_URL` secret.

## First usable milestone

The first persistent deployment is deliberately read-only in the browser:

- `/admin` renders the current shared Admin shell;
- `/admin/inventory` and `/admin/procurement` render the existing module pages with synthetic fixtures;
- other Admin routes render an explicit module readiness surface inside the current Admin shell;
- `/pos` renders the existing POS register workspace with synthetic exact-money data;
- `/api/health` delegates to the real API Worker health route;
- every page carries a visible non-production and synthetic-data notice;
- authenticated authoritative commands remain protected by the existing OIDC and permission boundary.

This milestone proves stable routing, responsive UI, module navigation, accessibility, Worker deployment, database migration connectivity and API health. It does not claim that all browser controls execute live business commands.

## Deployment flow

1. Run repository verification and build.
2. Resolve the dedicated Neon connection URI at runtime.
3. Apply every registered migration idempotently to the dedicated staging database.
4. Load only approved synthetic development seed data.
5. Store `DATABASE_URL` as a Cloudflare Worker secret.
6. Deploy `apps/api/src/staging.ts` to the fixed Worker name.
7. Keep the Worker after the workflow finishes.
8. Probe `/`, `/admin`, `/admin/inventory`, `/admin/procurement`, `/pos` and `/api/health`.
9. Upload a redacted deployment report.

## Security boundaries

- Staging is never production and must not use production credentials or data.
- Browser demo pages are synthetic and read-only.
- API routes continue to use the existing token verifier, permissions and tenant scope.
- Unknown or invalid routes fail closed.
- Responses include CSP, anti-framing, no-sniff, referrer and no-store headers.
- Database credentials are held only in GitHub Actions memory and the Cloudflare Worker secret store.
- Existing Neon module branches are not deleted, reset or repurposed.

## Follow-up milestones

1. Replace placeholder OIDC settings with a dedicated staging identity application and test users.
2. Add a repeatable staging tenant/store/register/product seed pack.
3. Bind selected Admin and POS actions to live staging APIs.
4. Add browser login, read and controlled-write smoke journeys.
5. Add a custom staging domain after the Workers URL is stable.

## Acceptance gates

- persistent Workers URL remains reachable after workflow completion;
- all required routes return the expected status and marker;
- migrations are checksum-verified and replay-safe;
- no secrets appear in logs or artifacts;
- no production or existing module database branch is mutated;
- root tests, staging unit tests and deployment smoke tests pass.
