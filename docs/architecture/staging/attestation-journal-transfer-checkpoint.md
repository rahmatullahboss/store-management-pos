# Attestation journal staging-transfer checkpoint

Date: 2026-08-01

## Purpose

This checkpoint records the history-preserving transfer of the verified internal-token production-attestation receipt-journal implementation into the persistent Admin/POS staging branch.

This is **production-shaped synthetic staging evidence, not production launch approval**. Production credentials, production data and production database branches remain prohibited in this workstream.

## Source verification

- temporary source branch: `agent/internal-token-production-attestation-receipt-postgres`
- verified source head: `9d7221dc2367ce97a4da8ce2b8e387fb68d2b3e3`
- temporary verification PR: `#93`
- temporary PR disposition: closed without merge
- transfer method: non-forced fast-forward
- persistent target branch: `ops/persistent-admin-pos-staging-v1`
- persistent review PR: `#58`

The target branch was an ancestor of the source head with no divergent commits. No squash, rebase, force-push or applied-migration rewrite was used.

## Database compatibility repair

The live PostgreSQL failure was SQLSTATE `42883` at the receipt batch digest assignment. The command supplied the fixed receipt count as an `integer`, while the reviewed digest helper accepted `smallint`.

The repair remains forward-only:

- `FND-0021` provides the reviewed JSON object-cardinality compatibility helper;
- `FND-0022` provides a restricted `integer` receipt-count overload;
- the overload validates the `smallint` range and delegates with an explicit cast to the original digest implementation;
- `PUBLIC` execution is revoked;
- already-applied `FND-0020` and `FND-0021` files were not rewritten.

## Exact target-context verification

Target-context PR merge SHA:

- `f84c93226d88d88e7b9633608b3cf2d3f40e3964`

Successful workflow runs:

- Production Launch Admission: `30680418051`
- Foundation CI: `30680418056`
- Persistent Admin/POS Staging: `30680418068`
- Foundation Design CI: `30680418081`
- Marketing Pages Preview: `30680418088`

Persistent staging job:

- job ID: `91316179562`
- registered manifests: `17`
- registered migrations: `72`
- repository tests: `600/600`
- format, lint, architecture boundaries, TypeScript and build: passed
- secret scan, licence register, SBOM and dependency audit: passed
- full ordered migration-marker verification: passed
- custom authentication and browser/API surfaces: passed
- aggregate operability status/gate: `healthy / clear`

## Live receipt-journal evidence

The dedicated Neon journey verified:

- one atomic thirteen-receipt append;
- exact idempotent replay without a second state advance;
- stale version, journal-head and sequence-checkpoint rejection;
- reused nonce with changed content rejection;
- tampered receipt-entry rejection;
- least-privilege function execution;
- concurrent append serialization;
- transaction rollback and pre/post durable-state equality;
- bounded structural PostgreSQL diagnostics without SQL values, payloads, raw errors or secrets.

## Staging deployment evidence

- Worker: `store-pos-staging`
- URL: `https://store-pos-staging.rahmatullahzisan.workers.dev`
- Worker version: `3facee08-6f7c-4359-b440-1efd953a97ac`
- artifact: `persistent-admin-pos-staging-30680418068`
- artifact ID: `8812011823`
- artifact digest: `sha256:204a3c5ee583a9c92f29bf6f546ed37381a4de04a91a4f071e99e5949f116883`
- artifact files: `9`

## Production blockers retained

This checkpoint does not clear production release. The following remain mandatory:

- non-exportable KMS/HSM signing-key ownership and audited signing access;
- approved scheduled/emergency rotation and revocation operations;
- isolated production Cloudflare/Neon resources and restricted secret ownership;
- production domain, product identity, monitoring, paging and approved SLOs;
- production retention/PITR, encrypted logical recovery and approved RPO/RTO;
- two-person recovery authorization and production-class restore acceptance;
- transactional-email, MFA factor replacement and support governance;
- production message transport, dead-letter ownership and delivery SLOs;
- protected read and command gates for every production-enabled module;
- independent production-launch evidence and approvals.

PR `#58` must remain draft and unmerged until these gates are satisfied.
