# Country-pack support matrix

Support levels describe evidence, not marketing availability. Capability flags are enforced independently; a pack may support localization while fiscal, e-invoice or offline legal issuance remains disabled.

## Bangladesh fixture — `bd-primary@1.0.0`

**Support level:** `limited`

Validated engineering behavior:

- Bengali/English locale fallback and `bn-BD` formatting metadata;
- BDT accounting precision and cash-rounding metadata;
- `Asia/Dhaka` business-day boundaries;
- versioned pack activation and deterministic legal-number allocation;
- immutable legal-document snapshots and correction lineage;
- retention-aware privacy workflow contracts;
- tenant isolation, replay safety and runtime privilege hardening.

Explicit limitations:

- this fixture is not a production tax, legal or accounting compliance opinion;
- fiscal submission is disabled until an approved Bangladesh provider adapter and reviewed golden examples are attached;
- electronic invoicing is disabled;
- offline legal issuance is limited by the effective capability and must fail closed when unsupported;
- document wording/templates require local legal and accountant review before production activation;
- data-residency claims require confirmation of every storage, processing, logging and backup provider.

## Synthetic fixture — `xz-synthetic`

**Support level:** `experimental`

Purpose:

- prove a second pack installs without a country-specific core-schema change;
- exercise RTL and mixed-script content;
- exercise CJK content and a three-decimal synthetic currency;
- prove capability/limitation data controls behavior instead of hard-coded country branches.

The synthetic fixture must never be enabled for a real legal entity or represented as a supported jurisdiction.

## Promotion to `validated`

A country-pack version may be marked `validated` only when all applicable evidence is attached:

1. local legal, tax and accounting review with named version/date;
2. golden examples for receipt, invoice, credit/debit correction and return behavior;
3. tax and accounting mappings verified against integrated MOD-A and MOD-E contracts;
4. fiscal/e-invoice provider certification or explicit `not required` evidence;
5. offline/contingency behavior reviewed against MOD-D controls;
6. privacy, retention and data-residency provider matrix completed;
7. Bengali/English or target-language, RTL/CJK and accessibility evidence as applicable;
8. full migration, tenant isolation, concurrency, replay, recovery and deployment gates passed;
9. documented limitations and support escalation ownership accepted.

A regulatory change creates a new effective-dated pack version and forward migration. Historical documents retain their original pack/template/rule versions.
