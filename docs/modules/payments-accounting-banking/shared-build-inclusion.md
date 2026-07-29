# Shared build inclusion record

MOD-E owns production TypeScript under `modules/payments`, `modules/accounting` and `modules/banking`. The Foundation compiler and lightweight lint script originally scanned only `apps` and `packages`, which would leave every module workpack outside typecheck/build/lint.

This checkpoint makes the minimal repository-wide integration change:

- add `modules/**/*.ts` to `tsconfig.json`;
- add `modules` to the existing lint source roots.

No frozen shared contract type or another module source path is changed. The change is necessary for module boundary enforcement and CI to validate owned code.
