# GitHub Actions supply-chain policy

## Immutable references

Every third-party action must use a reviewed full commit SHA. A readable release comment is retained beside the SHA, for example:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
```

Moving tags and branches are prohibited in repository workflows. Dependabot may propose updates, but the resulting tag must be resolved to its official immutable commit before merge.

## Pull-request trust boundary

The format, lint, architecture, typecheck, tests, secret scan, licence register, SBOM and dependency audit jobs run for every pull request, including Dependabot and forks.

Neon and Cloudflare jobs require repository secrets. They run only for trusted same-repository pull requests and trusted pushes. Dependabot and fork pull requests skip these jobs rather than failing because secrets are intentionally unavailable.

## Trusted post-merge verification

The core workflow also runs on pushes to `main` and `program/integration-v1`. This guarantees that a merged dependency update receives the complete Neon preview/recovery and Cloudflare preview/runtime gate under a trusted repository context.

## Update review

1. Confirm the proposed action release in the official action repository.
2. Resolve the release tag to the full immutable commit SHA.
3. Review breaking changes and runner requirements.
4. Run the pull-request verification and design jobs.
5. Merge only after review; verify the trusted push workflow completes.
6. Record exceptions or deferred major upgrades in a GitHub issue.
