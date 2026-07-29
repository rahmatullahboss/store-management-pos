# MOD-G Connector Framework Checkpoint

**Date:** 2026-07-30  
**Branch:** `module/reporting-integrations-saas-v1`  
**Review PR:** `#45`

## Delivered adapters

### Generic CSV

- bounded UTF-8 object loading through an injected object-source port;
- configurable delimiter, byte, column and cell limits;
- quoted fields, escaped quotes, CRLF and embedded newlines;
- mandatory unique header and external-ID column;
- deterministic row-offset cursors and stable sync identities;
- duplicate external-ID and malformed-row rejection;
- inbound-only operation until an explicit outbound contract is approved.

### Generic REST

- credential-free HTTPS origin and origin-relative path enforcement;
- credential headers resolved only through an external secret-provider port;
- restricted transport header rejection;
- configurable JSON pointers for records, external IDs and cursor tokens;
- bounded response size and page size;
- retryable classification for timeout, throttling and provider/server outages;
- permanent classification for credential rejection, malformed JSON and invalid provider contracts;
- cursor advancement remains outside the adapter and occurs only after every outcome is recorded by the connector worker.

### Shopify product adapter

- selected as the first launch-demand ecommerce adapter;
- GraphQL Admin API rather than the legacy REST Admin API;
- explicit quarterly API version in configuration rather than a moving `latest` alias;
- cursor-based product pagination capped at 250 records;
- product and variant fields required for catalog mapping;
- access token resolution through the external credential port;
- GraphQL errors, invalid page information and duplicate product IDs fail closed.

## Mapping and conflict controls

- only approved transform versions execute; no dynamic code or expressions are evaluated;
- unsafe paths such as `__proto__`, `prototype` and `constructor` are rejected;
- external-owned inbound fields apply deterministically;
- manual-owned fields produce explicit conflicts when a local value differs;
- platform-owned fields cannot synchronize inbound;
- the existing loop-safety gate remains mandatory before page execution.

## Recovery and outage behaviour

- adapter read failure records no per-item outcome and advances no cursor;
- provider throttling and temporary outages surface as retryable errors;
- malformed provider contracts surface as permanent errors;
- the worker records each item outcome before advancing the cursor;
- a resumed run starts from the last persisted cursor and stable external IDs preserve idempotent outcomes.

## Verification

Implementation head `67f9771804432ae79143d862d68a37e2b0e6f18f` passed:

- Foundation CI verify job `90686647684`;
- `325/325` tests;
- format, lint, architecture boundaries and strict TypeScript;
- secret scan, licence register, SBOM and dependency audit;
- MOD-G complete-chain and deterministic replay job `90686733818`;
- Neon recovery job `90686733744`;
- Foundation Design CI run `30484495340`.

Cloudflare preview/runtime/cleanup evidence is recorded by Foundation CI run `30484495094`.

## Remaining work

- persist SaaS plans, entitlements, subscriptions, exact usage and tenant lifecycle commands;
- add rollout, incident and approved support controls;
- build reporting, integration and SaaS administration web surfaces;
- complete final performance, isolation, recovery, security and observability gates.
