# Third-Party Notices

## @neondatabase/serverless 1.1.0

- Project: Neon Serverless Driver
- Source: https://github.com/neondatabase/serverless
- License: MIT
- Use: Direct HTTP and request-scoped WebSocket PostgreSQL connectivity from Cloudflare Workers.
- Modification: None. The package is consumed as a dependency.

The dependency remains governed by its upstream license and copyright notices.

## TypeScript 5.8.3

- Project: TypeScript
- Source: https://github.com/microsoft/TypeScript
- License: Apache-2.0
- Use: Development-only compiler for reproducible type checking and builds.
- Modification: None. The package is consumed as a pinned npm development dependency and is excluded from runtime deployment.

The dependency remains governed by its upstream licence and copyright notices.

## Impeccable 4.0.3

- Project: Impeccable
- Source: https://github.com/pbakaus/impeccable
- Pinned commit: `1cf7d7ab0f1ac0bb3319fd20be389a3009f4037d`
- Licence: Apache-2.0
- Use: Project-local Codex and GitHub Copilot design guidance, hooks and deterministic frontend quality detection.
- Modification: The upstream skill payload is mirrored into provider-specific directories; the Codex hook command points to the repository-local skill path. Product-specific workflow and context documentation is original to this repository.
- Preserved notices: `third_party/impeccable/LICENSE` and `third_party/impeccable/NOTICE.md`.

The vendored tooling remains governed by the upstream Apache-2.0 licence and notices.

## Puppeteer Core 24.16.0

- Project: Puppeteer Core
- Source: https://github.com/puppeteer/puppeteer
- Licence: Apache-2.0
- Use: Development-only control of the existing system Chrome browser for Foundation screenshot, responsive, keyboard and layout evidence.
- Modification: None. The package is consumed as an exact-pinned npm development dependency and excluded from runtime deployment.

The dependency remains governed by its upstream Apache-2.0 licence and notices.

## axe-core 4.10.3

- Project: axe-core
- Source: https://github.com/dequelabs/axe-core
- Licence: MPL-2.0
- Use: Development-only WCAG 2 A/AA and WCAG 2.1 AA checks against synthetic Foundation UI fixtures.
- Modification: None. The exact-pinned package is injected unmodified into local browser pages and excluded from runtime deployment.

The dependency remains governed by its upstream MPL-2.0 licence and notices.
