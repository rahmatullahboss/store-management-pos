# Cloudflare Pages Deployment

## Deployment target

- Cloudflare Pages project: `store-operating-system`
- Static asset directory: `apps/marketing-web/src`
- Preview source: pull requests targeting `main`
- Production source: pushes to `main`
- Workflow: `.github/workflows/marketing-pages-deploy.yml`

The landing page is a static HTML, CSS and JavaScript application. It does not require a framework build or a server runtime. Wrangler uploads the source directory directly to Cloudflare Pages.

## GitHub Actions secrets

The repository must expose these encrypted Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The API token must be able to edit Cloudflare Pages projects for the target account. The workflow does not print either secret.

The repository's Foundation Cloudflare verification tooling already uses these same secret names, so the marketing deployment reuses the established credential contract rather than introducing another token format.

## Deployment behaviour

1. A pull request targeting `main` runs repository verification and deploys a Pages preview.
2. The workflow publishes the immutable deployment URL and branch alias into the GitHub deployment record and job summary.
3. A merge to `main` runs the same verification and deploys the production version.
4. Subsequent eligible pushes automatically redeploy; no Cloudflare dashboard upload is required.

Expected production address after the first successful production deployment:

`https://store-operating-system.pages.dev`

Preview addresses are returned by Cloudflare for each deployment and branch. A custom domain can be attached later from the Cloudflare Pages project without changing the application code.

## One-time Cloudflare setup

If the Pages project does not yet exist, the first Wrangler deployment creates or initialises the `store-operating-system` project in the account. If Cloudflare rejects automatic creation because of account policy, create a Direct Upload Pages project with the same name and rerun the workflow.

Do not create the project using Pages Git integration when this workflow is the chosen deployment model. Cloudflare treats Git-integrated and Direct Upload projects as different setup modes; this repository intentionally uses Direct Upload through GitHub Actions so verification remains part of the deployment gate.
