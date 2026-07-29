\set ON_ERROR_STOP on
\ir ../../../database/foundation/migrations/FND-0001-platform.sql
\ir ../../../database/foundation/migrations/FND-0002-rls.sql
\ir ../../../database/foundation/migrations/FND-0003-reference-slice.sql
\ir ../../../database/foundation/migrations/FND-0004-identity-revocation.sql
\ir ../../../database/foundation/migrations/FND-0005-session-revocation-privilege-hardening.sql
\ir ../../../database/modules/payments/migrations/PAY-0001-payment-platform.sql
\ir ../../../database/modules/payments/migrations/PAY-0002-payment-commands.sql
\ir ../../../database/modules/accounting/migrations/ACC-0001-accounting-core.sql
\ir ../../../database/modules/banking/migrations/BNK-0001-banking-reconciliation.sql
