# Open-Source Reuse and Build-vs-Borrow Plan

## 1. Objective

Reduce implementation effort and design risk by studying and, where legally and technically appropriate, reusing open-source components. Open source is not automatically free of obligations, safe to copy, compatible with a proprietary SaaS, or inexpensive to maintain.

## Direct answer: can code be copied?

Yes, selected open-source code can be copied or adapted, but only when the exact file/revision license permits the intended proprietary SaaS and distributed POS clients, and all notice/source obligations are satisfied.

The product does **not** need to be written entirely from zero. The safe default is:

- directly reuse approved MIT, Apache-2.0, BSD or ISC libraries/components;
- use ERPNext, Odoo/OCA, Dolibarr and similar copyleft ERP/POS systems mainly as workflow/domain references;
- reimplement the financial, inventory and offline core from this project's independent specifications;
- integrate certified providers and maintained libraries instead of rebuilding commodity protocols;
- never copy code with no license, an unknown license or a custom condition without approval.

The fact that a repository is public does not grant permission to copy it. The `LICENSE`, file headers, subdirectories, bundled assets, contributor terms and exact pinned commit control reuse.

### Direct-copy decision table

| Source/license | Direct copy into proprietary core | Required handling |
|---|---:|---|
| MIT/BSD/ISC | Generally allowed | Preserve copyright/license notice; record exact files and revision |
| Apache-2.0 | Generally allowed | Preserve LICENSE/NOTICE and modification notices; review patent/third-party terms |
| Frappe Framework (MIT) | Technically allowed for MIT files | Keep notices; verify that copied file is framework code, not ERPNext GPL application code |
| Medusa (MIT) | Allowed for reviewed files/modules | Keep MIT notice and provenance; maintain updates/security ownership |
| Apache OFBiz (Apache-2.0) | Allowed for reviewed files/algorithms | Preserve Apache notices; Java/domain mismatch may make clean reimplementation cheaper |
| LGPL | Conditional | Keep LGPL component separable/replaceable; provide required source/relocation rights when distributed; legal review before copying modified portions |
| GPL | Do not copy into closed core by default | Running an unmodified server may be possible, but combined/derived distributed work triggers copyleft; POS/on-prem/client distribution increases risk |
| AGPL | Blocked for closed SaaS core by default | Network users may be entitled to corresponding source for modified/combined AGPL work |
| Open Source POS custom terms | Do not copy into white-label product by default | Its required visible footer/signature conflicts with normal rebranding expectations |
| No license/unknown/custom/source-available | Blocked | Obtain explicit permission or choose another source |

This is an engineering policy, not legal advice. Commercial release still requires qualified license review.

Use four reuse modes:

1. **Research reference** — study workflows, terminology, schemas and tests without copying code.
2. **Dependency** — use an upstream package through its public API under an approved license.
3. **Adapted component** — import/fork selected code with preserved license, attribution and update ownership.
4. **Platform adoption** — build the product on an existing ERP/POS platform; this is a separate product strategy, not a shortcut inside the proposed architecture.

## 2. License policy

### Preferred for direct reuse

- Apache-2.0
- MIT
- BSD-2-Clause/BSD-3-Clause
- ISC

These are generally permissive, but notices, attribution, patent clauses and third-party files still require review.

### Conditional

- LGPL-2.1/LGPL-3.0
- MPL-2.0
- EPL-2.0

Use only after analyzing linking, modification, distribution, source-offer and file-level obligations for the actual deployment model.

### Reference-first / high review

- GPL-2.0/GPL-3.0
- AGPL-3.0
- SSPL and source-available licenses
- custom “modified MIT” or commercial/community licenses

AGPL is particularly material for a network service. GPL/AGPL code should not be copied into a closed proprietary codebase without explicit legal/product approval.

No contributor should decide license compatibility from the repository homepage alone.

## 3. Candidate matrix

| Project | Main value | Reported license | Recommended use | Risk/notes |
|---|---|---|---|---|
| ERPNext | Accounting, stock ledger, purchase/sales document flows, POS | GPL-3.0 | Research reference; golden scenarios | Direct proprietary reuse likely problematic without GPL strategy |
| Frappe Framework | Metadata-driven app framework/workflows | MIT for framework, verify files/apps | Selected concepts/dependencies only after review | ERPNext application remains GPL |
| Odoo Community | Modular ERP/POS/inventory/accounting patterns | LGPL-3.0, verify edition/files | Research and possible isolated interoperability | Ecosystem contains mixed licenses |
| OCA POS modules | Community POS extensions | Often AGPL-3.0/module-specific | Research reference | File/module-level license review required |
| Apache OFBiz | Enterprise entities, accounting/order/inventory processes | Apache-2.0 | Strong reference; possible selected algorithms/tests | Java/runtime mismatch; attribution/patent notices |
| Medusa | Headless commerce products, carts, orders, workflows | MIT | Possible commerce connector/component reference | Does not solve accounting/offline POS |
| Open Source POS | Practical SMB POS workflows and reports | Custom/modified MIT terms in repo | UX/feature reference | Visible attribution/footer condition must be reviewed |
| Dolibarr | SMB ERP/CRM/accounting/inventory workflows | GPL-3.0 | Research reference | Copyleft |
| NexoPOS | Laravel/Vue POS patterns | Verify current repository/product terms | Research reference | License/product version may differ |
| Saleor | Headless commerce architecture | Verify current repository license | Potential ecommerce pattern/reference | Not store accounting/POS foundation |
| WooCommerce | Ecommerce ecosystem/connectors | GPL | Integration target/reference | Do not copy plugin code casually |
| Keycloak | Identity/SSO | Apache-2.0 | Possible external identity option | Operational weight; Workers integration architecture needed |
| Temporal SDK/concepts | Durable workflows | MIT SDKs; server license varies by component | Concept reference if using CF Workflows | Do not import server architecture unnecessarily |
| OpenTelemetry | Observability APIs/SDKs | Apache-2.0 | Approved dependency candidate | Verify Workers runtime support |

Licenses and terms can change or differ by directory/tag. Pin and record the exact revision reviewed.

## 4. What to borrow from ERPNext

Study:

- separation between business documents and stock/general-ledger entries;
- stock ledger and valuation concepts;
- purchase receipt vs purchase invoice;
- sales invoice/POS posting;
- chart of accounts and accounting dimensions;
- serial/batch flows;
- return documents and reversals;
- document state and approval concepts;
- test examples for accounting and inventory.

Do not copy GPL source into the proprietary core. Reimplement behavior from independent requirements and official accounting principles. Maintain clean design notes that describe concepts rather than source code.

## 5. What to borrow from Odoo/OCA

Study:

- module boundaries and extension hooks;
- product variant and unit-of-measure UX;
- POS session and payment flows;
- price list and promotion models;
- multi-company/location configuration;
- localization module packaging;
- hardware/IoT integration patterns;
- community extension needs.

Avoid creating a plugin architecture that allows arbitrary modules to reach all tables. Our extension model should expose stable capabilities and events.

## 6. What to borrow from Apache OFBiz

OFBiz is a useful permissively licensed domain reference for:

- party/person/organization relationships;
- product/category/facility models;
- orders, shipments and fulfillment;
- inventory item and facility concepts;
- accounting entities and posting relationships;
- work effort/process terminology;
- WebPOS/business-process examples.

Potential direct reuse is limited by the Java architecture and model differences. Selected test data, terminology or algorithms may be adapted only with required Apache notices and provenance.

## 7. What to borrow from Medusa and headless commerce projects

Potentially useful:

- commerce API boundaries;
- cart/order workflow composition;
- product/variant/channel concepts;
- fulfillment/payment provider interfaces;
- idempotent workflow patterns;
- integration module packaging;
- admin UI inspiration.

Do not treat headless commerce as the source of accounting truth. POS cash shifts, inventory valuation, purchasing and country fiscalization remain separate core responsibilities.

## 8. Component-level reuse candidates

Prefer mature, narrowly scoped libraries for:

- schema validation;
- UUIDv7 generation;
- exact decimal arithmetic;
- timezone/locale formatting;
- barcode generation/decoding;
- CSV/XLSX streaming;
- PDF/receipt rendering if Workers-compatible;
- OpenTelemetry instrumentation;
- cryptographic signing and JWT/OAuth verification;
- database migrations/query building;
- service-worker/offline storage;
- ESC/POS command generation;
- QR code generation;
- address/phone parsing;
- test data/property testing.

Each dependency must pass runtime compatibility, license, maintenance, security, bundle-size and replacement-cost review.

## 9. Build-vs-borrow decisions

### Build as product core

- tenant/legal-entity/store model;
- stock ledger and valuation posting;
- accounting journal/posting rules;
- POS offline protocol;
- cash/tender ledger;
- country-pack contract;
- provider-neutral payment/fiscal adapter contracts;
- approval/audit model;
- reporting metric catalog;
- entitlements and support tooling.

These determine product correctness and differentiation.

### Borrow as dependencies where possible

- authentication protocol implementation;
- UI component primitives;
- international formatting data;
- cryptographic primitives;
- HTTP/database clients;
- observability protocols;
- file parsing/rendering;
- barcode/QR/printing protocols;
- test frameworks.

### Integrate rather than rebuild

- card processing/acquiring;
- certified fiscal/e-invoice networks;
- shipping/carrier networks;
- email/SMS delivery;
- identity verification where required;
- exchange-rate feeds;
- tax determination for complex jurisdictions when commercially justified;
- accounting exports to external systems.

## 10. Provenance workflow

Before adding copied/adapted code:

1. Create a reuse proposal with purpose and alternatives.
2. Record repository, exact commit/tag and file paths.
3. Capture declared license and every relevant file/header/NOTICE.
4. Run dependency/license/SBOM scan.
5. Review compatibility with product distribution and SaaS model.
6. Record modifications and upstream relationship.
7. Preserve required copyright/license notices.
8. Add tests proving behavior independently.
9. Assign an owner for updates and vulnerabilities.
10. Add entry to `THIRD_PARTY_NOTICES` and provenance registry.
11. Obtain legal approval for copyleft/custom licenses.

No copy-paste from an external repository is allowed without this record.

## 11. Clean-room reference process

For copyleft projects used only as references:

- Researcher documents business behavior, inputs, outputs, invariants and edge cases without copying implementation text.
- Product/architecture documentation cites the source project as inspiration.
- Implementer works from the independent specification and domain principles.
- Tests use original scenarios/data created for this project.
- Avoid identical names/structure unless they are unavoidable industry terms.
- Preserve research notes to show independent implementation.

This process reduces but does not replace legal review.

## 12. Fork policy

Fork only when:

- upstream cannot accept a required change;
- the component is strategically important;
- license permits the planned use;
- security updates can be tracked;
- maintenance ownership is funded;
- divergence is intentionally limited.

Every fork has:

- upstream remote and pinned base;
- patch inventory;
- update/rebase cadence;
- vulnerability notification;
- deprecation/replacement plan;
- tests covering local changes.

Avoid forking full ERP/POS products merely to extract isolated screens.

## 13. Dependency governance

Required controls:

- lockfiles and reproducible installs;
- automated vulnerability/license scanning;
- SBOM per release;
- dependency-update bot with review/tests;
- no unmaintained critical dependency without replacement plan;
- no package whose install/build executes unreviewed privileged scripts;
- package allow/deny policy;
- transitive-license monitoring;
- emergency patch process;
- bundle/runtime compatibility checks for Workers and POS clients.

## 14. UI and design reuse

Market products may inspire workflow research, but do not copy protected branding, images, text or pixel-identical proprietary designs.

Create original:

- information architecture;
- visual system;
- icons/assets or properly licensed alternatives;
- help content;
- receipt/document templates;
- onboarding flows.

Document screenshots used for internal research and do not ship them as product assets.

## 15. Data and fixture reuse

Do not import real customer/vendor demo databases from open projects unless their data license and privacy status are clear.

Create synthetic fixtures covering:

- multiple currencies and tax modes;
- FIFO/weighted-average costing;
- returns and partial refunds;
- batch/serial/expiry;
- offline sync conflicts;
- multi-store transfers;
- Bengali/Arabic/CJK text;
- timezone/DST boundaries;
- accounting close and reversal.

## 16. Recommended initial reuse actions

1. Create comparative domain maps from ERPNext, OFBiz and Odoo without copying code.
2. Build golden accounting/stock scenarios inspired by publicly documented workflows.
3. Evaluate Apache/MIT libraries for barcode, decimal, observability, offline storage and printing.
4. Prototype ecommerce integration using a headless commerce connector or Medusa concepts.
5. Establish SBOM, notice and provenance automation before implementation dependencies grow.
6. Have counsel review GPL/AGPL/LGPL/custom-license policy before any direct reuse.

## 17. Acceptance criteria

- Every dependency has an identified license and source revision.
- Release SBOM and third-party notices are generated.
- No GPL/AGPL/custom-license code exists in the proprietary core without explicit approval.
- Copied/adapted files have provenance and required notices.
- Critical dependencies have maintainers, update paths and vulnerability monitoring.
- Open-source references are separated from implementation specifications.
- Product UI/assets are original or licensed.
- License policy is enforced in CI and contributor guidance.
