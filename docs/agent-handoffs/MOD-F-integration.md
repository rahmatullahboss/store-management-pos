# MOD-F — Serial Integration Handoff

**Integration date:** 2026-07-29  
**Repository:** `rahmatullahboss/store-management-pos`  
**Source branch:** `module/localization-compliance-v1`  
**Source head:** `8fe496e8725bd887de29db29a8d2e95e65af394b`  
**Target branch:** `program/integration-v1`  
**Review PR:** `#29`  
**Serial integration merge:** `cf93ca25252bc2ef0286fdc4865003d4fb1c7b02`  
**Assigned Neon branch:** `dev/module-localization-compliance` (`br-polished-flower-ax2ph8wp`)

## Integrated scope

- BCP 47 locale fallback, Bengali/English resolution, Unicode RTL and mixed-script behavior.
- Exact currency precision, cash rounding and effective-dated IANA business-day boundaries.
- Signed, versioned and effective-dated country-pack lifecycle with fail-closed capabilities.
- Bangladesh `bd-primary@1.0.0` at documented `limited` support.
- Synthetic second pack proving RTL, CJK, three-decimal currency and schema-independent extensibility.
- Legal-number allocation, immutable legal documents, fiscal-state separation, privacy and retention workflows.
- `LOC-0001` through `LOC-0005`, including transactional audit and outbox evidence.
- Localization/compliance services, authenticated APIs, provider adapters, worker jobs, admin UI and POS adapter.
- Monitoring, permissions, recovery, forward-fix and country-support documentation.

## Source-head gate evidence

The exact source head passed:

- core verification, strict TypeScript, deterministic migration checks, tests, secret scan, licence register, SBOM and dependency audit;
- Design CI with Bengali/English, Arabic RTL tablet and CJK browser coverage and zero Axe violations;
- dedicated MOD-F Neon complete-chain migration, runtime workflow and deterministic replay rehearsal;
- live transactional audit/outbox event-count assertions;
- Neon recovery;
- Cloudflare preview, runtime metrics and cleanup.

## Preserved validation boundary

`bd-primary@1.0.0` remains `limited`. Integration does not constitute a production legal, tax or accounting opinion. Promotion to `validated` remains blocked until named local legal/tax/accounting review, golden legal documents, approved MOD-A/MOD-E mappings, fiscal/e-invoice evidence, offline contingency review and the provider data-residency matrix are attached.

## Integration verification

The integration branch must pass core, design, Neon and Cloudflare gates on merge SHA `cf93ca25252bc2ef0286fdc4865003d4fb1c7b02` before Wave 2 is marked integrated or MOD-G is activated.
