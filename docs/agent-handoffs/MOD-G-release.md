# MOD-G — Main Release Handoff

**Release date:** 2026-07-30  
**Module:** MOD-G — Reporting, Integrations and SaaS Administration  
**Module PR:** `#45`  
**Release PR:** `#49`  
**Module handoff head:** `7da18ba317c4ed6dd7b9e84d149be355a5a5c08c`  
**Integration merge:** `c757ceff4e2a74ee7637804b61c4f656044904b2`  
**Verified release head:** `fd63dfde4d5940112a9c77c2743b281e49ff6b55`  
**Main release SHA:** `63af1a9e7388d99433e2ca8d3403d271abb49459`  
**State:** `complete`

## Release sequence

1. MOD-G completed on `module/reporting-integrations-saas-v1`.
2. Exact module head passed core, browser/accessibility, assigned Neon replay, recovery, Cloudflare and final-readiness gates.
3. PR `#45` was merged serially into `program/integration-v1` with expected-head protection.
4. The combined integration branch was verified through release PR `#49`.
5. The release workflow was hardened for the ten-branch Neon project quota without deleting permanent foundation/module branches.
6. Exact release head `fd63dfde4d5940112a9c77c2743b281e49ff6b55` passed every required release gate.
7. PR `#49` was merged to `main` with expected-head protection, producing `63af1a9e7388d99433e2ca8d3403d271abb49459`.
8. Module, integration, mobile and storefront branches were retained.

## Final release evidence

Foundation CI run `30496191406`:

- verify job `90725485960`;
- `343/343` tests;
- format, lint, architecture boundaries and strict TypeScript;
- secret scan, licence register, SBOM and dependency audit;
- assigned MOD-G Neon full-chain and deterministic replay job `90725574563`;
- Neon recovery job `90725574638`;
- Cloudflare preview, runtime metrics and cleanup job `90725574320`;
- final readiness job `90725828032`.

Foundation Design CI run `30496191402`:

- evidence job `90725485726`;
- Foundation, MOD-F and MOD-G browser/accessibility suites passed;
- MOD-G evidence `7/7`;
- zero axe violations, unexpected clipping or viewport overflow;
- keyboard, landmark, reduced-motion, RTL and 200% scaling checks passed.

## Released capabilities

- explainable, versioned reporting metrics and rebuildable projections;
- exact reconciliation, drill-through and bounded asynchronous exports;
- partner API clients, scopes, credential lifecycle and OpenAPI 3.1;
- signed webhooks, retry, dead-letter and replay;
- generic CSV/REST connectors and Shopify GraphQL adapter;
- SaaS plans, subscriptions, exact usage, entitlements and tenant lifecycle;
- deterministic rollouts, support incidents and approved support impersonation;
- owner/store/finance/inventory/platform reporting views;
- integration-health and SaaS administration consoles;
- workload protection, tenant isolation, credential redaction and recovery evidence.

## Database release

- `RPT-0001`–`RPT-0002`;
- `INT-0001`–`INT-0007`;
- complete deterministic chain and replay verified on assigned non-production MOD-G branch;
- forced RLS, command-only runtime writes, append-only evidence and explicit execute grants;
- no production database or production customer data used.

## Preserved boundaries

- projections are non-authoritative and rebuildable;
- existing business modules retain ledger/command authority;
- credentials remain external/redacted;
- tenant suspension and offboarding preserve business data;
- Bangladesh country-pack legal validation remains `limited`;
- mobile PR `#40` and storefront PR `#48` remain separate draft workstreams;
- marketing and dependency PRs are not part of the MOD-G release.

## Next controlled backlog

1. Resynchronize and verify marketing landing-page PR `#38` against current `main`.
2. Repair and verify the axe-core and Puppeteer dependency update provenance/licence records.
3. Treat TypeScript 7 as a separate major migration rather than an automatic dependency merge.
4. Continue draft mobile and storefront workstreams only through their own workpack gates.
