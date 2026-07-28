# Operations Ledger Design System

**Status:** Implemented Foundation visual system
**Foundation checkpoint:** 2026-07-28
**Owned surfaces:** Admin web, POS web and shared UI primitives

## North star

The visual system is called **Operations Ledger**. It makes operational state, exceptions and provenance primary. It intentionally avoids a generic equal-card SaaS dashboard.

The first viewport must answer four questions quickly:

1. Where am I operating?
2. What needs attention now?
3. Is the system safe and synchronised?
4. How can I trace a number or action to its source and ledger effects?

## Visual character

The system combines a dark stock-room navigation rail, warm ledger-paper work surfaces, ledger-green actions, receipt-like numeric alignment and compact operational controls. The result should feel precise, calm and durable rather than decorative.

- **Dark rail:** stable navigation and location context.
- **Warm paper:** long operational sessions without harsh white glare.
- **Ledger green:** primary action, healthy state and traceability.
- **Amber:** pending decisions, offline state and recoverable attention.
- **Red:** destructive, denied or failed states only.
- **Numeric alignment:** totals, quantities and references use tabular alignment where possible.

## Colour tokens

| Token | Value | Usage |
|---|---|---|
| `ink` | `#17231e` | Primary text |
| `ink-soft` | `#405049` | Secondary explanatory text |
| `muted` | `#59675f` | Metadata and supporting labels |
| `paper` | `#f5f3ec` | Application background |
| `surface` | `#fffefa` | Main work surfaces |
| `surface-raised` | `#ffffff` | Inputs and raised controls |
| `rail` | `#14251e` | Navigation rail and strong operational bands |
| `rail-soft` | `#20372d` | Rail secondary surfaces |
| `line` | `#d7ddd8` | Standard separators |
| `line-strong` | `#aab6af` | Input and control boundaries |
| `accent` | `#1f6a51` | Primary actions and healthy status |
| `accent-strong` | `#15523d` | Hover/action emphasis |
| `accent-soft` | `#dcece5` | Healthy background |
| `attention` | `#8a5a00` | Pending/offline text |
| `attention-soft` | `#fff0c7` | Pending/offline background |
| `danger` | `#9b2c2c` | Failure/destructive state |
| `danger-soft` | `#fbe1df` | Failure background |
| `focus` | `#e09a13` | Visible keyboard focus |

Do not introduce module-specific palettes. A durable new semantic colour requires a shared-design change request.

## Typography

The Foundation uses a system-native sans-serif stack:

```css
ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
```

This is deliberate for low-end devices, offline reliability, multilingual glyph coverage and zero font-loading dependency.

- Page title: `clamp(2rem, 4vw, 3.55rem)`, tight line height and balanced wrapping.
- POS title: `clamp(2rem, 3.6vw, 3rem)`.
- Body: `1rem`, line height `1.45`.
- Operational labels/metadata: approximately `0.7rem–0.78rem`, high enough contrast, often semibold.
- Monetary values and references should use tabular numerals.

## Spacing, shape and elevation

- Primary surface radius: `14px`.
- Compact control radius: `9px` or `10px`.
- Default control minimum height: approximately `44px`.
- Main content padding scales with the viewport through `clamp()`.
- Shadows are restrained and used to distinguish work surfaces, not every item.
- Dense tables remain horizontally scrollable on narrow screens instead of hiding required fields.

## App shell

The shared shell consists of:

- a permission-aware primary navigation rail;
- tenant, location, workspace and business-date context;
- user identity;
- an explicit offline banner when required;
- a skip link and semantic `nav`, `header` and `main` landmarks;
- responsive conversion from left rail to horizontally scrollable navigation below `820px`.

The shell must use logical CSS properties where direction matters. RTL support must not rely on duplicated left/right layouts or fixed viewport widths.

## Admin pattern

The reference admin surface establishes this hierarchy:

1. Task-oriented page heading and primary actions.
2. Strong operational signal band.
3. Risk-ordered work queue.
4. Adjacent provenance/trace panel.
5. Foundation service states.

Dashboards must not present unexplained totals. Important values need source, context and a drill-through path.

## POS pattern

The reference POS surface establishes:

1. Register, business date and synchronisation state.
2. Barcode/search-first product workspace.
3. Keyboard-accessible filters and results.
4. Persistent current-sale/cart panel.
5. Visually dominant payment action.
6. Explicit assurance that stock and ledger effects post only after payment confirmation.

Offline mode must be visible, calm and actionable; it must never appear equivalent to confirmed online posting.

## Resilient states

Shared state patterns exist for:

- loading;
- empty;
- error;
- permission denied;
- synchronisation conflict;
- offline operation.

States use semantic roles, `aria-live`, `aria-busy` where appropriate, clear recovery copy and an explicit next action. Modules must also implement stale and approval-pending states when their workflows require them.

## Accessibility contract

- First Tab focuses the visible skip link; Enter moves focus to `main`.
- Every interactive control has a visible focus outline.
- Admin and POS surfaces preserve semantic landmarks and labelled controls.
- Reduced-motion preferences disable non-essential transitions.
- Text scaling to 200% must not cause root horizontal scrolling.
- Tables and navigation may own bounded internal horizontal scrolling.
- Colour is not the only status indicator.
- Automated Axe results supplement manual task and visual review; they do not replace it.

## Internationalisation contract

The Foundation browser matrix covers English, Bengali, Arabic RTL and Japanese/CJK representative fixtures. The design system guarantees layout expansion and direction safety, not completion of every product translation.

Module agents must:

- externalise user-facing copy;
- test long labels, mixed scripts and large numbers;
- preserve logical alignment in RTL;
- avoid fixed widths based on English copy;
- use locale/currency/business-date formatters rather than embedded display strings in production flows.

## Component reuse rule

Module agents inherit the shared shell, tokens, state patterns, status chips, controls, tables and responsive rules. They must not introduce a parallel component library or visual language. A missing durable primitive is proposed through the shared-design change process and integrated serially.

## Verification baseline

The Foundation gate is backed by:

- `npm run design:verify`;
- Impeccable deterministic detector findings: `0`;
- seven browser scenarios passed: `7/7`;
- Axe WCAG 2 A/AA and WCAG 2.1 AA violations: `0`;
- desktop, tablet and mobile coverage;
- English, Bengali, Arabic RTL and Japanese/CJK fixtures;
- loading, empty, error, denied, conflict and offline states;
- keyboard skip-link, reduced-motion and 200% text checks;
- screenshot and machine-readable evidence under `docs/architecture/foundation/design-evidence/`.

All fixtures are synthetic. No production credentials or customer data are used.

## Known boundary

This Foundation establishes the visual language and reference flows, not the final implementation of every business module. Full translations, module-specific workflows and advanced dialogs/drawers are owned by MOD-A through MOD-G and must pass the same completion gate.
