\set ON_ERROR_STOP on

BEGIN;
SELECT platform.set_request_context(
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000020',
  NULL, NULL, DATE '2026-07-30', 'storefront-public-host-seed', 'trace-public-host-seed'
);
INSERT INTO pricing.price_lists(
  id, tenant_id, code, name, currency, status, active_version, created_by, updated_by
) VALUES (
  '10000000-0000-4000-8000-000000000120',
  '10000000-0000-4000-8000-000000000001',
  'ONLINE-GBP', 'Online GBP', 'GBP', 'draft', NULL,
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
);
INSERT INTO pricing.price_list_versions(
  price_list_id, tenant_id, version, effective_from, effective_to,
  status, business_date, created_by, approved_by
) VALUES (
  '10000000-0000-4000-8000-000000000120',
  '10000000-0000-4000-8000-000000000001',
  3, TIMESTAMPTZ '2026-07-30 00:00:00+00', NULL,
  'active', DATE '2026-07-30',
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
);
UPDATE pricing.price_lists
SET status = 'active', active_version = 3,
    updated_by = '30000000-0000-4000-8000-000000000001', updated_at = now()
WHERE tenant_id = '10000000-0000-4000-8000-000000000001'
  AND id = '10000000-0000-4000-8000-000000000120';
COMMIT;

BEGIN;
SET ROLE store_app_runtime;
SELECT platform.set_request_context(
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000020',
  NULL, NULL, DATE '2026-07-30', 'bind-domain-channel', 'trace-bind-domain-channel'
);
DO $test$
DECLARE
  v_id uuid;
  v_status text;
  v_replayed boolean;
BEGIN
  SELECT binding_id, status, replayed INTO v_id, v_status, v_replayed
  FROM storefront.bind_domain_sales_channel(
    '10000000-0000-4000-8000-000000000170',
    '10000000-0000-4000-8000-000000000171',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000150',
    '10000000-0000-4000-8000-000000000110',
    'active',
    '30000000-0000-4000-8000-000000000001',
    'bind-domain-channel-a', repeat('a', 64),
    'bind-domain-channel-a', 'trace-bind-domain-channel', DATE '2026-07-30'
  );
  IF v_id <> '10000000-0000-4000-8000-000000000170'
     OR v_status <> 'active' OR v_replayed THEN
    RAISE EXCEPTION 'initial domain binding result is invalid';
  END IF;

  SELECT binding_id, status, replayed INTO v_id, v_status, v_replayed
  FROM storefront.bind_domain_sales_channel(
    '10000000-0000-4000-8000-000000000170',
    '10000000-0000-4000-8000-000000000172',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000150',
    '10000000-0000-4000-8000-000000000110',
    'active',
    '30000000-0000-4000-8000-000000000001',
    'bind-domain-channel-a', repeat('a', 64),
    'bind-domain-channel-a-replay', 'trace-bind-domain-channel', DATE '2026-07-30'
  );
  IF NOT v_replayed THEN RAISE EXCEPTION 'domain binding replay was not detected'; END IF;
END $test$;
RESET ROLE;
COMMIT;

RESET ALL;
SET ROLE store_app_runtime;
DO $test$
DECLARE
  v_row record;
  v_count bigint;
BEGIN
  SELECT * INTO v_row FROM storefront.resolve_public_host('SHOP.EXAMPLE.TEST.');
  IF NOT FOUND THEN RAISE EXCEPTION 'active public hostname did not resolve'; END IF;
  IF v_row.tenant_id <> '10000000-0000-4000-8000-000000000001'
     OR v_row.storefront_id <> '10000000-0000-4000-8000-000000000100'
     OR v_row.sales_channel_id <> '10000000-0000-4000-8000-000000000110' THEN
    RAISE EXCEPTION 'public hostname returned the wrong scope';
  END IF;
  IF v_row.request_hostname <> 'shop.example.test'
     OR v_row.canonical_hostname <> 'shop.example.test' THEN
    RAISE EXCEPTION 'public hostname canonical resolution is invalid';
  END IF;
  IF v_row.locale <> 'en-GB' OR v_row.currency <> 'GBP' THEN
    RAISE EXCEPTION 'public hostname locale/currency is invalid';
  END IF;
  IF v_row.price_list_revision <> 'price-list:10000000-0000-4000-8000-000000000120:v3' THEN
    RAISE EXCEPTION 'authoritative price-list revision is invalid: %', v_row.price_list_revision;
  END IF;
  IF v_row.publication_generation <> 'publication:2'
     OR v_row.theme_revision <> 'theme:1'
     OR v_row.layout_revision <> 'layout:0' THEN
    RAISE EXCEPTION 'public revision set is invalid: %, %, %',
      v_row.publication_generation, v_row.theme_revision, v_row.layout_revision;
  END IF;
  IF NOT v_row.capabilities @> ARRAY['catalog.read','checkout.quote','checkout.guest','customer.account']::text[] THEN
    RAISE EXCEPTION 'public capabilities are incomplete';
  END IF;

  SELECT count(*) INTO v_count FROM storefront.resolve_public_host('missing.example.test');
  IF v_count <> 0 THEN RAISE EXCEPTION 'unknown hostname unexpectedly resolved'; END IF;
END $test$;
RESET ROLE;

BEGIN;
SET ROLE store_app_runtime;
SELECT platform.set_request_context(
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000020',
  NULL, NULL, DATE '2026-07-30', 'suspend-public-domain', 'trace-suspend-public-domain'
);
SELECT * FROM storefront.transition_domain(
  '10000000-0000-4000-8000-000000000173',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000150',
  'suspended', 'active', 'provider-host-a', NULL, NULL, false,
  '30000000-0000-4000-8000-000000000001',
  'suspend-domain-public', repeat('b', 64),
  'suspend-domain-public', 'trace-suspend-public-domain', DATE '2026-07-30'
);
RESET ROLE;
COMMIT;

RESET ALL;
SET ROLE store_app_runtime;
DO $test$
DECLARE v_count bigint;
BEGIN
  SELECT count(*) INTO v_count FROM storefront.resolve_public_host('shop.example.test');
  IF v_count <> 0 THEN RAISE EXCEPTION 'suspended domain unexpectedly resolved'; END IF;
END $test$;
RESET ROLE;

SELECT 'storefront public host rehearsal passed' AS result;
