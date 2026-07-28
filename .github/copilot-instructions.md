# GitHub Copilot Repository Instructions

Read and follow `AGENTS.md` before making changes.

For any frontend or UI-bearing task:

1. Read `PRODUCT.md` and `docs/18-IMPECCABLE-DESIGN-WORKFLOW.md`.
2. Use the project skill at `.github/skills/impeccable/SKILL.md`.
3. Run the Impeccable context step once for the target surface.
4. Inherit the shared `DESIGN.md` system after it exists; do not create a parallel visual language.
5. Implement complete workflows and states, including loading, empty, error, permission, approval, offline, conflict and localized/RTL behaviour as applicable.
6. Run the deterministic detector and accessibility/responsive checks before handoff.
7. Record design commands, evidence and unresolved findings in the owning module handoff.

One agent owns one complete large workpack. Do not split a module into separate agents for tables, endpoints, screens or tests. Preserve existing changes and obey module path/schema ownership.
