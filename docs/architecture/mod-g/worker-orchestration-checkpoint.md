# MOD-G Worker Orchestration Checkpoint

**Checkpoint date:** 2026-07-29  
**Implementation head:** `abae858f7861c49b3de0397971af9d21bd3c56c6`  
**Review PR:** `#45`  
**State:** active

## Scope completed

### Reporting projection workers

- Added a bounded tenant-scoped projection batch runner.
- The runner validates all selected event identities and tenant scope before command execution.
- Applied and duplicate events are recorded separately.
- Permanent failures are isolated as explicit dead-letter evidence.
- Retryable or unknown infrastructure failures stop the ordered batch and defer all later events, preventing silent cursor gaps.
- Batch size is bounded to protect transactional checkout workloads from reporting pressure.

### Asynchronous export workers

- Added renderer, object-storage and command ports without making exports authoritative.
- Export object keys are generated under a tenant-scoped prefix.
- Format, content type, exact row count, byte count and storage receipt are verified before completion.
- Row and byte ceilings fail closed before storage or completion.
- Renderer and storage failures are normalized to bounded categories without exposing internal error messages or credentials.

### Outbound webhook workers

- Added signer, transport and command ports.
- Only active subscriptions with matching tenant and event scope can run.
- Deliveries are recorded as active before external I/O.
- Successful 2xx responses complete once; transient network, 408, 425, 429 and 5xx outcomes retry while attempts remain.
- Permanent provider rejection, invalid signatures/responses and exhausted attempts enter dead letter.
- Terminal delivery state removes retry scheduling and no signing-key value enters worker output.

### Connector page workers

- Added bounded page reads, mapping ownership validation and tenant/cursor scope checks.
- Only mappings relevant to the active connection, resource and direction are supplied to the adapter.
- Non-terminal pages require an advancing cursor.
- Every record produces append-only sync outcome evidence before cursor advancement.
- Adapter application failures are normalized as deferred outcomes; the cursor advances only after the full page is recorded.

## Verification

Foundation CI run `30478165369`, verify job `90665021102`, passed on the implementation checkpoint:

- format;
- lint;
- architecture boundaries;
- strict TypeScript typecheck;
- build and all `306/306` unit and architecture tests;
- secret scan;
- licence register;
- SBOM generation;
- dependency audit.

The same run started the dedicated MOD-G Neon complete-chain/replay, Neon recovery and Cloudflare preview/runtime gates. Foundation Design CI run `30478174548` covers the unchanged visual surfaces.

## Preserved boundaries

- Reporting workers call command ports and do not write authoritative module ledgers.
- Cross-tenant projection, export, webhook and connector execution fails closed.
- External retries cannot silently skip ordered projection events.
- Export and integration diagnostics do not retain credential or provider-secret values.
- Connector cursors cannot advance before outcome evidence is recorded.
- Mobile application paths and branches are outside this checkpoint and were not modified.

## Next checkpoint

Continue with the public REST/OpenAPI surface, API-client scopes/rate limits/idempotency, webhook replay console contracts, generic REST/CSV connector adapters, SaaS lifecycle orchestration and the reporting/integration/SaaS admin web surfaces.
