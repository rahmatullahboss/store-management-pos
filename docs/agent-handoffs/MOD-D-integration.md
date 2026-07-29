# MOD-D Integration Handoff

## Status

MOD-D POS, Cash, Offline and Hardware has been serially merged into `program/integration-v1` after Wave 1 and before MOD-F. This checkpoint records the integrated composition and provides a clean PR gate over the resulting tree.

## Git evidence

- Approved secured Wave 1 baseline: `6badafe06a9e0013d12ba036160c915b48fe1c13`
- Module code-complete head: `17f7c0887e6836ab895c5a339e179c96a618c360`
- Accepted contract-review commit: `abb771e8a69ada050cb7d0b69229b4a9fe7e3f0b`
- Serial integration merge: `3410e4f60b9ed0d4218dd4c1690730e3040afaef`
- Module pull request: `#27`
- Integration checkpoint branch: `integration/mod-d-v1`

## Contract decision

`CCR-0002` is accepted as an additive, non-breaking extension to the Foundation error taxonomy. `APPROVAL_REQUIRED` preserves the existing response envelope and status selection while allowing POS/cash clients to handle exact approval dependencies without parsing message text. Permission, tenant, target and expiry checks remain server-side and fail closed.

## Composition decisions

- POS register and receipt surfaces inherit the approved shared Operations Ledger shell and accessibility contracts.
- POS reconciliation is an additive permission-scoped admin route and does not replace existing catalog, inventory, sales or finance routes.
- POS/cash API handlers are composed after authenticated request-context creation and retain the existing module routes.
- POS and CASH migrations run after the complete Wave 1 chain and preserve deterministic ordering, checksums, transactions and forced tenant RLS.
- Runtime writes use reviewed security-definer commands; direct POS/CASH table writes and `PUBLIC` function execution remain revoked.
- Offline operations, receipt evidence, checkout identity, cash events/counts/closures and synchronization outcomes remain append-only or explicitly transition-controlled.
- Generic ephemeral Neon preview is skipped only for the MOD-D module PR; assigned-branch full-chain rehearsal is the stronger module gate and integration/main pushes retain generic recovery/preview coverage.

## Verification before integration

- Foundation CI run `30444186108` passed format, lint, architecture boundaries, strict TypeScript, build/tests, secret scan, licence register, SBOM and high-severity dependency audit.
- Foundation Design CI run `30444186138` passed.
- Dedicated MOD-D Neon rehearsal job `90550496115` passed the full Foundation → Wave 1 → POS/CASH migration and replay chain.
- Neon recovery job `90550496102` passed.
- Cloudflare preview/runtime/cleanup job `90550495914` passed.
- No unresolved PR review threads remained before merge.

## Integration checkpoint gate

The `integration/mod-d-v1` pull request must pass core, design, Neon preview/recovery and Cloudflare preview/runtime checks over the exact integrated tree. MOD-D may be marked `integrated` on the programme board only after that checkpoint is green.

## Next phase

After the integration checkpoint passes, MOD-F remains the next serial integration target. MOD-G remains blocked until MOD-D and MOD-F cross-module reporting and integration contracts are stable.
