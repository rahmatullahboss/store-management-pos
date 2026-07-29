# Cloudflare Pages Deployment

## Deployment target

- Cloudflare Pages project: `store-operating-system`
- Static asset directory: `apps/marketing-web/src`
- Preview source: trusted pull requests targeting `main` and explicit manual preview runs
- Production source: disabled until launch approvals are recorded
- Workflow: `.github/workflows/marketing-pages-deploy.yml`

The landing page is a static HTML, CSS and JavaScript application. It does not require a framework build or a server runtime. Wrangler uploads the source directory directly to Cloudflare Pages.

## GitHub Actions secrets

The repository must expose these encrypted Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The API token must be able to edit Cloudflare Pages projects for the target account. The workflow does not print either secret.

The repository's Foundation Cloudflare verification tooling already uses these same secret names, so the marketing preview reuses the established credential contract rather than introducing another token format.

## Current deployment behaviour

1. A pull request targeting `main` runs repository verification and marketing browser/accessibility evidence.
2. A trusted same-repository pull request deploys a Pages preview after verification.
3. The workflow publishes the immutable preview URL and branch alias into the GitHub deployment record and job summary.
4. A push to `main` verifies the integrated landing page but does not deploy production.
5. A manual workflow run may deploy another preview under the `manual-preview` branch alias.

Production publishing is intentionally disabled while these decisions remain open:

- final product name, logo and custom domain;
- approved Ozzyl sales/early-access CTA destination;
- pilot validation of pricing, package limits and support costs;
- replacement of synthetic interface evidence with approved product screenshots.

Enabling production requires a separately reviewed workflow change after those launch decisions are documented. It must not be activated by changing a branch name or by an unreviewed push.

## Preview project setup

Before preview deployment, the workflow lists Direct Upload Pages projects and creates `store-operating-system` with `main` reserved as its production branch when the project is absent. Creating the project does not publish the current landing page to production.

Preview addresses are returned by Cloudflare for each deployment and branch. A custom domain can be attached later after launch approval without changing the static application code.

Do not create the project using Pages Git integration while this workflow remains the chosen deployment model. Cloudflare treats Git-integrated and Direct Upload projects as different setup modes; this repository intentionally uses Direct Upload through GitHub Actions so verification remains part of every preview deployment gate.
