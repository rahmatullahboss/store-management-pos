\set ON_ERROR_STOP on

INSERT INTO platform.tenants(id, code, display_name, home_region, status, default_locale, default_time_zone) VALUES
  ('10000000-0000-4000-8000-000000000001', 'storefront-a', 'Storefront Tenant A', 'test', 'active', 'en-GB', 'Europe/London'),
  ('20000000-0000-4000-8000-000000000001', 'storefront-b', 'Storefront Tenant B', 'test', 'active', 'en-GB', 'Europe/London');
INSERT INTO platform.users(id, identity_subject, display_name, email_normalized, status) VALUES
  ('30000000-0000-4000-8000-000000000001', 'storefront-rehearsal-actor', 'Storefront Rehearsal Actor', 'storefront-rehearsal@example.test', 'active');
INSERT INTO platform.legal_entities(id, tenant_id, code, legal_name, base_currency, country_code, time_zone, status) VALUES
  ('10000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000001', 'ENTITY-A', 'Tenant A Ltd', 'GBP', 'GB', 'Europe/London', 'active'),
  ('20000000-0000-4000-8000-000000000010', '20000000-0000-4000-8000-000000000001', 'ENTITY-B', 'Tenant B Ltd', 'GBP', 'GB', 'Europe/London', 'active');
INSERT INTO platform.stores(id, tenant_id, legal_entity_id, code, display_name, time_zone, status) VALUES
  ('10000000-0000-4000-8000-000000000020', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000010', 'STORE-A', 'Store A', 'Europe/London', 'active'),
  ('20000000-0000-4000-8000-000000000020', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000010', 'STORE-B', 'Store B', 'Europe/London', 'active');

BEGIN;
SET ROLE store_app_runtime;
SELECT platform.set_request_context(
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000020',
  NULL, NULL, DATE '2026-07-30', 'storefront-rehearsal-a', 'trace-storefront-a'
);

DO $test$
DECLARE
  v_id uuid;
  v_status text;
  v_replayed boolean;
  v_generation bigint;
  v_revision bigint;
  v_count bigint;
BEGIN
  BEGIN
    INSERT INTO storefront.storefronts(
      id, tenant_id, legal_entity_id, code, display_name, default_locale,
      default_currency, time_zone, created_by, updated_by
    ) VALUES (
      gen_random_uuid(), '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000010', 'forbidden', 'Forbidden',
      'en-GB', 'GBP', 'Europe/London',
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'runtime direct storefront insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  SELECT storefront_id, replayed INTO v_id, v_replayed
  FROM storefront.create_storefront(
    '10000000-0000-4000-8000-000000000100',
    '10000000-0000-4000-8000-000000000101',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000010',
    '10000000-0000-4000-8000-000000000020',
    'online-a', 'Tenant A Online', 'en-GB', 'GBP', 'Europe/London', 'tenant-a',
    '{}'::jsonb,
    '30000000-0000-4000-8000-000000000001',
    'create-storefront-a', repeat('a', 64),
    'create-storefront-a', 'trace-storefront-a', DATE '2026-07-30'
  );
  IF v_id <> '10000000-0000-4000-8000-000000000100' OR v_replayed THEN
    RAISE EXCEPTION 'initial storefront command result is invalid';
  END IF;

  SELECT storefront_id, replayed INTO v_id, v_replayed
  FROM storefront.create_storefront(
    '10000000-0000-4000-8000-000000000100',
    '10000000-0000-4000-8000-000000000102',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000010',
    '10000000-0000-4000-8000-000000000020',
    'online-a', 'Tenant A Online', 'en-GB', 'GBP', 'Europe/London', 'tenant-a',
    '{}'::jsonb,
    '30000000-0000-4000-8000-000000000001',
    'create-storefront-a', repeat('a', 64),
    'create-storefront-a-replay', 'trace-storefront-a', DATE '2026-07-30'
  );
  IF NOT v_replayed THEN RAISE EXCEPTION 'storefront replay was not detected'; END IF;

  BEGIN
    PERFORM * FROM storefront.create_storefront(
      '10000000-0000-4000-8000-000000000100',
      '10000000-0000-4000-8000-000000000103',
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000010',
      '10000000-0000-4000-8000-000000000020',
      'online-a', 'Tenant A Online', 'en-GB', 'GBP', 'Europe/London', 'tenant-a',
      '{}'::jsonb,
      '30000000-0000-4000-8000-000000000001',
      'create-storefront-a', repeat('b', 64),
      'create-storefront-a-conflict', 'trace-storefront-a', DATE '2026-07-30'
    );
    RAISE EXCEPTION 'idempotency conflict unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  SELECT storefront_id, status, replayed INTO v_id, v_status, v_replayed
  FROM storefront.transition_storefront(
    '10000000-0000-4000-8000-000000000104',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000100', 'active',
    '30000000-0000-4000-8000-000000000001',
    'activate-storefront-a', repeat('c', 64),
    'activate-storefront-a', 'trace-storefront-a', DATE '2026-07-30'
  );
  IF v_status <> 'active' OR v_replayed THEN RAISE EXCEPTION 'storefront activation failed'; END IF;

  SELECT sales_channel_id, replayed INTO v_id, v_replayed
  FROM storefront.create_sales_channel(
    '10000000-0000-4000-8000-000000000110',
    '10000000-0000-4000-8000-000000000111',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000100',
    'web', 'Online Store', '10000000-0000-4000-8000-000000000120',
    '{}'::jsonb, ARRAY['GB']::text[], true, true, 'deny',
    '30000000-0000-4000-8000-000000000001',
    'create-channel-a', repeat('d', 64),
    'create-channel-a', 'trace-storefront-a', DATE '2026-07-30'
  );
  IF v_replayed THEN RAISE EXCEPTION 'initial channel create was replayed'; END IF;

  SELECT sales_channel_id, status, replayed INTO v_id, v_status, v_replayed
  FROM storefront.transition_sales_channel(
    '10000000-0000-4000-8000-000000000112',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000110', 'active',
    '30000000-0000-4000-8000-000000000001',
    'activate-channel-a', repeat('e', 64),
    'activate-channel-a', 'trace-storefront-a', DATE '2026-07-30'
  );
  IF v_status <> 'active' THEN RAISE EXCEPTION 'channel activation failed'; END IF;

  SELECT publication_id, publication_state, cache_generation, replayed
    INTO v_id, v_status, v_generation, v_replayed
  FROM storefront.set_product_publication(
    '10000000-0000-4000-8000-000000000130',
    '10000000-0000-4000-8000-000000000131',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000100',
    '10000000-0000-4000-8000-000000000110',
    '10000000-0000-4000-8000-000000000140',
    'linen-shirt', 'published', NULL, '{}'::jsonb,
    '30000000-0000-4000-8000-000000000001',
    'publish-product-a', repeat('f', 64),
    'publish-product-a', 'trace-storefront-a', DATE '2026-07-30'
  );
  IF v_status <> 'published' OR v_generation <> 1 OR v_replayed THEN
    RAISE EXCEPTION 'product publication result is invalid';
  END IF;

  SELECT publication_id, publication_state, cache_generation, replayed
    INTO v_id, v_status, v_generation, v_replayed
  FROM storefront.set_product_publication(
    '10000000-0000-4000-8000-000000000130',
    '10000000-0000-4000-8000-000000000132',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000100',
    '10000000-0000-4000-8000-000000000110',
    '10000000-0000-4000-8000-000000000140',
    'linen-shirt', 'published', NULL, '{}'::jsonb,
    '30000000-0000-4000-8000-000000000001',
    'publish-product-a', repeat('f', 64),
    'publish-product-a-replay', 'trace-storefront-a', DATE '2026-07-30'
  );
  IF NOT v_replayed OR v_generation <> 1 THEN RAISE EXCEPTION 'publication replay failed'; END IF;

  SELECT domain_id, status, replayed INTO v_id, v_status, v_replayed
  FROM storefront.register_domain(
    '10000000-0000-4000-8000-000000000150',
    '10000000-0000-4000-8000-000000000151',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000100',
    'shop.example.test', 'custom', 'dns_txt',
    '30000000-0000-4000-8000-000000000001',
    'register-domain-a', repeat('1', 64),
    'register-domain-a', 'trace-storefront-a', DATE '2026-07-30'
  );
  IF v_status <> 'verification_pending' THEN RAISE EXCEPTION 'domain registration failed'; END IF;

  SELECT domain_id, domain_status, replayed INTO v_id, v_status, v_replayed
  FROM storefront.record_domain_verification(
    '10000000-0000-4000-8000-000000000152',
    '10000000-0000-4000-8000-000000000153',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000150',
    1, 'dns_txt', '_verify.shop.example.test', repeat('2', 64),
    'verified', 'provider-host-a', '{}'::jsonb,
    TIMESTAMPTZ '2026-07-30 00:00:00+00', TIMESTAMPTZ '2026-07-31 00:00:00+00',
    '30000000-0000-4000-8000-000000000001',
    'verify-domain-a', repeat('3', 64),
    'verify-domain-a', 'trace-storefront-a', DATE '2026-07-30'
  );
  IF v_status <> 'certificate_pending' THEN RAISE EXCEPTION 'domain verification failed'; END IF;

  SELECT domain_id, status, replayed INTO v_id, v_status, v_replayed
  FROM storefront.transition_domain(
    '10000000-0000-4000-8000-000000000154',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000150',
    'active', 'active', 'provider-host-a', NULL, NULL, true,
    '30000000-0000-4000-8000-000000000001',
    'activate-domain-a', repeat('4', 64),
    'activate-domain-a', 'trace-storefront-a', DATE '2026-07-30'
  );
  IF v_status <> 'active' THEN RAISE EXCEPTION 'domain activation failed'; END IF;

  SELECT theme_revision_id, revision, cache_generation, replayed
    INTO v_id, v_revision, v_generation, v_replayed
  FROM storefront.publish_theme_revision(
    '10000000-0000-4000-8000-000000000160',
    '10000000-0000-4000-8000-000000000161',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000100',
    '{"version":"storefront-theme.v1"}'::jsonb, repeat('5', 64),
    '30000000-0000-4000-8000-000000000001',
    'publish-theme-a', repeat('6', 64),
    'publish-theme-a', 'trace-storefront-a', DATE '2026-07-30'
  );
  IF v_revision <> 1 OR v_generation <> 2 OR v_replayed THEN
    RAISE EXCEPTION 'theme publication failed';
  END IF;

  SELECT count(*) INTO v_count FROM storefront.storefronts;
  IF v_count <> 1 THEN RAISE EXCEPTION 'tenant A RLS visibility is invalid'; END IF;
END $test$;

SELECT platform.set_request_context(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000010',
  '20000000-0000-4000-8000-000000000020',
  NULL, NULL, DATE '2026-07-30', 'storefront-rehearsal-b', 'trace-storefront-b'
);

DO $test$
DECLARE
  v_id uuid;
  v_status text;
  v_replayed boolean;
  v_count bigint;
BEGIN
  SELECT storefront_id, replayed INTO v_id, v_replayed
  FROM storefront.create_storefront(
    '20000000-0000-4000-8000-000000000100',
    '20000000-0000-4000-8000-000000000101',
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000010',
    '20000000-0000-4000-8000-000000000020',
    'online-b', 'Tenant B Online', 'en-GB', 'GBP', 'Europe/London', 'tenant-b',
    '{}'::jsonb,
    '30000000-0000-4000-8000-000000000001',
    'create-storefront-b', repeat('7', 64),
    'create-storefront-b', 'trace-storefront-b', DATE '2026-07-30'
  );
  SELECT storefront_id, status, replayed INTO v_id, v_status, v_replayed
  FROM storefront.transition_storefront(
    '20000000-0000-4000-8000-000000000102',
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000100', 'active',
    '30000000-0000-4000-8000-000000000001',
    'activate-storefront-b', repeat('8', 64),
    'activate-storefront-b', 'trace-storefront-b', DATE '2026-07-30'
  );

  BEGIN
    PERFORM * FROM storefront.register_domain(
      '20000000-0000-4000-8000-000000000150',
      '20000000-0000-4000-8000-000000000151',
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000100',
      'shop.example.test', 'custom', 'dns_txt',
      '30000000-0000-4000-8000-000000000001',
      'register-domain-b-duplicate', repeat('9', 64),
      'register-domain-b-duplicate', 'trace-storefront-b', DATE '2026-07-30'
    );
    RAISE EXCEPTION 'cross-tenant duplicate hostname unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  SELECT count(*) INTO v_count FROM storefront.storefronts;
  IF v_count <> 1 THEN RAISE EXCEPTION 'tenant B RLS visibility is invalid'; END IF;
END $test$;
RESET ROLE;
COMMIT;

BEGIN;
SELECT platform.set_request_context(
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000020',
  NULL, NULL, DATE '2026-07-30', 'storefront-owner-assertions', 'trace-storefront-owner'
);
DO $test$
DECLARE
  v_count bigint;
BEGIN
  BEGIN
    UPDATE storefront.theme_revisions
    SET theme_document = '{"tampered":true}'::jsonb
    WHERE tenant_id = '10000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'theme revision mutation unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;

  BEGIN
    UPDATE storefront.command_receipts
    SET response_document = '{"tampered":true}'::jsonb
    WHERE tenant_id = '10000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'command receipt mutation unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;

  SELECT count(*) INTO v_count
  FROM platform.audit_events
  WHERE tenant_id = '10000000-0000-4000-8000-000000000001'
    AND event_type LIKE 'storefront.%';
  IF v_count < 10 THEN RAISE EXCEPTION 'storefront audit evidence is incomplete: %', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM platform.outbox_events
  WHERE tenant_id = '10000000-0000-4000-8000-000000000001'
    AND event_type LIKE 'storefront.%';
  IF v_count < 10 THEN RAISE EXCEPTION 'storefront outbox evidence is incomplete: %', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM storefront.command_receipts
  WHERE tenant_id = '10000000-0000-4000-8000-000000000001';
  IF v_count <> 9 THEN RAISE EXCEPTION 'unexpected command receipt count: %', v_count; END IF;
END $test$;
COMMIT;

SELECT 'storefront PostgreSQL rehearsal passed' AS result;
