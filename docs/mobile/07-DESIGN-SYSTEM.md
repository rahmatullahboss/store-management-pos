# Store Companion — Mobile Design System

## 1. Authority

Store Companion inherits `DESIGN.md` and the Operations Ledger visual system. This document adapts that system to native mobile constraints. It does not approve a new brand, palette, font family or decorative component library.

Durable shared visual changes require the existing shared-design/contract-change process. Feature packages consume the mobile design-system package and do not define module-specific themes.

## 2. Mobile north star

The first useful screen should answer:

1. Which tenant, store or warehouse am I operating in?
2. What requires attention now?
3. Is the information current, stale, offline or pending?
4. What action can I safely perform here?
5. How can I trace the result to the source document or ledger effect?

The app should feel like a precise, calm operational instrument, not a consumer-shopping app or generic card dashboard.

## 3. Core tokens

Reuse the implemented Operations Ledger palette:

| Token | Value | Mobile use |
|---|---|---|
| `ink` | `#17231e` | Primary text and icons |
| `ink-soft` | `#405049` | Secondary text |
| `muted` | `#59675f` | Metadata/freshness |
| `paper` | `#f5f3ec` | App background |
| `surface` | `#fffefa` | Main work surfaces |
| `surface-raised` | `#ffffff` | Inputs, sheets, dialogs |
| `rail` | `#14251e` | Top context band/navigation rail |
| `rail-soft` | `#20372d` | Secondary dark surface |
| `line` | `#d7ddd8` | Dividers |
| `line-strong` | `#aab6af` | Input/control boundaries |
| `accent` | `#1f6a51` | Primary action/healthy state |
| `accent-strong` | `#15523d` | Pressed/emphasis |
| `accent-soft` | `#dcece5` | Healthy background |
| `attention` | `#8a5a00` | Pending/stale/offline text |
| `attention-soft` | `#fff0c7` | Pending/stale/offline background |
| `danger` | `#9b2c2c` | Failed/denied/destructive |
| `danger-soft` | `#fbe1df` | Failed background |
| `focus` | `#e09a13` | Keyboard/focus highlight where applicable |

Colour never communicates status alone. Every state includes text and accessible semantics.

## 4. Typography

- Use the native/system sans-serif stack available through Flutter platform typography.
- Do not add a network font dependency.
- Preserve multilingual glyph coverage and low-end reliability.
- Use tabular numerals where supported for money, quantity, counts and references.
- Allow system text scaling to at least 200% without clipping essential actions.
- Avoid fixed-height text containers and English-length assumptions.
- Bengali, Arabic RTL, Japanese/CJK, mixed scripts and long values are required fixtures.

Suggested semantic scale, tuned during implementation rather than copied blindly:

- display/context title;
- page/task title;
- section heading;
- body;
- compact operational label;
- numeric total/reference;
- metadata/freshness.

## 5. Shape, spacing and touch

- Controls use approximately the shared 9–10px compact radius; large task containers may use 14px.
- Minimum interactive target is 44×44 logical pixels; prefer 48 where space allows.
- Avoid default pill-shaped buttons/tabs unless the item is genuinely a compact status/filter.
- Use dividers and grouped rows rather than nested card grids.
- Bottom sheets/dialogs are for focused short tasks, not full complex workflows by default.
- Primary actions remain visible near the task context, but must not cover fields or system navigation.
- Destructive actions are separated and require explicit confirmation/reason where policy requires.

## 6. Adaptive app shell

### Phone

- compact top context band with active workspace and sync state;
- bottom navigation with at most five capability-driven destinations;
- additional destinations in a structured “More”/workspace menu;
- task pages use a single reading column;
- large tables become labelled rows or bounded horizontal tables where meaning requires columns.

### Tablet/large screen

- navigation rail;
- list-detail or master-detail layouts for queues and documents;
- persistent context/freshness panel where useful;
- responsive content width without stretching forms excessively.

Breakpoints are based on available width, not device labels. Foldables and split-screen are tested as width changes.

## 7. Navigation model

Potential destinations are composed from capabilities:

- Home;
- Scan/Lookup;
- Work (receiving/count/transfer/fulfilment);
- Approvals;
- Customers/Sales;
- Finance;
- Reports after MOD-G;
- Notifications;
- Settings/Device.

Do not show every module to every user. A user with multiple workspaces changes context through the workspace switcher; the app visibly reloads scoped data before showing it.

Deep links open a neutral loading/authorization state, then resolve to the permitted screen or a safe unavailable result.

## 8. Home and dashboard pattern

Before MOD-G, home is an operational action queue, not an invented KPI dashboard.

Structure:

1. workspace and business-date context;
2. sync/freshness status;
3. highest-risk assigned actions;
4. recent/pending mobile work;
5. quick actions based on capability;
6. source-aware summaries.

After MOD-G, metric cards/rows must include:

- metric name and definition access;
- period/timezone/currency;
- freshness;
- reconciliation/control-total state;
- drill-through action;
- no decorative unexplained total.

## 9. Scan and lookup pattern

- Scanning begins only after user intent/permission.
- Always provide manual barcode/SKU entry.
- Camera view has clear close, torch and permission/recovery controls.
- Scan result presents product identity, unit, location scope and freshness before actions.
- Repeated scan supports high-throughput receiving/counting without excessive animation.
- Audio/haptic confirmation is optional, user-controlled and accompanied by visible state.
- Invalid/unknown/restricted identifiers are distinct states.

## 10. Work queue pattern

Receiving, count, transfer and fulfilment queues use:

- assignment/status/risk ordering;
- store/warehouse and due/business-date context;
- progress and exception count;
- offline availability indicator;
- explicit freshness;
- filters that preserve current scope;
- empty/restricted/error states in the same task location.

A badge does not reveal restricted item counts.

## 11. Form pattern

- Labels remain visible; placeholders are examples, not labels.
- Exact unit, quantity, currency and timezone are shown near inputs.
- Preserve input through validation/network failure.
- Numeric keyboards are hints only; parsing/validation remains locale- and exact-type safe.
- Barcode/serial/batch fields support scan and manual correction.
- Server validation and version conflict show what changed and safe recovery.
- Offline drafts show local-save state and last local save.
- Submission state distinguishes device-pending from server-accepted.
- High-risk actions show approval/assurance requirements before submit.

## 12. Status vocabulary

Use stable plain-language states:

- Current;
- Refreshing;
- Cached as of …;
- Offline;
- Draft saved on this device;
- Pending submission;
- Submitting;
- Accepted;
- Accepted with adjustment;
- Needs approval;
- Conflict—review required;
- Rejected;
- Unknown external status;
- Access changed;
- Update required.

Do not use a green success treatment for locally queued work that the server has not accepted.

## 13. Approval pattern

Approval detail shows:

- requested action and owning domain;
- source document/reference;
- amount/currency or relevant quantity;
- requester, reason and submitted evidence where authorised;
- policy/threshold/expiry;
- current version/freshness;
- required assurance;
- source/drill-through;
- approve/reject/request-more-information actions where supported.

Approval decisions are not placed directly on lock-screen push actions. Stale/superseded state replaces the controls without losing the review context.

## 14. Finance and provenance pattern

- Numeric values use aligned exact formatting.
- Show currency and scope clearly.
- Distinguish operational document, payment status, stock effect and journal effect.
- Read-only journal/source detail is compact but traceable.
- Unknown payment or reconciliation states use attention treatment and recovery guidance.
- Mobile P0 does not make editing financial postings feel casual.

## 15. Offline and sync surfaces

Persistent but calm app-shell state includes:

- online/offline;
- last successful sync;
- pending/rejected/unknown counts;
- data freshness;
- explicit “Sync now” when useful;
- route to reconciliation/detail.

Offline banner must not consume the whole screen indefinitely. It becomes a compact status after acknowledgement, while high-risk blocked actions still explain why they are unavailable.

## 16. Loading, empty and error states

Every feature designs:

- first load;
- refresh with existing stale data;
- no assigned work;
- no search result;
- offline with cache;
- offline without cache;
- permission denied/masked;
- validation error;
- server error;
- version conflict;
- partial batch success;
- pending/rejected operation;
- minimum app update;
- revoked workspace/session/device.

Do not rely only on transient snackbars. Important state and recovery remain in the task location.

## 17. Accessibility

- Semantic labels for controls, status and values.
- Logical focus order and external keyboard support on tablets.
- Visible focus indicator.
- Screen-reader announcements for scan result, local save, submission and conflict.
- Colour-independent status.
- Minimum contrast aligned to WCAG 2.2 AA intent.
- Text scaling to 200%.
- Reduced-motion support.
- No essential timed interaction.
- Touch targets and spacing suitable for store-floor use.
- Charts, when introduced by MOD-G, require textual values/definitions and accessible drill-down.

Automated checks supplement manual TalkBack, VoiceOver, text-scaling, keyboard and task testing.

## 18. Internationalisation and RTL

- Externalise all user-facing strings.
- Use stable message keys and generated localisation resources.
- Do not concatenate translated fragments for sentences.
- Use locale-aware display formatting supplied by effective configuration.
- Keep legal/document language independent from UI locale.
- Use logical start/end alignment.
- Isolate bidirectional SKU, barcode, phone, amount and document-number text.
- Mirror only appropriate navigation/layout; numeric tables, charts and scanner controls may retain functional direction.
- Test Bengali/English fallback, Arabic RTL, Japanese/CJK, mixed scripts, long labels and large values.

## 19. Motion and feedback

- Motion communicates navigation, scan confirmation or state change; it is not decorative.
- Keep durations short and respect reduced motion.
- Haptics are optional and not the only feedback.
- Avoid celebratory animation for approvals, financial actions or locally queued work.
- Preserve user context during refresh rather than replacing the whole screen with a spinner.

## 20. Design implementation gate

Before a mobile UI checkpoint is complete:

- run repository-local Impeccable context/shaping/audit/harden/polish workflow adapted to the target mobile files;
- record DESIGN.md and mobile-design document SHAs;
- test phone/tablet widths, split-screen and rotation where supported;
- test Bengali, English, Arabic RTL and Japanese/CJK fixtures;
- test long content, large numbers and 200% text;
- run automated accessibility checks plus TalkBack/VoiceOver/manual tasks;
- verify offline, stale, denied, conflict and partial-success states;
- capture synthetic visual evidence;
- record detector findings and unresolved limitations;
- do not use production/customer data or invented claims.
