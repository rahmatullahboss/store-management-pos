# Impeccable Design Skill Workflow

## 1. Decision

Use [Impeccable](https://github.com/pbakaus/impeccable) as the repository-wide AI design skill and deterministic frontend quality detector for Codex and GitHub Copilot.

Pinned installation:

```text
Project: pbakaus/impeccable
Version: 4.0.3
Commit: 1cf7d7ab0f1ac0bb3319fd20be389a3009f4037d
License: Apache-2.0
```

The skill is vendored into the repository so every worktree and coding agent uses the same design vocabulary, playbooks and detector rules without relying on a mutable global installation.

## 2. Installed provider surfaces

```text
.agents/skills/impeccable/         Codex-compatible project skill
.codex/hooks.json                  Codex edit/stop detector hook
.github/skills/impeccable/         GitHub Copilot project skill
.github/hooks/impeccable.json      GitHub Copilot edit detector hook
third_party/impeccable/LICENSE     Upstream Apache-2.0 license
third_party/impeccable/NOTICE.md   Upstream notices
PRODUCT.md                         Durable product truth read by the skill
```

Codex discovers the skill through `.agents/skills/impeccable/SKILL.md`. GitHub Copilot discovers the mirrored skill under `.github/skills/impeccable/`.

## 3. Manual activation

### Codex

After cloning or after a hook update:

1. Open the repository in Codex.
2. Open `/skills` and verify `impeccable` is listed, or invoke `$impeccable`.
3. Open `/hooks` and approve the project hook.
4. Restart/reload Codex if a newly updated skill is not visible.

Codex requires explicit hook approval. A copied hook file alone does not prove that the local Codex client has trusted it.

### GitHub Copilot

The skill and hook become available after the files are merged into the repository default branch. The repository/folder must be trusted by the Copilot CLI or cloud agent environment.

### Required runtime

Node.js 22 or newer is required for the vendored Impeccable scripts and hook. Verify with:

```bash
node -v
```

## 4. Design authority hierarchy

Design agents must resolve authority in this order:

1. The user’s explicit brief and approved decisions.
2. `PRODUCT.md` for durable product truth.
3. `DESIGN.md` for the established visual system, after it exists.
4. A matching Impeccable surface brief for route-specific strategy.
5. Existing production tokens, components and implemented visual evidence.
6. The relevant Impeccable command playbook and craft floor.

`PRODUCT.md` must not contain palettes, typography recipes or invented visual directions. It records users, purpose, positioning, operating context, constraints, evidence, product principles and accessibility requirements.

`DESIGN.md` is intentionally absent at the planning-only stage. The Foundation Agent creates it only after the first real admin/POS application shell has been built, visually inspected and passed the Impeccable finish review. It must document the implemented visual system rather than a speculative pre-code mood board.

## 5. Mandatory per-session setup

For every session that changes frontend UI, the owning agent runs this once from the repository root:

```bash
node .agents/skills/impeccable/scripts/context.mjs --target <primary-file-or-route>
```

The agent must then:

1. Read the one Impeccable command reference that owns the task.
2. Inspect the target UI and at least one representative source of visual truth such as tokens, theme CSS or a shared component.
3. Load `reference/craft-floor.md` immediately before editing UI.
4. Do not rerun `context.mjs` repeatedly in the same session.

Backend-only, migration-only and documentation-only changes do not require this UI flow.

## 6. Command selection

Use the following commands as workflow stages, not decorative suggestions.

| Situation | Required command/playbook |
|---|---|
| Establish product truth | `$impeccable init` / `reference/init.md` |
| Plan a new screen or multi-screen flow | `$impeccable shape <surface>` |
| Build a new visual surface | general Impeccable new-work flow |
| Record an existing implemented system | `$impeccable document` |
| Extract stable tokens/components | `$impeccable extract <target>` |
| Review UX hierarchy and clarity | `$impeccable critique <target>` |
| Check accessibility, responsive and technical UI quality | `$impeccable audit <target>` |
| Prepare errors, overflow, i18n and edge states | `$impeccable harden <target>` |
| Adapt desktop/tablet/mobile layouts | `$impeccable adapt <target>` |
| Improve checkout/onboarding clarity | `$impeccable clarify` or `$impeccable onboard` |
| Final pre-handoff visual pass | `$impeccable polish <target>` |
| Run deterministic detector directly | `node .agents/skills/impeccable/scripts/detect.mjs <path>` |
| Diagnose skill/config drift | `$impeccable doctor` |

Do not run every command mechanically. Use the smallest sequence that fully covers the type of work.

## 7. Required workflow for a new module surface

One module agent still owns its complete module. Impeccable does not change the programme rule against splitting a module into small agents.

For a new admin, POS or dashboard surface:

1. **Context**
   - Run `context.mjs` once.
   - Read `PRODUCT.md`, existing `DESIGN.md` when present, and the module workpack.

2. **Shape**
   - Define the primary persona, job, frequency, information hierarchy, actions, approvals, empty/loading/error/offline states and responsive constraints.
   - Use `$impeccable shape <surface>` for a substantial new screen or flow.
   - Store route-specific strategy through the Impeccable surface-brief mechanism when it is durable.

3. **Implement**
   - Build the full module workflow in the shared design system.
   - Preserve domain correctness, permission boundaries, audit visibility and exact operational states.
   - Do not hide missing business logic behind attractive placeholder UI.

4. **Harden**
   - Cover loading, empty, error, partial, stale, permission-denied, approval-pending, offline, conflict and retry states as applicable.
   - Test long translated text, Bengali, Arabic/RTL, CJK, large numbers and narrow screens.

5. **Audit**
   - Run deterministic detection on the owned UI paths.
   - Run accessibility, keyboard, responsive and performance checks.
   - Inspect representative desktop and mobile renderings in bounded passes.

6. **Polish and finish**
   - Apply `$impeccable polish <target>` before handoff.
   - Close material design findings or record them honestly as unresolved.
   - Update shared design documentation only when the implementation establishes an approved durable system change.

7. **Handoff**
   - Include design commands used, detector commands/results, screenshots or visual evidence paths, accessibility evidence and unresolved findings in the module handoff.

## 8. Foundation Agent responsibilities

The Foundation Agent owns the first complete visual foundation:

- admin and POS application shells;
- navigation, workspace/location context and permission-aware routing;
- shared layout primitives and responsive behaviour;
- semantic typography, colour, spacing, density, elevation and motion tokens;
- buttons, fields, selectors, tables, filters, status indicators, dialogs, drawers, notifications and audit-history components;
- loading, empty, error, offline and permission-denied patterns;
- keyboard and focus conventions;
- RTL and localisation-safe primitives;
- design detector/hook integration and CI command;
- first representative admin and POS reference flows;
- creation of `DESIGN.md` and `.impeccable/design.json` after the implemented shell passes finish review.

The Foundation Agent must not choose a generic SaaS template and call it a design system. It must derive the operational system from `PRODUCT.md`, actual retail usage, accessibility constraints and the approved direction process.

## 9. Module Agent responsibilities

Each MOD-A through MOD-G agent must:

- inherit the approved Foundation visual system;
- use Impeccable for every substantial owned UI flow;
- avoid introducing a parallel component library or visual language;
- raise an explicit shared-design change when a module needs a durable new primitive;
- keep domain-specific complexity inside the module while using shared shell and primitives;
- provide complete UI states, not only happy-path forms and tables;
- pass the UI completion gate before declaring the module complete.

A module agent may use Impeccable’s shipped finish-review or asset subagents as part of one module’s design process. These are quality-review helpers, not separate module implementation owners, and do not violate the one-agent-per-large-module rule.

## 10. UI completion gate

A UI-bearing workpack is incomplete until all applicable conditions pass:

1. The primary workflows are implemented end-to-end, not as disconnected mock screens.
2. Role, location, permission, approval and audit context is visible where users need it.
3. Loading, empty, error, stale, denied, offline and conflict states are implemented.
4. Keyboard navigation and visible focus work for operational tasks.
5. Screen-reader labels and semantic relationships are present.
6. Contrast, reduced motion and text scaling requirements pass.
7. Desktop, tablet and relevant POS/mobile widths are verified.
8. Bengali/English, Arabic RTL, CJK, mixed-script and long-text fixtures do not break the layout.
9. The deterministic Impeccable detector has no unexplained blocking findings in owned paths.
10. Visual evidence is reviewed against the requested task and approved design system.
11. The module handoff contains the exact design/audit commands and results.
12. Any accepted detector ignore is narrow, documented and justified beside the code or shared configuration.

## 11. Deterministic detector usage

Run against the narrowest owned path during development:

```bash
node .agents/skills/impeccable/scripts/detect.mjs apps/admin-web/src/modules/inventory
node .agents/skills/impeccable/scripts/detect.mjs apps/pos-web/src/modules/checkout
```

Run a broader pre-handoff scan for the affected application:

```bash
node .agents/skills/impeccable/scripts/detect.mjs apps/admin-web
node .agents/skills/impeccable/scripts/detect.mjs apps/pos-web
```

For CI-friendly output:

```bash
node .agents/skills/impeccable/scripts/detect.mjs --json apps/admin-web apps/pos-web
```

Detector output supplements, but does not replace, browser rendering, accessibility testing, user-task verification or domain correctness.

## 12. Hook behaviour

The Codex hook runs after edit/write/patch actions and again as a deeper pass when the agent stops. The GitHub Copilot hook runs after supported UI file edits.

Hooks provide immediate findings but do not authorize agents to:

- alter factual requirements;
- make unrelated visual redesigns;
- bypass module ownership;
- suppress a rule globally to finish faster;
- claim accessibility or responsive quality without actual verification.

If a hook finding is intentionally inapplicable, use the narrowest supported file/line/value ignore with a reason. Shared ignores belong in `.impeccable/config.json` and require review.

## 13. Tracked and ignored Impeccable artifacts

Track shared project authority:

```text
PRODUCT.md
DESIGN.md                                  after the first real design system exists
.impeccable/config.json                    when created
.impeccable/design.json                    when created
.impeccable/live/config.json               when live mode is configured
.impeccable/critique/*.md                  durable review reports
```

Ignore per-developer and ephemeral output:

```text
.impeccable/config.local.json
.impeccable/hook.cache.json
.impeccable/hook.pending.json
.impeccable/*.png
.impeccable/live/server.json
.impeccable/live/sessions/
.impeccable/live/previews/
.impeccable/live/annotations/
.impeccable/live/cache/
.impeccable/live/manual-edit-apply-transaction.json
.impeccable/live/manual-edit-events.jsonl
.impeccable/live/manual-edit-evidence/
.impeccable/live/pending-manual-edits.json
.impeccable/live/deferred-svelte-component-accepts.json
.impeccable/live/*.png
```

## 14. Updating the vendored skill

Do not run an unpinned update directly on `main` or a module branch.

Update procedure:

1. Create a dedicated tooling branch/worktree.
2. Read upstream release notes and license changes.
3. Record the new exact version and commit.
4. Replace both copies:
   - `.agents/skills/impeccable/`
   - `.github/skills/impeccable/`
5. Refresh hook manifests only when upstream schemas changed.
6. Refresh `third_party/impeccable/LICENSE` and `NOTICE.md`.
7. Update `docs/open-source/reuse-register.yaml` and this document.
8. Run hook JSON validation, skill discovery, context, detector help and a representative detector scan.
9. Review the generated diff for unexpected scripts, binaries or provider-specific absolute paths.
10. Merge through a reviewed pull request.

## 15. Security and provenance

- The vendored skill is executable JavaScript and must be reviewed like development tooling.
- Do not grant it production credentials or production customer data.
- Browser/live-mode output must use synthetic or approved test data.
- Do not commit generated screenshots containing sensitive data.
- The upstream Apache-2.0 licence and notices are preserved under `third_party/impeccable/`.
- The exact source revision is recorded in the open-source reuse register.

## 16. Current status

- Impeccable 4.0.3 is vendored for Codex and GitHub Copilot.
- Codex and GitHub hook manifests are present.
- `PRODUCT.md` captures durable product truth.
- `DESIGN.md` is deliberately deferred until the Foundation Agent builds and finishes the first real UI system.
- No production frontend currently exists, so no claim is made that the visual system or detector CI gate has already passed.
