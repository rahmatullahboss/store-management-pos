# Internationalization, Localization and Country Packs

## 1. Definition of international support

International support is not equivalent to translating the interface or adding a currency dropdown. The platform must separate globally reusable commerce/accounting behavior from effective-dated country, region, language, tax, fiscal and payment rules.

A country is publicly marked “supported” only after its country pack has been legally and operationally validated. A generic international mode may operate in countries where no regulated fiscal integration is required, but it must clearly disclose unsupported statutory capabilities.

## 2. Localization layers

### Layer 1 — Global core

- Unicode text and identifiers;
- BCP 47 language/locale tags;
- CLDR-based number, currency, date, relative-time and plural formatting;
- IANA timezone identifiers;
- exact currency and tax calculations;
- tax-rule engine;
- configurable legal entities and registrations;
- localized document rendering;
- provider adapter interfaces;
- country-pack lifecycle and versioning.

### Layer 2 — Language pack

- user-interface messages;
- validation and error messages;
- product/category content where tenant-supplied;
- report labels;
- notification templates;
- receipt/invoice presentation strings;
- help content;
- RTL and typography metadata.

### Layer 3 — Country pack

- country code and supported subdivisions;
- default locale/timezone/currency suggestions;
- currency precision and cash rounding policy;
- tax types, jurisdictions, registrations and exemptions;
- invoice/receipt/credit-note legal requirements;
- numbering and fiscal-year behavior;
- fiscal device/cloud-provider adapters;
- e-invoice/e-report schemas and workflows;
- chart-of-accounts template and posting mappings;
- statutory reports;
- retention and correction rules;
- address and identity formats;
- supported payment/shipping providers;
- explicit limitations and certification evidence.

### Layer 4 — Vertical pack

Adds industry behavior such as pharmacy, restaurant, grocery or fuel requirements without changing the global accounting and inventory invariants.

## 3. Country-pack manifest

Each pack should include a machine-readable manifest similar to:

```yaml
id: country-bd
country: BD
version: 1.0.0
effective_from: 2026-01-01
status: draft|validated|certified|deprecated
languages: [bn-BD, en-BD]
currencies: [BDT]
default_timezone: Asia/Dhaka
supported_tax_modes:
  - exclusive
  - inclusive
legal_documents:
  sales_invoice:
    numbering_strategy: legal_entity_fiscal_year
    correction_strategy: credit_note
fiscalization:
  mode: none|device|cloud|reporting
  offline_policy: configured
e_invoicing:
  required: false
accounting_template: coa-bd-general-v1
retention_policy: retention-bd-v1
review:
  legal_reviewer: required
  accounting_reviewer: required
  last_reviewed_at: null
limitations: []
```

Country packs are signed, versioned artifacts. Activation records the exact pack version on every affected legal entity and business document.

## 4. Locale handling

Store these independently:

- user interface locale;
- customer communication locale;
- legal entity/report locale;
- store receipt locale;
- document language;
- formatting locale.

A user may operate an English interface while issuing a legally required bilingual invoice. Do not infer legal document language from browser settings.

Use fallback chains, for example:

```text
bn-BD -> bn -> tenant default -> en
```

Translation keys must be stable identifiers, not original English sentences.

## 5. Unicode, scripts and RTL

- Store all text as Unicode.
- Test Arabic, Hebrew, Bengali, Hindi, Thai, CJK and mixed-script values.
- Support bidirectional text isolation for SKU, phone, amount and invoice-number fields.
- Mirror layout only where appropriate; numbers, charts and hardware controls may not mirror.
- Avoid fixed-width assumptions for labels and buttons.
- Use locale-aware search normalization while preserving original text.
- Do not silently transliterate legal names.
- Generate PDFs with licensed, embeddable fonts selected by the deployment; do not bundle unlicensed font assets.

## 6. Currency architecture

Use ISO 4217 currency codes where applicable and versioned metadata for:

- accounting precision;
- display precision;
- cash denomination and rounding;
- minimum accountable unit;
- active/deprecated status;
- non-standard currencies or stored-value units.

Rules:

- price, tax and journal calculations use exact arithmetic;
- document currency and base currency are both persisted;
- exchange-rate source, timestamp and rate type are recorded;
- historical documents retain the currency metadata version used;
- cash rounding is a separate documented adjustment, not a change to tax silently;
- refunds reproduce original allocations unless law/policy requires current rules.

## 7. Timezone and business date

Store event timestamps in UTC, but business operations require the IANA timezone and local business date used when posting.

A store may define a business-day boundary after midnight, such as 04:00 local time. Therefore:

```text
calendar date != business date in every case
```

Persist:

- `occurred_at_utc`;
- IANA timezone ID;
- local date/time and offset snapshot where required;
- derived business date;
- business calendar/version;
- fiscal period.

Test daylight-saving gaps, overlaps and timezone database updates. Historical reports must not shift when a timezone rule is updated later.

## 8. Address, phone and identity formats

Address data should be structured but flexible:

- country;
- administrative areas with country-specific hierarchy;
- locality;
- postal code;
- address lines;
- organization/person;
- delivery instructions;
- latitude/longitude only when needed and consented.

Do not force every country into state/city/ZIP. Country packs provide labels, required fields and validation patterns.

Phone numbers should be stored in normalized international format when possible, while preserving the user-entered display form. Tax IDs, business IDs and national identifiers use country-specific typed records and masking policies.

## 9. Tax engine

The global engine supports:

- inclusive and exclusive taxes;
- multiple tax components;
- compound or cascading tax;
- origin- or destination-based jurisdiction selection;
- product/service tax categories;
- customer exemption and reverse charge;
- registration thresholds and effective dates;
- zero-rated, exempt and out-of-scope distinctions;
- withholding components where appropriate;
- line- and document-level rounding methods;
- tax on shipping/fees/discount allocations;
- returns and credit-note corrections;
- tax evidence and rule-version snapshots.

A tax calculation output persists every component:

```text
jurisdiction
registration
tax code/rate/rule version
taxable base
rate
amount
inclusive/exclusive flag
rounding adjustment
exemption/reverse-charge evidence
```

Do not embed country names in global tax code. Country packs configure rules and provider adapters.

## 10. Fiscalization and e-invoicing

Country requirements may include:

- certified local fiscal printer/device;
- cryptographic signing;
- real-time or near-real-time authority submission;
- sequential legal numbering;
- QR codes;
- prescribed invoice schemas;
- buyer tax identification;
- outage/contingency reporting;
- immutable archive requirements;
- cancellation or credit-note-only corrections.

The fiscal adapter contract must support capability discovery, validation, submission, acknowledgement, status query, correction and archival evidence.

```text
FiscalDocumentState:
  draft
  validated
  submission_pending
  submitted
  accepted
  rejected
  contingency
  corrected
  archived
```

A sale may be commercially complete while fiscal issuance is pending only if the country pack permits it. The UI must distinguish commercial payment, accounting posting and legal fiscal status.

## 11. Legal document templates

Templates are semantic and versioned. They specify required fields, not only visual layout.

Document types:

- receipt;
- tax invoice;
- simplified invoice;
- sales invoice;
- credit/debit note;
- quotation;
- purchase order;
- delivery note;
- goods receipt;
- customer/supplier statement;
- fiscal closure report.

Every generated legal document stores:

- template and country-pack version;
- source document version;
- language/locale;
- number and fiscal references;
- checksum;
- immutable R2 object reference;
- generation/issue timestamps;
- correction/replacement links.

## 12. Accounting localization

Country packs may provide:

- chart-of-accounts template;
- tax-control accounts;
- inventory/COGS mappings;
- payment-clearing accounts;
- statutory statement layouts;
- fiscal-year defaults;
- account code/name translations;
- rounding and foreign-exchange mappings;
- required accounting dimensions;
- cash/accrual reporting options.

Tenant customization is allowed after initialization, but required statutory mappings must be validated before posting.

Posting rules are effective-dated. Changing a mapping affects future postings and does not rewrite historical journal entries.

## 13. Data residency and cross-border transfer

The platform maintains a capability matrix by deployment region:

- canonical database region;
- object storage location controls;
- backup and disaster-recovery location;
- observability/log destinations;
- support-access location;
- integration-provider transfer locations;
- subprocessors and contracts;
- retention/deletion behavior.

Tenant placement is explicit. A region migration is a controlled workflow and audit event. The global control plane retains only the minimum routing and subscription data.

Do not market data residency more strongly than the actual behavior of Cloudflare, database, logging, support and integration providers combined.

## 14. Privacy localization

The product provides configurable workflows for:

- access/export requests;
- correction;
- deletion/anonymization;
- consent and preference management;
- retention/legal hold;
- breach response;
- processor/subprocessor records;
- purpose and lawful-basis metadata where used.

Legal retention for invoices/accounting may override direct deletion; customer identity should be minimized or pseudonymized where permitted while preserving required records.

Country packs document legal assumptions but are not a substitute for customer legal advice.

## 15. Payments and banking localization

Payment methods differ by country. Core tender types remain stable while adapters provide:

- provider account onboarding;
- supported currencies/countries;
- terminal models;
- authorization/capture/refund capability;
- offline capability;
- settlement files/webhooks;
- fees and payout timing;
- local wallets/bank transfer/QR;
- dispute behavior;
- regulatory limitations.

The platform must support cash and external/manual tenders even where no integrated processor exists. “International” must not depend on one global payment provider.

## 16. Country support levels

| Level | Meaning |
|---|---|
| Core available | Language/currency/timezone and generic documents; no statutory assurance |
| Operational | Tested tax/document configuration for common use; limited fiscal integrations |
| Validated | Local accounting and legal review completed; documented supported scenarios |
| Certified | Required fiscal/e-invoice provider/device certification completed |
| Enterprise | Data residency, SSO, audit and support commitments available |

The product interface and sales materials must state the level and limitations per country.

## 17. Pack development workflow

1. Select country and target business segment.
2. Gather official tax, fiscal, invoice, accounting and retention requirements.
3. Identify certified payment/fiscal/e-invoice providers.
4. Create requirement and capability matrix.
5. Implement pack configuration and adapters.
6. Create golden calculation/document examples.
7. Obtain local accountant and legal review.
8. Test online, offline, returns, corrections and period close.
9. Pilot with controlled tenants.
10. Publish signed version, limitations and support policy.
11. Monitor regulatory changes and issue effective-dated updates.

## 18. Regulatory change management

Every country pack has an owner and review schedule. Changes are classified:

- presentation-only;
- configuration/rate update;
- calculation behavior;
- document schema;
- provider/API update;
- data migration;
- breaking legal correction.

Releases include effective dates, tenant impact, migration plan, validation report and rollback/forward-fix strategy. Future rates/rules can be preloaded but activate only at their effective business time.

## 19. Initial launch recommendation

Launch with:

1. a generic international core;
2. one fully validated primary country pack based on the first commercial market;
3. one secondary pack used to prove that the architecture is not hard-coded;
4. English plus the primary market language;
5. one global card provider adapter where available and at least one local payment adapter;
6. explicit unsupported-country messaging.

For a Bangladesh-first launch, create a Bangladesh pack with local accounting/tax/legal review and Bengali/English support, but do not label any regulatory feature compliant until verified against current official requirements.

## 20. Acceptance criteria

- UI passes representative Latin, Bengali, Arabic/RTL and CJK test data.
- All money/tax calculations are exact and golden-tested.
- Business dates are stable across timezone and DST cases.
- Country rules are versioned and reproducible on historical documents.
- Legal documents retain immutable semantic/render snapshots.
- A second country pack can be added without changing core domain tables for country-specific fields.
- Payment/fiscal provider failures have visible recoverable states.
- Country support level and limitations are visible to administrators.
- Pack activation/deprecation is audited and reversible where legally possible.
- Local accountant/legal validation evidence is stored before “validated/certified” status.
