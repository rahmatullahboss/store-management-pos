# Production launch revocation and suspension boundary

## Purpose

A valid production admission bundle is not sufficient forever. Before every production deployment, the launch checker must also consume a fresh external revocation snapshot that is bound to the exact release digest and exact admission bundle digest.

This boundary prevents a previously admitted release from being deployed after an emergency stop, owner suspension or terminal revocation. It does not create a production deployment, provision an incident system or nominate real owners.

## Required production inputs

Production mode requires all of the following:

- `PRODUCTION_LAUNCH_EVIDENCE_PATH`: bounded admission bundle file;
- `PRODUCTION_LAUNCH_REVOCATION_STATE_PATH`: bounded revocation snapshot file;
- `PRODUCTION_LAUNCH_REVOCATION_EXPECTED_HEAD_DIGEST`: protected checkpoint for the append-only journal head;
- `STORE_DEPLOYMENT_TARGET=production`.

Admission or revocation JSON supplied inline is prohibited. File names, provider details, actor identities, incident references and raw digests are never copied into the aggregate report or error output.

## Journal model

The snapshot contains at most 100 ordered entries. Every entry:

- starts at sequence `1` and increments contiguously;
- binds to the exact release digest and admission bundle digest;
- binds to the previous entry digest, or the journal genesis digest for the first entry;
- has a bounded proposal-to-effective window;
- has a digest-bound reason;
- contains only digest identities and approvals;
- contributes to the snapshot digest and final head digest.

The snapshot lifetime is at most five minutes. A stale, future-dated, malformed, cross-release or cross-admission snapshot fails closed.

The protected expected-head digest is supplied separately from the snapshot. A snapshot that removes valid tail entries and recalculates its own digest is rejected because its head no longer matches the protected checkpoint.

## State transitions

The initial state is `clear`.

| Action | Required state | Result | Approval requirement |
| --- | --- | --- | --- |
| `suspend` | `clear` | `suspended` | operations, platform and security owners; distinct actors |
| `emergency_stop` | `clear` | `suspended` | one security owner and a mandatory incident digest |
| `reinstate` | `suspended` | `clear` | operations, platform and security owners; distinct actors |
| `revoke` | `clear` or `suspended` | `revoked` | operations, platform and security owners; distinct actors |

Revocation is terminal. No later entry is accepted. An emergency stop cannot be silently undone by the security owner alone; reinstatement requires all three independent owner roles.

## Deployment behavior

The admission checker evaluates the normal ten-control, three-owner production bundle first. It then evaluates the revocation snapshot.

- `clear`: the aggregate status is `admitted` and the launch gate may be `clear`;
- `suspended`: the aggregate status is `suspended` and the launch gate is `blocked`;
- `revoked`: the aggregate status is `revoked` and the launch gate is `blocked`.

The command-line checker exits non-zero for a production target whose final launch gate is not clear. Non-production CI remains `not_requested / blocked` and succeeds so it can publish proof that no production launch was attempted.

## Aggregate evidence

The output may include only:

- production control and launch approval counts;
- revocation entry, approval and emergency-stop counts;
- latest action classification;
- revocation state;
- effective aggregate expiry;
- final launch gate and status;
- explicit `identifiersIncluded: false` and `evidenceDigestsIncluded: false` flags.

It excludes actor, approval, admission, release, reason, incident, entry, genesis, head and snapshot digests. It also excludes provider resource names, incident URLs, ticket identifiers, email addresses and secret values.

## E2E coverage

Repository verification covers:

- clear admission with an empty fresh journal;
- normal suspension and three-owner reinstatement;
- one-owner emergency stop and mandatory multi-owner reinstatement;
- terminal revocation from clear and suspended states;
- missing, duplicate and non-distinct approvals;
- stale, malformed, tampered and cross-release evidence;
- invalid transition order;
- chain break and tail truncation against the protected checkpoint;
- missing production files and missing protected head;
- inline evidence prohibition;
- masked command-boundary errors;
- aggregate-only production and non-production reports.

## Remaining external production work

This repository boundary does not provision or prove:

- an immutable external journal authority;
- access controls around the protected expected-head checkpoint;
- named operations, platform or security owners;
- an incident-management provider;
- production deployment credentials or infrastructure;
- automatic rollback, traffic evacuation or key disabling;
- production monitoring, paging or recovery execution.

Until those external controls are provisioned and the ten launch controls have current evidence, production remains blocked.
