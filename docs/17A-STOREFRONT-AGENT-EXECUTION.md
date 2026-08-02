# MOD-H Storefront Agent Execution Appendix

This appendix extends `docs/17-PARALLEL-AGENT-EXECUTION.md` for the post-foundation Storefront Commerce workpack.

## Workpack coordinates

| ID | Workpack | Git branch | Worktree | Neon branch | Tracker |
|---|---|---|---|---|---|
| MOD-H | Storefront Commerce and Custom Domains | `module/storefront-commerce-v1` | `.worktrees/storefront-commerce` | `dev/module-storefront-commerce` | `docs/architecture/storefront/status.yaml` |

## Delegation rule

One agent owns all MOD-H work from activation through final handoff. Do not assign separate agents for:

- storefront pages/components;
- product publication;
- cart/checkout;
- custom domains;
- theme/CMS/SEO;
- migrations/API/tests;
- upstream source extraction.

## Branch and continuation rule

A new agent resumes the existing MOD-H branch. It must not create another storefront implementation branch unless the programme integrator explicitly records a replacement. The first read after root instructions is `docs/architecture/storefront/START-HERE.md`.

Before editing:

1. verify repository and branch;
2. verify fixed worktree path;
3. inspect dirty state;
4. verify ancestry from `program/integration-v1`;
5. verify/create the non-production Neon branch;
6. read the machine tracker and continue the first incomplete checkpoint.

## Ownership

MOD-H owns:

- `apps/storefront-web/**`
- `modules/storefront/**`
- `packages/storefront-contracts/**`
- `packages/storefront-client/**`
- `packages/storefront-theme/**`
- `database/modules/storefront/migrations/**`
- `tests/storefront/**`
- `docs/architecture/storefront/**`
- `docs/modules/storefront/**`
- `docs/agent-handoffs/MOD-H-*.md`

Shared composition, existing module schemas/contracts, SaaS control-plane internals and top-level release workflows require an approved CCR or explicit integration patch.

## Contract dependencies

MOD-H consumes but does not replace:

- MOD-A catalog/pricing/tax contracts;
- MOD-B availability/reservation contracts;
- MOD-C customer/order/fulfilment contracts;
- MOD-E payment/refund contracts;
- MOD-F effective localisation/country-support contracts;
- MOD-G entitlement/public integration/control-plane contracts when integrated.

When a dependency is not available on the branch, use frozen contract fixtures. Never import another module's unmerged implementation.

## Source adaptation workflow

For every external adaptation batch:

1. pin the upstream commit;
2. add exact upstream/local paths to `upstream-file-manifest.yaml`;
3. classify the batch as copy/adapt/concept-only/reject;
4. exclude upstream branding, D1 and business authority;
5. replace money/API/domain assumptions before runtime use;
6. run licence, secret, boundary, unit and UI gates;
7. commit provenance and adapted source together;
8. update `status.yaml` and the programme board evidence list.

## Checkpoint sequence

- H0 activation/provenance
- H1 foundation/runtime/contracts
- H2 Neon domain/publication/admin controls
- H3 public catalog/content/cache/SEO
- H4 exact cart/checkout
- H5 customer/order experience
- H6 custom domains/SaaS operations
- H7 hardening/recovery/handoff

No checkpoint is complete from documentation or UI alone. Each checkpoint requires its owned persistence, contracts, failure behavior, tests and evidence.

## Integration

MOD-H development may proceed while MOD-G is active, but integration is serial. Shared custom-domain or entitlement contract changes land through the programme integrator first. MOD-H remains draft until all H0–H7 gates pass and the final handoff identifies exact migration order and integration commits.
