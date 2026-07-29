# MOD-F: Localization, Country Packs and Compliance

## Assignment

One agent owns the complete internationalization and country-pack workpack. Do not assign separate agents for translation, tax localization, legal documents, fiscalization or privacy workflows.

```text
Git branch:   module/localization-compliance-v1
Worktree:     .worktrees/localization-compliance
Neon branch:  dev/module-localization-compliance
Base SHA:     6badafe06a9e0013d12ba036160c915b48fe1c13
```

The base SHA is the secured Wave 1 `main` baseline after MOD-A, MOD-B, MOD-C and MOD-E integration and GitHub Actions/Neon cold-wake hardening. MOD-F consumes frozen contracts and approved simulators for MOD-D until its serial integration checkpoint is available.

## Mission

Make the core product internationally deployable through versioned language and country packs without adding country-specific columns or logic to other modules.

## Owned paths and schemas

```text
modules/localization/**
modules/compliance/**
modules/country-packs/**
database/modules/localization/**
apps/admin-web/src/modules/localization/**
apps/pos-web/src/localization/**
docs/modules/localization-compliance/**
PostgreSQL schema: localization
Country-pack packages and adapters
```

## Complete scope

- BCP 47 locale, Unicode, CLDR formatting and fallback behavior;
- RTL layout and mixed-script handling;
- language-pack packaging, versioning and translation workflow;
- IANA timezone, store business-day boundary and historical local-time snapshot support;
- currency precision, cash rounding and historical metadata versioning;
- flexible address, phone, tax identity and administrative-area formats;
- signed/versioned country-pack manifest and lifecycle;
- country tax configuration mapped into MOD-A tax engine;
- country chart-of-accounts and posting mappings for MOD-E;
- legal receipt/invoice/credit/debit/delivery document semantics and templates;
- document numbering, fiscal year and correction rules;
- fiscal device/cloud-provider and e-invoice adapter contracts/implementations for the first market where required;
- offline fiscal/contingency capability supplied to MOD-D;
- immutable legal document rendering and R2 archive references;
- country support levels, limitations and administrator capability matrix;
- data residency/retention configuration and tenant placement metadata;
- privacy access/export/correction/anonymization/retention workflows;
- pack migration, activation, deprecation and regulatory-change process;
- initial primary country pack and one synthetic/secondary pack proving extensibility;
- UI, APIs, audits, validation evidence, runbooks and support documentation.

## Contract responsibilities

Produce:

- country-pack manifest/capability contract;
- tax, rounding and document configuration adapters;
- receipt/fiscal/e-invoice request and status;
- legal number allocation/offline capability;
- chart/accounting mapping package;
- retention/privacy operation policies.

Consume:

- price/tax engine hooks;
- sales/return/receipt semantic documents;
- POS offline and hardware capability;
- payment/provider metadata;
- accounting posting/report contracts;
- foundation locale/timezone/currency primitives.

## Required invariants

- country behavior is effective-dated and versioned;
- historical documents retain the exact pack/template/rule version;
- a second country pack installs without core schema changes;
- legal numbering cannot collide within its scope;
- fiscal/e-invoice status is distinct from commercial/payment status;
- unsupported offline legal behavior is blocked explicitly;
- privacy deletion does not destroy legally required ledger history;
- translations never determine legal accounting behavior;
- data residency claims match the combined behavior of every provider.

## Required tests

- Bengali/English, Arabic RTL, CJK and mixed-script UI/document data;
- currency precision and cash rounding;
- timezone/DST/business-day boundaries;
- tax/document effective-date transition;
- legal number concurrency and offline allocation exhaustion;
- fiscal submission timeout/retry/rejection/correction;
- immutable document checksum/regeneration;
- country-pack upgrade and rollback/forward-fix;
- second pack without core modification;
- privacy export/anonymization/retention;
- tenant/role access to restricted identity and documents;
- accountant/legal golden examples for initial country.

## Open-source reuse guidance

Odoo localization modules and ERPNext country workflows are reference-only unless a file passes explicit license review. CLDR/Unicode/IANA data must be used under their applicable terms and recorded as dependencies/data sources.

## Completion gate

- initial country pack reaches its documented validated support level;
- second pack proves no country-specific core schema change;
- legal documents, numbering and correction rules pass golden tests;
- fiscal/e-invoice/offline capability behaves correctly for the target market;
- Bengali/English and RTL test suites pass;
- privacy/retention workflows and data-residency matrix are complete;
- local accounting/legal review evidence and limitations are recorded;
- migrations, UI, security, runbooks and handoff are complete;
- handoff path: `docs/agent-handoffs/MOD-F-handoff.md`.
