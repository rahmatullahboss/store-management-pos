# Impeccable Vendoring Record

- Upstream: `https://github.com/pbakaus/impeccable`
- Version: `4.0.3`
- Commit: `1cf7d7ab0f1ac0bb3319fd20be389a3009f4037d`
- License: Apache-2.0
- Vendored on: 2026-07-28

Vendored payload:

- `.agents/skills/impeccable/` for Codex-compatible project skill discovery;
- `.github/skills/impeccable/` for GitHub Copilot project skill discovery;
- `.codex/hooks.json` and `.github/hooks/impeccable.json` for design-detector hooks.

Local changes are limited to provider placement, the Codex hook command path pointing to `.agents/skills/impeccable/scripts/hook.mjs`, and text-only final-newline/trailing-whitespace normalization required by the repository format gate. Product-specific workflow and context files are original project documentation.

Do not edit the two vendored skill copies independently. Replace both from the same pinned upstream revision through a dedicated reviewed tooling branch. See `docs/18-IMPECCABLE-DESIGN-WORKFLOW.md` and `docs/open-source/reuse-register.yaml`.
