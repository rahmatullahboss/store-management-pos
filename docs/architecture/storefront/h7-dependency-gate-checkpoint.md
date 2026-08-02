# MOD-H H7 Dependency Activation Gate Checkpoint

Status: **complete and verified; external dependencies remain unresolved**

Slice: `H7-DEPENDENCY-GATE-08`

Verified implementation head: `88a38c35e4b18dc254176c2729c030678716b5fd`

Implementation Storefront CI: `30753418022`

Latest strengthened verification head: `f06d350d109c5161b03ed26dba852914a6f116f1`

Latest strengthened Storefront CI: `30753736803`

## Purpose

Prevent a partial cross-module/runtime delivery from being mistaken for permission to activate a sensitive storefront surface. This checkpoint adds release policy only. It does not register routes, implement provider authority or change any commerce/domain side effect.

## Dependency re-check

The approved serial integration branch remains `program/integration-v1` at `fd63dfde4d5940112a9c77c2743b281e49ff6b55`.

No hidden owning-module delivery was found:

- `module/customer-sales-fulfillment-v1`: ahead 0, behind 549;
- `module/payments-accounting-banking-v1`: ahead 0, behind 535;
- `module/localization-compliance-v1`: ahead 0, behind 130;
- `module/reporting-integrations-saas-v1`: ahead 0, behind 8.

Issues #97, #98, #100, #101, #102, #104, #107 and #108 therefore remain unresolved. Each issue thread records the serial-integration handoff and the applicable verified MOD-H consumer boundary.

The desired Neon branch `dev/module-storefront-commerce` also remains externally blocked: the non-production Neon project still has 10 branches with a 10-branch limit. No existing branch was deleted, reset or repurposed.

## Implementation

`modules/storefront/src/dependency-activation.ts` defines the fixed blocker set and protected surfaces, and evaluates readiness only from verified issue numbers.

Required combinations are deliberately conjunctive:

- public cart quote: #97;
- checkout capabilities: #97 + #98 + #100;
- checkout submit: #97 + #98 + #100;
- private profile/order history/order detail/order tracking: #101;
- buyer return/support: #101 + #102;
- tenant domain verification/provider transition/custom-domain activation: #104;
- distributed abuse enforcement: #107;
- operational event sink: #108.

Unknown issue numbers are rejected rather than treated as substitute evidence. Missing required issues produce a fail-closed decision with the exact missing blocker set.

`tests/unit/storefront-dependency-activation.test.mjs` proves:

1. blocker-to-surface associations remain consistent with `dependency-integration-acceptance.json`;
2. every protected surface denies with no verified dependency;
3. omitting any one required issue denies even if every other known issue is marked verified;
4. checkout capabilities/submit cannot activate from only a subset of #97/#98/#100;
5. buyer return/support requires both trusted customer binding (#101) and buyer-safe return/support authority (#102);
6. unknown issue numbers cannot substitute for an approved blocker;
7. assertion-mode activation succeeds only after the complete required set is supplied.

The activation policy is release-time evidence, not live runtime authority.

## Static live-root isolation

`tests/unit/storefront-dependency-integration-acceptance.test.mjs` was strengthened at `f06d350d109c5161b03ed26dba852914a6f116f1` to explicitly prove that live `apps/api/src/index.ts` and `apps/storefront-web/src/runtime.ts` do not import or invoke:

- `dependency-activation`;
- `evaluateStorefrontDependencyActivationV1`;
- `assertStorefrontDependencyActivationV1`.

Existing static fail-closed checks also continue to exclude cart quote, checkout capability, private account, domain-provider, distributed-abuse-provider and operational-sink bridges from live roots.

The policy therefore cannot itself become an accidental activation mechanism. Actual route/provider registration still requires an explicit integration change after the complete owning dependency set has been delivered and verified.

## Verification history

The first implementation attempt at `854540a9881f0488bf51e2f740a95f9293b9be68` failed TypeScript because frozen numeric arrays widened to `readonly number[]`. No blocker requirement or security rule was changed. The source was corrected to preserve literal issue types with readonly tuples.

### Implementation verification

Exact implementation head: `88a38c35e4b18dc254176c2729c030678716b5fd`.

Storefront CI `30753418022` passed all five lanes:

- verify `91511363027` — passed;
- PostgreSQL rehearsal `91511448363` — passed;
- browser/accessibility/performance `91511448385` — passed;
- Cloudflare preview/runtime/cleanup `91511448339` — passed;
- non-destructive Neon recovery `91511448509` — passed.

Browser evidence at this head:

- Astro: 27 files, 0 errors, 0 warnings, 0 hints;
- buyer: 5/5 scenarios across 4 locales with one low-bandwidth scenario;
- admin: 4/4;
- public content: 3/3;
- public catalog: 3/3;
- public discovery: 3/3 with 0 Axe violations;
- public search/filter: passed with 0 Axe violations;
- checkout recovery: 4/4;
- order tracking: 4/4;
- bounded synthetic performance: 64/64 requests, p95 **88.05 ms**, not a production SLA.

Evidence artifact:

- artifact ID: `8835204935`;
- files: 45;
- SHA-256: `062c7466453af712c52a615542eace8b1f4953661cf676bb936e0e0ac93a634f`.

### Strengthened isolation verification

Exact strengthened verification head: `f06d350d109c5161b03ed26dba852914a6f116f1`.

Storefront CI `30753736803` passed all five lanes:

- verify `91512213388` — passed;
- PostgreSQL rehearsal `91512301655` — passed;
- browser/accessibility/performance `91512301671` — passed;
- Cloudflare preview/runtime/cleanup `91512301660` — passed;
- non-destructive Neon recovery `91512301823` — passed.

Fresh browser evidence:

- Astro: 27 files, 0 errors, 0 warnings, 0 hints;
- buyer: 5/5 scenarios across 4 locales with one low-bandwidth scenario;
- admin: 4/4;
- public content: 3/3;
- public catalog: 3/3;
- public discovery: 3/3 with 0 Axe violations;
- public search/filter: passed with 0 Axe violations;
- checkout recovery: 4/4;
- order tracking: 4/4;
- bounded synthetic performance: 64/64 requests, p95 **59.76 ms**, not a production SLA.

Fresh evidence artifact:

- artifact ID: `8835292030`;
- files: 45;
- SHA-256: `71866e18b9baae63e2be69f4e71554acf506d5df5c9c619bf510a178573b9e0e`.

## Safety result

No route, provider or side effect was activated by this slice. Checkout, private account/order, buyer return/support, trusted domain provider transitions, distributed abuse enforcement and operational sink delivery remain fail closed until their complete owning dependency sets are delivered through `program/integration-v1` and pass fresh exact-head verification.
