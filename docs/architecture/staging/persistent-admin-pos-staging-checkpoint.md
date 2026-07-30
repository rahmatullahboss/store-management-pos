# Persistent Admin and POS staging checkpoint

Status: first milestone complete
Verified source head: `d48357b64ab267b0c191ff03e30bf75dbc85e9ec`
Persistent URL: `https://store-pos-staging.rahmatullahzisan.workers.dev`

## Delivered

- fixed Cloudflare Worker `store-pos-staging` that remains deployed after CI completion;
- dedicated Neon staging project `store-management-pos-staging` (`morning-flower-46531465`);
- dedicated Neon `main` branch `br-empty-sound-afkx5vkj` and database `neondb`;
- runtime-only Neon connection URI resolution and Cloudflare `DATABASE_URL` secret upload;
- complete idempotent migration replay and approved synthetic development seed;
- persistent Admin routes using the current shared Admin shell;
- real current inventory and procurement fixture renderers;
- readiness pages for the remaining integrated Admin navigation;
- current POS register renderer with exact BDT fixture totals;
- real API Worker health delegation under `/api/health`;
- no-store, CSP, anti-framing, no-sniff, noindex and referrer protections;
- unit coverage and live HTTP/browser evidence.

## Routes verified

| Route | Expected result |
|---|---|
| `/` | `302` to `/admin` |
| `/admin` | Admin shell and persistent staging notice |
| `/admin/inventory` | Current inventory operations page |
| `/admin/procurement` | Current procurement operations page |
| `/pos` | Current register surface with checkout disabled |
| `/api/health` | Real API health response |
| `/staging/status` | Bounded staging status document |

All seven route probes passed.

## Database evidence

- registered migrations applied or verified: `55`;
- synthetic tenants present: `2`;
- source credentials were not committed or written to artifacts;
- existing module branches in the original non-production project were not deleted, reset or repurposed.

## Live browser evidence

### Admin inventory desktop

- viewport: `1440 × 900`;
- one main landmark and one H1;
- persistent staging disclosure visible;
- Admin inventory navigation resolved correctly;
- keyboard first focus reached the visible skip link;
- skip link moved focus to `#main`;
- zero Axe WCAG A/AA/2.1 AA violations;
- zero page-level horizontal overflow;
- no database URI exposed.

### POS register mobile

- viewport: `390 × 844`;
- one main landmark and one H1;
- persistent staging disclosure visible;
- exact demo totals rendered;
- complete checkout remained disabled;
- zero Axe WCAG A/AA/2.1 AA violations;
- zero page-level horizontal overflow after the staging containment correction;
- no database URI exposed.

## Exact verification

Persistent Admin POS Staging workflow:

- run: `30527115140`;
- job: `90820730822`;
- result: passed;
- artifact: `8753163579`;
- artifact digest: `sha256:2a8b34fefa4dede45caac768f0405a515adaa34b85f8f1571118dae617a3a325`;
- browser scenarios: `2/2`;
- Axe violations: `0`;
- HTTP probes: `7/7`.

The same source also passed repository verification before deployment: format, lint, architecture boundaries, TypeScript, migration validation, complete build/tests, secret scan, licence register, SBOM and dependency audit.

## Honest test boundary

This milestone makes the current Admin/POS browser surfaces persistently accessible and useful for visual, responsive, navigation, accessibility and API-health testing. The browser data is synthetic. Checkout, payment and other authoritative browser writes are deliberately disabled.

The next milestone must configure a dedicated staging identity provider, test users and repeatable business seed pack before enabling controlled live Admin/POS write journeys. No placeholder OIDC issuer may be represented as a working login.
