# Stitch Operations Ledger UI authority

Status: implementation authority for Admin Web and POS Web

## Authority order

1. **Operations Ledger visual authority** — Stitch project `9797401750091342175` (`International Store Management & POS — Operations Ledger Impeccable UI`). Its dark stock-room rail, warm ledger-paper workspace, dense operational tables, evidence rails, offline distinction and enterprise control hierarchy are normative.
2. **Complete screen composition authority** — Stitch project `4118306164156863779` (`Store Operating System — Complete Impeccable UI`). It supplies supplemental workflow composition and complete screen coverage where the Operations Ledger project is intentionally terse.
3. `DESIGN.md` remains the repository-level token/accessibility/i18n contract. Existing business behavior, permissions, state machines and domain data remain authoritative over generated presentation fixtures.

Generated HTML is reference evidence, not a replacement for module contracts. The implementation must reuse shared components and preserve functional compatibility.

## Route coverage map

| Product surface | Route | Operations Ledger screen | Screen id |
| --- | --- | --- | --- |
| Dashboard | `/` | Operations Dashboard - Ozzyl Retail Group | `8c48a56475564f1ab686ff038939f102` |
| Catalog | `/catalog` | Catalog - Ozzyl Retail Group | `0270cd1ba00d422e978b37edf1ecde4c` |
| Product Record | `/catalog/products/:productId` | Product Record - Ozzyl Premium Basmati Rice | `b8d92949aa4947fabd7bae161f12c7ce` |
| Catalog Imports | `/catalog/imports` | Catalog Imports - Ozzyl Retail Group | `a9278216d57b4ce4a9e0aabe3297e3f8` |
| Pricing / Price Lists | `/pricing` | Pricing & price lists - Ozzyl Retail Group | `ae3f726458a14e2b9035700edb785cdb` |
| Promotions / Coupons | `/pricing/promotions` | Promotions & coupons - Ozzyl Retail Group | `1e97a427975243678e1770ad1ae1d7d7` |
| Discount Approvals | `/pricing/discount-approvals` | Discount Approvals - Ozzyl Retail Group | `e61c18c065414f7ba88fc1b4a9098944` |
| Tax Configuration | `/tax` | Tax Configuration - Ozzyl Retail Group | `8db054f4c8df4fc5ba33265153d432ac` |
| Tax Exemptions | `/tax/exemptions` | Tax Exemptions - Ozzyl Retail Group | `211704307e584c4886cba0b1320866db` |
| Inventory | `/inventory` | Inventory - Ozzyl Retail Group | `407ec73fe40140298c2b699dfbe38320` |
| Procurement & Receiving | `/procurement` | Procurement & receiving - Ozzyl Retail Group | `eb91034dcf394937b3bc220a642a3ae6` |
| Customers | `/customers` | Customers - Ozzyl Retail Group | `80a1ad1a42294324ba3266ce0840d62a` |
| Sales Orders & Returns | `/sales` | Sales Orders & Returns - Ozzyl Retail Group | `679523e661474af1aeb8211e010e6f6b` |
| Fulfillment | `/fulfillment` | Fulfillment - Ozzyl Retail Group | `290d1debeb654fb3af309a2f0591de3a` |
| Payments & Settlements | `/finance/payments` | Payments & Settlements - Ozzyl Retail Group | `afd68171244f4bee808e65f4ff03f05c` |
| Accounting Ledger | `/finance/accounting` | Accounting Ledger - Ozzyl Retail Group | `ddbbc855416942328883f81d3512b33b` |
| Banking & Reconciliation | `/finance/banking` | Banking & Reconciliation - Ozzyl Retail Group | `9008f52e9d35442093b6ad54ee88e81f` |
| Financial Readiness & Close | `/finance/readiness` | Financial Readiness & Close - Ozzyl Retail Group | `17dbbee401ea4218b38a5700e386ac51` |
| POS Reconciliation | `/pos/reconciliation` | POS Reconciliation - Ozzyl Retail Group | `4adf3a5ee74f407fb3e4f5e738a4fa39` |
| Localization & Country Packs | `/localization` | Localization & country packs - Ozzyl Retail Group | `777284aaba67414e9e7ea619591063c8` |
| Compliance & Evidence | `/compliance` | Compliance & evidence - Ozzyl Retail Group | `8775a0ecfdb043cb9aca69ae605ebec4` |
| Reporting & Exports | `/reporting` | Reporting & exports - Ozzyl Retail Group | `a2b6972dac59431598d49a9a541474f7` |
| Integrations & API | `/integrations` | Integrations & API - Ozzyl Retail Group | `20d00caeb29a4e468743e010115db8fd` |
| SaaS Platform Operations | `/platform/saas` | SaaS Platform Operations - Ozzyl Retail Group | `122b7374077b4c38991e8075dce09ae8` |
| POS Register | POS `/` | POS Terminal - REG-DHK-03 | `22dded10e39b4ac88d5cc03d50908d45` |
| Sync & Offline Operations | POS `/sync` | POS Sync & Offline Operations - Ozzyl Retail Group | `2ecaabddcbdc4c5d9dc121280e966213` |
| Register & Device Diagnostics | POS `/device` | Register & Device Diagnostics - Dhaka Flagship | `ba83da8d6d194cc68403d33f6b309da5` |

Supplemental complete-project screen compositions include Catalog Browser, Product Detail, Catalog Imports, Price Books & Effective Rules, Promotions & Coupons, Discount Approval Queue, Tax Rule Registry, Tax Exemptions & Evidence, Inventory Ledger, Procurement & Receiving, Customer Records, Sales Ledger, Fulfillment Operations, Payments Ledger, Accounting Journals & AR/AP, Bank Reconciliation, Finance Readiness & Close, POS Reconciliation, Localization & Country Packs, Compliance Controls, Reporting Workspace, Integrations & Diagnostics, SaaS Control Plane, POS Register Workspace, POS Sync Queue and POS Device Health in project `4118306164156863779`.

## Non-negotiable implementation rules

- Dark stock-room rail; warm `paper` and `surface` work areas; no gradients, glass, glow or decorative chart-first dashboards.
- Dense tables/ledgers and risk-ordered queues dominate. Metric summaries are compact control rows, not equal decorative cards.
- Important values expose source/provenance, state and next action. Audit/evidence links remain visible beside risky workflows.
- Offline/local state must never look equivalent to server-confirmed state. Conflicts block blind replay.
- Currency, quantity, references and operational counters use tabular numerals.
- English, Bengali, Arabic RTL and Japanese/CJK layouts use logical properties and allow label expansion; no English-width assumptions.
- Loading, empty, error, denied, offline and conflict states have semantic roles, visible recovery guidance and keyboard focus states.
- Existing permissions, domain invariants, immutable-ledger rules and APIs are preserved; this authority changes presentation and composition, not business truth.

## Shared implementation points

- `packages/ui/src/operations-ledger.ts` owns reusable signal, status, state and evidence primitives plus the compatibility layer for module surfaces.
- `packages/ui/src/direction-support.ts` injects the shared authority into both Admin and POS shells while retaining walkthrough and RTL behavior.
- `apps/admin-web/src/app-shell/routes.ts` maps functional routes to Stitch task language without changing route paths or permissions.
- `apps/pos-web/src/operations-ledger.ts` owns dedicated Register, Sync/Offline and Device Diagnostics compositions.
