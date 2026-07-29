# MOD-D Neon Clean-Rebuild Checkpoint

**Date:** 2026-07-29  
**Project:** `twilight-boat-26805962`  
**Assigned branch:** `dev/module-pos-cash-offline` (`br-rapid-river-axoz0rfs`)  
**Parent:** `main` (`br-spring-grass-ax3ptydv`)

## Reason

The assigned non-production branch had accumulated valid earlier MOD-D rehearsal migrations while the cash migration filenames and marker sequence were still being canonicalized. The resulting historical `CSH-0004` marker no longer matched the final manifest-owned `CSH-0004-runtime-commands.sql` path.

This was an environment-history mismatch, not a destructive migration correction. The repository retains immutable migration markers and refuses to reinterpret an already-applied ID under a different file marker.

## Preservation and reset

Before reset, the full branch state was preserved under:

`archive/mod-d-pre-canonical-cash-chain-20260729`

The assigned branch was then reset from its fixed non-production parent without deleting the preserved state. No production branch, production credential or production data was used.

## Required rebuild gate

The next exact-head MOD-D Neon rehearsal must:

1. apply the complete Foundation → MOD-A → MOD-B → MOD-C → MOD-E → MOD-D chain;
2. apply `POS-0001` through `POS-0007` and `CSH-0001` through `CSH-0006` in manifest order;
3. replay the apply path without duplicate effects or marker drift;
4. confirm all POS/CASH tables have enabled and forced RLS;
5. confirm `store_app_runtime` has zero direct table-write grants;
6. confirm no POS/CASH function grants execution to `PUBLIC`;
7. preserve only reviewed command/helper execution grants;
8. upload the non-secret rehearsal artifact for the exact tested commit.

The MOD-D PR remains draft until the clean rebuild and every other stable-head release gate pass.
